const express = require('express');
const router = express.Router();
const {
  getSalesOrders,
  getSalesOrder,
  createSalesOrder,
  updateSalesOrder,
  deleteSalesOrder,
  confirmSalesOrder,
  cancelSalesOrder,
  getClientSalesOrders,
  getReadyForPicking,
  getReadyForPacking,
  getReadyForDelivery,
  getBackorders,
  getWorkflowStatus
} = require('../controllers/salesOrderController');
const { protect, authorize } = require('../middleware/auth');
const logAction = require('../middleware/logAction');

router.use(protect);

// Special routes (must come before :id routes)
router.get('/ready-for-picking', authorize('admin', 'stock_manager', 'warehouse'), getReadyForPicking);
router.get('/ready-for-packing', authorize('admin', 'stock_manager', 'warehouse'), getReadyForPacking);
router.get('/ready-for-delivery', authorize('admin', 'stock_manager', 'warehouse'), getReadyForDelivery);
router.get('/backorders', authorize('admin', 'stock_manager', 'sales'), getBackorders);
router.get('/client/:clientId', getClientSalesOrders);

// Main routes
router.route('/')
  .get(getSalesOrders)
  .post(authorize('admin', 'sales', 'stock_manager'), logAction('sales_order'), createSalesOrder);

router.route('/:id')
  .get(getSalesOrder)
  .put(authorize('admin', 'sales', 'stock_manager'), logAction('sales_order'), updateSalesOrder)
  .delete(authorize('admin', 'sales'), logAction('sales_order'), deleteSalesOrder);

// Workflow actions
router.post('/:id/confirm', authorize('admin', 'sales', 'stock_manager'), logAction('sales_order'), confirmSalesOrder);
router.post('/:id/cancel', authorize('admin', 'sales'), logAction('sales_order'), cancelSalesOrder);
router.get('/:id/workflow', getWorkflowStatus);

module.exports = router;
