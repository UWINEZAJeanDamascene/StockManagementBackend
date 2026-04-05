const mongoose = require('mongoose');
const ARReceipt = require('../models/ARReceipt');
const ARReceiptAllocation = require('../models/ARReceiptAllocation');
const ARBadDebtWriteoff = require('../models/ARBadDebtWriteoff');
const Invoice = require('../models/Invoice');
const Client = require('../models/Client');
const JournalService = require('./journalService');
const periodService = require('./periodService');
const cacheService = require('./cacheService');
const ARTrackingService = require('./arTrackingService');
const { DEFAULT_ACCOUNTS } = require('../constants/chartOfAccounts');
const { aggregateWithTimeout } = require('../utils/mongoAggregation');

/**
 * AR Service - Handles Accounts Receivable operations
 * Following the rules:
 * - All money: DECIMAL(18,2)
 * - All rates/costs: DECIMAL(18,6)
 * - API money responses: always strings
 * - Reference numbers: DB sequences, zero-padded to 5 digits per year
 * - Posted entries: immutable (corrections via reversal only)
 */

class ARService {
  /**
   * Create a new AR receipt (draft status)
   */
  static async createReceipt(companyId, userId, data) {
    const {
      clientId,
      client,
      receiptDate,
      paymentMethod,
      bankAccountId,
      amountReceived,
      currencyCode = 'USD',
      exchangeRate = 1,
      reference,
      notes,
      allocations = []
    } = data;

    // Support both clientId and client parameters
    const actualClientId = clientId || client;

    // Validate client
    const clientDoc = await Client.findOne({ _id: actualClientId, company: companyId });
    if (!clientDoc) {
      throw new Error('Client not found');
    }

    // Validate amount
    const amountNum = parseFloat(amountReceived);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error('Invalid amount received');
    }

    // Validate allocations if provided
    let totalAllocated = 0;
    if (allocations.length > 0) {
      for (const alloc of allocations) {
        totalAllocated += parseFloat(alloc.amountAllocated) || 0;
      }
      if (totalAllocated > amountNum) {
        throw new Error('Total allocated amount exceeds receipt amount');
      }
    }

    // Create receipt
    const receipt = new ARReceipt({
      company: companyId,
      client: actualClientId,
      receiptDate: receiptDate || new Date(),
      paymentMethod,
      bankAccount: bankAccountId || null,
      amountReceived: mongoose.Types.Decimal128.fromString(amountNum.toFixed(2)),
      currencyCode,
      exchangeRate: mongoose.Types.Decimal128.fromString(parseFloat(exchangeRate).toString()),
      reference: reference || null,
      status: 'draft',
      notes: notes || null,
      createdBy: userId
    });

    await receipt.save();

    // Create allocations if provided
    if (allocations.length > 0) {
      for (const alloc of allocations) {
        const allocation = new ARReceiptAllocation({
          receipt: receipt._id,
          invoice: alloc.invoiceId,
          amountAllocated: mongoose.Types.Decimal128.fromString(parseFloat(alloc.amountAllocated).toFixed(2)),
          company: companyId,
          createdBy: userId
        });
        await allocation.save();

        // Update invoice balance
        await this.updateInvoiceBalance(alloc.invoiceId, parseFloat(alloc.amountAllocated));
      }
    }

    // Invalidate cache
    try {
      await cacheService.bumpCompanyFinancialCaches(companyId);
    } catch (e) {
      console.error('Cache invalidation failed:', e);
    }

