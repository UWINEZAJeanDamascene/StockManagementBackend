const FinancialRatiosService = require('../services/financialRatiosService');
const cacheService = require('../services/cacheService');

/**
 * Financial Ratios Controller
 *
 * Computes financial ratios from the current ledger state.
 */

/**
 * GET /api/reports/financial-ratios
 * Query params: as_of_date (required), date_from (required), date_to (required)
 */
const getFinancialRatios = async (req, res) => {
  try {
    const { companyId } = req;
    const { as_of_date, date_from, date_to } = req.query;

    if (!as_of_date) {
      return res.status(422).json({
        error: 'AS_OF_DATE_REQUIRED',
        message: 'as_of_date query parameter is required'
      });
    }

    if (!date_from || !date_to) {
      return res.status(422).json({
        error: 'DATE_RANGE_REQUIRED',
        message: 'date_from and date_to query parameters are required'
      });
    }

    const cacheKey = { companyId, as_of_date, date_from, date_to };
    const cfg = cacheService.getCacheConfig('financial_ratios');
    const cached = await cacheService.fetchOrExecute(
      'financial_ratios',
      async () =>
        FinancialRatiosService.compute(companyId, {
          asOfDate: as_of_date,
          dateFrom: date_from,
          dateTo: date_to,
        }),
      cacheKey,
      { ttl: cfg.ttl, useCompanyPrefix: true }
    );

    res.json({ ...cached.data, from_cache: cached.fromCache });
  } catch (error) {
    console.error('Error computing financial ratios:', error);
    res.status(500).json({
      error: error.message || 'INTERNAL_ERROR',
      message: 'Failed to compute financial ratios'
    });
  }
};

module.exports = {
  getFinancialRatios
};
