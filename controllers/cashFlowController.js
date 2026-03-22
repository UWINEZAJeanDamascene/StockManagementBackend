const CashFlowService = require('../services/cashFlowService');
const cacheService = require('../services/cacheService');

/**
 * Cash Flow Controller
 * 
 * Generates Cash Flow Statement - shows how cash moved in and out of the business
 * across three sections: Operating, Investing, and Financing.
 */

/**
 * GET /api/reports/cash-flow
 * Query params: date_from (required), date_to (required)
 */
const getCashFlow = async (req, res) => {
  try {
    const { date_from, date_to } = req.query;

    if (!date_from || !date_to) {
      return res.status(422).json({
        error: 'DATE_RANGE_REQUIRED',
        message: 'date_from and date_to are required query parameters'
      });
    }

    const cacheKey = { companyId: req.companyId, date_from, date_to };
    const cfg = cacheService.getCacheConfig('report');
    const cached = await cacheService.fetchOrExecute(
      'report',
      async () =>
        CashFlowService.generate(req.companyId, { dateFrom: date_from, dateTo: date_to }),
      cacheKey,
      { ttl: cfg.ttl, useCompanyPrefix: true }
    );
    const report = { ...cached.data, from_cache: cached.fromCache };

    if (!report.is_reconciled) {
      report.warning = `Cash flow is not reconciled. Difference: ${report.reconciliation_diff}.`;
    }

    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getCashFlow
};
