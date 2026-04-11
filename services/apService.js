const mongoose = require("mongoose");
const APPayment = require("../models/APPayment");
const APPaymentAllocation = require("../models/APPaymentAllocation");
const GoodsReceivedNote = require("../models/GoodsReceivedNote");
const Supplier = require("../models/Supplier");
const { BankAccount } = require("../models/BankAccount");
const JournalService = require("./journalService");
const periodService = require("./periodService");
const cacheService = require("./cacheService");
const APTrackingService = require("./apTrackingService");
const { DEFAULT_ACCOUNTS } = require("../constants/chartOfAccounts");
const { nextSequence } = require("./sequenceService");
const { aggregateWithTimeout } = require("../utils/mongoAggregation");

/**
 * AP Service - Handles Accounts Payable operations
 * Following the rules:
 * - All money: DECIMAL(18,2)
 * - All rates/costs: DECIMAL(18,6)
 * - API money responses: always strings
 * - Reference numbers: DB sequences, zero-padded to 5 digits per year
 * - Posted entries: immutable (corrections via reversal only)
 */

// AP accounts payable code
const AP_ACCOUNT_CODE = "2000"; // Accounts Payable (was incorrectly set to 2100 = VAT Payable)

class APService {
  /**
   * Create a new AP payment (draft status)
   */
  static async createPayment(companyId, userId, data) {
    const {
      supplierId,
      paymentDate,
      paymentMethod,
      bankAccountId,
      amountPaid,
      currencyCode = "USD",
      exchangeRate = 1,
      reference: externalRef,
      notes,
      allocations = [],
    } = data;

    // Validate supplier
    const supplier = await Supplier.findOne({
      _id: supplierId,
      company: companyId,
    });
    if (!supplier) {
      throw new Error("Supplier not found");
    }

    // Validate bank account
    const bankAccount = await BankAccount.findOne({
      _id: bankAccountId,
      company: companyId,
    });
    if (!bankAccount) {
      throw new Error("Bank account not found");
    }

    // Validate amount
    const amountNum = parseFloat(amountPaid);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error("Invalid amount paid");
    }

    // Validate allocations if provided
    let totalAllocated = 0;
    if (allocations.length > 0) {
      for (const alloc of allocations) {
        totalAllocated += parseFloat(alloc.amountAllocated) || 0;
      }
      if (totalAllocated > amountNum) {
        throw new Error("Total allocated amount exceeds payment amount");
      }
    }

    // Generate reference number for payment
    const year = new Date().getFullYear();
    const seqNum = await nextSequence(companyId, "ap_payment");
    const generatedRef = `PAY-${year}-${seqNum}`;

    // Create payment
    const payment = new APPayment({
      company: companyId,
      supplier: supplierId,
      paymentDate: paymentDate || new Date(),
      paymentMethod,
      bankAccount: bankAccountId,
      amountPaid: mongoose.Types.Decimal128.fromString(amountNum.toString()),
      currencyCode,
      exchangeRate: mongoose.Types.Decimal128.fromString(
        parseFloat(exchangeRate).toString(),
      ),
      referenceNo: externalRef || generatedRef,
      reference: externalRef || null,
      status: "draft",
      notes: notes || null,
      createdBy: userId,
    });

    await payment.save();

    // Create allocations if provided
    if (allocations.length > 0) {
      for (const alloc of allocations) {
        // Validate GRN belongs to same supplier
        const grn = await GoodsReceivedNote.findById(alloc.grnId);
        if (!grn) {
          throw new Error(`GRN not found: ${alloc.grnId}`);
        }
        if (grn.supplier.toString() !== supplierId.toString()) {
          throw new Error(
            "GRN must belong to the same supplier as the payment",
          );
        }

        const allocation = new APPaymentAllocation({
          payment: payment._id,
          grn: alloc.grnId,
          amountAllocated: mongoose.Types.Decimal128.fromString(
            parseFloat(alloc.amountAllocated).toString(),
          ),
          company: companyId,
          createdBy: userId,
        });
        await allocation.save();
        // Note: do not update GRN balances here. Balances are updated when the payment is posted
      }
    }

