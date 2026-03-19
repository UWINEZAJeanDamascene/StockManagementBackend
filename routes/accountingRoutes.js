const express = require('express');
const router = express.Router();
const { healthCheck } = require('../controllers/accountingController');
const { protect } = require('../middleware/auth');

router.use(protect);

// Health endpoint for accounting core checks
router.get('/health', healthCheck);

module.exports = router;
