const express = require('express');
const router = express.Router();
const taxController = require('../controllers/taxController');
const { protect, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// =====================================================
// TAX DASHBOARD - Auto-detected from all sources
// =====================================================
router.get('/dashboard', taxController.getTaxDashboard);

// =====================================================
// TAX RATE CONFIGURATION (Module 9: Taxes)
// =====================================================
// Tax rate CRUD
router.get('/rates', taxController.getTaxRates);
router.post('/rates', taxController.createTaxRate);
router.get('/rates/:id', taxController.getTaxRateById);
router.put('/rates/:id', taxController.updateTaxRate);
router.delete('/rates/:id', taxController.deleteTaxRate);

// Tax liability report - computed from journal entries
router.get('/liability-report', taxController.getLiabilityReport);

// Tax settlement - post payment to authorities (supports settlement_type: vat, paye, rssb)
router.post('/settlements', taxController.postSettlement);

// Separate settlement endpoints
router.post('/settlements/vat', taxController.postVatSettlement);
router.post('/settlements/paye', taxController.postPayeSettlement);
router.post('/settlements/rssb', taxController.postRssbSettlement);

// Tax preview - live calculation without posting
router.post('/preview', taxController.previewTax);

// =====================================================
// TAX TRACKING (existing - for filings, payments, calendar)
// =====================================================
// Tax records CRUD
router.get('/', taxController.getTaxRecords);
router.get('/summary', taxController.getTaxSummary);
router.get('/calendar', taxController.getCalendar);
router.get('/filing-history', taxController.getFilingHistory);
router.get('/vat-return', taxController.prepareVATReturn);
router.post('/generate-calendar', taxController.generateCalendar);

router.get('/:id', taxController.getTaxById);
router.post('/', taxController.createTax);
router.put('/:id', taxController.updateTax);
router.delete('/:id', taxController.deleteTax);

// Payments and filings
router.post('/:id/payments', taxController.addPayment);
router.post('/:id/filings', taxController.addFiling);
router.post('/:id/calendar', taxController.addCalendarEntry);

module.exports = router;
