const express = require('express');
const router = express.Router();
const { 
  listPurchaseReturns,
  getPurchaseReturn, 
  createPurchaseReturn, 
  updatePurchaseReturn,
  confirmPurchaseReturn,
  getPurchaseReturnSummary,
  processRefund
} = require('../controllers/purchaseReturnController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(listPurchaseReturns)
  .post(createPurchaseReturn);

router.route('/summary')
  .get(getPurchaseReturnSummary);

router.route('/:id')
  .get(getPurchaseReturn)
  .put(updatePurchaseReturn);

router.route('/:id/confirm')
  .put(confirmPurchaseReturn);

router.route('/:id/refund')
  .post(processRefund);

module.exports = router;
