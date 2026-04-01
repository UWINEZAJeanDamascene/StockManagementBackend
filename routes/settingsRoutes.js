const express = require('express')
const router = express.Router()
const systemSettingsController = require('../controllers/systemSettingsController')
const { protect } = require('../middleware/auth')
const { attachCompanyId } = require('../middleware/companyContext')

// All routes require authentication and company context
router.use(protect)
router.use(attachCompanyId)

// GET /api/settings - Get all settings for company
router.get('/', systemSettingsController.getSettings)

// PUT /api/settings - Update settings (admin only)
router.put('/', systemSettingsController.updateSettings)

module.exports = router
