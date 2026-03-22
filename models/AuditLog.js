const mongoose = require('mongoose');
const { Schema } = mongoose;

const auditLogSchema = new mongoose.Schema({
  company_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    // null for system-level actions (login, company creation)
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  action: {
    type: String,
    required: true,
    // Format: 'resource.verb' e.g. 'invoice.confirm', 'period.close'
  },
  entity_type: {
    type: String,
    required: true
    // e.g. 'sales_invoice', 'journal_entry', 'user'
  },
  entity_id: {
    type: Schema.Types.Mixed,  // Can be ObjectId or string for flexible entity tracking
    default: null,
  },
  changes: {
    type: mongoose.Schema.Types.Mixed,
    default: null
    // JSON diff of what changed — before/after for updates
  },
  ip_address: {
    type: String,
    default: null
  },
  user_agent: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['success', 'failure'],
    default: 'success'
  },
  error_message: {
    type: String,
    default: null
    // Set when status = failure
  },
  duration_ms: {
    type: Number,
    default: null
    // How long the operation took
  }
}, {
  timestamps: true
  // createdAt = when the action happened
});

// Indexes for common audit queries
auditLogSchema.index({ company_id: 1, createdAt: -1 });
auditLogSchema.index({ company_id: 1, user_id: 1, createdAt: -1 });
auditLogSchema.index({ company_id: 1, entity_type: 1, entity_id: 1 });
auditLogSchema.index({ company_id: 1, action: 1 });

// TTL index — auto-delete audit logs older than 7 years (regulatory requirement)
auditLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 365 * 7 }
);

module.exports = mongoose.model('AuditLog', auditLogSchema);
