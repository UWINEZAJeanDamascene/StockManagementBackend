const PLStatementService = require('../services/plStatementService');
const cacheService = require('../services/cacheService');

/**
 * P&L Statement Controller
 * 
 * Generates Profit & Loss Statement - shows revenue earned and expenses incurred
 * in a period, arriving at gross profit, operating profit, and net profit.
 */

/**
 * GET /api/reports/profit-and-loss
 * Query params: date_from (required), date_to (required), comparative_date_from (optional), comparative_date_to (optional)
 */
const getPLStatement = async (req, res) => {
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
      comparative_date_to: comparative_date_to || null,
    };
    const cfg = cacheService.getCacheConfig('report');
    const cached = await cacheService.fetchOrExecute(
      'report',
      async () =>
        PLStatementService.generate(req.companyId, {
          dateFrom: date_from,
          dateTo: date_to,
          comparativeDateFrom: comparative_date_from,
          comparativeDateTo: comparative_date_to,
        }),
      cacheKey,
      { ttl: cfg.ttl, useCompanyPrefix: true }
    );

    res.json({ ...cached.data, from_cache: cached.fromCache });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getPLStatement
};
