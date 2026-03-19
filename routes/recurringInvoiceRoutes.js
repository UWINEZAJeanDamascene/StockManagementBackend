const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const controller = require('../controllers/recurringInvoiceController');

router.use(protect);

// POST /api/recurring-templates — Create template
router.route('/')
  .get(controller.getRecurringInvoices)
  .post(controller.createRecurringInvoice);

// POST /api/recurring-templates/trigger — Trigger all due templates (admin)
router.post('/trigger', controller.triggerGeneration);

// GET /api/recurring-templates/:templateId/runs — History of all invoice runs
router.get('/:templateId/runs', controller.getRecurringInvoiceRuns);

// POST /api/recurring-templates/:id/pause — Pause
router.post('/:id/pause', controller.pauseRecurringInvoice);

// POST /api/recurring-templates/:id/resume — Resume
router.post('/:id/resume', controller.resumeRecurringInvoice);

// POST /api/recurring-templates/:id/cancel — Cancel permanently
router.post('/:id/cancel', controller.cancelRecurringInvoice);

// POST /api/recurring-templates/:id/trigger — Trigger a specific template
router.post('/:id/trigger', controller.triggerTemplate);

// PUT /api/recurring-templates/:id — Edit (only when status is active or paused)
router.route('/:id')
  .get(controller.getRecurringInvoice)
  .put(controller.updateRecurringInvoice)
  .delete(controller.deleteRecurringInvoice);

module.exports = router;
