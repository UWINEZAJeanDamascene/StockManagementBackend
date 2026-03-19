const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const stockBatchController = require('../controllers/stockBatchController');

// @route   GET /api/stock-batches
// @desc    Get all stock batches
// @access  Private
router.get('/', protect, stockBatchController.getStockBatches);

// @route   GET /api/stock-batches/expiring
// @desc    Get expiring batches
// @access  Private
router.get('/expiring', protect, stockBatchController.getExpiringBatches);

// @route   GET /api/stock-batches/:id
// @desc    Get single stock batch
// @access  Private
router.get('/:id', protect, stockBatchController.getStockBatch);

// @route   POST /api/stock-batches
// @desc    Create a new stock batch
// @access  Private (admin, stock_manager)
router.post('/', protect, authorize('admin', 'stock_manager'), stockBatchController.createStockBatch);

// @route   PUT /api/stock-batches/:id
// @desc    Update a stock batch
// @access  Private (admin, stock_manager)
router.put('/:id', protect, authorize('admin', 'stock_manager'), stockBatchController.updateStockBatch);

// @route   PUT /api/stock-batches/:id/quarantine
// @desc    Quarantine/unquarantine a stock batch
// @access  Private (admin, stock_manager)
router.put('/:id/quarantine', protect, authorize('admin', 'stock_manager'), stockBatchController.quarantineStockBatch);

// @route   DELETE /api/stock-batches/:id
// @desc    Delete a stock batch
// @access  Private (admin, stock_manager)
router.delete('/:id', protect, authorize('admin', 'stock_manager'), stockBatchController.deleteStockBatch);

module.exports = router;
