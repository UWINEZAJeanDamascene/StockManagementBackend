const express = require('express');
const router = express.Router();
const {
  getPayrollRecords,
  getPayrollById,
  createPayroll,
  updatePayroll,
  deletePayroll,
  processPayment,
  getPayrollSummary,
  calculatePayroll,
  bulkCreatePayroll
} = require('../controllers/payrollController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

// Calculate payroll (preview)
router.route('/calculate')
  .post(calculatePayroll);

// Summary
router.route('/summary')
  .get(getPayrollSummary);

// Bulk create
router.route('/bulk')
  .post(bulkCreatePayroll);

// CRUD
router.route('/')
  .get(getPayrollRecords)
  .post(createPayroll);

router.route('/:id')
  .get(getPayrollById)
  .put(updatePayroll)
  .delete(deletePayroll);

// Process payment
router.route('/:id/pay')
  .post(authorize('admin', 'manager'), processPayment);

module.exports = router;
