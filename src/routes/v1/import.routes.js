/**
 * Import Routes - HTTP Layer for import operations
 * Uses ImportController with authorization
 * 
 * Middleware chain: authenticate → authorize('products', 'create') → upload → controller
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/auth');
const requireCompanyHeader = require('../../../middleware/requireCompanyHeader');
const { createUploadMiddleware, validateUpload } = require('../../middleware/upload');
const { createRateLimiters } = require('../../../middleware/redisRateLimiter');
const ImportController = require('../../controllers/ImportController');

// Rate limiter for imports
const rateLimiters = createRateLimiters();

// Middleware chain for product imports
const productUpload = createUploadMiddleware('file');

// Product import: POST /api/v1/import/products
router.post(
  '/products',
  rateLimiters.import,
  protect,
  requireCompanyHeader,
  productUpload,
  validateUpload,
  ImportController.importProducts
);

// Product template: GET /api/v1/import/products/template
router.get(
  '/products/template',
  protect,
  requireCompanyHeader,
  ImportController.getProductTemplate
);

// Client import: POST /api/v1/import/clients
router.post(
  '/clients',
  protect,
  requireCompanyHeader,
  productUpload,
  validateUpload,
  ImportController.importClients
);

// Client template: GET /api/v1/import/clients/template
router.get(
  '/clients/template',
  protect,
  requireCompanyHeader,
  ImportController.getClientTemplate
);

// Supplier import: POST /api/v1/import/suppliers
router.post(
  '/suppliers',
  protect,
  requireCompanyHeader,
  productUpload,
  validateUpload,
  ImportController.importSuppliers
);

// Supplier template: GET /api/v1/import/suppliers/template
router.get(
  '/suppliers/template',
  protect,
  requireCompanyHeader,
  ImportController.getSupplierTemplate
);

// Opening balance import: POST /api/v1/import/opening-balances
router.post(
  '/opening-balances',
  protect,
  requireCompanyHeader,
  productUpload,
  validateUpload,
  ImportController.importOpeningBalances
);

// Opening balance template: GET /api/v1/import/opening-balances/template
router.get(
  '/opening-balances/template',
  protect,
  requireCompanyHeader,
  ImportController.getOpeningBalanceTemplate
);

// Get job status: GET /api/v1/import/jobs/:jobId
router.get(
  '/jobs/:jobId',
  protect,
  requireCompanyHeader,
  ImportController.getJobStatus
);

// Get job history: GET /api/v1/import/jobs
router.get(
  '/jobs',
  protect,
  requireCompanyHeader,
  ImportController.getJobHistory
);

// Retry failed job: POST /api/v1/import/jobs/:jobId/retry
router.post(
  '/jobs/:jobId/retry',
  rateLimiters.import,
  protect,
  requireCompanyHeader,
  productUpload,
  validateUpload,
  ImportController.retryJob
);

// Get available import types metadata
router.get('/meta/types', (req, res) => {
  res.json({
    success: true,
    data: [
      {
        type: 'products',
        name: 'Products',
        description: 'Import products with SKU, pricing, and stock info',
        fileTypes: ['.csv'],
        templateEndpoint: '/api/v1/import/products/template',
        columns: {
          required: ['code', 'name', 'unit_of_measure'],
          optional: ['category_name', 'cost_price', 'selling_price', 'costing_method', 'reorder_point', 'is_stockable']
        }
      },
      {
        type: 'clients',
        name: 'Clients',
        description: 'Import customers/clients',
        fileTypes: ['.csv'],
        templateEndpoint: '/api/v1/import/clients/template'
      },
      {
        type: 'suppliers',
        name: 'Suppliers',
        description: 'Import vendors/suppliers',
        fileTypes: ['.csv'],
        templateEndpoint: '/api/v1/import/suppliers/template'
      },
      {
        type: 'opening-balances',
        name: 'Opening Balances',
        description: 'Import opening balances for go-live (creates journal entries)',
        fileTypes: ['.csv'],
        templateEndpoint: '/api/v1/import/opening-balances/template',
        notes: 'Creates journal entry in the current open period'
      }
    ]
  });
});

module.exports = router;