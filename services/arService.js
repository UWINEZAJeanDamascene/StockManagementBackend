const mongoose = require("mongoose");
const ARReceipt = require("../models/ARReceipt");
const ARReceiptAllocation = require("../models/ARReceiptAllocation");
const ARBadDebtWriteoff = require("../models/ARBadDebtWriteoff");
const Invoice = require("../models/Invoice");
const Client = require("../models/Client");
const JournalService = require("./journalService");
const periodService = require("./periodService");
const cacheService = require("./cacheService");
const ARTrackingService = require("./arTrackingService");
const { DEFAULT_ACCOUNTS } = require("../constants/chartOfAccounts");
const { aggregateWithTimeout } = require("../utils/mongoAggregation");

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
      status: { $in: ["sent", "confirmed", "partially_paid"] },
    };

    if (clientId) {
      matchConditions.client = clientId;
    }

    // Get invoices with their allocations
    // Populate client to get client names
    const invoices = await Invoice.find(matchConditions)
      .populate("client", "name code")
      .sort({ invoiceDate: 1 });

    // Debug: log invoices found for aging report
    try {
      console.log(
        "ARService.getAgingReport - invoices found:",
        invoices.length,
        invoices.map((i) => i.referenceNo),
      );
    } catch (e) {}

    // Get all allocations for these invoices
    const invoiceIds = invoices.map((inv) => inv._id);
    const allocations = await ARReceiptAllocation.find({
      invoice: { $in: invoiceIds },
    }).lean();

    // Create allocation map
    const allocMap = {};
    allocations.forEach((alloc) => {
      const invId = alloc.invoice.toString();
      if (!allocMap[invId]) allocMap[invId] = 0;
      allocMap[invId] += parseFloat(alloc.amountAllocated);
    });

    // Group by client
    const clientData = {};

    invoices.forEach((inv) => {
      // Subtract allocated amounts from outstanding balance
      const allocated = allocMap[inv._id.toString()] || 0;
      // FIX: Convert Decimal128 to string before parseFloat
      const outstanding = inv.amountOutstanding
        ? parseFloat(inv.amountOutstanding.toString())
        : inv.balance
          ? parseFloat(inv.balance.toString())
          : 0;
      const effectiveBalance = outstanding - allocated;

      if (effectiveBalance <= 0) return;

      // Get due date - default to invoice date if not set
      const dueDate = inv.dueDate
        ? new Date(inv.dueDate)
        : new Date(inv.invoiceDate);
      const dueDateOnly = new Date(
        dueDate.getFullYear(),
        dueDate.getMonth(),
        dueDate.getDate(),
      );

      let bucket;

      // Standard aging buckets: current, 1-30, 31-60, 61-90, 90+
      if (dueDateOnly >= today) {
        bucket = "current";
      } else if (dueDateOnly >= todayMinus30 && dueDateOnly <= todayMinus1) {
        bucket = "1-30";
      } else if (dueDateOnly >= todayMinus60 && dueDateOnly <= todayMinus31) {
        bucket = "31-60";
      } else if (dueDateOnly >= todayMinus90 && dueDateOnly <= todayMinus61) {
        bucket = "61-90";
      } else {
        bucket = "90+";
      }

      // Get client info - client is now populated
      const clientId = inv.client?._id?.toString();
      const clientName = inv.client?.name || "Unknown";
      const clientCode = inv.client?.code || "";

      if (!clientId) return;

      if (!clientData[clientId]) {
        clientData[clientId] = {
          client_id: inv.client._id,
          client_name: clientName,
          client_code: clientCode,
          current: 0,
          "1-30": 0,
          "31-60": 0,
          "61-90": 0,
          "90+": 0,
          total_outstanding: 0,
        };
      }
      // Add to appropriate bucket
      clientData[clientId][bucket] += effectiveBalance;
      clientData[clientId].total_outstanding += effectiveBalance;
    });

    // Format amounts as strings with 2 decimal places
    const result = Object.values(clientData).map((c) => ({
      client: { _id: c.client_id, name: c.client_name, code: c.client_code },
      current: c.current.toFixed(2),
      "1-30": c["1-30"].toFixed(2),
      "31-60": c["31-60"].toFixed(2),
      "61-90": c["61-90"].toFixed(2),
      "90+": c["90+"].toFixed(2),
      totalBalance: c.total_outstanding.toFixed(2),
    }));

    try {
      console.log("ARService.getAgingReport - result:", JSON.stringify(result));
    } catch (e) {}

    return {
      success: true,
      asOfDate: today,
      data: result,
    };
  }

  /**
   * Get client statement - full details: invoices, credits, receipts, balance
   */
  
