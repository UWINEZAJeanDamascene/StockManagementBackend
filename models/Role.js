const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema({
  company_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null
    // null = system role (applies to all companies)
    // set = custom role for a specific company
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true,
    default: null
  },
  is_system_role: {
    type: Boolean,
    default: false
    // System roles cannot be deleted or modified
  },
  permissions: [{
    resource: {
      type: String,
      required: true
      // e.g. 'products', 'invoices', 'journal_entries', 'reports'
    },
    actions: {
      type: [String],
      default: []
      // e.g. ['read', 'create', 'update', 'delete', 'approve', 'post']
    }
  }]
}, {
  timestamps: true
});

// Index for efficient queries
roleSchema.index({ company_id: 1, name: 1 });

// Virtual for backward compatibility - map company_id to company
roleSchema.virtual('company').get(function() {
  return this.company_id;
});

roleSchema.set('toJSON', { virtuals: true });
roleSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Role', roleSchema);
