const express = require('express');
const router = express.Router();
const {
  getWarehouses,
  getWarehouse,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
  getWarehouseInventory
} = require('../controllers/warehouseController');
const { protect, authorize } = require('../middleware/auth');
const logAction = require('../middleware/logAction');

router.use(protect);

router.route('/')
  .get(getWarehouses)
  .post(authorize('admin', 'stock_manager'), logAction('warehouse'), createWarehouse);

router.route('/:id')
  .get(getWarehouse)
  .put(authorize('admin', 'stock_manager'), logAction('warehouse'), updateWarehouse)
  .delete(authorize('admin'), logAction('warehouse'), deleteWarehouse);

router.get('/:id/inventory', getWarehouseInventory);

module.exports = router;