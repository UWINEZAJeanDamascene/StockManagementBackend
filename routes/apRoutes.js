const express = require('express');
const router = express.Router();
const apController = require('../controllers/apController');
const { protect } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(protect);

/**
 * AP Payment Routes
 */
// GET /api/ap/payments - List payments
router.get('/payments', apController.getPayments);

// GET /api/ap/payments/:id - Get single payment
router.get('/payments/:id', apController.getPayment);

// POST /api/ap/payments - Create payment draft
router.post('/payments', apController.createPayment);

// PUT /api/ap/payments/:id - Edit payment (draft only)
router.put('/payments/:id', apController.updatePayment);

// POST /api/ap/payments/:id/post - Post payment
router.post('/payments/:id/post', apController.postPayment);

// POST /api/ap/payments/:id/save-and-post - Save and post without journal entry
router.post('/payments/:id/save-and-post', apController.saveAndPostPayment);

// POST /api/ap/payments/:id/reverse - Reverse payment
router.post('/payments/:id/reverse', apController.reversePayment);

/**
 * AP Allocation Routes
 */
// GET /api/ap/allocations - List allocations
router.get('/allocations', apController.getAllocations);

// POST /api/ap/allocations - Create allocation
router.post('/allocations', apController.createAllocation);

/**
 * AP Reports
 */
// GET /api/ap/aging - AP aging report
router.get('/aging', apController.getAgingReport);

// GET /api/ap/statement/:supplier_id - Supplier statement
router.get('/statement/:supplier_id', apController.getSupplierStatement);

module.exports = router;
