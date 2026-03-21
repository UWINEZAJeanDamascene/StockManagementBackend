const express = require('express');
const router = express.Router();
const stockAuditController = require('../controllers/stockAuditController');
const { protect } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// CRUD operations
router.post('/', stockAuditController.createStockAudit);
router.get('/', stockAuditController.getStockAudits);
router.get('/:id', stockAuditController.getStockAudit);
router.put('/:id', stockAuditController.updateStockAudit);
router.delete('/:id', stockAuditController.deleteStockAudit);

// Audit-specific operations
router.put('/:id/lines', stockAuditController.bulkUpdateLines);
router.put('/:id/lines/:lineId', stockAuditController.updateLine);
router.post('/:id/post', stockAuditController.postStockAudit);
router.post('/:id/cancel', stockAuditController.cancelStockAudit);

module.exports = router;
