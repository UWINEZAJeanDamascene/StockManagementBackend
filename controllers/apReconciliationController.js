const APTrackingService = require('../services/apTrackingService');
const APTransactionLedger = require('../models/APTransactionLedger');
const GoodsReceivedNote = require('../models/GoodsReceivedNote');
const Supplier = require('../models/Supplier');
const mongoose = require('mongoose');

/**
 * AP Reconciliation Controller
 * Mirrors ARReconciliationController for Accounts Payable
 */
const apReconciliationController = {
  /**
   * GET /api/ap-reconciliation/dashboard - Get dashboard data
   */
  async getDashboard(req, res, next) {
    try {
      const companyId = req.user.company._id;
      const dashboard = await APTrackingService.getDashboardStats(companyId);
      
      // Convert Decimal128 fields in recentActivity to plain numbers
      if (dashboard.recentActivity) {
        dashboard.recentActivity = dashboard.recentActivity.map(tx => ({
          ...tx.toObject ? tx.toObject() : tx,
          amount: parseFloat(tx.amount || 0),
          supplierBalanceAfter: parseFloat(tx.supplierBalanceAfter || 0),
          grnBalanceAfter: tx.grnBalanceAfter ? parseFloat(tx.grnBalanceAfter) : null
        }));
      }
      
      res.json(dashboard);
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/ap-reconciliation/transactions - List transactions
   */
  async getTransactions(req, res, next) {
    try {
      const companyId = req.user.company._id;
      const {
        supplierId,
        transactionType,
        reconciliationStatus,
        startDate,
        endDate,
        page = 1,
        limit = 50
      } = req.query;

      const query = { company: companyId };

      if (supplierId) query.supplier = supplierId;
      if (transactionType) query.transactionType = transactionType;
      if (reconciliationStatus) query.reconciliationStatus = reconciliationStatus;
      if (startDate || endDate) {
        query.transactionDate = {};
        if (startDate) query.transactionDate.$gte = new Date(startDate);
        if (endDate) query.transactionDate.$lte = new Date(endDate);
      }

      const total = await APTransactionLedger.countDocuments(query);
      const transactions = await APTransactionLedger.find(query)
        .populate('supplier', 'name code')
        .populate('grn', 'referenceNo grnNumber')
        .populate('payment', 'referenceNo')
        .sort({ transactionDate: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      res.json({
        success: true,
        data: transactions.map(tx => ({
          ...tx.toObject(),
          amount: parseFloat(tx.amount || 0),
          supplierBalanceAfter: parseFloat(tx.supplierBalanceAfter || 0),
          grnBalanceAfter: tx.grnBalanceAfter ? parseFloat(tx.grnBalanceAfter) : null
        })),
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/ap-reconciliation/transactions/:id - Get single transaction
   */
  async getTransactionById(req, res, next) {
    try {
      const companyId = req.user.company._id;
      const { id } = req.params;

      const transaction = await APTransactionLedger.findOne({
        _id: id,
        company: companyId
      })
        .populate('supplier', 'name code')
        .populate('grn', 'referenceNo grnNumber')
        .populate('payment', 'referenceNo amountPaid')
        .populate('createdBy', 'name');

      if (!transaction) {
        return res.status(404).json({ success: false, message: 'Transaction not found' });
      }

      res.json({ success: true, data: transaction });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/ap-reconciliation/verify - Verify data integrity
   */
  async verifyIntegrity(req, res, next) {
    try {
      const companyId = req.user.company._id;
      const { supplierId, startDate, endDate } = req.body;

      const result = await APTrackingService.verifyIntegrity(companyId, {
        supplierId,
        startDate,
        endDate
      });

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/ap-reconciliation/reconcile - Reconcile and correct
   */
  async reconcileAndCorrect(req, res, next) {
    try {
      const companyId = req.user.company._id;
      const userId = req.user._id;
      const { supplierId, startDate, endDate } = req.body;

      const result = await APTrackingService.reconcileAndCorrect(companyId, userId, {
        supplierId,
        startDate,
        endDate
      });

      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/ap-reconciliation/current-payables - Current outstanding payables
   */
  async getCurrentPayables(req, res, next) {
    try {
      const companyId = req.user.company._id;
      const { supplierId, page = 1, limit = 50 } = req.query;

      const query = {
        company: companyId,
        balance: { $gt: 0 }
      };

      if (supplierId) query.supplier = supplierId;

      const total = await GoodsReceivedNote.countDocuments(query);
      const grns = await GoodsReceivedNote.find(query)
        .populate('supplier', 'name code')
        .sort({ receivedDate: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      // Calculate summary
      const summary = await GoodsReceivedNote.aggregate([
        { $match: { company: new mongoose.Types.ObjectId(companyId), balance: { $gt: 0 } } },
        {
          $group: {
            _id: null,
            totalOutstanding: { $sum: { $toDouble: '$balance' } },
            totalGRNs: { $sum: 1 }
          }
        }
      ]);

      res.json({
        success: true,
        data: {
          grns: grns.map(g => ({
            ...g.toObject(),
            totalAmount: parseFloat(g.totalAmount || 0),
            amountPaid: parseFloat(g.amountPaid || 0),
            balance: parseFloat(g.balance || 0)
          })),
          summary: summary[0] || { totalOutstanding: 0, totalGRNs: 0 },
          pagination: {
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/ap-reconciliation/aging - Get aging report with verification
   */
  async getAgingWithVerification(req, res, next) {
    try {
      const companyId = req.user.company._id;
      const { supplierId, asOfDate } = req.query;

      const result = await APTrackingService.getAgingWithVerification(companyId, {
        supplierId,
        asOfDate
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/ap-reconciliation/suppliers/:supplierId/summary - Get supplier summary
   */
  async getSupplierSummary(req, res, next) {
    try {
      const companyId = req.user.company._id;
      const { supplierId } = req.params;

      // Verify supplier
      const supplier = await Supplier.findOne({ _id: supplierId, company: companyId });
      if (!supplier) {
        return res.status(404).json({ success: false, message: 'Supplier not found' });
      }

      // Get current balance
      const currentBalance = await APTrackingService.getSupplierBalance(companyId, supplierId);

      // Get transaction summary
      const transactions = await APTransactionLedger.find({
        company: companyId,
        supplier: supplierId
      });

      const summary = {
        totalTransactions: transactions.length,
        totalIncreases: transactions
          .filter(t => t.direction === 'increase')
          .reduce((sum, t) => sum + parseFloat(t.amount), 0),
        totalDecreases: transactions
          .filter(t => t.direction === 'decrease')
          .reduce((sum, t) => sum + parseFloat(t.amount), 0),
        currentBalance
      };

      res.json({
        success: true,
        data: {
          supplier: {
            _id: supplier._id,
            name: supplier.name,
            code: supplier.code
          },
          summary
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/ap-reconciliation/suppliers/:supplierId/statement - Get supplier statement
   */
  async getSupplierStatementWithHistory(req, res, next) {
    try {
      const companyId = req.user.company._id;
      const { supplierId } = req.params;
      const { startDate, endDate, page = 1, limit = 50 } = req.query;

      // Verify supplier
      const supplier = await Supplier.findOne({ _id: supplierId, company: companyId });
      if (!supplier) {
        return res.status(404).json({ success: false, message: 'Supplier not found' });
      }

      // Get GRNs
      const grnQuery = { supplier: supplierId, company: companyId };
      if (startDate || endDate) {
        grnQuery.receivedDate = {};
        if (startDate) grnQuery.receivedDate.$gte = new Date(startDate);
        if (endDate) grnQuery.receivedDate.$lte = new Date(endDate);
      }
      const grns = await GoodsReceivedNote.find(grnQuery)
        .populate('createdBy', 'name')
        .sort({ receivedDate: 1 });

      // Get transaction history
      const transactions = await APTrackingService.getSupplierHistory(companyId, supplierId, {
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        limit: parseInt(limit),
        skip: (page - 1) * limit
      });

      const totalTransactions = await APTransactionLedger.countDocuments({
        company: companyId,
        supplier: supplierId,
        ...(startDate && { transactionDate: { $gte: new Date(startDate) } }),
        ...(endDate && { transactionDate: { $lte: new Date(endDate) } })
      });

      // Calculate totals
      const totalGRNs = grns.reduce((sum, g) => sum + (parseFloat(g.totalAmount) || 0), 0);
      const totalPaid = grns.reduce((sum, g) => sum + (parseFloat(g.amountPaid) || 0), 0);
      const totalOutstanding = grns.reduce((sum, g) => sum + (parseFloat(g.balance) || 0), 0);

      res.json({
        success: true,
        data: {
          supplier: {
            _id: supplier._id,
            name: supplier.name,
            code: supplier.code
          },
          statement: {
            grns: grns.map(g => ({
              id: g._id,
              reference: g.referenceNo || g.grnNumber,
              date: g.receivedDate,
              total: parseFloat(g.totalAmount || 0).toFixed(2),
              paid: parseFloat(g.amountPaid || 0).toFixed(2),
              balance: parseFloat(g.balance || 0).toFixed(2),
              status: g.paymentStatus
            })),
            summary: {
              totalGRNs: totalGRNs.toFixed(2),
              totalPaid: totalPaid.toFixed(2),
              totalOutstanding: totalOutstanding.toFixed(2),
              grnCount: grns.length
            }
          },
          transactions: {
            data: transactions,
            total: totalTransactions,
            pages: Math.ceil(totalTransactions / limit),
            currentPage: parseInt(page)
          }
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/ap-reconciliation/discrepancies - Find discrepancies
   */
  async findDiscrepancies(req, res, next) {
    try {
      const companyId = req.user.company._id;
      const { supplierId, startDate, endDate } = req.query;

      const verification = await APTrackingService.verifyIntegrity(companyId, {
        supplierId,
        startDate,
        endDate
      });

      res.json({
        success: true,
        count: verification.discrepancyCount,
        data: verification.discrepancies
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/ap-reconciliation/verify-all - Verify all pending transactions
   */
  async verifyAllPending(req, res, next) {
    try {
      const companyId = req.user.company._id;
      const userId = req.user._id;

      // Update all pending transactions to verified
      const result = await APTransactionLedger.updateMany(
        {
          company: new mongoose.Types.ObjectId(companyId),
          reconciliationStatus: 'pending'
        },
        {
          $set: {
            reconciliationStatus: 'verified',
            verifiedAt: new Date()
          }
        }
      );

      // Log the action
      const ActionLog = require('../models/ActionLog');
      await ActionLog.create({
        company: companyId,
        user: userId,
        action: 'verify_all_pending_ap_transactions',
        module: 'ap_reconciliation',
        details: { count: result.modifiedCount },
        status: 'success'
      });

      res.json({
        success: true,
        message: `${result.modifiedCount} AP transactions marked as verified`,
        count: result.modifiedCount
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = apReconciliationController;
