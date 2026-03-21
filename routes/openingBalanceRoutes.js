/**
 * MODULE 7 - Opening Balance Routes
 * 
 * API routes for opening balance operations.
 */

const express = require('express');
const router = express.Router();
const openingBalanceController = require('../controllers/openingBalanceController');
const { protect } = require('../middleware/auth');
const { body, query } = require('express-validator');

// All routes require authentication
router.use(protect);

// POST /api/opening-balances/preview - Preview without committing
router.post(
  '/preview',
  [
    body('balances').isArray({ min: 1 }).withMessage('Balances array is required'),
    body('balances.*.account_id').notEmpty().withMessage('Account ID is required'),
    body('balances.*.entry_type').isIn(['debit', 'credit']).withMessage('Entry type must be debit or credit'),
    body('balances.*.amount').isFloat({ min: 0 }).withMessage('Amount must be a positive number')
  ],
  openingBalanceController.preview
);

// POST /api/opening-balances/import - Import and post the journal entry
router.post(
  '/import',
  [
    body('asOfDate').notEmpty().withMessage('As of date is required'),
    body('balances').isArray({ min: 1 }).withMessage('Balances array is required'),
    body('balances.*.account_id').notEmpty().withMessage('Account ID is required'),
    body('balances.*.entry_type').isIn(['debit', 'credit']).withMessage('Entry type must be debit or credit'),
    body('balances.*.amount').isFloat({ min: 0 }).withMessage('Amount must be a positive number')
  ],
  openingBalanceController.import
);

// POST /api/opening-balances/csv - Import from CSV file (multipart)
router.post(
  '/csv',
  [
    body('asOfDate').notEmpty().withMessage('As of date is required'),
    body('csvData').isArray({ min: 1 }).withMessage('CSV data array is required'),
    body('csvData.*.account_code').notEmpty().withMessage('Account code is required'),
    body('csvData.*.entry_type').isIn(['debit', 'credit']).withMessage('Entry type must be debit or credit'),
    body('csvData.*.amount').isFloat({ min: 0 }).withMessage('Amount must be a positive number')
  ],
  openingBalanceController.importCSV
);

// GET /api/opening-balances - Get the posted opening balance entry
router.get(
  '/',
  openingBalanceController.get
);

module.exports = router;
