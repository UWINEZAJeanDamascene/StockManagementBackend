const express = require('express');
const router = express.Router();
const periodController = require('../controllers/periodController');

// POST /api/periods/generate - Generate 12 monthly periods for a fiscal year
router.post('/generate', periodController.generateFiscalYear);

// GET /api/periods/current - Get the currently open period for today's date
router.get('/current', periodController.getCurrentPeriod);

// POST /api/periods/year-end-close - Perform year-end close for a fiscal year
router.post('/year-end-close', periodController.performYearEndClose);

// GET /api/periods - List all periods. Filter: fiscal_year, status
router.get('/', periodController.getAllPeriods);

// GET /api/periods/:id - Get single period
router.get('/:id', periodController.getPeriod);

// POST /api/periods/:id/close - Close a period
router.post('/:id/close', periodController.closePeriod);

// POST /api/periods/:id/reopen - Reopen a closed period
router.post('/:id/reopen', periodController.reopenPeriod);

// POST /api/periods/:id/lock - Lock permanently
router.post('/:id/lock', periodController.lockPeriod);

module.exports = router;