    return receipt;
  }

  /**
   * Post an AR receipt (creates journal entry)
   * Validations per Section 1.3:
   * 1. SUM(allocations.amount_allocated) <= receipt.amount_received
   * 2. Each allocation: amount_allocated <= invoice.amount_outstanding
   * 3. All allocated invoices must belong to same client as receipt
   * 4. Period must be open for receipt_date
   */
  static async postReceipt(companyId, userId, receiptId) {
    const receipt = await ARReceipt.findOne({ _id: receiptId, company: companyId });
    if (!receipt) {
      throw new Error('Receipt not found');
    }

    if (receipt.status !== 'draft') {
      const err = new Error('INVALID_STATUS');
      err.status = 400;
      throw err;
    }

    // Step 4: Check period is open for receipt_date
    if (await periodService.isDateInClosedPeriod(companyId, receipt.receiptDate)) {
      throw new Error('Target accounting period is closed');
    }

    // Get allocations for this receipt
    const allocations = await ARReceiptAllocation.find({ receipt: receipt._id });
    
    // Step 1: Validate SUM(allocations) <= amount_received
    const receiptAmount = parseFloat(receipt.amountReceived);
    let totalAllocated = 0;
    
    if (allocations.length > 0) {
      for (const alloc of allocations) {
        totalAllocated += parseFloat(alloc.amountAllocated);
      }
      
      if (totalAllocated > receiptAmount) {
        throw new Error('Total allocated amount cannot exceed receipt amount');
      }

      // Step 3: Validate all allocated invoices belong to same client
      for (const alloc of allocations) {
        const invoice = await Invoice.findById(alloc.invoice);
        if (!invoice) {
          throw new Error('Allocated invoice not found');
        }
        if (invoice.client.toString() !== receipt.client.toString()) {
          throw new Error('Allocated invoice must belong to the same client as the receipt');
        }

        // Step 2: Validate amount_allocated <= invoice.amount_outstanding
        const invoiceOutstanding = parseFloat(invoice.amountOutstanding) || parseFloat(invoice.balance) || 0;
        const allocAmount = parseFloat(alloc.amountAllocated);
        
        if (allocAmount > invoiceOutstanding) {
          const err = new Error('ALLOCATION_EXCEEDS_OUTSTANDING');
          err.status = 422;
          throw err;
        }
      }
    }

    // Determine cash account based on payment method
    let cashAccount;
    const pm = receipt.paymentMethod;
    
    if (pm === 'bank_transfer' || pm === 'cheque') {
      // Use bank account if specified
      if (receipt.bankAccount) {
        const { BankAccount } = require('../models/BankAccount');
        const bankAcct = await BankAccount.findById(receipt.bankAccount);
        if (bankAcct && bankAcct.accountCode) {
          cashAccount = bankAcct.accountCode;
        }
      }
      cashAccount = cashAccount || DEFAULT_ACCOUNTS.cashAtBank;
    } else if (pm === 'card') {
      cashAccount = DEFAULT_ACCOUNTS.cashAtBank;
    } else {
      // cash, other
      cashAccount = DEFAULT_ACCOUNTS.cashInHand;
    }

    const amountNum = parseFloat(receipt.amountReceived);

    // Get client name for narration
    const client = await Client.findById(receipt.client);
    const clientName = client?.name || 'Unknown Client';

    // Create journal entries as two separate entries (debit and credit)
    const debitLine = JournalService.createDebitLine(cashAccount, amountNum, `Customer Receipt - ${clientName} - RCP#${receipt.reference || receipt.referenceNo}`);
    const creditLine = JournalService.createCreditLine(await JournalService.getMappedAccountCode(companyId, 'sales', 'accountsReceivable', DEFAULT_ACCOUNTS.accountsReceivable), amountNum, `Customer Receipt - ${clientName} - RCP#${receipt.reference || receipt.referenceNo}`);

    const entryA = {
      date: receipt.receiptDate,
      description: `Customer Receipt - ${clientName} - RCP#${receipt.reference || receipt.referenceNo}`,
      sourceType: 'ar_receipt',
      sourceId: receipt._id,
      sourceReference: receipt.reference || receipt.referenceNo,
      lines: [debitLine, creditLine],
      isAutoGenerated: true
    };

    const createdJournals = await JournalService.createEntriesAtomic(companyId, userId, [entryA]);
    const journalEntry = Array.isArray(createdJournals) && createdJournals.length > 0 ? createdJournals[0] : null;

    // Calculate unallocated amount
    const unallocatedAmount = amountNum - totalAllocated;

    // Note: Invoice balances are already updated when allocations are created via allocateToInvoice
    // Do NOT update them again here to avoid double-counting

    // Update receipt status
    receipt.status = 'posted';
    receipt.journalEntry = journalEntry._id;
    receipt.postedBy = userId;
    receipt.postedAt = new Date();
    receipt.unallocatedAmount = mongoose.Types.Decimal128.fromString(unallocatedAmount.toFixed(2));
    await receipt.save();

    // Invalidate cache
    try {
      await cacheService.bumpCompanyFinancialCaches(companyId);
    } catch (e) {
      console.error('Cache invalidation failed:', e);
    }

    // Record AR tracking transaction for receipt posting
    try {
      await ARTrackingService.recordReceiptPosted(receipt, allocations, userId);
    } catch (trackingError) {
      console.error('AR tracking error for receipt posting:', trackingError);
    }

    return receipt;
  }

  /**
   * Reverse an AR receipt
   */
  static async reverseReceipt(companyId, userId, receiptId, reason) {
    const receipt = await ARReceipt.findOne({ _id: receiptId, company: companyId });
    if (!receipt) {
      throw new Error('Receipt not found');
    }

    if (receipt.status !== 'posted') {
      throw new Error('Only posted receipts can be reversed');
    }

    // Check period is open
    if (await periodService.isDateInClosedPeriod(companyId, receipt.receiptDate)) {
      throw new Error('Target accounting period is closed');
    }

    const amountNum = parseFloat(receipt.amountReceived);

    // Determine cash account based on original payment method
    let cashAccount;
    const pm = receipt.paymentMethod;
    
    if (pm === 'bank_transfer' || pm === 'cheque') {
      if (receipt.bankAccount) {
        const { BankAccount } = require('../models/BankAccount');
        const bankAcct = await BankAccount.findById(receipt.bankAccount);
        if (bankAcct && bankAcct.accountCode) {
          cashAccount = bankAcct.accountCode;
        }
      }
      cashAccount = cashAccount || DEFAULT_ACCOUNTS.cashAtBank;
    } else if (pm === 'card') {
      cashAccount = DEFAULT_ACCOUNTS.cashAtBank;
    } else {
      cashAccount = DEFAULT_ACCOUNTS.cashInHand;
    }

    // Create reversal journal entry
    // Debit: Accounts Receivable
    // Credit: Cash/Bank
    const rdLine = JournalService.createDebitLine(await JournalService.getMappedAccountCode(companyId, 'sales', 'accountsReceivable', DEFAULT_ACCOUNTS.accountsReceivable), amountNum, `AR Receipt ${receipt.reference || receipt.referenceNo} - Reversal`);
    const rcLine = JournalService.createCreditLine(cashAccount, amountNum, `AR Receipt ${receipt.reference || receipt.referenceNo} - Reversal`);

    const revA = {
      date: new Date(),
      description: `AR Receipt ${receipt.reference || receipt.referenceNo} - Reversal: ${reason || 'Reversed'}`,
      sourceType: 'ar_receipt_reversal',
      sourceId: receipt._id,
      sourceReference: receipt.reference || receipt.referenceNo,
      lines: [rdLine, rcLine],
      isAutoGenerated: true
    };

    const reverseEntries = await JournalService.createEntriesAtomic(companyId, userId, [revA]);
    const reverseEntry = Array.isArray(reverseEntries) && reverseEntries.length > 0 ? reverseEntries[0] : null;

    // Restore invoice balances from allocations
    const allocations = await ARReceiptAllocation.find({ receipt: receipt._id });
    for (const alloc of allocations) {
      await this.restoreInvoiceBalance(alloc.invoice, parseFloat(alloc.amountAllocated));
    }

    // Update receipt status
    receipt.status = 'reversed';
    receipt.reversedAt = new Date();
    receipt.reversedBy = userId;
    receipt.reversalReason = reason || 'Reversed';
    receipt.reverseJournalEntry = reverseEntry._id;
    await receipt.save();

    // Invalidate cache
    try {
      await cacheService.bumpCompanyFinancialCaches(companyId);
    } catch (e) {
      console.error('Cache invalidation failed:', e);
    }

    // Record AR tracking transaction for receipt reversal
    try {
      await ARTrackingService.recordReceiptReversed(receipt, allocations, userId, reason);
    } catch (trackingError) {
      console.error('AR tracking error for receipt reversal:', trackingError);
    }

    return receipt;
  }

  /**
   * Allocate receipt to invoice
   */
  static async allocateToInvoice(companyId, userId, receiptId, invoiceId, amount) {
    const receipt = await ARReceipt.findOne({ _id: receiptId, company: companyId });
    if (!receipt) {
      throw new Error('Receipt not found');
    }

    if (receipt.status !== 'draft' && receipt.status !== 'posted') {
      throw new Error('Receipt cannot be allocated');
    }

    const invoice = await Invoice.findOne({ _id: invoiceId, company: companyId });
    if (!invoice) {
      throw new Error('Invoice not found');
    }

    // Check if this invoice belongs to the same client
    if (invoice.client.toString() !== receipt.client.toString()) {
      throw new Error('Invoice does not belong to the same client');
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error('Invalid allocation amount');
    }

    // Check existing allocations
    const existingAlloc = await ARReceiptAllocation.findOne({
      receipt: receiptId,
      invoice: invoiceId
    });

    if (existingAlloc) {
      throw new Error('This invoice is already allocated to this receipt');
    }

    // First check invoice outstanding amount
    const invoiceOutstanding = parseFloat(invoice.amountOutstanding) || parseFloat(invoice.balance) || 0;
    if (amountNum > invoiceOutstanding) {
      const err = new Error('ALLOCATION_EXCEEDS_OUTSTANDING');
      err.status = 422;
      throw err;
    }

    // Check available amount to allocate on the receipt
    const allocatedSum = await aggregateWithTimeout(ARReceiptAllocation, [
      { $match: { receipt: receipt._id } },
      { $group: { _id: null, total: { $sum: '$amountAllocated' } } }
    ]);
    const alreadyAllocated = allocatedSum[0]?.total || 0;
    const receiptAmount = parseFloat(receipt.amountReceived);
    const available = receiptAmount - alreadyAllocated;

    if (amountNum > available) {
      const err = new Error('ALLOCATION_EXCEEDS_RECEIPT');
      err.status = 422;
      throw err;
    }

    // Create allocation
    const allocation = new ARReceiptAllocation({
      receipt: receiptId,
      invoice: invoiceId,
      amountAllocated: mongoose.Types.Decimal128.fromString(amountNum.toFixed(2)),
      company: companyId,
      createdBy: userId
    });

    await allocation.save();

    // Update invoice balance
    await this.updateInvoiceBalance(invoiceId, amountNum);

    // Invalidate cache
    try {
      await cacheService.bumpCompanyFinancialCaches(companyId);
    } catch (e) {
      console.error('Cache invalidation failed:', e);
    }

    return allocation;
  }

  /**
   * Update invoice balance after payment allocation (for draft receipts)
   */
  static async updateInvoiceBalance(invoiceId, amount) {
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return;

    const currentPaid = parseFloat(invoice.amountPaid) || 0;
    const currentBalance = parseFloat(invoice.amountOutstanding) || parseFloat(invoice.balance) || 0;
    const newPaid = currentPaid + amount;
    const newBalance = Math.max(0, parseFloat(invoice.roundedAmount || invoice.total || 0) - newPaid);

    invoice.amountPaid = mongoose.Types.Decimal128.fromString(newPaid.toFixed(2));
    invoice.amountOutstanding = mongoose.Types.Decimal128.fromString(newBalance.toFixed(2));
    invoice.balance = newBalance;

    // Update status
    const totalAmount = parseFloat(invoice.roundedAmount || invoice.total || 0);
    if (newPaid >= totalAmount) {
      invoice.status = 'fully_paid';
      if (!invoice.paidDate) invoice.paidDate = new Date();
    } else if (newPaid > 0) {
      invoice.status = 'partially_paid';
    }

    await invoice.save();
  }

  /**
   * Update invoice balance on receipt post (per Section 1.3 Step 3)
   * invoice.amount_paid += allocation.amount_allocated
   * invoice.amount_outstanding -= allocation.amount_allocated
   * If amount_outstanding <= 0.01: invoice.status = fully_paid
   * If amount_outstanding > 0.01 and amount_paid > 0: invoice.status = partially_paid
   */
  static async updateInvoiceBalanceOnPost(invoiceId, amount) {
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return;

    const currentPaid = parseFloat(invoice.amountPaid) || 0;
    const currentOutstanding = parseFloat(invoice.amountOutstanding) || parseFloat(invoice.balance) || 0;
    
    const newPaid = currentPaid + amount;
    const newOutstanding = currentOutstanding - amount;

    invoice.amountPaid = mongoose.Types.Decimal128.fromString(newPaid.toFixed(2));
    invoice.amountOutstanding = mongoose.Types.Decimal128.fromString(Math.max(0, newOutstanding).toFixed(2));
    invoice.balance = Math.max(0, newOutstanding);

    // Update status per Step 3 rules
    if (newOutstanding <= 0.01) {
      invoice.status = 'fully_paid';
      if (!invoice.paidDate) invoice.paidDate = new Date();
    } else if (newPaid > 0) {
      invoice.status = 'partially_paid';
    }

    await invoice.save();
  }

  /**
   * Restore invoice balance after receipt reversal
   */
  static async restoreInvoiceBalance(invoiceId, amount) {
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return;

    const currentPaid = parseFloat(invoice.amountPaid) || 0;
    const currentBalance = parseFloat(invoice.amountOutstanding) || parseFloat(invoice.balance) || 0;
    const newPaid = Math.max(0, currentPaid - amount);
    const totalAmount = parseFloat(invoice.roundedAmount || invoice.total || 0);
    const newBalance = totalAmount - newPaid;

    invoice.amountPaid = mongoose.Types.Decimal128.fromString(newPaid.toFixed(2));
    invoice.amountOutstanding = mongoose.Types.Decimal128.fromString(newBalance.toFixed(2));
    invoice.balance = newBalance;

    // Restore status
    if (newPaid >= totalAmount) {
      invoice.status = 'fully_paid';
      if (!invoice.paidDate) invoice.paidDate = new Date();
    } else if (newPaid > 0) {
      invoice.status = 'partially_paid';
    } else {
      invoice.status = 'confirmed';
      invoice.paidDate = null;
    }

    await invoice.save();
  }

  /**
   * Write off bad debt (per Section 1.5)
   * Journal entry:
   *   DR 6xxx Bad Debt Expense     writeoff_amount
   *   CR 1200 Accounts Receivable  writeoff_amount
   * source_type: bad_debt_writeoff
   * Narration: "Bad Debt Write-off - [Client Name] - INV#[ref]"
   */
  static async writeOffBadDebt(companyId, userId, data) {
    const { invoiceId, writeoffDate, amount, reason, notes } = data;

    const invoice = await Invoice.findOne({ _id: invoiceId, company: companyId });
    if (!invoice) {
      throw new Error('Invoice not found');
    }

    // Check if already written off
    if (invoice.status === 'cancelled') {
      throw new Error('Invoice is already written off as bad debt');
    }

    const amountNum = parseFloat(amount) || parseFloat(invoice.balance) || 0;
    if (amountNum <= 0) {
      throw new Error('Invalid write-off amount');
    }

    // Check period is open
    const targetDate = writeoffDate || new Date();
    if (await periodService.isDateInClosedPeriod(companyId, targetDate)) {
      throw new Error('Target accounting period is closed');
    }

    // Get client name for narration
    const client = await Client.findById(invoice.client);
    const clientName = client?.name || 'Unknown Client';
    const invoiceRef = invoice.referenceNo || invoice.invoiceNumber || 'N/A';

    // Create bad debt write-off record as DRAFT only; posting will be
    // performed by a separate postBadDebtWriteoff method.
    const writeoff = new ARBadDebtWriteoff({
      invoice: invoiceId,
      client: invoice.client,
      writeoffDate: targetDate,
      amount: mongoose.Types.Decimal128.fromString(amountNum.toFixed(2)),
      reason: reason || 'Bad debt write-off',
      notes: notes || null,
      status: 'draft',
      createdBy: userId,
      company: companyId
    });

    await writeoff.save();

    // Invalidate cache
    try {
      await cacheService.bumpCompanyFinancialCaches(companyId);
    } catch (e) {
      console.error('Cache invalidation failed:', e);
    }

    return writeoff;
  }

  /**
   * Post a previously created bad debt write-off (create journals and apply)
   */
  static async postBadDebtWriteoff(companyId, userId, writeoffId) {
    const writeoff = await ARBadDebtWriteoff.findOne({ _id: writeoffId, company: companyId });
    if (!writeoff) throw new Error('Bad debt write-off not found');
    if (writeoff.status !== 'draft') {
      const err = new Error('INVALID_STATUS');
      err.status = 400;
      throw err;
    }

    const invoice = await Invoice.findById(writeoff.invoice);
    if (!invoice) throw new Error('Invoice not found');

    const amountNum = parseFloat(writeoff.amount) || 0;

    // Create journal entries now
    const client = await Client.findById(writeoff.client);
    const clientName = client?.name || 'Unknown Client';
    const invoiceRef = invoice.referenceNo || invoice.invoiceNumber || 'N/A';
    const narration = `Bad Debt Write-off - ${clientName} - INV#${invoiceRef}`;

    const bdDebitLine = JournalService.createDebitLine(DEFAULT_ACCOUNTS.badDebtExpense || '6100', amountNum, narration);
    const bdCreditLine = JournalService.createCreditLine(await JournalService.getMappedAccountCode(companyId, 'sales', 'accountsReceivable', DEFAULT_ACCOUNTS.accountsReceivable), amountNum, narration);

    const bdEntryA = {
      date: writeoff.writeoffDate || new Date(),
      description: narration,
      sourceType: 'bad_debt_writeoff',
      sourceId: writeoff._id,
      sourceReference: writeoff.reference || writeoff.referenceNo,
      lines: [bdDebitLine, bdCreditLine],
      isAutoGenerated: true
    };

    const bdEntries = await JournalService.createEntriesAtomic(companyId, userId, [bdEntryA]);
    const journalEntry = Array.isArray(bdEntries) && bdEntries.length > 0 ? bdEntries[0] : null;

    // Update write-off status
    writeoff.status = 'posted';
    if (journalEntry) writeoff.journalEntry = journalEntry._id;
    writeoff.postedBy = userId;
    await writeoff.save();

    // Update invoice balance: amount_outstanding -= writeoff_amount
    const currentOutstanding = parseFloat(invoice.amountOutstanding) || parseFloat(invoice.balance) || 0;
    const newOutstanding = currentOutstanding - amountNum;

    invoice.amountOutstanding = mongoose.Types.Decimal128.fromString(Math.max(0, newOutstanding).toFixed(2));
    invoice.balance = Math.max(0, newOutstanding);

    // If fully written off: invoice.status = cancelled
    if (newOutstanding <= 0.01) {
      invoice.status = 'cancelled';
      invoice.badDebtWrittenOff = true;
      invoice.writtenOffAt = new Date();
      invoice.writtenOffBy = userId;
      invoice.badDebtReason = writeoff.reason || 'Bad debt write-off';
    }
    await invoice.save();

    // Update client outstanding balance
    if (client) {
      client.outstandingBalance = Math.max(0, (client.outstandingBalance || 0) - amountNum);
      await client.save();
    }

    // Invalidate cache
    try {
      await cacheService.bumpCompanyFinancialCaches(companyId);
    } catch (e) {
      console.error('Cache invalidation failed:', e);
    }

    // Record AR tracking transaction for bad debt write-off
    try {
      await ARTrackingService.recordBadDebtWriteoff(writeoff, invoice, userId);
    } catch (trackingError) {
      console.error('AR tracking error for bad debt write-off:', trackingError);
    }

    return writeoff;
  }

  /**
   * Reverse bad debt write-off
   */
  static async reverseBadDebt(companyId, userId, writeoffId, reason) {
    const writeoff = await ARBadDebtWriteoff.findOne({ _id: writeoffId, company: companyId });
    if (!writeoff) {
      throw new Error('Bad debt write-off not found');
    }

    if (writeoff.status !== 'posted') {
      throw new Error('Only posted write-offs can be reversed');
    }

    // Check period is open
    if (await periodService.isDateInClosedPeriod(companyId, writeoff.writeoffDate)) {
      throw new Error('Target accounting period is closed');
    }

    const amountNum = parseFloat(writeoff.amount);

    // Create reversal journal entry
    // Debit: Accounts Receivable
    // Credit: Bad Debt Expense
    const bdRevDebitLine = JournalService.createDebitLine(await JournalService.getMappedAccountCode(companyId, 'sales', 'accountsReceivable', DEFAULT_ACCOUNTS.accountsReceivable), amountNum, `Bad Debt Reversal ${writeoff.reference || writeoff.referenceNo}`);
    const bdRevCreditLine = JournalService.createCreditLine(DEFAULT_ACCOUNTS.badDebtExpense || '6100', amountNum, `Bad Debt Reversal ${writeoff.reference || writeoff.referenceNo}`);

    const bdRevA = {
      date: new Date(),
      description: `Bad Debt Reversal ${writeoff.reference || writeoff.referenceNo}: ${reason || 'Reversed'}`,
      sourceType: 'ar_bad_debt_reversal',
      sourceId: writeoff._id,
      sourceReference: writeoff.reference || writeoff.referenceNo,
      lines: [bdRevDebitLine, bdRevCreditLine],
      isAutoGenerated: true
    };

    const bdRevEntries = await JournalService.createEntriesAtomic(companyId, userId, [bdRevA]);
    const reverseEntry = Array.isArray(bdRevEntries) && bdRevEntries.length > 0 ? bdRevEntries[0] : null;

    // Update write-off status
    writeoff.status = 'reversed';
    writeoff.reversedAt = new Date();
    writeoff.reversedBy = userId;
    writeoff.reversalReason = reason || 'Reversed';
    writeoff.reverseJournalEntry = reverseEntry._id;
    await writeoff.save();

    // Restore invoice
    const invoice = await Invoice.findById(writeoff.invoice);
    if (invoice) {
      invoice.status = 'confirmed';
      invoice.badDebtWrittenOff = false;
      invoice.writtenOffAt = undefined;
      invoice.writtenOffBy = undefined;
      invoice.badDebtReason = undefined;
      invoice.balance = parseFloat(invoice.roundedAmount || invoice.total || 0) - parseFloat(invoice.amountPaid || 0);
      invoice.amountOutstanding = mongoose.Types.Decimal128.fromString(invoice.balance.toString());
      await invoice.save();

      // Restore client outstanding balance
      const client = await Client.findById(invoice.client);
      if (client) {
        client.outstandingBalance = (client.outstandingBalance || 0) + amountNum;
        await client.save();
      }
    }

    // Invalidate cache
    try {
      await cacheService.bumpCompanyFinancialCaches(companyId);
    } catch (e) {
      console.error('Cache invalidation failed:', e);
    }

    // Record AR tracking transaction for bad debt reversal
    try {
      await ARTrackingService.recordBadDebtReversed(writeoff, invoice, userId, reason);
    } catch (trackingError) {
      console.error('AR tracking error for bad debt reversal:', trackingError);
    }

    return writeoff;
  }

  /**
   * Get AR aging report using new allocations
   * Computed on the fly from live invoice data - not stored in a table
   * Aging buckets per Section 1.4:
   * - Not yet due: due_date >= TODAY
   * - 1-30 days: due_date between (TODAY - 30) and (TODAY - 1)
   * - 31-60 days: due_date between (TODAY - 60) and (TODAY - 31)
   * - 61-90 days: due_date between (TODAY - 90) and (TODAY - 61)
   * - 90+ days: due_date < (TODAY - 90)
   */
  static async getAgingReport(companyId, options = {}) {
    const { clientId, asOfDate } = options;
    const now = asOfDate ? new Date(asOfDate) : new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Calculate date boundaries for standard aging buckets
    const todayMinus1 = new Date(today);
    todayMinus1.setDate(todayMinus1.getDate() - 1);

    const todayMinus30 = new Date(today);
    todayMinus30.setDate(todayMinus30.getDate() - 30);

    const todayMinus31 = new Date(today);
    todayMinus31.setDate(todayMinus31.getDate() - 31);

    const todayMinus60 = new Date(today);
    todayMinus60.setDate(todayMinus60.getDate() - 60);

    const todayMinus61 = new Date(today);
    todayMinus61.setDate(todayMinus61.getDate() - 61);

    const todayMinus90 = new Date(today);
    todayMinus90.setDate(todayMinus90.getDate() - 90);

    // Build match conditions
    const matchConditions = {
      company: companyId,
      // include invoices that are sent/confirmed/partially_paid so aging
      // works against invoices that may not yet be marked as confirmed
      status: { $in: ['sent', 'confirmed', 'partially_paid'] }
    };

    if (clientId) {
      matchConditions.client = clientId;
    }

    // Get invoices with their allocations
    // Populate client to get client names
    const invoices = await Invoice.find(matchConditions)
      .populate('client', 'name code')
      .sort({ invoiceDate: 1 });

    // Debug: log invoices found for aging report
    try {
      console.log('ARService.getAgingReport - invoices found:', invoices.length, invoices.map(i => i.referenceNo));
    } catch (e) {}

    // Get all allocations for these invoices
    const invoiceIds = invoices.map(inv => inv._id);
    const allocations = await ARReceiptAllocation.find({
      invoice: { $in: invoiceIds }
    }).lean();

    // Create allocation map
    const allocMap = {};
    allocations.forEach(alloc => {
      const invId = alloc.invoice.toString();
      if (!allocMap[invId]) allocMap[invId] = 0;
      allocMap[invId] += parseFloat(alloc.amountAllocated);
    });

    // Group by client
    const clientData = {};

    invoices.forEach(inv => {
      // Subtract allocated amounts from outstanding balance
      const allocated = allocMap[inv._id.toString()] || 0;
      // FIX: Convert Decimal128 to string before parseFloat
      const outstanding = inv.amountOutstanding 
        ? parseFloat(inv.amountOutstanding.toString()) 
        : (inv.balance ? parseFloat(inv.balance.toString()) : 0);
      const effectiveBalance = outstanding - allocated;
      
      if (effectiveBalance <= 0) return;

      // Get due date - default to invoice date if not set
      const dueDate = inv.dueDate ? new Date(inv.dueDate) : new Date(inv.invoiceDate);
      const dueDateOnly = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());

      let bucket;
      
      // Standard aging buckets: current, 1-30, 31-60, 61-90, 90+
      if (dueDateOnly >= today) {
        bucket = 'current';
      } else if (dueDateOnly >= todayMinus30 && dueDateOnly <= todayMinus1) {
        bucket = '1-30';
      } else if (dueDateOnly >= todayMinus60 && dueDateOnly <= todayMinus31) {
        bucket = '31-60';
      } else if (dueDateOnly >= todayMinus90 && dueDateOnly <= todayMinus61) {
        bucket = '61-90';
      } else {
        bucket = '90+';
      }

      // Get client info - client is now populated
      const clientId = inv.client?._id?.toString();
      const clientName = inv.client?.name || 'Unknown';
      const clientCode = inv.client?.code || '';
      
      if (!clientId) return;

      if (!clientData[clientId]) {
        clientData[clientId] = {
          client_id: inv.client._id,
          client_name: clientName,
          client_code: clientCode,
          current: 0,
          '1-30': 0,
          '31-60': 0,
          '61-90': 0,
          '90+': 0,
          total_outstanding: 0
        };
      }
      // Add to appropriate bucket
      clientData[clientId][bucket] += effectiveBalance;
      clientData[clientId].total_outstanding += effectiveBalance;
    });

    // Format amounts as strings with 2 decimal places
    const result = Object.values(clientData).map(c => ({
      client: { _id: c.client_id, name: c.client_name, code: c.client_code },
      current: c.current.toFixed(2),
      '1-30': c['1-30'].toFixed(2),
      '31-60': c['31-60'].toFixed(2),
      '61-90': c['61-90'].toFixed(2),
      '90+': c['90+'].toFixed(2),
      totalBalance: c.total_outstanding.toFixed(2)
    }));

    try { console.log('ARService.getAgingReport - result:', JSON.stringify(result)); } catch (e) {}

    return {
      success: true,
      asOfDate: today,
      data: result
    };
  }

  /**
   * Get client statement - full details: invoices, credits, receipts, balance
   */
  static async getClientStatement(companyId, clientId, options = {}) {
    const { startDate, endDate } = options;

    // Verify client
    const client = await Client.findOne({ _id: clientId, company: companyId });
    if (!client) {
      throw new Error('Client not found');
    }

    // Build date filter
    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    // Get invoices
    const invoiceQuery = { client: clientId, company: companyId };
    if (startDate || endDate) {
      invoiceQuery.invoiceDate = dateFilter;
    }
    const invoices = await Invoice.find(invoiceQuery)
      .populate('createdBy', 'name')
      .sort({ invoiceDate: 1 });

    // Get receipts and allocations for this client
    const receipts = await ARReceipt.find({ client: clientId, company: companyId })
      .sort({ receiptDate: -1 });

    const receiptIds = receipts.map(r => r._id);
    const allocations = await ARReceiptAllocation.find({
      receipt: { $in: receiptIds },
      company: companyId
    }).populate('invoice', 'invoiceNumber referenceNo');

    // Build statement
    const statement = {
      client: {
        _id: client._id,
        name: client.name,
        code: client.code
      },
      invoices: invoices.map(inv => ({
        id: inv._id,
        reference: inv.referenceNo,
        date: inv.invoiceDate,
        dueDate: inv.dueDate,
        total: parseFloat(inv.roundedAmount || inv.total || 0).toFixed(2),
        paid: parseFloat(inv.amountPaid || 0).toFixed(2),
        balance: parseFloat(inv.balance || 0).toFixed(2),
        status: inv.status
      })),
      receipts: receipts.map(rec => ({
        id: rec._id,
        reference: rec.referenceNo,
        date: rec.receiptDate,
        amount: parseFloat(rec.amountReceived).toFixed(2),
        status: rec.status,
        allocations: allocations
          .filter(a => a.receipt.toString() === rec._id.toString())
          .map(a => ({
            invoiceReference: a.invoice?.referenceNo,
            amount: parseFloat(a.amountAllocated).toFixed(2)
          }))
      }))
    };

    // Calculate totals
    const totalInvoices = invoices.reduce((sum, inv) => sum + (parseFloat(inv.roundedAmount || inv.total || 0)), 0);
    const totalPaid = invoices.reduce((sum, inv) => sum + (parseFloat(inv.amountPaid || 0)), 0);
    const totalOutstanding = invoices.reduce((sum, inv) => sum + (parseFloat(inv.balance || 0)), 0);

    statement.summary = {
      totalInvoices: totalInvoices.toFixed(2),
      totalPaid: totalPaid.toFixed(2),
      totalOutstanding: totalOutstanding.toFixed(2),
      invoiceCount: invoices.length
    };

    return {
      success: true,
      data: statement
    };
  }
}

module.exports = ARService;
