const cacheService = require('../services/cacheService');
const GeneralLedgerService = require('../services/generalLedgerService');

/**
 * General Ledger Controller
 * 
 * Handles API endpoints for General Ledger reports:
 * - GET /api/reports/general-ledger (requires: account_id, date_from, date_to)
 * - GET /api/reports/general-ledger/summary (requires: date_from, date_to)
 */

// @desc    Get General Ledger for a specific account
// @route   GET /api/reports/general-ledger
// @access  Private
exports.getGeneralLedger = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { account_id, date_from, date_to } = req.query;

    // Validate required parameters
    if (!account_id) {
      return res.status(400).json({ success: false, message: 'account_id is required' });
    }
    if (!date_from) {
      return res.status(400).json({ success: false, message: 'date_from is required' });
    }
    if (!date_to) {
      return res.status(400).json({ success: false, message: 'date_to is required' });
    }

    const cacheKey = { companyId, account_id, date_from, date_to };
    
    const cached = await cacheService.fetchOrExecute(
      'general_ledger',
      async () => {
        const ledger = await GeneralLedgerService.getAccountLedger(
          companyId,
          account_id,
          { dateFrom: date_from, dateTo: date_to }
        );
        return ledger;
      },
      cacheKey,
      { ttl: 60, useCompanyPrefix: true }
    );

    res.json({
      success: true,
      data: cached.data,
      fromCache: cached.fromCache
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get General Ledger summary for all accounts
// @route   GET /api/reports/general-ledger/summary
// @access  Private
exports.getGeneralLedgerSummary = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { date_from, date_to } = req.query;

    // Validate required parameters
    if (!date_from) {
      return res.status(400).json({ success: false, message: 'date_from is required' });
    }
    if (!date_to) {
      return res.status(400).json({ success: false, message: 'date_to is required' });
    }

    const cacheKey = { companyId, date_from, date_to };
    
    const cached = await cacheService.fetchOrExecute(
      'general_ledger_summary',
      async () => {
        const summary = await GeneralLedgerService.getAllAccountsSummary(
          companyId,
          { dateFrom: date_from, dateTo: date_to }
        );
        return summary;
      },
      cacheKey,
      { ttl: 60, useCompanyPrefix: true }
    );

    res.json({
      success: true,
      data: cached.data,
      fromCache: cached.fromCache
    });
  } catch (error) {
    next(error);
  }
};
