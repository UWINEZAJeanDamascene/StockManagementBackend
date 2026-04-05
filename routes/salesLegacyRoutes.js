const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const logAction = require('../middleware/logAction');
const {
  createDirectSale,
  getPosProducts,
  getReceipt
} = require('../controllers/salesLegacyController');

// All routes require authentication
router.use(protect);

// Direct sale endpoint (Legacy/Direct POS workflow)
router.post('/direct-sale', logAction('sales_legacy_direct_sale'), createDirectSale);

// Get products for POS with stock availability
router.get('/products', getPosProducts);

// Get receipt for printing
router.get('/receipt/:invoiceId', getReceipt);

module.exports = router;
