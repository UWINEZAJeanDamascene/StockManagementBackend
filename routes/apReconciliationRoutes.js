const express = require('express');
const router = express.Router();
const {
  getDashboard,
  getTransactions,
  getTransactionById,
  verifyIntegrity,
  reconcileAndCorrect,
  getCurrentPayables,
  getAgingWithVerification,
  getSupplierSummary,
  getSupplierStatementWithHistory,
  findDiscrepancies,
  verifyAllPending
} = require('../controllers/apReconciliationController');
const { protect } = require('../middleware/auth');
const logAction = require('../middleware/logAction');

router.use(protect);

// Dashboard and overview
router.get('/dashboard', getDashboard);

// Current payables (outstanding GRNs)
router.get('/current-payables', getCurrentPayables);

// Transaction history
router.get('/transactions', getTransactions);
router.get('/transactions/:id', getTransactionById);

// Integrity and reconciliation
router.post('/verify', logAction('ap_reconciliation'), verifyIntegrity);
router.post('/reconcile', logAction('ap_reconciliation'), reconcileAndCorrect);
router.post('/verify-all', logAction('ap_reconciliation'), verifyAllPending);
router.get('/discrepancies', findDiscrepancies);

// Supplier-specific endpoints
router.get('/suppliers/:supplierId/summary', getSupplierSummary);
router.get('/suppliers/:supplierId/statement', getSupplierStatementWithHistory);

// Reports
router.get('/aging', getAgingWithVerification);

module.exports = router;