static async writeOffBadDebt(companyId, userId, data) {
    const { invoiceId, writeoffDate, amount, reason, notes } = data;

    const invoice = await Invoice.findOne({
      _id: invoiceId,
      company: companyId,
    });
    if (!invoice) {
      throw new Error("Invoice not found");
    }

    // Check if already written off
    if (invoice.status === "cancelled") {
      throw new Error("Invoice is already written off as bad debt");
    }

    const amountNum = parseFloat(amount) || parseFloat(invoice.balance) || 0;
    if (amountNum <= 0) {
      throw new Error("Invalid write-off amount");
    }

    // Check period is open
    const targetDate = writeoffDate || new Date();
    if (await periodService.isDateInClosedPeriod(companyId, targetDate)) {
      throw new Error("Target accounting period is closed");
    }

    // Get client name for narration
    const client = await Client.findById(invoice.client);
    const clientName = client?.name || "Unknown Client";
    const invoiceRef = invoice.referenceNo || invoice.invoiceNumber || "N/A";

    // Create bad debt write-off record as DRAFT only; posting will be
    // performed by a separate postBadDebtWriteoff method.
    const writeoff = new ARBadDebtWriteoff({
      invoice: invoiceId,
      client: invoice.client,
      writeoffDate: targetDate,
      amount: mongoose.Types.Decimal128.fromString(amountNum.toFixed(2)),
      reason: reason || "Bad debt write-off",
      notes: notes || null,
      status: "draft",
      createdBy: userId,
      company: companyId,
    });

    await writeoff.save();

    // Invalidate cache
    try {
      await cacheService.bumpCompanyFinancialCaches(companyId);
    } catch (e) {
      console.error("Cache invalidation failed:", e);
    }

    return writeoff;
  }

  /**
   * Post a previously created bad debt write-off (create journals and apply)
   */
  
static async postBadDebtWriteoff(companyId, userId, writeoffId) {
    const writeoff = await ARBadDebtWriteoff.findOne({
      _id: writeoffId,
      company: companyId,
    });
    if (!writeoff) throw new Error("Bad debt write-off not found");
    if (writeoff.status !== "draft") {
      const err = new Error("INVALID_STATUS");
      err.status = 400;
      throw err;
    }

    const invoice = await Invoice.findById(writeoff.invoice);
    if (!invoice) throw new Error("Invoice not found");

    const amountNum = parseFloat(writeoff.amount) || 0;

    // Create journal entries now
    const client = await Client.findById(writeoff.client);
    const clientName = client?.name || "Unknown Client";
    const invoiceRef = invoice.referenceNo || invoice.invoiceNumber || "N/A";
    const narration = `Bad Debt Write-off - ${clientName} - INV#${invoiceRef}`;

    const bdDebitLine = JournalService.createDebitLine(
      DEFAULT_ACCOUNTS.badDebtExpense || "6100",
      amountNum,
      narration,
    );
    const bdCreditLine = JournalService.createCreditLine(
      await JournalService.getMappedAccountCode(
        companyId,
        "sales",
        "accountsReceivable",
        DEFAULT_ACCOUNTS.accountsReceivable,
      ),
      amountNum,
      narration,
    );

    const bdEntryA = {
      date: writeoff.writeoffDate || new Date(),
      description: narration,
      sourceType: "bad_debt_writeoff",
      sourceId: writeoff._id,
      sourceReference: writeoff.reference || writeoff.referenceNo,
      lines: [bdDebitLine, bdCreditLine],
      isAutoGenerated: true,
    };

    const bdEntries = await JournalService.createEntriesAtomic(
      companyId,
      userId,
      [bdEntryA],
    );
    const journalEntry =
      Array.isArray(bdEntries) && bdEntries.length > 0 ? bdEntries[0] : null;

    // Update write-off status
    writeoff.status = "posted";
    if (journalEntry) writeoff.journalEntry = journalEntry._id;
    writeoff.postedBy = userId;
    await writeoff.save();

    // Update invoice balance: amount_outstanding -= writeoff_amount
    const currentOutstanding =
      parseFloat(invoice.amountOutstanding) || parseFloat(invoice.balance) || 0;
    const newOutstanding = currentOutstanding - amountNum;

    invoice.amountOutstanding = mongoose.Types.Decimal128.fromString(
      Math.max(0, newOutstanding).toFixed(2),
    );
    invoice.balance = Math.max(0, newOutstanding);

    // If fully written off: invoice.status = cancelled
    if (newOutstanding <= 0.01) {
      invoice.status = "cancelled";
      invoice.badDebtWrittenOff = true;
      invoice.writtenOffAt = new Date();
      invoice.writtenOffBy = userId;
      invoice.badDebtReason = writeoff.reason || "Bad debt write-off";
    }
    await invoice.save();

    // Update client outstanding balance
    if (client) {
      client.outstandingBalance = Math.max(
        0,
        (client.outstandingBalance || 0) - amountNum,
      );
      await client.save();
    }

    // Invalidate cache
    try {
      await cacheService.bumpCompanyFinancialCaches(companyId);
    } catch (e) {
      console.error("Cache invalidation failed:", e);
    }

    // Record AR tracking transaction for bad debt write-off
    try {
      await ARTrackingService.recordBadDebtWriteoff(writeoff, invoice, userId);
    } catch (trackingError) {
      console.error("AR tracking error for bad debt write-off:", trackingError);
    }

    return writeoff;
  }

  /**
   * Reverse bad debt write-off
   */
  
