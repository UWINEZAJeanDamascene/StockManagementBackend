const CreditNote = require('../models/CreditNote');
const Invoice = require('../models/Invoice');
const Product = require('../models/Product');
const StockMovement = require('../models/StockMovement');
const Client = require('../models/Client');
const SerialNumber = require('../models/SerialNumber');
const JournalService = require('../services/journalService');

// List credit notes
exports.getCreditNotes = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const notes = await CreditNote.find({ company: companyId }).populate('invoice client createdBy');
    res.json({ success: true, count: notes.length, data: notes });
  } catch (err) { next(err); }
};

// Get single
exports.getCreditNote = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const note = await CreditNote.findOne({ _id: req.params.id, company: companyId }).populate('invoice client createdBy payments.refundedBy');
    if (!note) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: note });
  } catch (err) { next(err); }
};

// Create credit note (draft)
exports.createCreditNote = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { invoice: invoiceId } = req.body;
    const invoice = await Invoice.findOne({ _id: invoiceId, company: companyId });
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const payload = { ...req.body, company: companyId, client: invoice.client, createdBy: req.user.id };
    const note = await CreditNote.create(payload);
    res.status(201).json({ success: true, data: note });
  } catch (err) { next(err); }
};

// Approve credit note: apply client balance adjustment and optional stock reversal
exports.approveCreditNote = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const note = await CreditNote.findOne({ _id: req.params.id, company: companyId });
    if (!note) return res.status(404).json({ success: false, message: 'Not found' });
    if (note.status !== 'draft') return res.status(400).json({ success: false, message: 'Only draft notes can be approved' });

    // Update client balance
    const client = await Client.findOne({ _id: note.client, company: companyId });
    if (client) {
      client.outstandingBalance -= note.grandTotal;
      if (client.outstandingBalance < 0) client.outstandingBalance = 0;
      await client.save();
    }

    // Update original invoice with credit note reference
    if (note.invoice) {
      const invoice = await Invoice.findOne({ _id: note.invoice, company: companyId });
      if (invoice) {
        if (!invoice.creditNotes) invoice.creditNotes = [];
        invoice.creditNotes.push({
          creditNoteId: note._id,
          creditNoteNumber: note.creditNoteNumber,
          amount: note.grandTotal,
          appliedDate: new Date()
        });
        
        // Reduce the invoice balance by the credit note amount
        const creditAmount = note.grandTotal;
        invoice.balance = Math.max(0, (invoice.balance || 0) - creditAmount);
        
        // Update invoice status based on new balance - but keep 'paid' status if it was paid
        // A credit note is a reduction of the invoice, not a partial payment
        if (invoice.balance <= 0) {
          invoice.status = 'paid';
          if (!invoice.paidDate) {
            invoice.paidDate = new Date();
          }
        } else if (invoice.amountPaid > 0 && invoice.amountPaid < invoice.grandTotal) {
          // Only change to partial if there's actual partial payment, not just credit note
          invoice.status = 'partial';
        }
        // Don't reduce amountPaid - the invoice was paid, credit note is a separate adjustment
        if (invoice.balance <= 0) {
          invoice.status = 'paid';
          if (!invoice.paidDate) {
            invoice.paidDate = new Date();
          }
        } else if (invoice.amountPaid > 0 && invoice.amountPaid < invoice.grandTotal) {
          invoice.status = 'partial';
        }
        
        await invoice.save();
      }
    }

    // Optionally reverse stock if requested via body.flag
    const { reverseStock } = req.body;
    if (reverseStock && note.items && note.items.length > 0) {
      if (note.stockReversed) {
        // already reversed
      } else {
        for (const item of note.items) {
          const product = await Product.findOne({ _id: item.product, company: companyId });
          if (product) {
            const previousStock = product.currentStock || 0;
            // If serial numbers provided, update each serial record
            let serialsProcessed = [];
            if (item.serialNumbers && Array.isArray(item.serialNumbers) && item.serialNumbers.length > 0) {
              for (const s of item.serialNumbers) {
                if (!s) continue;
                const serialDoc = await SerialNumber.findOne({ company: companyId, serialNumber: s.toUpperCase() });
                if (serialDoc) {
                  const prev = serialDoc.status;
                  serialDoc.status = 'returned';
                  // clear sale references
                  serialDoc.client = null;
                  serialDoc.invoice = null;
                  serialDoc.saleDate = null;
                  serialDoc.salePrice = null;
                  serialDoc.warrantyEndDate = null;
                  serialDoc.warrantyStartDate = null;
                  if (req.body.warehouseId) serialDoc.warehouse = req.body.warehouseId;
                  await serialDoc.save();
                  serialsProcessed.push(serialDoc.serialNumber);
                }
              }
            }

            const qtyToAdd = (item.serialNumbers && item.serialNumbers.length > 0) ? item.serialNumbers.length : (item.quantity || 0);
            const newStock = previousStock + qtyToAdd;

            // include serials in notes when available
            const notes = serialsProcessed.length > 0
              ? `Credit Note ${note.creditNoteNumber} - Return. Serials: ${serialsProcessed.join(',')}`
              : `Credit Note ${note.creditNoteNumber} - Return`;

            await StockMovement.create({
              company: companyId,
              product: product._id,
              type: 'in',
              reason: 'return',
              quantity: qtyToAdd,
              previousStock,
              newStock,
              unitCost: item.unitPrice || 0,
              totalCost: item.totalWithTax || 0,
              referenceType: 'credit_note',
              referenceNumber: note.creditNoteNumber,
              referenceDocument: note._id,
              referenceModel: 'CreditNote',
              notes,
              performedBy: req.user.id
            });

            product.currentStock = newStock;
            await product.save();
          }
        }
        note.stockReversed = true;
      }
    }

    note.status = 'issued';
    await note.save();

    // Calculate inventory cost for stock reversal (cost of goods sold)
    let inventoryCost = 0;
    if (reverseStock && note.items && note.items.length > 0) {
      for (const item of note.items) {
        const product = await Product.findOne({ _id: item.product, company: companyId });
        if (product && product.averageCost) {
          const qty = item.quantity || 0;
          inventoryCost += (product.averageCost * qty);
        }
      }
    }

    // Get refund method from request (bank_transfer, cash, mobile_money, or ar)
    const refundMethod = req.body.refundMethod || 'ar';
    let bankAccountCode = null;
    if ((refundMethod === 'bank_transfer' || refundMethod === 'cheque' || refundMethod === 'mobile_money') && req.body.bankAccountId) {
      const { BankAccount } = require('../models/BankAccount');
      
      // Try to find by _id first (MongoDB ObjectId), then by accountCode
      let bankAccount = await BankAccount.findOne({
        _id: req.body.bankAccountId,
        company: companyId,
        isActive: true
      });
      
      // If not found by _id, try finding by accountCode (in case user passed account code like "1100")
      if (!bankAccount) {
        bankAccount = await BankAccount.findOne({
          accountCode: req.body.bankAccountId,
          company: companyId,
          isActive: true
        });
      }
      
      if (bankAccount && bankAccount.accountCode) {
        bankAccountCode = bankAccount.accountCode;
      }
    }

    // Create journal entry for credit note
    // If refundMethod is not 'ar', it will credit Cash/Bank instead of Accounts Receivable
    // If reverseStock is true, it will also add Inventory/COGS entries
    try {
      await JournalService.createCreditNoteEntry(companyId, req.user.id, {
        _id: note._id,
        creditNoteNumber: note.creditNoteNumber,
        date: note.date,
        total: note.grandTotal,
        vatAmount: note.totalTax,
        refundMethod: refundMethod,
        bankAccountCode: bankAccountCode,
        inventoryCost: inventoryCost
      });
    } catch (journalError) {
      console.error('Error creating journal entry for credit note:', journalError);
      // Don't fail the credit note approval if journal entry fails
    }

    res.json({ success: true, data: note });
  } catch (err) { next(err); }
};

