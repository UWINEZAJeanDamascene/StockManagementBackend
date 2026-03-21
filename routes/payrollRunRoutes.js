const express = require('express');
const router = express.Router();
const {
  getPayrollRuns,
  getPayrollRunById,
  createPayrollRun,
  postPayrollRun,
  reversePayrollRun,
  deletePayrollRun,
  previewPayrollRun,
  createFromRecords
} = require('../controllers/payrollRunController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

// CRUD routes
router.route('/')
  .get(getPayrollRuns)
  .post(authorize('admin', 'manager'), createPayrollRun);

router.route('/:id')
  .get(getPayrollRunById)
  .delete(authorize('admin'), deletePayrollRun);

// Post payroll run (creates journal entry)
router.route('/:id/post')
  .post(authorize('admin'), postPayrollRun);

// Reverse payroll run
router.route('/:id/reverse')
  .post(authorize('admin'), reversePayrollRun);

// Preview journal entry before posting
router.route('/preview')
  .get(authorize('admin', 'manager'), previewPayrollRun);

// Create payroll run from finalised employee records
router.route('/from-records')
  .post(authorize('admin', 'manager'), createFromRecords);

module.exports = router;
