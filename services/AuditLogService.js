const AuditLog = require('../models/AuditLog');

/**
 * AuditLogService - Records all CRUD operations with user + timestamp
 * 
 * Every create, update, delete, and financial action in the system must be recorded
 * with who did it, when, from which IP address, and what changed.
 * This is legally required for financial systems and essential for debugging.
 */
class AuditLogService {

  /**
   * Called from every service that modifies data
   * Fire-and-forget — never await this in a transaction
   * @param {object} params
   * @param {string} params.companyId - Company ID (null for system-level actions)
   * @param {string} params.userId - User ID who performed the action
   * @param {string} params.action - Action type (format: 'resource.verb' e.g. 'invoice.confirm')
   * @param {string} params.entityType - Type of entity (e.g. 'sales_invoice', 'journal_entry')
   * @param {string} params.entityId - ID of the entity
   * @param {object} params.changes - JSON diff of what changed
   * @param {string} params.ipAddress - IP address of the request
   * @param {string} params.userAgent - User agent string
   * @param {string} params.status - 'success' or 'failure'
   * @param {string} params.errorMessage - Error message if status = failure
   * @param {number} params.durationMs - How long the operation took
   */
  static async log({
    companyId,
    userId,
    action,
    entityType,
    entityId,
    changes = null,
    ipAddress = null,
    userAgent = null,
    status = 'success',
    errorMessage = null,
    durationMs = null
  }) {
    try {
      await AuditLog.create({
        company_id: companyId || null,
        user_id: userId || null,
        action,
        entity_type: entityType,
        entity_id: entityId || null,
        changes,
        ip_address: ipAddress,
        user_agent: userAgent,
        status,
        error_message: errorMessage,
        duration_ms: durationMs
      });
    } catch (err) {
      // Never let audit log failure break the main operation
      console.error('AuditLog write failed:', err.message);
    }
  }

  /**
   * Query audit logs with filters
   * @param {string} companyId - Company ID
   * @param {object} filters - Filter options
   * @param {string} filters.userId - Filter by user ID
   * @param {string} filters.action - Filter by action
   * @param {string} filters.entityType - Filter by entity type
   * @param {string} filters.entityId - Filter by entity ID
   * @param {string} filters.dateFrom - Start date
   * @param {string} filters.dateTo - End date
   * @param {string} filters.status - Filter by status (success/failure)
   * @param {object} options - Pagination options
   * @param {number} options.page - Page number (default: 1)
   * @param {number} options.perPage - Items per page (default: 50)
   */
  static async query(companyId, filters = {}, options = {}) {
    const {
      userId,
      action,
      entityType,
      entityId,
      dateFrom,
      dateTo,
      status
    } = filters;

    const match = { company_id: companyId };
    
    if (userId) match.user_id = userId;
    if (action) match.action = action;
    if (entityType) match.entity_type = entityType;
    if (entityId) match.entity_id = entityId;
    if (status) match.status = status;
    
    if (dateFrom || dateTo) {
      match.createdAt = {};
      if (dateFrom) match.createdAt.$gte = new Date(dateFrom);
      if (dateTo) match.createdAt.$lte = new Date(dateTo);
    }

    const page = options.page || 1;
    const perPage = options.perPage || 50;
    const skip = (page - 1) * perPage;

    const [logs, total] = await Promise.all([
      AuditLog.find(match)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(perPage)
        .populate('user_id', 'first_name last_name email')
        .lean(),
      AuditLog.countDocuments(match)
    ]);

    return {
      data: logs,
      pagination: {
        page,
        per_page: perPage,
        total,
        total_pages: Math.ceil(total / perPage)
      }
    };
  }

  /**
   * Get full history for a specific record
   * @param {string} companyId - Company ID
   * @param {string} entityType - Entity type
   * @param {string} entityId - Entity ID
   */
  static async getEntityHistory(companyId, entityType, entityId) {
    return AuditLog.find({
      company_id: companyId,
      entity_type: entityType,
      entity_id: entityId
    })
      .sort({ createdAt: 1 })
      .populate('user_id', 'first_name last_name email')
      .lean();
  }
}

module.exports = AuditLogService;
