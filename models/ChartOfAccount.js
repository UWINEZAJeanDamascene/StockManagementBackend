const mongoose = require('mongoose');

const chartOfAccountSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  code: { type: String, required: true },
  name: { type: String, required: true },
  type: { 
    type: String, 
    enum: ['asset', 'liability', 'equity', 'revenue', 'expense', 'cogs'],
    default: 'asset' 
  },
  subtype: { type: String, default: null },
  // Normal balance direction - critical for financial reports
  normal_balance: {
    type: String,
    enum: ['debit', 'credit'],
    default: 'debit'
  },
  // Hierarchy support
  parent_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'ChartOfAccount', 
    default: null 
  },
  // Whether transactions can be posted directly to this account
  allow_direct_posting: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

chartOfAccountSchema.index({ company: 1, code: 1 }, { unique: true });
chartOfAccountSchema.index({ company: 1, type: 1 });
chartOfAccountSchema.index({ company: 1, parent_id: 1 });

// Set default normal_balance based on account type
chartOfAccountSchema.pre('save', function(next) {
  if (!this.normal_balance) {
    if (['asset', 'expense', 'cogs'].includes(this.type)) {
      this.normal_balance = 'debit';
    } else {
      this.normal_balance = 'credit';
    }
  }

  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('ChartOfAccount', chartOfAccountSchema);