    // Invalidate cache
    try {
      await cacheService.bumpCompanyFinancialCaches(companyId);
    } catch (e) {
      console.error("Cache invalidation failed:", e);
    }

    return payment;
  }

  /**
   * Update an existing payment (draft only)
   */
  static async updatePayment(companyId, userId, paymentId, data) {
    const payment = await APPayment.findOne({
      _id: paymentId,
      company: companyId,
    });
    if (!payment) {
      throw new Error("Payment not found");
    }

    if (payment.status !== "draft") {
      throw new Error("Only draft payments can be edited");
    }

    // Update fields
    if (data.paymentDate) payment.paymentDate = data.paymentDate;
    if (data.paymentMethod) payment.paymentMethod = data.paymentMethod;
    if (data.bankAccountId) payment.bankAccount = data.bankAccountId;
    if (data.amountPaid) {
      payment.amountPaid = mongoose.Types.Decimal128.fromString(
        parseFloat(data.amountPaid).toString(),
      );
    }
    if (data.currencyCode) payment.currencyCode = data.currencyCode;
    if (data.exchangeRate) {
      payment.exchangeRate = mongoose.Types.Decimal128.fromString(
        parseFloat(data.exchangeRate).toString(),
      );
    }
    if (data.reference !== undefined) payment.reference = data.reference;
    if (data.notes !== undefined) payment.notes = data.notes;

    await payment.save();

    // Invalidate cache
    try {
      await cacheService.bumpCompanyFinancialCaches(companyId);
    } catch (e) {
      console.error("Cache invalidation failed:", e);
    }

    return payment;
  }

  /**
   * Post an AP payment (creates journal entry)
   * Per Section 2.3:
   * 1. Validate: SUM(allocations) <= amount_paid, period open, all GRNs same supplier
   * 2. Post journal: DR 2100 AP, CR bank_account
   * 3. Mark GRNs as paid
   */
  static async postPayment(companyId, userId, paymentId) {
    const payment = await APPayment.findOne({
      _id: paymentId,
      company: companyId,
    });
    if (!payment) {
      throw new Error("Payment not found");
    }

    if (payment.status !== "draft") {
      throw new Error("Only draft payments can be posted");
    }

    // Step 1: Check period is open
    if (
      await periodService.isDateInClosedPeriod(companyId, payment.paymentDate)
    ) {
      throw new Error("Target accounting period is closed");
    }

    // Get allocations for this payment
    const allocations = await APPaymentAllocation.find({
      payment: payment._id,
    });

    // Step 1a: Validate SUM(allocations) <= amount_paid
    const paymentAmount = parseFloat(payment.amountPaid);
    let totalAllocated = 0;

    if (allocations.length > 0) {
      for (const alloc of allocations) {
        totalAllocated += parseFloat(alloc.amountAllocated);

        // Step 1c: Validate each GRN belongs to same supplier
        const grn = await GoodsReceivedNote.findById(alloc.grn);
        if (!grn) {
          throw new Error("Allocated GRN not found");
        }
        if (grn.supplier.toString() !== payment.supplier.toString()) {
          throw new Error(
            "Allocated GRN must belong to the same supplier as the payment",
          );
        }

        // Step 1b: Validate allocation <= GRN balance
        const grnBalance = parseFloat(grn.balance) || 0;
        const allocAmount = parseFloat(alloc.amountAllocated);

        if (allocAmount > grnBalance) {
          throw new Error(
            `Allocation amount ${allocAmount} exceeds GRN balance ${grnBalance}`,
          );
        }
      }

      if (totalAllocated > paymentAmount) {
        throw new Error("Total allocated amount cannot exceed payment amount");
      }
    }

    // Get supplier name for narration
    const supplier = await Supplier.findById(payment.supplier);
    const supplierName = supplier?.name || "Unknown Supplier";

    // Get bank account code for journal entry
    const bankAccount = await BankAccount.findById(payment.bankAccount);
    const bankAccountCode =
      bankAccount?.accountCode || DEFAULT_ACCOUNTS.cashAtBank;

    const amountNum = parseFloat(payment.amountPaid);

    // Journal entries are intentionally NOT created here.
    // The DR AP / CR Cash entry is already posted when payment is recorded
    // on the purchase (POST /api/purchases/:id/payment) or PO.
    // This AP payment is a payment tracking record only — not a GL posting.

    // Calculate unallocated amount
    const unallocatedAmount = amountNum - totalAllocated;

    // Note: GRN balances are already updated when allocations are created via allocateToGRN
    // Do NOT update them again here to avoid double-counting

    // Update payment status
    payment.status = "posted";
    payment.postedBy = userId;
    payment.postedAt = new Date();
    payment.unallocatedAmount = mongoose.Types.Decimal128.fromString(
      unallocatedAmount.toFixed(2),
    );
    await payment.save();

    // Record in AP Transaction Ledger
    await APTrackingService.recordPaymentPosted(payment, userId);

    // Invalidate cache
    try {
      await cacheService.bumpCompanyFinancialCaches(companyId);
    } catch (e) {
      console.error("Cache invalidation failed:", e);
    }

    return payment;
  }

  /**
   * Save and Post payment — records payment without creating a journal entry.
   * This is now the canonical post behavior. Journal entries are handled
   * upstream by the purchase/PO payment recording.
   * @deprecated Use postPayment() instead — both now have identical behavior.
   */
  static async saveAndPostPayment(companyId, userId, paymentId) {
    const payment = await APPayment.findOne({
      _id: paymentId,
      company: companyId,
    });
    if (!payment) {
      throw new Error("Payment not found");
    }

    if (payment.status !== "draft") {
      throw new Error("Only draft payments can be posted");
    }

    // Check period is open
    if (
      await periodService.isDateInClosedPeriod(companyId, payment.paymentDate)
    ) {
      throw new Error("Target accounting period is closed");
    }

    // Get allocations for this payment
    const allocations = await APPaymentAllocation.find({
      payment: payment._id,
    });

    // Validate SUM(allocations) <= amount_paid
    const paymentAmount = parseFloat(payment.amountPaid);
    let totalAllocated = 0;

    if (allocations.length > 0) {
      for (const alloc of allocations) {
        totalAllocated += parseFloat(alloc.amountAllocated);

        // Validate each GRN belongs to same supplier
        const grn = await GoodsReceivedNote.findById(alloc.grn);
        if (!grn) {
          throw new Error("Allocated GRN not found");
        }
        if (grn.supplier.toString() !== payment.supplier.toString()) {
          throw new Error(
            "Allocated GRN must belong to the same supplier as the payment",
          );
        }

        // Validate allocation <= GRN balance
        const grnBalance = parseFloat(grn.balance) || 0;
        const allocAmount = parseFloat(alloc.amountAllocated);

        if (allocAmount > grnBalance) {
          throw new Error(
            `Allocation amount ${allocAmount} exceeds GRN balance ${grnBalance}`,
          );
        }
      }

      if (totalAllocated > paymentAmount) {
        throw new Error("Total allocated amount cannot exceed payment amount");
      }
    }

    // Calculate unallocated amount
    const unallocatedAmount = paymentAmount - totalAllocated;

    // Update payment status to posted (NO journal entry created)
    payment.status = "posted";
    payment.postedBy = userId;
    payment.postedAt = new Date();
    payment.unallocatedAmount = mongoose.Types.Decimal128.fromString(
      unallocatedAmount.toFixed(2),
    );
    await payment.save();

    // Record in AP Transaction Ledger
    await APTrackingService.recordPaymentPosted(payment, userId);

    // Invalidate cache
    try {
      await cacheService.bumpCompanyFinancialCaches(companyId);
    } catch (e) {
      console.error("Cache invalidation failed:", e);
    }

    return payment;
  }

  /**
   * Reverse a posted payment
   */
  static async reversePayment(companyId, userId, paymentId, reason) {
    const payment = await APPayment.findOne({
      _id: paymentId,
      company: companyId,
    });
    if (!payment) {
      throw new Error("Payment not found");
    }

    if (payment.status !== "posted") {
      throw new Error("Only posted payments can be reversed");
    }

    // Check period is open
    if (
      await periodService.isDateInClosedPeriod(companyId, payment.paymentDate)
    ) {
      throw new Error("Target accounting period is closed");
    }

    const amountNum = parseFloat(payment.amountPaid);

    // Get bank account code
    const bankAccount = await BankAccount.findById(payment.bankAccount);
    const bankAccountCode =
      bankAccount?.accountCode || DEFAULT_ACCOUNTS.cashAtBank;

    // Get supplier name
    const supplier = await Supplier.findById(payment.supplier);
    const supplierName = supplier?.name || "Unknown Supplier";

    // No reversal journal entry — AP payments are tracking-only records.
    // The GL impact is handled by the purchase/PO payment reversal flow.

    // Restore GRN balances from allocations
    const allocations = await APPaymentAllocation.find({
      payment: payment._id,
    });
    for (const alloc of allocations) {
      await this.restoreGRNBalance(
        alloc.grn,
        parseFloat(alloc.amountAllocated),
      );
    }

    // Update payment status
    payment.status = "reversed";
    payment.reversedAt = new Date();
    payment.reversedBy = userId;
    payment.reversalReason = reason || "Reversed";
    await payment.save();

    // Record in AP Transaction Ledger
    await APTrackingService.recordPaymentReversed(payment, userId, reason);

    // Invalidate cache
    try {
      await cacheService.bumpCompanyFinancialCaches(companyId);
    } catch (e) {
      console.error("Cache invalidation failed:", e);
    }

    return payment;
  }

  /**
   * Allocate payment to GRN (for draft or posted payments)
   */
  static async allocateToGRN(companyId, userId, paymentId, grnId, amount) {
    const payment = await APPayment.findOne({
      _id: paymentId,
      company: companyId,
    });
    if (!payment) {
      throw new Error("Payment not found");
    }

    if (payment.status !== "draft" && payment.status !== "posted") {
      throw new Error("Payment cannot be allocated");
    }

    const grn = await GoodsReceivedNote.findOne({
      _id: grnId,
      company: companyId,
    });
    if (!grn) {
      throw new Error("GRN not found");
    }

    // Check if this GRN belongs to the same supplier
    if (grn.supplier.toString() !== payment.supplier.toString()) {
      throw new Error("GRN does not belong to the same supplier");
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error("Invalid allocation amount");
    }

    // Check existing allocation
    const existingAlloc = await APPaymentAllocation.findOne({
      payment: paymentId,
      grn: grnId,
    });

    if (existingAlloc) {
      throw new Error("This GRN is already allocated to this payment");
    }

    // Check available amount to allocate
    const allocatedSum = await aggregateWithTimeout(APPaymentAllocation, [
      { $match: { payment: payment._id } },
      { $group: { _id: null, total: { $sum: "$amountAllocated" } } },
    ]);
    const alreadyAllocated = allocatedSum[0]?.total || 0;
    const paymentAmount = parseFloat(payment.amountPaid);
    const available = paymentAmount - alreadyAllocated;

    if (amountNum > available) {
      throw new Error(
        `Cannot allocate more than available amount (${available})`,
      );
    }

    // Check GRN balance
    const grnBalance = parseFloat(grn.balance) || 0;
    if (amountNum > grnBalance) {
      throw new Error(`Cannot allocate more than GRN balance (${grnBalance})`);
    }

    // Create allocation
    const allocation = new APPaymentAllocation({
      payment: paymentId,
      grn: grnId,
      amountAllocated: mongoose.Types.Decimal128.fromString(
        amountNum.toString(),
      ),
      company: companyId,
      createdBy: userId,
    });

    await allocation.save();

    // Update GRN balance
    await this.updateGRNBalance(grnId, amountNum);

    // Invalidate cache
    try {
      await cacheService.bumpCompanyFinancialCaches(companyId);
    } catch (e) {
      console.error("Cache invalidation failed:", e);
    }

    return allocation;
  }

  /**
   * Update GRN balance after allocation (for draft payments)
   */
  static async updateGRNBalance(grnId, amount) {
    const grn = await GoodsReceivedNote.findById(grnId);
    if (!grn) return;

    const currentPaid = parseFloat(grn.amountPaid) || 0;
    const currentBalance = parseFloat(grn.balance) || 0;
    const newPaid = currentPaid + amount;
    const newBalance = Math.max(0, currentBalance - amount);

    grn.amountPaid = mongoose.Types.Decimal128.fromString(newPaid.toString());
    grn.balance = mongoose.Types.Decimal128.fromString(newBalance.toString());

    // Update payment status
    if (newBalance <= 0.01) {
      grn.paymentStatus = "paid";
    } else if (newPaid > 0) {
      grn.paymentStatus = "partially_paid";
    }

    await grn.save();
  }

  /**
   * Update GRN balance on payment post
   * grn.amount_paid += allocation.amount_allocated
   * grn.balance -= allocation.amount_allocated
   */
  static async updateGRNBalanceOnPost(grnId, amount) {
    const grn = await GoodsReceivedNote.findById(grnId);
    if (!grn) return;

    const currentPaid = parseFloat(grn.amountPaid) || 0;
    const currentBalance = parseFloat(grn.balance) || 0;

    const newPaid = currentPaid + amount;
    const newBalance = currentBalance - amount;

    grn.amountPaid = mongoose.Types.Decimal128.fromString(newPaid.toString());
    grn.balance = mongoose.Types.Decimal128.fromString(
      Math.max(0, newBalance).toString(),
    );

    // Update payment status
    if (newBalance <= 0.01) {
      grn.paymentStatus = "paid";
    } else if (newPaid > 0) {
      grn.paymentStatus = "partially_paid";
    }

    await grn.save();
  }

  /**
   * Restore GRN balance after payment reversal
   */
  static async restoreGRNBalance(grnId, amount) {
    const grn = await GoodsReceivedNote.findById(grnId);
    if (!grn) return;

    const currentPaid = parseFloat(grn.amountPaid) || 0;
    const currentBalance = parseFloat(grn.balance) || 0;
    const totalAmount = parseFloat(grn.totalAmount) || 0;

    const newPaid = Math.max(0, currentPaid - amount);
    const newBalance = totalAmount - newPaid;

    grn.amountPaid = mongoose.Types.Decimal128.fromString(newPaid.toString());
    grn.balance = mongoose.Types.Decimal128.fromString(newBalance.toString());

    // Restore payment status
    if (newPaid >= totalAmount) {
      grn.paymentStatus = "paid";
    } else if (newPaid > 0) {
      grn.paymentStatus = "partially_paid";
    } else {
      grn.paymentStatus = "pending";
    }

    await grn.save();
  }

  /**
   * Get AP aging report - per supplier, based on GRN payment_due_date
   * Buckets: current, 1-30, 31-60, 61-90, 90+
   */
  static async getAgingReport(companyId, options = {}) {
    const { supplierId, asOfDate } = options;
    const now = asOfDate ? new Date(asOfDate) : new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Calculate date boundaries
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
      paymentStatus: { $in: ["pending", "partially_paid"] },
      balance: { $gt: 0 },
    };

    if (supplierId) {
      matchConditions.supplier = supplierId;
    }

    // Get GRNs with their allocations
    const grns = await GoodsReceivedNote.find(matchConditions)
      .populate("supplier", "name code")
      .sort({ receivedDate: 1 });

    // Get all allocations for these GRNs
    const grnIds = grns.map((g) => g._id);
    const allocations = await APPaymentAllocation.find({
      grn: { $in: grnIds },
    }).lean();

    // Create allocation map
    const allocMap = {};
    allocations.forEach((alloc) => {
      const grnId = alloc.grn.toString();
      if (!allocMap[grnId]) allocMap[grnId] = 0;
      allocMap[grnId] += parseFloat(alloc.amountAllocated);
    });

    console.log(
      `[AP Aging] Found ${grns.length} GRNs with outstanding balance`,
    );
    console.log(
      `[AP Aging] Date boundaries - today: ${today.toISOString()}, todayMinus1: ${todayMinus1.toISOString()}`,
    );

    // Group by supplier
    const supplierData = {};
    let currentCount = 0,
      overdueCount = 0;

    grns.forEach((grn) => {
      // Subtract allocated amounts from balance
      const allocated = allocMap[grn._id.toString()] || 0;
      // FIX: Convert Decimal128 to string before parseFloat
      const balance = grn.balance ? parseFloat(grn.balance.toString()) : 0;
      const effectiveBalance = balance - allocated;

      if (effectiveBalance <= 0) return;

      // Get due date - default to received date if not set
      const dueDate = grn.paymentDueDate
        ? new Date(grn.paymentDueDate)
        : new Date(grn.receivedDate);
      const dueDateOnly = new Date(
        dueDate.getFullYear(),
        dueDate.getMonth(),
        dueDate.getDate(),
      );

      let bucket;

      // Per Section 2.4 bucket definitions (same as AR aging)
      if (dueDateOnly >= today) {
        bucket = "current";
        currentCount++;
      } else if (dueDateOnly >= todayMinus30 && dueDateOnly <= todayMinus1) {
        bucket = "1-30";
        overdueCount++;
      } else if (dueDateOnly >= todayMinus60 && dueDateOnly <= todayMinus31) {
        bucket = "31-60";
        overdueCount++;
      } else if (dueDateOnly >= todayMinus90 && dueDateOnly <= todayMinus61) {
        bucket = "61-90";
        overdueCount++;
      } else {
        bucket = "90+";
        overdueCount++;
      }

      // Debug log for first few GRNs
      if (currentCount + overdueCount <= 5) {
        console.log(
          `[AP Aging] GRN ${grn.referenceNo || grn._id}: dueDate=${dueDateOnly.toISOString()}, bucket=${bucket}, balance=${effectiveBalance.toFixed(2)}`,
        );
      }

      const supplierKey = grn.supplier?._id?.toString();
      if (!supplierKey) return;

      if (!supplierData[supplierKey]) {
        supplierData[supplierKey] = {
          supplier_id: grn.supplier._id,
          supplier_name: grn.supplier?.name || "Unknown",
          current: 0,
          "1-30": 0,
          "31-60": 0,
          "61-90": 0,
          "90+": 0,
          total_outstanding: 0,
        };
      }
      // Add to appropriate bucket
      supplierData[supplierKey][bucket] += effectiveBalance;
      supplierData[supplierKey].total_outstanding += effectiveBalance;
    });

    // Format amounts as strings with 2 decimal places
    const result = Object.values(supplierData).map((s) => ({
      supplier: { _id: s.supplier_id, name: s.supplier_name },
      current: s.current.toFixed(2),
      "1-30": s["1-30"].toFixed(2),
      "31-60": s["31-60"].toFixed(2),
      "61-90": s["61-90"].toFixed(2),
      "90+": s["90+"].toFixed(2),
      totalBalance: s.total_outstanding.toFixed(2),
    }));

    // Calculate summary for debug
    const totals = result.reduce(
      (acc, r) => ({
        current: acc.current + parseFloat(r.current),
        "1-30": acc["1-30"] + parseFloat(r["1-30"]),
        "31-60": acc["31-60"] + parseFloat(r["31-60"]),
        "61-90": acc["61-90"] + parseFloat(r["61-90"]),
        "90+": acc["90+"] + parseFloat(r["90+"]),
      }),
      { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 },
    );
    console.log(
      `[AP Aging] Summary - current: ${totals.current.toFixed(2)}, 1-30: ${totals["1-30"].toFixed(2)}, 31-60: ${totals["31-60"].toFixed(2)}, 61-90: ${totals["61-90"].toFixed(2)}, 90+: ${totals["90+"].toFixed(2)}`,
    );

    return {
      success: true,
      asOfDate: today,
      data: result,
    };
  }

  /**
   * Get supplier statement - full details: GRNs, payments, balance
   */
  static async getSupplierStatement(companyId, supplierId, options = {}) {
    const { startDate, endDate } = options;

    // Verify supplier
    const supplier = await Supplier.findOne({
      _id: supplierId,
      company: companyId,
    });
    if (!supplier) {
      throw new Error("Supplier not found");
    }

    // Build date filter
    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    // Get GRNs
    const grnQuery = { supplier: supplierId, company: companyId };
    if (startDate || endDate) {
      grnQuery.receivedDate = dateFilter;
    }
    const grns = await GoodsReceivedNote.find(grnQuery)
      .populate("createdBy", "name")
      .sort({ receivedDate: 1 });

    // Get payments and allocations for this supplier
    const payments = await APPayment.find({
      supplier: supplierId,
      company: companyId,
    }).sort({ paymentDate: -1 });

    const paymentIds = payments.map((p) => p._id);
    const allocations = await APPaymentAllocation.find({
      payment: { $in: paymentIds },
      company: companyId,
    }).populate("grn", "referenceNo totalAmount balance");

    // Build statement
    const statement = {
      supplier: {
        _id: supplier._id,
        name: supplier.name,
        code: supplier.code,
      },
      grns: grns.map((grn) => ({
        id: grn._id,
        reference: grn.referenceNo,
        date: grn.receivedDate,
        dueDate: grn.paymentDueDate,
        total: parseFloat(grn.totalAmount || 0).toFixed(2),
        paid: parseFloat(grn.amountPaid || 0).toFixed(2),
        balance: parseFloat(grn.balance || 0).toFixed(2),
        status: grn.paymentStatus,
      })),
      payments: payments.map((pay) => ({
        id: pay._id,
        reference: pay.referenceNo,
        date: pay.paymentDate,
        amount: parseFloat(pay.amountPaid).toFixed(2),
        status: pay.status,
        allocations: allocations
          .filter((a) => a.payment.toString() === pay._id.toString())
          .map((a) => ({
            grnReference: a.grn?.referenceNo,
            amount: parseFloat(a.amountAllocated).toFixed(2),
          })),
      })),
    };

    // Calculate totals
    const totalGRNs = grns.reduce(
      (sum, grn) => sum + (parseFloat(grn.totalAmount) || 0),
      0,
    );
    const totalPaid = grns.reduce(
      (sum, grn) => sum + (parseFloat(grn.amountPaid) || 0),
      0,
    );
    const totalOutstanding = grns.reduce(
      (sum, grn) => sum + (parseFloat(grn.balance) || 0),
      0,
    );

    statement.summary = {
      totalGRNs: totalGRNs.toFixed(2),
      totalPaid: totalPaid.toFixed(2),
      totalOutstanding: totalOutstanding.toFixed(2),
      grnCount: grns.length,
    };

    return {
      success: true,
      data: statement,
    };
  }

  /**
   * Get payments with filters
   */
  static async getPayments(companyId, options = {}) {
    const {
      supplierId,
      status,
      dateFrom,
      dateTo,
      page = 1,
      limit = 50,
    } = options;

    const query = { company: companyId };

    if (supplierId) {
      query.supplier = supplierId;
    }

    if (status) {
      query.status = status;
    }

    if (dateFrom || dateTo) {
      query.paymentDate = {};
      if (dateFrom) query.paymentDate.$gte = new Date(dateFrom);
      if (dateTo) query.paymentDate.$lte = new Date(dateTo);
    }

    const total = await APPayment.countDocuments(query);
    const payments = await APPayment.find(query)
      .populate("supplier", "name code")
      .populate("bankAccount", "name accountNumber")
      .sort({ paymentDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return {
      success: true,
      data: payments,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get single payment with allocations
   */
  static async getPayment(companyId, paymentId) {
    const payment = await APPayment.findOne({
      _id: paymentId,
      company: companyId,
    })
      .populate("supplier", "name code")
      .populate("bankAccount", "name accountNumber accountCode")
      .populate("journalEntry")
      .populate("postedBy", "name");

    if (!payment) {
      throw new Error("Payment not found");
    }

    // Get allocations
    const allocations = await APPaymentAllocation.find({
      payment: paymentId,
    }).populate("grn", "referenceNo totalAmount balance paymentStatus");

    return {
      success: true,
      data: {
        ...payment.toObject(),
        allocations,
      },
    };
  }
}

module.exports = APService;
