const express = require('express');
const router = express.Router();
const {
  addRate,
  listRates,
  getCurrentRate,
  convert
} = require('../controllers/exchangeRateController');
const { protect } = require('../middleware/auth');

router.use(protect);

// Spec endpoints
router.get('/', listRates);
router.post('/', addRate);
router.get('/current/:currency', getCurrentRate);

// Internal / convert
router.post('/convert', convert);

module.exports = router;
