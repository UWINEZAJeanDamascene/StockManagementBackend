const express = require('express');
const router = express.Router();
const AuditLogController = require('../controllers/auditLogController');

/**
 * Audit Log Routes
 * Base path: /api/audit-logs
 */

/**
 * POST /api/audit-logs
 * Create a new audit log entry manually
 * Body:
 *   - action: Action name (e.g., 'invoice.confirm')
 *   - entity_type: Entity type (e.g., 'sales_invoice')
 *   - entity_id: Entity ID (optional)
 *   - changes: Changes object (optional)
 *   - status: 'success' or 'failure' (default: 'success')
 *   - error_message: Error message if failed (optional)
 *   - duration_ms: Duration in milliseconds (optional)
 */
router.post('/', AuditLogController.createAuditLog);

/**
 * GET /api/audit-logs
 * Query audit logs with filters
 * Filters:
 *   - user_id: Filter by user ID
 *   - action: Filter by action (e.g., 'invoice.confirm')
 *   - entity_type: Filter by entity type (e.g., 'sales_invoice')
 *   - entity_id: Filter by specific entity ID
 *   - date_from: Start date (ISO format)
 *   - date_to: End date (ISO format)
 *   - status: 'success' or 'failure'
 * Pagination:
 *   - page: Page number (default: 1)
 *   - per_page: Items per page (default: 50)
 */
router.get('/', AuditLogController.getAuditLogs);

/**
 * GET /api/audit-logs/entity/:type/:id
 * Get full history for a specific entity
 * Parameters:
 *   - type: Entity type (e.g., 'sales_invoice', 'journal_entry')
 *   - id: Entity ID
 */
router.get('/entity/:type/:id', AuditLogController.getEntityHistory);

module.exports = router;
