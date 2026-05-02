const APService = require('../services/apService');

/**
 * AP Controller - Read-Only Reporting Module
 *
 * Core Principle: AP is an auto-generated ledger, NOT a transaction entry module.
 * All AP movements originate from source documents:
 *   - Purchase/GRN received          -> AP increases
 *   - Payment recorded on GRN/Purchase -> AP decreases
 *   - Debit note issued             -> AP decreases
 *   - Bad debt/write-off            -> AP decreases
 *
 * These endpoints return reports only. No manual transaction entry here.
 */

const apController = {
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
