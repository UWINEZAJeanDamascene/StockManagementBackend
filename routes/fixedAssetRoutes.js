/**
 * Module 5 - Fixed Assets Routes
 */

const express = require('express');
const router = express.Router();
const fixedAssetController = require('../controllers/fixedAssetController');
const { protect } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// GET /api/fixed-assets - List all assets for company
router.get('/', fixedAssetController.getAssets);

// GET /api/fixed-assets/report/depreciation - Depreciation report
router.get('/report/depreciation', fixedAssetController.getDepreciationReport);

// GET /api/fixed-assets/:id - Get single asset
router.get('/:id', fixedAssetController.getAssetById);

// GET /api/fixed-assets/:id/depreciation-schedule - Get depreciation schedule
router.get('/:id/depreciation-schedule', fixedAssetController.getDepreciationSchedule);

// POST /api/fixed-assets - Create asset and post purchase entry
router.post('/', fixedAssetController.createAsset);

// PUT /api/fixed-assets/:id - Update asset (only before first depreciation)
router.put('/:id', fixedAssetController.updateAsset);

// POST /api/fixed-assets/:id/depreciate - Manually trigger depreciation
router.post('/:id/depreciate', fixedAssetController.postDepreciation);

// POST /api/fixed-assets/:id/dispose - Post disposal
router.post('/:id/dispose', fixedAssetController.disposeAsset);

// DELETE /api/fixed-assets/:id - Soft delete asset (with strict guards)
router.delete('/:id', fixedAssetController.deleteAsset);

// GET /api/fixed-assets/:id/depreciation-entries - Get posted depreciation entries for an asset
router.get('/:id/depreciation-entries', fixedAssetController.getDepreciationEntries);

// POST /api/fixed-assets/:id/depreciation/:entryId/reverse - Reverse depreciation (LIFO only)
router.post('/:id/depreciation/:entryId/reverse', fixedAssetController.reverseDepreciation);

// POST /api/fixed-assets/:id/place-in-service - Place asset in service (from in_transit to in_service)
router.post('/:id/place-in-service', fixedAssetController.placeInService);

// POST /api/fixed-assets/:id/transition - Transition asset status
router.post('/:id/transition', fixedAssetController.transitionStatus);

// GET /api/fixed-assets/:id/status-history - Get asset status history
router.get('/:id/status-history', fixedAssetController.getStatusHistory);

// GET /api/fixed-assets/:id/disposal-event - Get disposal event for asset
router.get('/:id/disposal-event', fixedAssetController.getDisposalEvent);

module.exports = router;
