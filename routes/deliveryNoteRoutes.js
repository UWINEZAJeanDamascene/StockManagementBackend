const express = require('express');
const router = express.Router();
const {
  getDeliveryNotes,
  getDeliveryNote,
  createDeliveryNote,
  updateDeliveryNote,
  deleteDeliveryNote,
  confirmDelivery,
  cancelDeliveryNote,
  createInvoiceFromDeliveryNote,
  getInvoiceDeliveryNotes,
  getQuotationDeliveryNotes,
  generateDeliveryNotePDF,
  updateLineDeliveryQty,
  updateItemDeliveryQty // Legacy
} = require('../controllers/deliveryNoteController');
const { protect, authorize } = require('../middleware/auth');
const logAction = require('../middleware/logAction');

router.use(protect);

router.route('/')
  .get(getDeliveryNotes)
  .post(authorize('admin', 'sales', 'stock_manager'), logAction('delivery_note'), createDeliveryNote);

// PDF route must come BEFORE :id route
router.get('/:id/pdf', generateDeliveryNotePDF);

// Get delivery notes for an invoice (Module 7)
router.get('/invoice/:invoiceId', getInvoiceDeliveryNotes);

// Get delivery notes for a quotation (legacy)
router.get('/quotation/:quotationId', getQuotationDeliveryNotes);

router.route('/:id')
  .get(getDeliveryNote)
  .put(authorize('admin', 'sales', 'stock_manager'), logAction('delivery_note'), updateDeliveryNote)
  .delete(authorize('admin', 'sales'), logAction('delivery_note'), deleteDeliveryNote);

// Update line delivery qty (Module 7)
router.put('/:id/lines/:lineId', authorize('admin', 'sales', 'stock_manager'), logAction('delivery_note'), updateLineDeliveryQty);

// Legacy: Update item delivery qty (backwards compatibility)
router.put('/:id/items/:itemId', authorize('admin', 'sales', 'stock_manager'), logAction('delivery_note'), updateItemDeliveryQty);

// Confirm delivery (Module 7: POST /api/delivery-notes/:id/confirm)
router.post('/:id/confirm', authorize('admin', 'sales', 'stock_manager'), logAction('delivery_note'), confirmDelivery);

// Legacy: PUT confirm still works but deprecated
router.put('/:id/confirm', authorize('admin', 'sales', 'stock_manager'), logAction('delivery_note'), confirmDelivery);

// Cancel delivery note
router.post('/:id/cancel', authorize('admin'), logAction('delivery_note'), cancelDeliveryNote);

// Legacy: PUT cancel still works but deprecated
router.put('/:id/cancel', authorize('admin'), logAction('delivery_note'), cancelDeliveryNote);

// Create invoice from delivery note (legacy - Module 7 uses invoice -> delivery flow)
router.post('/:id/create-invoice', authorize('admin', 'sales'), logAction('delivery_note'), createInvoiceFromDeliveryNote);

module.exports = router;
