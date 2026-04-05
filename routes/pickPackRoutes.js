const express = require('express');
const router = express.Router();
const {
  getPickPacks,
  getPickPack,
  createPickPack,
  assignPickPack,
  startPicking,
  pickItems,
  completePicking,
  startPacking,
  packItems,
  completePacking,
  reportIssue,
  getMyTasks,
  getPendingPick,
  getPendingPack,
  cancelPickPack
} = require('../controllers/pickPackController');
const { protect, authorize } = require('../middleware/auth');
const logAction = require('../middleware/logAction');

router.use(protect);

// Special routes (must come before :id routes)
router.get('/my-tasks', authorize('admin', 'stock_manager', 'warehouse'), getMyTasks);
router.get('/pending-pick', authorize('admin', 'stock_manager', 'warehouse'), getPendingPick);
router.get('/pending-pack', authorize('admin', 'stock_manager', 'warehouse'), getPendingPack);

// Main routes
router.route('/')
  .get(authorize('admin', 'stock_manager', 'warehouse'), getPickPacks)
  .post(authorize('admin', 'stock_manager', 'warehouse'), logAction('pick_pack'), createPickPack);

router.route('/:id')
  .get(authorize('admin', 'stock_manager', 'warehouse'), getPickPack);

// Assignment
router.post('/:id/assign', authorize('admin', 'stock_manager'), logAction('pick_pack'), assignPickPack);

// Picking workflow
router.post('/:id/start-picking', authorize('admin', 'stock_manager', 'warehouse'), logAction('pick_pack'), startPicking);
router.post('/:id/pick-items', authorize('admin', 'stock_manager', 'warehouse'), logAction('pick_pack'), pickItems);
router.post('/:id/complete-picking', authorize('admin', 'stock_manager', 'warehouse'), logAction('pick_pack'), completePicking);

// Packing workflow
router.post('/:id/start-packing', authorize('admin', 'stock_manager', 'warehouse'), logAction('pick_pack'), startPacking);
router.post('/:id/pack-items', authorize('admin', 'stock_manager', 'warehouse'), logAction('pick_pack'), packItems);
router.post('/:id/complete-packing', authorize('admin', 'stock_manager', 'warehouse'), logAction('pick_pack'), completePacking);

// Issue reporting
router.post('/:id/report-issue', authorize('admin', 'stock_manager', 'warehouse'), logAction('pick_pack'), reportIssue);

// Cancel
router.post('/:id/cancel', authorize('admin', 'stock_manager'), logAction('pick_pack'), cancelPickPack);

module.exports = router;