// Apply credit note to a new invoice
exports.applyCreditNote = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { invoiceId } = req.body; // Target invoice to apply credit to
    
    const note = await CreditNote.findOne({ _id: req.params.id, company: companyId });
    if (!note) return res.status(404).json({ success: false, message: 'Credit note not found' });
    if (note.status !== 'issued') return res.status(400).json({ success: false, message: 'Only issued credit notes can be applied' });
    if (!invoiceId) return res.status(400).json({ success: false, message: 'Target invoice required' });

    // Get target invoice
    const targetInvoice = await Invoice.findOne({ _id: invoiceId, company: companyId });
    if (!targetInvoice) return res.status(404).json({ success: false, message: 'Target invoice not found' });

    // Apply credit to client balance (reduce outstanding)
    const client = await Client.findOne({ _id: note.client, company: companyId });
    if (client) {
      client.outstandingBalance -= note.grandTotal;
      if (client.outstandingBalance < 0) client.outstandingBalance = 0;
      await client.save();
    }

    // Add credit note to target invoice
    if (!targetInvoice.creditNotes) targetInvoice.creditNotes = [];
    targetInvoice.creditNotes.push({
      creditNoteId: note._id,
      creditNoteNumber: note.creditNoteNumber,
      amount: note.grandTotal,
      appliedDate: new Date()
    });
    
    // Reduce the invoice balance by the credit note amount
    const creditAmount = note.grandTotal;
    targetInvoice.balance = Math.max(0, (targetInvoice.balance || 0) - creditAmount);
    
    // Update invoice status - keep 'paid' if it was paid
    if (targetInvoice.balance <= 0) {
      targetInvoice.status = 'paid';
      if (!targetInvoice.paidDate) {
        targetInvoice.paidDate = new Date();
      }
    }
    // Don't reduce amountPaid - credit note is a separate adjustment
    if (targetInvoice.balance <= 0) {
      targetInvoice.status = 'paid';
      if (!targetInvoice.paidDate) {
        targetInvoice.paidDate = new Date();
      }
    } else if (targetInvoice.amountPaid > 0 && targetInvoice.amountPaid < targetInvoice.grandTotal) {
      targetInvoice.status = 'partial';
    }
    
    await targetInvoice.save();

    // Update credit note status
    note.status = 'applied';
    note.appliedTo = targetInvoice.invoiceNumber;
    note.appliedDate = new Date();
    await note.save();

    res.json({ success: true, data: note, message: `Credit note applied to invoice ${targetInvoice.invoiceNumber}` });
  } catch (err) { next(err); }
};

