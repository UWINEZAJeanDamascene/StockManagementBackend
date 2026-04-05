const mongoose = require('mongoose');
const APTransactionLedger = require('../models/APTransactionLedger');
const APPayment = require('../models/APPayment');
const APPaymentAllocation = require('../models/APPaymentAllocation');
const GoodsReceivedNote = require('../models/GoodsReceivedNote');
const Supplier = require('../models/Supplier');
const cacheService = require('./cacheService');

/**
 * AP Tracking Service
 * Mirrors ARTrackingService for Accounts Payable
 * Handles AP transaction recording, integrity verification, and reconciliation
 */
class APTrackingService {
  /**
   * Record a new GRN received (increases AP)
   */
  static async recordGRNReceived(grn, userId) {
    const companyId = grn.company;
    const supplierId = grn.supplier;
    const amount = parseFloat(grn.totalAmount) || 0;

    // Get current supplier balance
    const currentBalance = await this.getSupplierBalance(companyId, supplierId);
    const newBalance = currentBalance + amount;

    // Create ledger entry
    const transaction = new APTransactionLedger({
      company: companyId,
      supplier: supplierId,
      transactionType: 'grn_received',
      transactionDate: grn.receivedDate || new Date(),
      referenceNo: grn.referenceNo || grn.grnNumber,
      description: `GRN ${grn.referenceNo || grn.grnNumber} received - Amount: ${amount.toFixed(2)}`,
      amount: amount,
      direction: 'increase',
      supplierBalanceAfter: newBalance,
      grnBalanceAfter: amount,
      grn: grn._id,
      sourceType: 'grn',
      sourceId: grn._id,
      sourceReference: grn.referenceNo || grn.grnNumber,
      createdBy: userId,
      reconciliationStatus: 'verified',
      metadata: {
        grnDate: grn.grnDate,
        supplierRef: grn.supplierRef
      }
    });

    await transaction.save();

    // Invalidate cache
    await this.invalidateSupplierBalanceCache(companyId, supplierId);

    return transaction;
  }

  /**
   * Record a payment posted (decreases AP)
   */
  static async recordPaymentPosted(payment, userId) {
    const companyId = payment.company;
    const supplierId = payment.supplier;
    const amount = parseFloat(payment.amountPaid) || 0;

    // Get current supplier balance
    const currentBalance = await this.getSupplierBalance(companyId, supplierId);
    const newBalance = Math.max(0, currentBalance - amount);

    // Create ledger entry for payment
    const transaction = new APTransactionLedger({
      company: companyId,
      supplier: supplierId,
      transactionType: 'payment_posted',
      transactionDate: payment.paymentDate || new Date(),
      referenceNo: payment.referenceNo || payment.reference,
      description: `Payment ${payment.referenceNo || payment.reference} posted - Payment: ${amount.toFixed(2)}`,
      amount: amount,
      direction: 'decrease',
      supplierBalanceAfter: newBalance,
      sourceType: 'ap_payment',
      sourceId: payment._id,
      sourceReference: payment.referenceNo || payment.reference,
      createdBy: userId,
      reconciliationStatus: 'verified',
      metadata: {
        paymentMethod: payment.paymentMethod,
        unallocatedAmount: payment.unallocatedAmount || 0
      }
    });

    await transaction.save();

    // Create ledger entries for each allocation
    const allocations = await APPaymentAllocation.find({ payment: payment._id })
      .populate('grn', 'referenceNo grnNumber balance');

    for (const alloc of allocations) {
      const allocAmount = parseFloat(alloc.amountAllocated) || 0;
      const grn = alloc.grn;

      if (grn) {
        const grnBalance = parseFloat(grn.balance) || 0;
        const newGRNBalance = Math.max(0, grnBalance - allocAmount);

        await APTransactionLedger.create({
          company: companyId,
          supplier: supplierId,
          transactionType: 'payment_allocation',
          transactionDate: payment.paymentDate || new Date(),
          referenceNo: payment.referenceNo || payment.reference,
          description: `Allocation to GRN ${grn.referenceNo || grn.grnNumber}: ${allocAmount.toFixed(2)}`,
          amount: allocAmount,
          direction: 'decrease',
          grnBalanceAfter: newGRNBalance,
          supplierBalanceAfter: newBalance,
          grn: grn._id,
          payment: payment._id,
          sourceType: 'ap_allocation',
          sourceId: alloc._id,
          sourceReference: payment.referenceNo || payment.reference,
          createdBy: userId,
          reconciliationStatus: 'verified'
        });
      }
    }

    // Invalidate cache
    await this.invalidateSupplierBalanceCache(companyId, supplierId);

    return transaction;
  }

