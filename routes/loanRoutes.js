const express = require('express');
const router = express.Router();
const {
  getLoans,
  getLoan,
  createLoan,
  updateLoan,
  deleteLoan,
  recordPayment,
  getLoansSummary,
  recordDrawdown,
  recordRepayment,
  recordInterest,
  getTransactions
} = require('../controllers/loanController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(getLoans)
  .post(createLoan);

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

module.exports = router;
