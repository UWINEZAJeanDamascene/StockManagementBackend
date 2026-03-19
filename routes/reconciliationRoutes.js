const express = require('express');
const router = express.Router();
const reconciliationController = require('../controllers/reconciliationController');
const { protect, authorize } = require('../middleware/auth');

// Health-check (returns ok boolean)
router.get('/health', protect, reconciliationController.healthCheck);

// Full check with discrepancies list. Optionally pass ?asOfDate=YYYY-MM-DD
router.get('/check', protect, reconciliationController.checkLedger);

module.exports = router;
