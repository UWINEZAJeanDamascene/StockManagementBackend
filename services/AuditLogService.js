const AuditLog = require('../models/AuditLog');
const ActionLog = require('../models/ActionLog');

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
      // Ensure `changes` is a plain JSON-serializable object. Convert Mongoose documents,
      // Decimal128, ObjectId and Dates to safe representations to avoid save errors.
      const sanitize = (obj) => {
        if (obj == null) return obj;
        // Primitive types
        if (typeof obj !== 'object') return obj;
        // Handle Mongoose documents with toObject
        if (typeof obj.toObject === 'function') {
          obj = obj.toObject({ depopulate: true });
        }

        // Arrays
        if (Array.isArray(obj)) return obj.map(sanitize);

        const out = {};
        for (const [k, v] of Object.entries(obj)) {
          try {
            if (v == null) {
              out[k] = v;
            } else if (v instanceof Date) {
              out[k] = v.toISOString();
            } else if (v && v._bsontype === 'ObjectID') {
              out[k] = v.toString();
            } else if (v && v.constructor && v.constructor.name === 'Decimal128') {
              out[k] = parseFloat(v.toString());
            } else if (typeof v === 'object') {
              out[k] = sanitize(v);
            } else {
              out[k] = v;
            }
          } catch (e) {
            out[k] = String(v);
          }
        }
        return out;
      };

      const safeChanges = sanitize(changes);

      const created = await AuditLog.create({
        company_id: companyId || null,
        user_id: userId || null,
        action,
        entity_type: entityType,
        entity_id: entityId || null,
        changes: safeChanges,
        ip_address: ipAddress,
        user_agent: userAgent,
        status,
        error_message: errorMessage,
        duration_ms: durationMs
      });

      if (process.env.NODE_ENV !== 'production') {
        try {
          console.log('AuditLog created:', { action, entityType, entityId, companyId, id: created._id });
        } catch (ignore) {}
      }

      // Also mirror into ActionLog for the legacy frontend audit trail UI.
      try {
        // Only create ActionLog when a user is present (ActionLog requires a user)
        if (userId) {
          // Derive module from action (e.g. 'company.update' -> 'company') or from entityType
          let module = null;
          if (action && action.includes('.')) module = action.split('.')[0];
          if (!module && entityType && typeof entityType === 'string') module = entityType.split('_')[0];
          if (!module) module = 'report';

          const actionLogDoc = {
            company: companyId || null,
            user: userId,
            action,
            module,
            targetId: entityId || null,
            targetModel: entityType || null,
            details: { changes: safeChanges },
            ipAddress: ipAddress || null,
            userAgent: userAgent || null,
            status: status === 'failure' ? 'failed' : 'success'
          };

          // Create but don't let failures bubble up
          await ActionLog.create(actionLogDoc);
        }
      } catch (e) {
        console.error('Failed to mirror AuditLog into ActionLog:', e.message);
      }

      return created;
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
