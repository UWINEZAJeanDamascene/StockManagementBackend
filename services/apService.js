const mongoose = require("mongoose");
const APPayment = require("../models/APPayment");
const APPaymentAllocation = require("../models/APPaymentAllocation");
const GoodsReceivedNote = require("../models/GoodsReceivedNote");
const Supplier = require("../models/Supplier");
const Purchase = require("../models/Purchase");
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

    // Also include direct purchases (Purchase model) that have an outstanding balance
    try {
      const purchaseMatch = {
        company: companyId,
        balance: { $gt: 0 },
        status: { $nin: ["paid", "cancelled", "draft"] },
      };
      if (supplierId) purchaseMatch.supplier = supplierId;

      const purchases = await Purchase.find(purchaseMatch)
        .populate("supplier", "name code")
        .sort({ purchaseDate: 1 });

      console.log(
        `[AP Aging] Found ${purchases.length} direct purchases with outstanding balance`,
      );

      purchases.forEach((p) => {
        const balance = p.balance ? parseFloat(p.balance.toString()) : 0;
        const effectiveBalance = balance;
        if (effectiveBalance <= 0) return;

        const dueDate = p.supplierInvoiceDate
          ? new Date(p.supplierInvoiceDate)
          : p.receivedDate
          ? new Date(p.receivedDate)
          : new Date(p.purchaseDate);
        const dueDateOnly = new Date(
          dueDate.getFullYear(),
          dueDate.getMonth(),
          dueDate.getDate(),
        );

        let bucket;
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

        if (currentCount + overdueCount <= 5) {
          console.log(
            `[AP Aging] Purchase ${p.purchaseNumber || p._id}: dueDate=${dueDateOnly.toISOString()}, bucket=${bucket}, balance=${effectiveBalance.toFixed(2)}`,
          );
        }

        const supplierKey = p.supplier?._id?.toString();
        if (!supplierKey) return;

        if (!supplierData[supplierKey]) {
          supplierData[supplierKey] = {
            supplier_id: p.supplier._id,
            supplier_name: p.supplier?.name || "Unknown",
            current: 0,
            "1-30": 0,
            "31-60": 0,
            "61-90": 0,
            "90+": 0,
            total_outstanding: 0,
          };
        }

        supplierData[supplierKey][bucket] += effectiveBalance;
        supplierData[supplierKey].total_outstanding += effectiveBalance;
      });
    } catch (err) {
      console.error('[AP Aging] Failed to include direct purchases:', err.message);
    }

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

    // Also include direct purchases for supplier statements
    const purchaseQuery = { supplier: supplierId, company: companyId };
    if (startDate || endDate) {
      // include purchases by receivedDate or purchaseDate
      purchaseQuery.$or = [
        { receivedDate: dateFilter },
        { purchaseDate: dateFilter },
      ];
    }
    const purchases = await Purchase.find(purchaseQuery)
      .populate("supplier", "name code")
      .sort({ purchaseDate: 1 });

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
      grns: [
        ...grns.map((grn) => ({
        id: grn._id,
        reference: grn.referenceNo,
        date: grn.receivedDate,
        dueDate: grn.paymentDueDate,
        total: parseFloat(grn.totalAmount || 0).toFixed(2),
        paid: parseFloat(grn.amountPaid || 0).toFixed(2),
        balance: parseFloat(grn.balance || 0).toFixed(2),
        status: grn.paymentStatus,
        })),
        // Append direct purchases
        ...purchases.map((p) => ({
          id: p._id,
          reference: p.purchaseNumber || p.supplierInvoiceNumber,
          date: p.receivedDate || p.purchaseDate,
          dueDate: null,
          total: parseFloat(p.grandTotal || p.roundedAmount || 0).toFixed(2),
          paid: parseFloat(p.amountPaid || 0).toFixed(2),
          balance: parseFloat(p.balance || 0).toFixed(2),
          status: p.status,
        })),
      ],
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

    // Calculate totals including both GRNs and direct purchases
    const allEntries = [
      ...grns.map((g) => ({ total: parseFloat(g.totalAmount || 0), paid: parseFloat(g.amountPaid || 0), balance: parseFloat(g.balance || 0) })),
      ...purchases.map((p) => ({ total: parseFloat(p.grandTotal || p.roundedAmount || 0), paid: parseFloat(p.amountPaid || 0), balance: parseFloat(p.balance || 0) })),
    ];

    const totalGRNs = allEntries.reduce((sum, e) => sum + (e.total || 0), 0);
    const totalPaid = allEntries.reduce((sum, e) => sum + (e.paid || 0), 0);
    const totalOutstanding = allEntries.reduce((sum, e) => sum + (e.balance || 0), 0);

    statement.summary = {
      totalGRNs: totalGRNs.toFixed(2),
      totalPaid: totalPaid.toFixed(2),
      totalOutstanding: totalOutstanding.toFixed(2),
      grnCount: allEntries.length,
    };

    return {
      success: true,
      data: statement,
    };
  }

  /**
   * Get payments with filters
   */
  
}

module.exports = APService;
