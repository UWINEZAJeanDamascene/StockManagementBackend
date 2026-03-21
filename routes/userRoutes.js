const express = require('express');
const router = express.Router();
const {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  getUserActionLogs,
  resetPassword,
  toggleUserStatus
} = require('../controllers/userController');
const { inviteUser } = require('../controllers/userAuthController');
const { protect, authorize } = require('../middleware/auth');
const logAction = require('../middleware/logAction');

// All routes require authentication
router.use(protect);

// Admin only routes
router.use(authorize('admin'));

router.route('/')
  .get(getUsers)
  .post(logAction('user'), createUser);

router.route('/:id')
  .get(getUser)
  .put(logAction('user'), updateUser)
  .delete(logAction('user'), deleteUser);

// Invite user to company
router.post('/invite', logAction('user'), inviteUser);

// Admin-only special actions
router.post('/:id/reset-password', logAction('user'), resetPassword);
router.put('/:id/toggle-status', logAction('user'), toggleUserStatus);

router.get('/:id/action-logs', getUserActionLogs);

module.exports = router;
