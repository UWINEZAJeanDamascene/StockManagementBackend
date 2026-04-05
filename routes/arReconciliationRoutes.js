const express = require('express');
const router = express.Router();
const {
  getTransactions,
  getTransactionById,
  verifyIntegrity,
  reconcileAndCorrect,
  getClientARSummary,
  getAgingWithVerification,
  getClientStatementWithHistory,
  findDiscrepancies,
  getDashboard,
  getCurrentReceivables,
  verifyAllPending
} = require('../controllers/arReconciliationController');
const { protect } = require('../middleware/auth');
const logAction = require('../middleware/logAction');

router.use(protect);

// Dashboard and overview
router.get('/dashboard', getDashboard);

// Current receivables (outstanding invoices)
router.get('/current-receivables', getCurrentReceivables);

// Transaction history
router.get('/transactions', getTransactions);
router.get('/transactions/:id', getTransactionById);

// Integrity and reconciliation
router.post('/verify', logAction('ar_reconciliation'), verifyIntegrity);
router.post('/reconcile', logAction('ar_reconciliation'), reconcileAndCorrect);
router.post('/verify-all', logAction('ar_reconciliation'), verifyAllPending);
router.get('/discrepancies', findDiscrepancies);

// Client-specific endpoints
router.get('/clients/:clientId/summary', getClientARSummary);
router.get('/clients/:clientId/statement', getClientStatementWithHistory);

// Reports
router.get('/aging', getAgingWithVerification);

module.exports = router;
