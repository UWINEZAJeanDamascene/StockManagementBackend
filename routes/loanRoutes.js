const express = require('express');
const router = express.Router();
const {
  getLoans,
  getLoan,
  createLoan,
  updateLoan,
  deleteLoan,
  cancelLoan,
  recordPayment,
  getLoansSummary,
  recordDrawdown,
  recordRepayment,
  recordInterest,
  getTransactions,
  calculatePaymentSchedule,
  getPaymentSchedule
} = require('../controllers/loanController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(getLoans)
  .post(createLoan);

// Calculate payment schedule (preview before creating loan)
router.route('/calculate')
  .post(calculatePaymentSchedule);

router.route('/summary')
  .get(getLoansSummary);

router.route('/:id')
  .get(getLoan)
  .put(updateLoan)
  .delete(deleteLoan);

router.route('/:id/payment')
  .post(recordPayment);

// New liability transaction routes
router.route('/:id/drawdown')
  .post(recordDrawdown);

router.route('/:id/repayment')
  .post(recordRepayment);

router.route('/:id/interest')
  .post(recordInterest);

router.route('/:id/transactions')
  .get(getTransactions);

// Get payment schedule for existing loan
router.route('/:id/schedule')
  .get(getPaymentSchedule);

// Cancel loan route
router.route('/:id/cancel')
  .post(cancelLoan);

module.exports = router;
