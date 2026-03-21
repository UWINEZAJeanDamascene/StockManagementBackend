const AuditLogService = require('../services/AuditLogService');

/**
 * Audit Middleware — Auto-log All Requests
 * Attach to routes that need automatic request logging
 * @param {string} action - Action name (e.g., 'invoice.confirm', 'period.close')
 * @param {string} entityType - Entity type (e.g., 'sales_invoice', 'journal_entry')
 */
const auditRequest = (action, entityType) => {
  return async (req, res, next) => {
    const start = Date.now();

    // Intercept response to capture status
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const duration = Date.now() - start;
      const success = res.statusCode < 400;

      // Fire and forget — do not block response
      AuditLogService.log({
        companyId: req.companyId || req.company?._id || null,
        userId: req.userId || req.user?._id || null,
        action,
        entityType,
        entityId: req.params.id || body?._id || body?.id || null,
        changes: success ? req.body : null,
        ipAddress: req.ip || req.connection?.remoteAddress || null,
        userAgent: req.headers['user-agent'],
        status: success ? 'success' : 'failure',
        errorMessage: success ? null : body?.error || body?.message || null,
        durationMs: duration
      }).catch(() => {});

      return originalJson(body);
    };

    next();
  };
};

module.exports = auditRequest;
