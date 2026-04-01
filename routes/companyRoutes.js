const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();
const companyController = require('../controllers/companyController');
const { protect, authorize } = require('../middleware/auth');
const { attachCompanyId } = require('../middleware/companyContext');
const validateRequest = require('../middleware/validateRequest');
const stripUnvalidatedBody = require('../middleware/stripUnvalidatedBody');

const registerValidation = [
  body('company').isObject().withMessage('company object required'),
  body('company.name').trim().notEmpty().withMessage('Company name required'),
  body('company.email').isEmail().normalizeEmail().withMessage('Valid company email required'),
  body('admin').isObject().withMessage('admin object required'),
  body('admin.name').trim().notEmpty().withMessage('Admin name required'),
  body('admin.email').isEmail().normalizeEmail().withMessage('Valid admin email required'),
  body('admin.password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
];

/**
 * Public — must stay before router.use(protect)
 */
router.post(
  '/register',
  registerValidation,
  validateRequest,
  stripUnvalidatedBody,
  companyController.registerPublic
);

router.use(protect);

/**
 * Current user's company — must be before /:id routes
 */
router.get('/me', companyController.getMyCompany);
router.put('/me', companyController.updateMyCompany);

/**
 * Platform admin — literal paths before /:id
 */
router.get('/pending', authorize('platform_admin'), companyController.getPendingCompanies);
router.get('/rejected', authorize('platform_admin'), companyController.getRejectedCompanies);

router.post('/', companyController.createCompany);
router.get('/', companyController.getAllCompanies);

const approveValidation = [
  param('id').isMongoId().withMessage('Invalid company id')
];

const rejectValidation = [
  param('id').isMongoId().withMessage('Invalid company id'),
  body('reason').optional().isString().trim()
];

router.put(
  '/:id/approve',
  authorize('platform_admin'),
  ...approveValidation,
  validateRequest,
  companyController.approveCompany
);
router.put(
  '/:id/reject',
  authorize('platform_admin'),
  ...rejectValidation,
  validateRequest,
  stripUnvalidatedBody,
  companyController.rejectCompany
);

router.post('/:id/logo', companyController.uploadLogo);
router.get('/:id/setup-status', companyController.getSetupStatus);
router.post('/:id/setup/:step', companyController.markSetupStepComplete);

router.get('/:id', companyController.getCompany);
router.put('/:id', companyController.updateCompany);
router.delete('/:id', companyController.deleteCompany);

module.exports = router;
