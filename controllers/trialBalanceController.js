const TrialBalanceService = require('../services/trialBalanceService');

/**
 * Trial Balance Controller
 * 
 * Generates Trial Balance report - lists every account with activity in a period
 * alongside its total DR movements, total CR movements, and closing balance.
 * 
 * Fundamental invariant: SUM(all DR) = SUM(all CR)
 */

/**
 * GET /api/reports/trial-balance
 * Query params: date_from (required), date_to (required)
 */
const getTrialBalance = async (req, res) => {
  try {
    const { date_from, date_to } = req.query;

    if (!date_from || !date_to) {
      return res.status(422).json({
        error: 'DATE_RANGE_REQUIRED',
        message: 'date_from and date_to are required query parameters'
      });
    }

    const report = await TrialBalanceService.generate(
      req.companyId,
      { dateFrom: date_from, dateTo: date_to }
    );

    // If not balanced — surface as warning not error
    // The report still returns but flags the problem
    if (!report.is_balanced) {
      report.warning = `Trial balance is out of balance by ${report.difference}. ` +
        `Run GET /api/health/accounting to diagnose.`;
    }

    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getTrialBalance
};
