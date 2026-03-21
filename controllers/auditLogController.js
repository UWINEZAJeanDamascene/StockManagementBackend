const AuditLogService = require('../services/AuditLogService');
const AuditLog = require('../models/AuditLog');

/**
 * Audit Log Controller
 * Provides endpoints for querying audit logs
 */
class AuditLogController {

  /**
   * POST /api/audit-logs
   * Create a new audit log entry manually
   */
  static async createAuditLog(req, res) {
    try {
      const companyId = req.company?._id || req.company;
      
      const { action, entity_type, entity_id, changes, status, error_message, duration_ms } = req.body;

      // Validate required fields
      if (!action) {
        return res.status(400).json({
          success: false,
          error: 'ACTION_REQUIRED',
          message: 'action is required'
        });
      }

      if (!entity_type) {
        return res.status(400).json({
          success: false,
          error: 'ENTITY_TYPE_REQUIRED',
          message: 'entity_type is required'
        });
      }

      // Fire-and-forget - but we need to wait for this in tests
      const logEntry = await AuditLog.create({
        company_id: companyId,
        user_id: req.userId || req.user?._id || null,
        action,
        entity_type: entity_type,
        entity_id: entity_id || null,
        changes,
        ip_address: req.ip || req.connection?.remoteAddress || null,
        user_agent: req.headers['user-agent'],
        status: status || 'success',
        error_message: error_message || null,
        duration_ms: duration_ms || null
      });

      res.status(201).json({
        success: true,
        data: logEntry
      });
    } catch (error) {
      console.error('AuditLogController.createAuditLog error:', error);
      res.status(500).json({
        success: false,
        error: 'CREATE_FAILED',
        message: error.message
      });
    }
  }

  /**
   * GET /api/audit-logs
   * Query audit logs with filters
   * Filters: user_id, action, entity_type, date_from, date_to, status
   */
  static async getAuditLogs(req, res) {
    try {
      const companyId = req.company?._id || req.company;
      
      if (!companyId) {
        return res.status(400).json({
          success: false,
          error: 'COMPANY_REQUIRED'
        });
      }

      const {
        user_id,
        action,
        entity_type,
        entity_id,
        date_from,
        date_to,
        status,
        page = 1,
        per_page = 50
      } = req.query;

      const filters = {
        userId: user_id,
        action,
        entityType: entity_type,
        entityId: entity_id,
        dateFrom: date_from,
        dateTo: date_to,
        status
      };

      const options = {
        page: parseInt(page) || 1,
        perPage: parseInt(per_page) || 50
      };

      const result = await AuditLogService.query(companyId, filters, options);

      res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination
      });
    } catch (error) {
      console.error('AuditLogController.getAuditLogs error:', error);
      res.status(500).json({
        success: false,
        error: 'QUERY_FAILED',
        message: error.message
      });
    }
  }

  /**
   * GET /api/audit-logs/entity/:type/:id
   * Get full history for a specific record
   */
  static async getEntityHistory(req, res) {
    try {
      const companyId = req.company?._id || req.company;
      
      if (!companyId) {
        return res.status(400).json({
          success: false,
          error: 'COMPANY_REQUIRED'
        });
      }

      const { type, id } = req.params;

      if (!type || !id) {
        return res.status(400).json({
          success: false,
          error: 'ENTITY_TYPE_AND_ID_REQUIRED'
        });
      }

      const logs = await AuditLogService.getEntityHistory(companyId, type, id);

      res.status(200).json({
        success: true,
        data: logs,
        count: logs.length
      });
    } catch (error) {
      console.error('AuditLogController.getEntityHistory error:', error);
      res.status(500).json({
        success: false,
        error: 'QUERY_FAILED',
        message: error.message
      });
    }
  }
}

module.exports = AuditLogController;
