const SystemSettingsService = require('../services/systemSettingsService')

/**
 * Get system settings for the authenticated user's company
 * GET /api/settings
 */
exports.getSettings = async (req, res) => {
  try {
    const companyId = req.companyId

    const settings = await SystemSettingsService.get(companyId)

    return res.status(200).json({
      success: true,
      data: settings
    })
  } catch (error) {
    console.error('Error fetching system settings:', error)
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch system settings',
      error: error.message
    })
  }
}

/**
 * Update system settings for the authenticated user's company
 * PUT /api/settings
 */
exports.updateSettings = async (req, res) => {
  try {
    const companyId = req.companyId
    const userId = req.user._id
    const data = req.body

    // Validate allowed fields
    const allowedFields = [
      'invoice_prefix',
      'invoice_footer_text',
      'invoice_payment_instructions',
      'default_invoice_due_days',
      'default_quote_expiry_days',
      'auto_apply_vat',
      'default_vat_rate_id',
      'default_costing_method',
      'allow_negative_stock',
      'low_stock_alert_enabled',
      'require_po_approval',
      'po_approval_threshold',
      'require_invoice_approval',
      'document_terms_and_conditions',
      'document_theme_color',
      'notify_on_low_stock',
      'notify_on_overdue_invoice',
      'overdue_invoice_alert_days'
    ]

    // Filter to only allowed fields
    const filteredData = {}
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        filteredData[field] = data[field]
      }
    }

    // Validate costing_method if provided
    if (filteredData.default_costing_method && !['fifo', 'wac'].includes(filteredData.default_costing_method)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid default_costing_method. Must be "fifo" or "wac"'
      })
    }

    // Validate numeric fields
    if (filteredData.default_invoice_due_days !== undefined) {
      if (typeof filteredData.default_invoice_due_days !== 'number' || filteredData.default_invoice_due_days < 0) {
        return res.status(400).json({
          success: false,
          message: 'default_invoice_due_days must be a positive number'
        })
      }
    }

    if (filteredData.default_quote_expiry_days !== undefined) {
      if (typeof filteredData.default_quote_expiry_days !== 'number' || filteredData.default_quote_expiry_days < 0) {
        return res.status(400).json({
          success: false,
          message: 'default_quote_expiry_days must be a positive number'
        })
      }
    }

    if (filteredData.po_approval_threshold !== undefined) {
      if (typeof filteredData.po_approval_threshold !== 'number' || filteredData.po_approval_threshold < 0) {
        return res.status(400).json({
          success: false,
          message: 'po_approval_threshold must be a positive number'
        })
      }
    }

    if (filteredData.overdue_invoice_alert_days !== undefined) {
      if (typeof filteredData.overdue_invoice_alert_days !== 'number' || filteredData.overdue_invoice_alert_days < 0) {
        return res.status(400).json({
          success: false,
          message: 'overdue_invoice_alert_days must be a positive number'
        })
      }
    }

    // Validate theme color if provided
    if (filteredData.document_theme_color !== undefined) {
      const colorRegex = /^#[0-9A-Fa-f]{6}$/
      if (!colorRegex.test(filteredData.document_theme_color)) {
        return res.status(400).json({
          success: false,
          message: 'document_theme_color must be a valid hex color (e.g., #1D9E75)'
        })
      }
    }

    const settings = await SystemSettingsService.update(companyId, filteredData, userId)

    return res.status(200).json({
      success: true,
      data: settings
    })
  } catch (error) {
    console.error('Error updating system settings:', error)
    return res.status(500).json({
      success: false,
      message: 'Failed to update system settings',
      error: error.message
    })
  }
}
