const express = require('express');
const router = express.Router();
const {
  createReceipt,
  updateReceipt,
  postReceipt,
  reverseReceipt,
  listReceipts,
  getReceipt,
  allocateReceipt,
  getAgingReport,
  getClientStatement,
  writeOffBadDebt,
  listBadDebts,
  reverseBadDebt
} = require('../controllers/arController');
const { protect } = require('../middleware/auth');
const logAction = require('../middleware/logAction');

router.use(protect);

// Receipt endpoints
router.post('/receipts', logAction('ar_receipt'), createReceipt);
router.put('/receipts/:id', logAction('ar_receipt'), updateReceipt);
router.post('/receipts/:id/post', logAction('ar_receipt'), postReceipt);
router.post('/receipts/:id/reverse', logAction('ar_receipt'), reverseReceipt);
router.get('/receipts', listReceipts);
router.get('/receipts/:id', getReceipt);
router.post('/receipts/:id/allocate', logAction('ar_receipt'), allocateReceipt);

// Aging report
router.get('/aging', getAgingReport);

// Client statement
router.get('/statement/:client_id', getClientStatement);

// Bad debt endpoints
router.post('/bad-debt', logAction('ar_bad_debt'), writeOffBadDebt);
router.get('/bad-debt', listBadDebts);
router.post('/bad-debt/:id/reverse', logAction('ar_bad_debt'), reverseBadDebt);

module.exports = router;
