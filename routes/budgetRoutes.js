const express = require('express');
const router = express.Router();
const budgetController = require('../controllers/budgetController');
const { protect, authorize } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(protect);

/**
 * Budget CRUD
 */
router.post('/', authorize(['admin', 'accountant']), budgetController.createBudget);
router.get('/', budgetController.getBudgets);
router.get('/:id', budgetController.getBudgetById);
router.put('/:id', authorize(['admin', 'accountant']), budgetController.updateBudget);
router.delete('/:id', authorize(['admin']), budgetController.deleteBudget);

/**
 * Budget Lines
 */
router.post('/:id/lines', authorize(['admin', 'accountant']), budgetController.upsertLines);
router.get('/:id/lines', budgetController.getLines);

/**
 * Budget Actions
 */
router.post('/:id/approve', authorize(['admin']), budgetController.approveBudget);
router.post('/:id/lock', authorize(['admin']), budgetController.lockBudget);

/**
 * Variance Report
 */
router.get('/:id/variance-report', budgetController.getVarianceReport);

module.exports = router;
