const express = require('express');
const router = express.Router();
const glCtrl = require('../controllers/glFinancialsController');
const { protect } = require('../middleware/auth');

// GET /api/gl-financials/pl
router.get('/pl', protect, glCtrl.getProfitAndLoss);

// GET /api/gl-financials/balance-sheet
router.get('/balance-sheet', protect, glCtrl.getBalanceSheet);

module.exports = router;
