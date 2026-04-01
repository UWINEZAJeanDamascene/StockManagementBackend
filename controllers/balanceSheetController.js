const BalanceSheetService = require('../services/balanceSheetService');
const cacheService = require('../services/cacheService');

/**
 * Balance Sheet Controller
 *
 * Generates Balance Sheet — Statement of Financial Position (IAS 1).
 * Assets = Liabilities + Equity must hold.
 */

/**
 * GET /api/reports/balance-sheet
 * Query params: as_of_date (required), comparative_date (optional)
 */
const getBalanceSheet = async (req, res) => {
  try {
    const { as_of_date, comparative_date } = req.query;

    if (!as_of_date) {
      return res.status(422).json({
        error: 'AS_OF_DATE_REQUIRED',
        message: 'as_of_date is a required query parameter'
      });
    }

    const cacheKey = {
      companyId: req.companyId,
      as_of_date,
      comparative_date: comparative_date || null
    };
    const cfg = cacheService.getCacheConfig('report');
    const cached = await cacheService.fetchOrExecute(
      'report',
      async () => BalanceSheetService.generate(req.companyId, {
        asOfDate: as_of_date,
        comparativeDate: comparative_date
      }),
      cacheKey,
      { ttl: cfg.ttl, useCompanyPrefix: true }
    );
    const report = { ...cached.data, from_cache: cached.fromCache };

    if (!report.current?.is_balanced) {
      report.warning = `Balance sheet is out of balance by ${report.current.difference}. ` +
        `Assets must equal Liabilities + Equity.`;
    }

    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getBalanceSheet
};