// Record refund (money returned to client)
exports.recordRefund = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { amount, paymentMethod, reference } = req.body;
    const note = await CreditNote.findOne({ _id: req.params.id, company: companyId });
    if (!note) return res.status(404).json({ success: false, message: 'Not found' });
    if (note.status !== 'issued' && note.status !== 'applied' && note.status !== 'partially_refunded') return res.status(400).json({ success: false, message: 'Only issued/applied notes can be refunded' });

    const remaining = note.grandTotal - (note.amountRefunded || 0);
    if (amount > remaining) return res.status(400).json({ success: false, message: 'Refund amount exceeds credit note balance' });

    // attach payment
    note.payments.push({ amount, paymentMethod, reference, refundedBy: req.user.id });
    note.amountRefunded = (note.amountRefunded || 0) + amount;

    // Adjust invoice payments (reduce amountPaid)
    const invoice = await Invoice.findOne({ _id: note.invoice, company: companyId });
    if (invoice) {
      invoice.amountPaid = Math.max(0, (invoice.amountPaid || 0) - amount);
      await invoice.save();
    }

    // Adjust client stats
    const client = await Client.findOne({ _id: note.client, company: companyId });
    if (client) {
      client.totalPurchases = Math.max(0, (client.totalPurchases || 0) - amount);
      // If invoice existed and we decreased amountPaid, outstandingBalance may increase; keep consistent: recompute outstandingBalance as sum of invoices minus payments is complex; instead, adjust by -amount earlier when approving; now refund increases outstandingBalance by amount
      client.outstandingBalance = Math.max(0, (client.outstandingBalance || 0) + amount);
      await client.save();
    }

    if (note.amountRefunded >= note.grandTotal) {
      note.status = 'refunded';
    } else {
      note.status = 'partially_refunded';
    }

    await note.save();

    // Create journal entry for refund (Accounts Receivable Debit, Cash/Bank Credit)
    try {
      const { DEFAULT_ACCOUNTS } = require('../constants/chartOfAccounts');
      const cashAccount = paymentMethod === 'bank' 
        ? DEFAULT_ACCOUNTS.cashAtBank 
        : DEFAULT_ACCOUNTS.cashInHand;
      
      await JournalService.createEntry(companyId, req.user.id, {
        date: new Date(),
        description: `Refund for Credit Note ${note.creditNoteNumber}`,
        sourceType: 'credit_note_refund',
        sourceId: note._id,
        sourceReference: note.creditNoteNumber,
        lines: [
          JournalService.createDebitLine(DEFAULT_ACCOUNTS.accountsReceivable, amount, `Refund for Credit Note ${note.creditNoteNumber}`),
          JournalService.createCreditLine(cashAccount, amount, `Refund for Credit Note ${note.creditNoteNumber}`)
        ],
        isAutoGenerated: true
      });
    } catch (journalError) {
      console.error('Error creating journal entry for credit note refund:', journalError);
      // Don't fail the refund if journal entry fails
    }

    res.json({ success: true, data: note });
  } catch (err) { next(err); }
};

