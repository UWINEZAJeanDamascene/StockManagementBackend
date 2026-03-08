const express = require('express');
const router = express.Router();
const {
  getFixedAssets,
  getFixedAsset,
  createFixedAsset,
  updateFixedAsset,
  deleteFixedAsset,
  getFixedAssetsSummary
} = require('../controllers/fixedAssetController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(getFixedAssets)
  .post(createFixedAsset);

router.route('/summary')
  .get(getFixedAssetsSummary);

router.route('/:id')
  .get(getFixedAsset)
  .put(updateFixedAsset)
  .delete(deleteFixedAsset);

module.exports = router;
