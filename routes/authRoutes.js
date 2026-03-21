const express = require('express');
const router = express.Router();
const {
  login,
  register,
  refresh,
  getMe,
  changePassword,
  resetPassword,
  forgotPassword,
  logout
} = require('../controllers/userAuthController');
const { protect } = require('../middleware/auth');

// Public routes
router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refresh);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Protected routes
router.get('/me', protect, getMe);
router.put('/change-password', protect, changePassword);
router.post('/logout', protect, logout);

module.exports = router;