  /**
   * Record a payment reversal (increases AP back)
   */
  static async recordPaymentReversed(payment, userId, reason) {
    const companyId = payment.company;
    const supplierId = payment.supplier;
    const amount = parseFloat(payment.amountPaid) || 0;

    // Get current supplier balance
    const currentBalance = await this.getSupplierBalance(companyId, supplierId);
    const newBalance = currentBalance + amount;

    // Create reversal entry
    const transaction = new APTransactionLedger({
      company: companyId,
      supplier: supplierId,
      transactionType: 'payment_reversed',
      transactionDate: new Date(),
      referenceNo: payment.referenceNo || payment.reference,
      description: `Payment ${payment.referenceNo || payment.reference} reversed: ${reason || 'Reversed'}`,
      amount: amount,
      direction: 'increase',
      supplierBalanceAfter: newBalance,
      sourceType: 'ap_payment',
      sourceId: payment._id,
      sourceReference: payment.referenceNo || payment.reference,
      createdBy: userId,
      reconciliationStatus: 'verified',
      metadata: {
        reversalReason: reason,
        originalPaymentDate: payment.paymentDate
      }
    });

    await transaction.save();

    // Invalidate cache
    await this.invalidateSupplierBalanceCache(companyId, supplierId);

    return transaction;
  }

  /**
   * Get current supplier balance
   */
  static async getSupplierBalance(companyId, supplierId) {
    const cacheKey = `ap_supplier_balance_${companyId}_${supplierId}`;
    const cached = await cacheService.get(cacheKey);
    if (cached !== null) {
      return parseFloat(cached);
    }

    const latestEntry = await APTransactionLedger.findOne({
      company: companyId,
      supplier: supplierId
    }).sort({ transactionDate: -1, createdAt: -1 });

    const balance = latestEntry ? parseFloat(latestEntry.supplierBalanceAfter) : 0;

    // Cache for 5 minutes
    await cacheService.set(cacheKey, balance.toString(), 300);

    return balance;
  }

  /**
   * Invalidate supplier balance cache
   */
  static async invalidateSupplierBalanceCache(companyId, supplierId) {
    const cacheKey = `ap_supplier_balance_${companyId}_${supplierId}`;
    await cacheService.del(cacheKey);
  }

  /**
   * Get transaction history for a supplier
   */
  static async getSupplierHistory(companyId, supplierId, options = {}) {
    return APTransactionLedger.getSupplierHistory(companyId, supplierId, options);
  }

  /**
   * Verify data integrity for AP
   */
  static async verifyIntegrity(companyId, options = {}) {
    const { supplierId, startDate, endDate } = options;

    // Use the model's static method
    const ledgerVerification = await APTransactionLedger.verifyIntegrity(companyId, {
      supplierId,
      startDate,
      endDate
    });

    // Additional verification: Compare ledger totals with actual supplier balances
    const discrepancies = [...(ledgerVerification.discrepancies || [])];

    // Check supplier balances
    const suppliers = supplierId
      ? await Supplier.find({ _id: supplierId, company: companyId })
      : await Supplier.find({ company: companyId });

    for (const supplier of suppliers) {
      const ledgerBalance = await this.getSupplierBalance(companyId, supplier._id);

      // Calculate actual balance from GRNs
      const grns = await GoodsReceivedNote.find({
        supplier: supplier._id,
        company: companyId,
        balance: { $gt: 0 }
      });

      const actualBalance = grns.reduce((sum, grn) => sum + (parseFloat(grn.balance) || 0), 0);

      if (Math.abs(ledgerBalance - actualBalance) > 0.01) {
        discrepancies.push({
          type: 'supplier_balance_mismatch',
          supplierId: supplier._id,
          supplierName: supplier.name,
          ledgerBalance: ledgerBalance.toFixed(2),
          actualBalance: actualBalance.toFixed(2),
          difference: (ledgerBalance - actualBalance).toFixed(2)
        });
      }
    }

    return {
      verified: discrepancies.length === 0,
      discrepancyCount: discrepancies.length,
      discrepancies
    };
  }

