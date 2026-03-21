const express = require('express');
const router = express.Router();
const companyController = require('../controllers/companyController');
const { protect } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

/**
 * Company Routes:
 * POST   /api/companies                    // Create company (super-admin only)
 * GET    /api/companies                   // Get all companies (super-admin only)
 * GET    /api/companies/:id               // Get company profile
 * PUT    /api/companies/:id               // Update company profile
 * POST   /api/companies/:id/logo           // Upload logo
 * GET    /api/companies/:id/setup-status  // Get onboarding completion status
 * POST   /api/companies/:id/setup/:step    // Mark a setup step as complete
 * DELETE /api/companies/:id                // Delete company (super-admin only)
 */

// Create company (platform admin only)
router.post('/', companyController.createCompany);

// Get all companies (platform admin only)
router.get('/', companyController.getAllCompanies);

// Get company profile
router.get('/:id', companyController.getCompany);

// Update company profile
router.put('/:id', companyController.updateCompany);

// Upload logo
router.post('/:id/logo', companyController.uploadLogo);

// Get setup status
router.get('/:id/setup-status', companyController.getSetupStatus);

// Mark setup step complete
router.post('/:id/setup/:step', companyController.markSetupStepComplete);

// Delete company (soft delete - platform admin only)
router.delete('/:id', companyController.deleteCompany);

module.exports = router;
