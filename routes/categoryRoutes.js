const express = require('express');
const router = express.Router();
const {
  getCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory
} = require('../controllers/categoryController');
const { protect, authorize } = require('../middleware/auth');
const logAction = require('../middleware/logAction');

router.use(protect);

router.route('/')
  .get(getCategories)
  .post(authorize('admin'), logAction('category'), createCategory);

router.route('/:id')
  .get(getCategory)
  .put(authorize('admin'), logAction('category'), updateCategory)
  .delete(authorize('admin'), logAction('category'), deleteCategory);

module.exports = router;
