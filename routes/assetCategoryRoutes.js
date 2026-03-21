/**
 * Asset Category Routes
 */

const express = require('express');
const router = express.Router();
const assetCategoryController = require('../controllers/assetCategoryController');
const { protect } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// GET /api/asset-categories - List all categories
router.get('/', assetCategoryController.getCategories);

// GET /api/asset-categories/seed - Seed default categories
router.post('/seed', assetCategoryController.seedDefaults);

// GET /api/asset-categories/:id - Get single category
router.get('/:id', assetCategoryController.getCategoryById);

// POST /api/asset-categories - Create category
router.post('/', assetCategoryController.createCategory);

// PUT /api/asset-categories/:id - Update category
router.put('/:id', assetCategoryController.updateCategory);

// DELETE /api/asset-categories/:id - Delete category
router.delete('/:id', assetCategoryController.deleteCategory);

module.exports = router;