static async getClientStatement(companyId, clientId, options = {}) {
    const { startDate, endDate } = options;

    // Verify client
    const client = await Client.findOne({ _id: clientId, company: companyId });
    if (!client) {
      throw new Error("Client not found");
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
      .populate("createdBy", "name")
      .sort({ invoiceDate: 1 });

    // Get receipts and allocations for this client
    const receipts = await ARReceipt.find({
      client: clientId,
      company: companyId,
    }).sort({ receiptDate: -1 });

    const receiptIds = receipts.map((r) => r._id);
    const allocations = await ARReceiptAllocation.find({
      receipt: { $in: receiptIds },
      company: companyId,
    }).populate("invoice", "invoiceNumber referenceNo");

    // Build statement
    const statement = {
      client: {
        _id: client._id,
        name: client.name,
        code: client.code,
      },
      invoices: invoices.map((inv) => ({
        id: inv._id,
        reference: inv.referenceNo,
        date: inv.invoiceDate,
        dueDate: inv.dueDate,
        total: parseFloat(inv.roundedAmount || inv.total || 0).toFixed(2),
        paid: parseFloat(inv.amountPaid || 0).toFixed(2),
        balance: parseFloat(inv.balance || 0).toFixed(2),
        status: inv.status,
      })),
      receipts: receipts.map((rec) => ({
        id: rec._id,
        reference: rec.referenceNo,
        date: rec.receiptDate,
        amount: parseFloat(rec.amountReceived).toFixed(2),
        status: rec.status,
        allocations: allocations
          .filter((a) => a.receipt.toString() === rec._id.toString())
          .map((a) => ({
            invoiceReference: a.invoice?.referenceNo,
            amount: parseFloat(a.amountAllocated).toFixed(2),
          })),
      })),
    };

    // Calculate totals
    const totalInvoices = invoices.reduce(
      (sum, inv) => sum + parseFloat(inv.roundedAmount || inv.total || 0),
      0,
    );
    const totalPaid = invoices.reduce(
      (sum, inv) => sum + parseFloat(inv.amountPaid || 0),
      0,
    );
    const totalOutstanding = invoices.reduce(
      (sum, inv) => sum + parseFloat(inv.balance || 0),
      0,
    );

    statement.summary = {
      totalInvoices: totalInvoices.toFixed(2),
      totalPaid: totalPaid.toFixed(2),
      totalOutstanding: totalOutstanding.toFixed(2),
      invoiceCount: invoices.length,
    };

    return {
      success: true,
      data: statement,
    };
  }
}


module.exports = ARService;
