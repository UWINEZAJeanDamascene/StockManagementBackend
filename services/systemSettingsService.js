const SystemSettings = require('../models/SystemSettings')
const AuditLogService = require('./AuditLogService')

class SystemSettingsService {
  /**
   * Get system settings for a company
   * Auto-creates with defaults if not exists
   * @param {string} companyId - Company ID
   * @returns {Object} System settings
   */
  static async get(companyId) {
    let settings = await SystemSettings.findOne({ company_id: companyId }).lean()

    // Auto-create with defaults if not exists
    if (!settings) {
      settings = await SystemSettings.create({ company_id: companyId })
    }

    return settings
  }

  /**
   * Update system settings for a company
   * @param {string} companyId - Company ID
   * @param {Object} data - Settings data to update
   * @param {string} userId - User ID making the change
   * @returns {Object} Updated settings
   */
  static async update(companyId, data, userId) {
    const settings = await SystemSettings.findOneAndUpdate(
      { company_id: companyId },
      { $set: { ...data, last_updated_by: userId } },
      { new: true, upsert: true, runValidators: true }
    ).lean()

    await AuditLogService.log({
      companyId,
      userId,
      action: 'settings.update',
      entity_type: 'system_settings',
      entity_id: settings._id,
      changes: data
    })

    return settings
  }
}

module.exports = SystemSettingsService
