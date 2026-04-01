const express = require('express');
const router = express.Router();
const {
  getAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  reactivateAccount,
  bulkCreateAccounts
} = require('../controllers/chartOfAccountsController');

const { protect, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// Bulk create (admin only) - must be before /:id routes
router.route('/bulk')
  .post(authorize('admin', 'super_admin'), bulkCreateAccounts);

// CRUD routes
router.route('/')
  .get(getAccounts)
  .post(createAccount);

router.route('/:id')
  .get(getAccount)
  .put(updateAccount)
  .delete(deleteAccount);

router.route('/:id/reactivate')
  .put(reactivateAccount);

module.exports = router;
