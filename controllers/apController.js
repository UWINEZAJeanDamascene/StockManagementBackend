const APService = require('../services/apService');

/**
 * AP Controller - Handles Accounts Payable API endpoints
 */
const apController = {
  /**
   * GET /api/ap/payments - List payments
   */
  async getPayments(req, res, next) {
    try {
      const companyId = req.user.company._id;
      const userId = req.user._id;

      const options = {
        supplierId: req.query.supplier_id,
        status: req.query.status,
        dateFrom: req.query.date_from,
        dateTo: req.query.date_to,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 50
      };

      const result = await APService.getPayments(companyId, options);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/ap/payments/:id - Get single payment
   */
  async getPayment(req, res, next) {
    try {
      const companyId = req.user.company._id;
      const { id } = req.params;

      const result = await APService.getPayment(companyId, id);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/ap/payments - Create payment draft
   */
  async createPayment(req, res, next) {
    try {
      const companyId = req.user.company._id;
      const userId = req.user._id;

      const {
        supplierId,
        paymentDate,
        paymentMethod,
        bankAccountId,
        amountPaid,
        currencyCode,
        exchangeRate,
        reference,
        notes,
        allocations
      } = req.body;

      // Validate required fields
      if (!supplierId) {
        return res.status(400).json({ success: false, error: 'SUPPLIER_REQUIRED' });
      }
      if (!paymentMethod) {
        return res.status(400).json({ success: false, error: 'PAYMENT_METHOD_REQUIRED' });
      }
      if (!bankAccountId) {
        return res.status(400).json({ success: false, error: 'BANK_ACCOUNT_REQUIRED' });
      }
      if (!amountPaid) {
        return res.status(400).json({ success: false, error: 'AMOUNT_REQUIRED' });
      }

      const payment = await APService.createPayment(companyId, userId, {
        supplierId,
        paymentDate,
        paymentMethod,
        bankAccountId,
        amountPaid,
        currencyCode,
        exchangeRate,
        reference,
        notes,
        allocations
      });

      res.status(201).json({ success: true, data: payment });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PUT /api/ap/payments/:id - Edit payment (draft only)
   */
  async updatePayment(req, res, next) {
    try {
      const companyId = req.user.company._id;
      const userId = req.user._id;
      const { id } = req.params;

      const {
        paymentDate,
        paymentMethod,
        bankAccountId,
        amountPaid,
        currencyCode,
        exchangeRate,
        reference,
        notes
      } = req.body;

      const payment = await APService.updatePayment(companyId, userId, id, {
        paymentDate,
        paymentMethod,
        bankAccountId,
        amountPaid,
        currencyCode,
        exchangeRate,
        reference,
        notes
      });

      res.status(200).json({ success: true, data: payment });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/ap/payments/:id/post - Post payment
   */
  async postPayment(req, res, next) {
    try {
      const companyId = req.user.company._id;
      const userId = req.user._id;
      const { id } = req.params;

      const payment = await APService.postPayment(companyId, userId, id);

      res.status(200).json({ success: true, data: payment });
    } catch (error) {
      // Return 400 for known validation (e.g., trying to post a non-draft payment)
      if (error && error.message && error.message.indexOf('Only draft payments can be posted') !== -1) {
        return res.status(400).json({ success: false, error: 'ONLY_DRAFT_CAN_BE_POSTED' });
      }
      next(error);
    }
  },

  /**
   * POST /api/ap/payments/:id/save-and-post - Save and post without journal entry
   */
  async saveAndPostPayment(req, res, next) {
    try {
      const companyId = req.user.company._id;
      const userId = req.user._id;
      const { id } = req.params;

      const payment = await APService.saveAndPostPayment(companyId, userId, id);

      res.status(200).json({ success: true, data: payment });
    } catch (error) {
      if (error && error.message && error.message.indexOf('Only draft payments can be posted') !== -1) {
        return res.status(400).json({ success: false, error: 'ONLY_DRAFT_CAN_BE_POSTED' });
      }
      next(error);
    }
  },

  /**
   * POST /api/ap/payments/:id/reverse - Reverse payment
   */
  async reversePayment(req, res, next) {
    try {
      const companyId = req.user.company._id;
      const userId = req.user._id;
      const { id } = req.params;
      const { reason } = req.body;

      const payment = await APService.reversePayment(companyId, userId, id, reason);

      res.status(200).json({ success: true, data: payment });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/ap/allocations - Create allocation
   */
  async createAllocation(req, res, next) {
    try {
      const companyId = req.user.company._id;
      const userId = req.user._id;

      const { paymentId, grnId, amount } = req.body;

      if (!paymentId) {
        return res.status(400).json({ success: false, error: 'PAYMENT_REQUIRED' });
      }
      if (!grnId) {
        return res.status(400).json({ success: false, error: 'GRN_REQUIRED' });
      }
      if (!amount) {
        return res.status(400).json({ success: false, error: 'AMOUNT_REQUIRED' });
      }

      const allocation = await APService.allocateToGRN(companyId, userId, paymentId, grnId, amount);

      res.status(201).json({ success: true, data: allocation });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/ap/allocations - List allocations
   */
  async getAllocations(req, res, next) {
    try {
      const companyId = req.user.company._id;

      const { paymentId, grnId } = req.query;

      const APPaymentAllocation = require('../models/APPaymentAllocation');
      
      const query = { company: companyId };
      if (paymentId) query.payment = paymentId;
      if (grnId) query.grn = grnId;

      const allocations = await APPaymentAllocation.find(query)
        .populate('payment', 'referenceNo amountPaid status')
        .populate('grn', 'referenceNo totalAmount balance');

      res.status(200).json({ success: true, data: allocations });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/ap/aging - AP aging report
   */
  async getAgingReport(req, res, next) {
    try {
      const companyId = req.user.company._id;

      const options = {
        supplierId: req.query.supplier_id,
        asOfDate: req.query.as_of_date
      };

      const result = await APService.getAgingReport(companyId, options);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/ap/statement/:supplier_id - Supplier statement
   */
  async getSupplierStatement(req, res, next) {
    try {
      const companyId = req.user.company._id;
      const { supplier_id } = req.params;

      const options = {
        startDate: req.query.start_date,
        endDate: req.query.end_date
      };

      const result = await APService.getSupplierStatement(companyId, supplier_id, options);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
};

module.exports = apController;
