const express = require('express');
const router = express.Router();

// General Ledger controller (separate file for maintainability)
const { getGeneralLedger, getGeneralLedgerSummary } = require('../controllers/generalLedgerController');

// Trial Balance controller
const { getTrialBalance } = require('../controllers/trialBalanceController');

// P&L Statement controller
const { getPLStatement } = require('../controllers/plStatementController');

// Balance Sheet controller
const { getBalanceSheet } = require('../controllers/balanceSheetController');

// Cash Flow controller
const { getCashFlow } = require('../controllers/cashFlowController');

// Financial Ratios controller
const { getFinancialRatios } = require('../controllers/financialRatiosController');

// Budget vs Actual report
const BudgetService = require('../services/budgetService');

const { protect } = require('../middleware/auth');
const { attachCompanyId } = require('../middleware/companyContext');
const { cacheMiddleware, sessionMiddleware } = require('../middleware/cacheMiddleware');

router.use(protect);
router.use(attachCompanyId);
router.use(sessionMiddleware);

// General Ledger routes
// GET /api/reports/general-ledger (requires: account_id, date_from, date_to)
router.get('/general-ledger', getGeneralLedger);
// GET /api/reports/general-ledger/summary (requires: date_from, date_to)
router.get('/general-ledger/summary', getGeneralLedgerSummary);

// Trial Balance route
// GET /api/reports/trial-balance (requires: date_from, date_to)
router.get('/trial-balance', getTrialBalance);

// P&L Statement route (detailed)
// GET /api/reports/profit-and-loss (requires: date_from, date_to)
router.get('/profit-and-loss', getPLStatement);

// Balance Sheet route
router.get('/balance-sheet', cacheMiddleware({ type: 'report', ttl: 300 }), getBalanceSheet);

// Cash Flow route
router.get('/cash-flow', cacheMiddleware({ type: 'report', ttl: 900 }), getCashFlow);

// Financial Ratios route
router.get('/financial-ratios', cacheMiddleware({ type: 'report', ttl: 300 }), getFinancialRatios);

// Budget vs Actual route
router.get('/budget-vs-actual', async (req, res) => {
  try {
    const companyId = req.companyId;
    const { budgetId } = req.query;

    if (!budgetId) {
      return res.status(400).json({ success: false, error: 'budgetId is required' });
    }

    const comparison = await BudgetService.getComparison(companyId, budgetId);
    res.json({ success: true, data: comparison });
  } catch (error) {
    if (error.message === 'NOT_FOUND') {
      return res.status(404).json({ success: false, error: 'Budget not found' });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;
