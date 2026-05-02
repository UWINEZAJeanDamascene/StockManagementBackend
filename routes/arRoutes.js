const express = require('express');
const router = express.Router();
const {
  getAgingReport,
  getClientStatement
} = require('../controllers/arController');
const { protect } = require('../middleware/auth');

router.use(protect);

/**
 * AR Routes - Read-Only Reporting Module
 *
 * Core Principle: AR is an auto-generated ledger, NOT a transaction entry module.
 * All AR movements originate from source documents:
 *   - Invoice confirmed          -> AR increases (Dr AR / Cr Sales)
 *   - Payment recorded on invoice -> AR decreases (Dr Cash/Bank / Cr AR)
 *   - Credit note issued         -> AR decreases (Dr Sales Returns / Cr AR)
 *   - Bad debt write-off on invoice -> AR decreases (Dr Bad Debt / Cr AR)
 *
 * These endpoints return reports only. No manual transaction entry here.
 */

// Aging report (all outstanding invoices grouped by age)
router.get('/aging', getAgingReport);

// Client statement (transaction history per customer)
router.get('/statement/:client_id', getClientStatement);

module.exports = router;
