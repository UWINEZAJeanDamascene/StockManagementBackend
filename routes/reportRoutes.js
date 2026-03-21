const express = require('express');
const router = express.Router();
const {
  getStockValuationReport,
  getSalesSummaryReport,
  getProductMovementReport,
  getClientSalesReport,
  getSupplierPurchaseReport,
  getClientCreditLimitReport,
  getNewClientsReport,
  getInactiveClientsReport,
  getLowStockReport,
  getDeadStockReport,
  getStockAgingReport,
  getInventoryTurnoverReport,
  getBatchExpiryReport,
  getSerialNumberTrackingReport,
  getWarehouseStockReport,
  exportReportToExcel,
  exportReportToPDF,
  
  // new reports
  getProfitAndLossReport,
  getProfitAndLossDetailed,
  getProfitAndLossFull,
  getAgingReport,
  getVATSummaryReport,
  getProductPerformanceReport,
  getCLVReport,
  getBudgetVsActualReport,
  // Period-based report functions
  getPeriodReport,
  getAvailablePeriods,
  generateManualSnapshot
} = require('../controllers/reportController');

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

const { protect, authorize } = require('../middleware/auth');
const { cacheMiddleware, sessionMiddleware } = require('../middleware/cacheMiddleware');

router.use(protect);
router.use(sessionMiddleware);

// Basic report routes
router.get('/stock-valuation', cacheMiddleware({ type: 'report', ttl: 900 }), getStockValuationReport);
router.get('/sales-summary', cacheMiddleware({ type: 'report', ttl: 900 }), getSalesSummaryReport);
router.get('/product-movement', cacheMiddleware({ type: 'report', ttl: 900 }), getProductMovementReport);
router.get('/client-sales', cacheMiddleware({ type: 'report', ttl: 900 }), getClientSalesReport);
router.get('/supplier-purchase', cacheMiddleware({ type: 'report', ttl: 900 }), getSupplierPurchaseReport);
router.get('/client-credit-limit', cacheMiddleware({ type: 'report', ttl: 900 }), getClientCreditLimitReport);
router.get('/new-clients', cacheMiddleware({ type: 'report', ttl: 900 }), getNewClientsReport);
router.get('/inactive-clients', cacheMiddleware({ type: 'report', ttl: 900 }), getInactiveClientsReport);

// Stock & Inventory report routes
router.get('/low-stock', cacheMiddleware({ type: 'report', ttl: 900 }), getLowStockReport);
router.get('/dead-stock', cacheMiddleware({ type: 'report', ttl: 900 }), getDeadStockReport);
router.get('/stock-aging', cacheMiddleware({ type: 'report', ttl: 900 }), getStockAgingReport);
router.get('/inventory-turnover', cacheMiddleware({ type: 'report', ttl: 900 }), getInventoryTurnoverReport);
router.get('/batch-expiry', cacheMiddleware({ type: 'report', ttl: 900 }), getBatchExpiryReport);
router.get('/serial-number-tracking', cacheMiddleware({ type: 'report', ttl: 900 }), getSerialNumberTrackingReport);
router.get('/warehouse-stock', cacheMiddleware({ type: 'report', ttl: 900 }), getWarehouseStockReport);

// Financial report routes
router.get('/profit-and-loss', cacheMiddleware({ type: 'report', ttl: 900 }), getProfitAndLossReport);
router.get('/profit-and-loss-detailed', getProfitAndLossDetailed);
router.get('/profit-and-loss-full', getProfitAndLossFull);
router.get('/financial-ratios', cacheMiddleware({ type: 'report', ttl: 300 }), getFinancialRatios);
router.get('/aging', cacheMiddleware({ type: 'report', ttl: 900 }), getAgingReport);
router.get('/vat-summary', cacheMiddleware({ type: 'report', ttl: 900 }), getVATSummaryReport);
router.get('/product-performance', cacheMiddleware({ type: 'report', ttl: 900 }), getProductPerformanceReport);
router.get('/clv', cacheMiddleware({ type: 'report', ttl: 900 }), getCLVReport);
router.get('/cash-flow', cacheMiddleware({ type: 'report', ttl: 900 }), getCashFlow);
router.get('/budget-vs-actual', cacheMiddleware({ type: 'report', ttl: 900 }), getBudgetVsActualReport);
router.get('/balance-sheet', cacheMiddleware({ type: 'report', ttl: 300 }), getBalanceSheet);

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

// Period-based report routes - MORE SPECIFIC ROUTES MUST COME FIRST
// Get available periods for a period type (MUST be before /period/:periodType)
router.get('/periods/:periodType/available', getAvailablePeriods);

// Get report for specific period (daily, weekly, monthly, quarterly, semi-annual, annual)
router.get('/period/:periodType', getPeriodReport);

// Generate manual snapshot
router.post('/generate-snapshot', authorize('admin', 'manager'), generateManualSnapshot);

// Export routes with query parameter support for period-based exports
router.get('/export/excel/:reportType', exportReportToExcel);
router.get('/export/pdf/:reportType', exportReportToPDF);

module.exports = router;