// Delete (only drafts)
exports.deleteCreditNote = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const note = await CreditNote.findOne({ _id: req.params.id, company: companyId });
    if (!note) return res.status(404).json({ success: false, message: 'Not found' });
    if (note.status !== 'draft') return res.status(400).json({ success: false, message: 'Only draft notes can be deleted' });
    await note.deleteOne();
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { next(err); }
};

// =====================================================
// MODULE 8 - Credit Notes Confirmation Logic
// =====================================================

// Module 8 Error Codes
const ERR_CREDIT_NOT_FOUND = 'ERR_CREDIT_NOT_FOUND';
const ERR_CREDIT_CONFIRMED = 'ERR_CREDIT_CONFIRMED';
const ERR_CREDIT_CANCELLED = 'ERR_CREDIT_CANCELLED';
const ERR_INVOICE_NOT_CONFIRMED = 'ERR_INVOICE_NOT_CONFIRMED';
const ERR_EXCEEDS_INVOICE_QTY = 'ERR_EXCEEDS_INVOICE_QTY';
const ERR_PRICE_MISMATCH = 'ERR_PRICE_MISMATCH';
const ERR_SERIAL_NOT_DISPATCHED = 'ERR_SERIAL_NOT_DISPATCHED';
const ERR_INVENTORY_UPDATE_FAILED = 'ERR_INVENTORY_UPDATE_FAILED';

// Update credit note (draft only)
exports.updateCreditNote = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const note = await CreditNote.findOne({ _id: req.params.id, company: companyId });
    
    if (!note) {
      return res.status(404).json({ success: false, code: ERR_CREDIT_NOT_FOUND, message: 'Credit note not found' });
    }
    
    // Only draft credit notes can be updated
    if (note.status !== 'draft') {
      return res.status(409).json({ success: false, code: ERR_CREDIT_CONFIRMED, message: 'Cannot update credit note with status: ' + note.status });
    }
    
    const { reason, type, creditDate, notes, lines } = req.body;
    
    if (reason) note.reason = reason;
    if (type) note.type = type;
    if (creditDate) note.creditDate = creditDate;
    if (notes !== undefined) note.notes = notes;
    
    // Update lines if provided
    if (lines && Array.isArray(lines)) {
      note.lines = lines;
    }
    
    await note.save();
    await note.populate('client lines.product warehouse createdBy invoice');
    
    res.json({ success: true, data: note });
  } catch (err) { next(err); }
};

