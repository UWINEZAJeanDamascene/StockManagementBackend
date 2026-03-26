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
  reverseExpense
} = require('../controllers/expenseController');

const { protect } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// CRUD routes
router.route('/')
  .get(getExpenses)
  .post(createExpense);

router.route('/bulk')
  .post(bulkCreateExpenses);

router.route('/summary')
  .get(getExpenseSummary);

router.route('/:id')
  .get(getExpense)
  .put(updateExpense)
  .delete(deleteExpense);

router.route('/:id/reverse')
  .post(reverseExpense);

module.exports = router;