  /**
   * Reconcile and correct discrepancies
   */
  static async reconcileAndCorrect(companyId, userId, options = {}) {
    const verification = await this.verifyIntegrity(companyId, options);

    if (verification.verified) {
      // No discrepancies found - mark all pending transactions as verified
      const updateResult = await APTransactionLedger.updateMany(
        {
          company: new mongoose.Types.ObjectId(companyId),
          reconciliationStatus: 'pending'
        },
        {
          reconciliationStatus: 'verified',
          verifiedAt: new Date()
        }
      );
      return {
        corrected: 0,
        verified: updateResult.modifiedCount || 0,
        message: `No discrepancies found. ${updateResult.modifiedCount || 0} transactions marked as verified.`
      };
    }

    let corrected = 0;
    const corrections = [];

    // Process each discrepancy
    for (const disc of verification.discrepancies) {
      if (disc.type === 'supplier_balance_mismatch') {
        // Create adjustment transaction to reconcile
        const adjustmentAmount = parseFloat(disc.difference);
        const currentBalance = await this.getSupplierBalance(companyId, disc.supplierId);
        const newBalance = currentBalance - adjustmentAmount;

        await APTransactionLedger.create({
          company: companyId,
          supplier: disc.supplierId,
          transactionType: 'adjustment',
          transactionDate: new Date(),
          referenceNo: 'ADJ-' + Date.now(),
          description: `Reconciliation adjustment for supplier ${disc.supplierName}`,
          amount: Math.abs(adjustmentAmount),
          direction: adjustmentAmount > 0 ? 'decrease' : 'increase',
          supplierBalanceAfter: newBalance,
          sourceType: 'manual',
          sourceId: new mongoose.Types.ObjectId(),
          sourceReference: 'ADJ-' + Date.now(),
          createdBy: userId,
          reconciliationStatus: 'corrected',
          discrepancyDetails: disc
        });

        corrected++;
        corrections.push({
          supplierId: disc.supplierId,
          type: 'balance_adjustment',
          amount: adjustmentAmount
        });

        // Invalidate cache
        await this.invalidateSupplierBalanceCache(companyId, disc.supplierId);
      }
    }

    return {
      corrected,
      corrections,
      message: `${corrected} discrepancies corrected.`
    };
  }

  /**
   * Get dashboard stats
   */
  static async getDashboardStats(companyId) {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalTransactions,
      recentTransactions,
      pendingReconciliation,
      discrepancyCheck
    ] = await Promise.all([
      APTransactionLedger.countDocuments({ company: companyId }),
      APTransactionLedger.countDocuments({
        company: companyId,
        transactionDate: { $gte: thirtyDaysAgo }
      }),
      APTransactionLedger.countDocuments({
        company: companyId,
        reconciliationStatus: 'pending'
      }),
      this.verifyIntegrity(companyId)
    ]);

    // Get transaction type breakdown
    const typeBreakdown = await APTransactionLedger.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(companyId) } },
      {
        $group: {
          _id: '$transactionType',
          count: { $sum: 1 },
          totalAmount: { $sum: { $toDouble: '$amount' } }
        }
      }
    ]);

    // Get recent activity
    const recentActivity = await APTransactionLedger.find({ company: companyId })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('supplier', 'name code')
      .populate('grn', 'referenceNo')
      .populate('payment', 'referenceNo');

    return {
      stats: {
        totalTransactions,
        recentTransactions,
        pendingReconciliation,
        discrepancyCount: discrepancyCheck.discrepancyCount
      },
      typeBreakdown,
      recentActivity,
      integrity: discrepancyCheck
    };
  }

  /**
   * Get AP aging report with verification
   */
  static async getAgingWithVerification(companyId, options = {}) {
    const { supplierId, asOfDate } = options;
    const APService = require('./apService');

    const [agingReport, verification] = await Promise.all([
      APService.getAgingReport(companyId, { supplierId, asOfDate }),
      this.verifyIntegrity(companyId, { supplierId })
    ]);

    return {
      ...agingReport,
      verification: {
        verified: verification.verified,
        discrepancyCount: verification.discrepancyCount
      }
    };
  }
}

module.exports = APTrackingService;
