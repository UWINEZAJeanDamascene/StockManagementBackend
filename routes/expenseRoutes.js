const express = require('express');
const router = express.Router();
const {
  getExpenses,
  getExpense,
  createExpense,
  updateExpense,
  deleteExpense,
  getExpenseSummary,
  bulkCreateExpenses,
  reverseExpense,
  approveExpense,
  rejectExpense,
  postExpense,
  getExpenseAccounts
} = require('../controllers/expenseController');

const { protect } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// Special routes
router.route('/accounts')
  .get(getExpenseAccounts);

router.route('/bulk')
  .post(bulkCreateExpenses);

router.route('/summary')
  .get(getExpenseSummary);

// CRUD routes
router.route('/')
  .get(getExpenses)
  .post(createExpense);

router.route('/:id')
  .get(getExpense)
  .put(updateExpense)
  .delete(deleteExpense);

router.route('/:id/reverse')
  .post(reverseExpense);

router.route('/:id/approve')
  .put(approveExpense);

router.route('/:id/reject')
  .put(rejectExpense);

router.route('/:id/post')
  .put(postExpense);

module.exports = router;
