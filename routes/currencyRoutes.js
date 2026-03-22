const express = require('express');
const router = express.Router();
const { listCurrencies } = require('../controllers/currencyController');

// @route   GET /api/currencies
// @desc    List all active currencies
// @access  Public
router.get('/', listCurrencies);

module.exports = router;
