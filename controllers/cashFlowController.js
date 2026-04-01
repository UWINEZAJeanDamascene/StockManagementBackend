const CashFlowService = require('../services/cashFlowService');
const cacheService = require('../services/cacheService');

/**
 * Cash Flow Controller
 *
 * Generates Cash Flow Statement — shows how cash moved in and out of the business
 * across three sections: Operating, Investing, and Financing (IAS 7).
 */

/**
 * GET /api/reports/cash-flow
 * Query params: date_from (required), date_to (required), comparative_date_from (optional), comparative_date_to (optional)
 */
const getCashFlow = async (req, res) => {
  try {
    const { date_from, date_to, comparative_date_from, comparative_date_to } = req.query;

    if (!date_from || !date_to) {
      return res.status(422).json({
        error: 'DATE_RANGE_REQUIRED',
        message: 'date_from and date_to are required query parameters'
      });
    }

    const cacheKey = {
      companyId: req.companyId,
      date_from,
      date_to,
      comparative_date_from: comparative_date_from || null,
      comparative_date_to: comparative_date_to || null
    };
    const cfg = cacheService.getCacheConfig('report');
    const cached = await cacheService.fetchOrExecute(
      'report',
      async () =>
        CashFlowService.generate(req.companyId, {
          dateFrom: date_from,
          dateTo: date_to,
          comparativeDateFrom: comparative_date_from,
          comparativeDateTo: comparative_date_to
        }),
      cacheKey,
      { ttl: cfg.ttl, useCompanyPrefix: true }
    );
    const report = { ...cached.data, from_cache: cached.fromCache };

    if (!report.current?.is_reconciled) {
      report.warning = `Cash flow is not reconciled. Difference: ${report.current?.reconciliation_diff}.`;
    }

    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getCashFlow
};
