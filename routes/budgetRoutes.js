const express = require('express');
const router = express.Router();
const budgetController = require('../controllers/budgetController');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const { attachCompanyId } = require('../middleware/companyContext');

// All routes require authentication + company context
router.use(protect);
router.use(attachCompanyId);

// ── Forecasts (must be before /:id routes to avoid conflicts) ──────────
router.get('/forecast/revenue', budgetController.getRevenueForecast);
router.get('/forecast/expense', budgetController.getExpenseForecast);
router.get('/forecast/cashflow', budgetController.getCashFlowForecast);

// ── Summary & Comparisons (must be before /:id routes) ─────────────────
router.get('/summary', budgetController.getSummary);
router.get('/compare/all', budgetController.getAllComparisons);

// ── Budget CRUD ────────────────────────────────────────────────────────
router.post('/', authorize('budgets', 'create'), budgetController.createBudget);
router.get('/', authorize('budgets', 'read'), budgetController.getBudgets);
router.get('/:id', authorize('budgets', 'read'), budgetController.getBudgetById);
router.put('/:id', authorize('budgets', 'update'), budgetController.updateBudget);
router.delete('/:id', authorize('budgets', 'delete'), budgetController.deleteBudget);

// ── Budget Lines ───────────────────────────────────────────────────────
router.post('/:id/lines', authorize('budgets', 'update'), budgetController.upsertLines);
router.get('/:id/lines', authorize('budgets', 'read'), budgetController.getLines);

// ── Budget Actions ─────────────────────────────────────────────────────
router.post('/:id/approve', authorize('budgets', 'approve'), budgetController.approveBudget);
router.post('/:id/reject', authorize('budgets', 'approve'), budgetController.rejectBudget);
router.post('/:id/lock', authorize('budgets', 'approve'), budgetController.lockBudget);
router.post('/:id/close', authorize('budgets', 'approve'), budgetController.closeBudget);
router.post('/:id/clone', authorize('budgets', 'create'), budgetController.cloneBudget);

// ── Comparison & Reports ───────────────────────────────────────────────
router.get('/:id/compare', authorize('budgets', 'read'), budgetController.getComparison);
router.get('/:id/variance-report', authorize('budgets', 'read'), budgetController.getVarianceReport);

module.exports = router;