// Confirm credit note - triggers dual journal reversal + stock return
exports.confirmCreditNote = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const creditNoteId = req.params.id;
    
    // Find credit note with populated data
    console.log('DEBUG: creditNoteId =', creditNoteId);
    let creditNote = await CreditNote.findOne({ _id: creditNoteId, company: companyId })
      .populate('lines.product')
      .populate('invoice')
      .populate('client')
      .populate('lines.returnToWarehouse');
    
    console.log('DEBUG: creditNote =', creditNote ? 'found' : 'not found');
    console.log('DEBUG: creditNote.invoice =', creditNote?.invoice);
    
    if (!creditNote) {
      return res.status(404).json({ success: false, code: ERR_CREDIT_NOT_FOUND, message: 'Credit note not found' });
    }
    
    // Validate status is draft
    if (creditNote.status !== 'draft') {
      return res.status(400).json({ success: false, code: ERR_CREDIT_CONFIRMED, message: 'Cannot confirm credit note with status: ' + creditNote.status });
    }
    
    // ========== STEP 1: VALIDATION ==========
    const invoice = await Invoice.findById(creditNote.invoice).populate('lines.product');
    if (!invoice) {
      return res.status(404).json({ success: false, code: ERR_CREDIT_NOT_FOUND, message: 'Invoice not found' });
    }
    
    // Invoice must be confirmed, partially_paid, or fully_paid
    const validInvoiceStatuses = ['confirmed', 'partially_paid', 'fully_paid'];
    console.log('DEBUG: invoice.status =', invoice.status);
    console.log('DEBUG: validInvoiceStatuses =', validInvoiceStatuses);
    if (!invoice.status || !validInvoiceStatuses.includes(invoice.status)) {
      console.log('DEBUG: Invoice validation failed - returning 400');
      return res.status(400).json({ success: false, code: ERR_INVOICE_NOT_CONFIRMED, message: 'Invoice must be confirmed, partially paid, or fully paid' });
    }
    
    // Use lines array (Module 8) or items (legacy)
    const lineArray = creditNote.lines && creditNote.lines.length > 0 ? creditNote.lines : creditNote.items;
    
    for (const line of lineArray) {
      // Find original invoice line
      const invoiceLine = invoice.lines.id(line.invoiceLineId);
      if (!invoiceLine) {
        return res.status(400).json({ success: false, code: 'ERR_INVALID_INVOICE_LINE', message: 'Invoice line not found' });
      }
      
      // Validate qty doesn't exceed remaining
      const alreadyCredited = invoiceLine.qtyCredited || 0;
      const remainingQty = invoiceLine.quantity - alreadyCredited;
      if (line.quantity > remainingQty) {
        return res.status(422).json({ success: false, code: ERR_EXCEEDS_INVOICE_QTY, message: 'Credit qty (' + line.quantity + ') exceeds remaining invoice qty (' + remainingQty + ')' });
      }
      
      // Validate unit price matches original
      if (line.unitPrice !== invoiceLine.unitPrice) {
        return res.status(400).json({ success: false, code: ERR_PRICE_MISMATCH, message: 'Unit price must match original invoice line' });
      }
      
      // Validate serial numbers if provided
      if (line.serialNumbers && line.serialNumbers.length > 0) {
        const StockSerialNumber = require('../models/StockSerialNumber');
        for (const serialId of line.serialNumbers) {
          const serial = await StockSerialNumber.findOne({ _id: serialId, company: companyId });
          if (!serial || serial.status !== 'dispatched') {
            return res.status(400).json({ success: false, code: ERR_SERIAL_NOT_DISPATCHED, message: 'Serial number must be dispatched' });
          }
        }
      }
    }
    
    // ========== STEP 2-5: Execute in transaction ==========
    const { runInTransaction } = require('../services/transactionService');
    const inventoryService = require('../services/inventoryService');
    const JournalService = require('../services/journalService');
    const Product = require('../models/Product');
    const StockMovement = require('../models/StockMovement');
    const StockBatch = require('../models/StockBatch');
    const StockSerialNumber = require('../models/StockSerialNumber');
    const { DEFAULT_ACCOUNTS } = require('../constants/chartOfAccounts');
    
    await runInTransaction(async (session) => {
      // Calculate totals for journal entries
      let totalSubtotal = 0;
      let totalTax = 0;
      let totalCogs = 0;
      
      const isGoodsReturn = creditNote.type === 'goods_return';
      
      // Process each line
      console.log('DEBUG: Processing lineArray =', JSON.stringify(lineArray, null, 2));
      for (const line of lineArray) {
        const product = line.product;
        if (!product) continue;
        
        // Get taxRate from credit note line or fall back to invoice line
        let taxRate = line.taxRate;
        if (!taxRate && line.invoiceLineId) {
          const invoiceLine = invoice.lines.id(line.invoiceLineId);
          if (invoiceLine) {
            taxRate = invoiceLine.taxRate;
          }
        }
        console.log('DEBUG: line.taxRate =', line.taxRate, 'taxRate from invoice =', taxRate, 'line.quantity =', line.quantity, 'line.unitPrice =', line.unitPrice);
        const lineSubtotal = (line.quantity || 0) * (line.unitPrice || 0);
        const lineTax = lineSubtotal * ((taxRate || 0) / 100);
        const lineCogs = (line.unitCost || 0) * (line.quantity || 0);
        
        console.log('DEBUG: lineSubtotal =', lineSubtotal, 'lineTax =', lineTax);
        totalSubtotal += lineSubtotal;
        totalTax += lineTax;
        totalCogs += lineCogs;
        
        // ========== STEP 4: Return stock to warehouse (goods return only) ==========
        if (isGoodsReturn && product.isStockable) {
          const warehouse = line.returnToWarehouse;
          
          // Add stock using inventory service createLayer
          await inventoryService.createLayer(
            companyId,
            product._id,
            line.quantity,
            line.unitCost || 0,
            { 
              warehouse: warehouse ? warehouse._id : null,
              session,
              userId: req.user.id
            }
          );
          
          // Update batch if batch-tracked
          if (line.batchId) {
            const batch = await StockBatch.findById(line.batchId).session(session);
            if (batch) {
              batch.qtyOnHand = (batch.qtyOnHand || 0) + line.quantity;
              await batch.save({ session });
            }
          }
          
          // Update serial numbers if serial-tracked
          if (line.serialNumbers && line.serialNumbers.length > 0) {
            await StockSerialNumber.updateMany(
              { _id: { $in: line.serialNumbers } },
              { status: 'in_stock', returnedVia: creditNote._id, returnedAt: new Date() },
              { session }
            );
          }
          
          // Create stock movement
          // Use Number() to avoid string concatenation (currentStock can be Decimal128 string)
          const previousStock = Number(product.currentStock) || 0;
          const newStock = previousStock + Number(line.quantity);
          
          await StockMovement.create([{
            company: companyId,
            product: product._id,
            warehouse: warehouse ? warehouse._id : null,
            type: 'in',
            reason: 'return',
            quantity: line.quantity,
            previousStock,
            newStock,
            unitCost: line.unitCost || 0,
            totalCost: lineCogs,
            sourceType: 'credit_note',
            sourceId: creditNote._id,
            referenceNumber: creditNote.referenceNo || creditNote.creditNoteNumber,
            notes: 'CN#' + (creditNote.referenceNo || creditNote.creditNoteNumber) + ' - Return',
            performedBy: req.user.id,
            movementDate: new Date()
          }], { session });
          
          // Update product stock
          await Product.findByIdAndUpdate(product._id, { currentStock: newStock }, { session });
        }
        
        // ========== Track qty credited on invoice line ==========
        const invoiceLine = invoice.lines.id(line.invoiceLineId);
        if (invoiceLine) {
          invoiceLine.qtyCredited = (invoiceLine.qtyCredited || 0) + line.quantity;
        }
      }
      
      // Save invoice with updated qtyCredited
      await invoice.save({ session });
      
      // ========== STEP 2: Post Revenue Reversal Journal Entry (Entry A) ==========
      const totalAmount = totalSubtotal + totalTax;
      const narration = 'Credit Note - ' + (creditNote.client?.name || 'Client') + ' - CN#' + (creditNote.referenceNo || creditNote.creditNoteNumber) + ' - Ref INV#' + (invoice.invoiceNumber || invoice._id);
      
      // Get revenue account from first product
      let revenueAccount = DEFAULT_ACCOUNTS.salesRevenue;
      if (lineArray[0] && lineArray[0].product) {
        const firstProduct = await Product.findById(lineArray[0].product._id).session(session);
        if (firstProduct && firstProduct.revenueAccount) {
          revenueAccount = firstProduct.revenueAccount;
        }
      }
      
      console.log('DEBUG: Creating revenue + COGS entries with totalSubtotal =', totalSubtotal, 'totalTax =', totalTax, 'totalAmount =', totalAmount);

      // Build revenue lines
      const revenueLines = [
        { accountCode: revenueAccount, accountName: 'Sales Revenue', debit: totalSubtotal, credit: 0, description: narration },
        { accountCode: DEFAULT_ACCOUNTS.vatPayable, accountName: 'VAT Output', debit: totalTax || 0, credit: 0, description: narration },
        { accountCode: DEFAULT_ACCOUNTS.accountsReceivable, accountName: 'Accounts Receivable', debit: 0, credit: totalAmount || (totalSubtotal + (totalTax || 0)), description: narration }
      ];

      // Build COGS lines if goods return
      let cogsLines = null;
      if (isGoodsReturn && totalCogs > 0) {
        let inventoryAccount = DEFAULT_ACCOUNTS.inventory;
        let cogsAccount = DEFAULT_ACCOUNTS.costOfGoodsSold;
        if (lineArray[0] && lineArray[0].product) {
          const firstProduct = await Product.findById(lineArray[0].product._id).session(session);
          if (firstProduct) {
            if (firstProduct.inventoryAccount) inventoryAccount = firstProduct.inventoryAccount;
            if (firstProduct.cogsAccount) cogsAccount = firstProduct.cogsAccount;
          }
        }
        const cogsNarration = 'COGS Reversal - ' + (creditNote.client?.name || 'Client') + ' - CN#' + (creditNote.referenceNo || creditNote.creditNoteNumber);
        cogsLines = [
          { accountCode: inventoryAccount, accountName: 'Inventory', debit: totalCogs, credit: 0, description: cogsNarration },
          { accountCode: cogsAccount, accountName: 'Cost of Goods Sold', debit: 0, credit: totalCogs, description: cogsNarration }
        ];
      }

      // Prepare entries array
      const entriesToCreate = [
        {
          date: new Date(),
          description: narration,
          sourceType: 'credit_note',
          sourceId: creditNote._id,
          sourceReference: creditNote.referenceNo || creditNote.creditNoteNumber,
          lines: revenueLines,
          isAutoGenerated: true
        }
      ];
      if (cogsLines) {
        entriesToCreate.push({
          date: new Date(),
          description: `COGS Reversal - ${creditNote.referenceNo || creditNote.creditNoteNumber}`,
          sourceType: 'credit_note_cogs',
          sourceId: creditNote._id,
          sourceReference: `CN-COGS-${creditNote.referenceNo || creditNote.creditNoteNumber}`,
          lines: cogsLines,
          isAutoGenerated: true
        });
      }

      const created = await JournalService.createEntriesAtomic(companyId, req.user.id, entriesToCreate, { session });
      if (Array.isArray(created) && created.length > 0) {
        creditNote.revenueReversalEntry = created[0]._id;
        if (created[1]) creditNote.cogsReversalEntry = created[1]._id;
      }
      
      // ========== STEP 5: Update AR balance ==========
      invoice.amountOutstanding = (invoice.amountOutstanding || invoice.balance || 0) - totalAmount;
      if (invoice.amountOutstanding <= 0) {
        invoice.amountOutstanding = 0;
        invoice.status = 'fully_paid';
        if (!invoice.paidDate) {
          invoice.paidDate = new Date();
        }
      }
      await invoice.save({ session });
      
      // Update credit note status
      creditNote.status = 'confirmed';
      creditNote.confirmedBy = req.user.id;
      creditNote.confirmedAt = new Date();
      creditNote.stockReversed = isGoodsReturn;
      
      await creditNote.save({ session });
    });
    
    await creditNote.populate('lines.product lines.returnToWarehouse createdBy confirmedBy invoice client revenueReversalEntry cogsReversalEntry');
    
    res.json({ success: true, message: 'Credit note confirmed successfully', data: creditNote });
  } catch (err) {
    console.error('Error confirming credit note:', err);
    next(err);
  }
};
