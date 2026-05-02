const express = require('express');
const router = express.Router();
const apController = require('../controllers/apController');
const { protect } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(protect);

/**
 * AP Routes - Read-Only Reporting Module
 *
 * Core Principle: AP is an auto-generated ledger, NOT a transaction entry module.
 * All AP movements originate from source documents:
 *   - Purchase/GRN received          -> AP increases (Dr Inventory/Expense / Cr AP)
 *   - Payment recorded on GRN/Purchase -> AP decreases (Dr AP / Cr Cash/Bank)
 *   - Debit note issued             -> AP decreases (Dr AP / Cr Inventory/Expense)
 *   - Bad debt/write-off            -> AP decreases (Dr Expense / Cr AP)
 *
 * These endpoints return reports only. No manual transaction entry here.
 */

// GET /api/ap/aging - AP aging report
router.get('/aging', apController.getAgingReport);

// GET /api/ap/statement/:supplier_id - Supplier statement
router.get('/statement/:supplier_id', apController.getSupplierStatement);

module.exports = router;
