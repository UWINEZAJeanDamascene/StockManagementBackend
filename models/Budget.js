const mongoose = require('mongoose');

const budgetSchema = new mongoose.Schema({
  company_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  type: {
    type: String,
    enum: ['revenue', 'expense', 'profit'],
    default: 'expense'
  },
  fiscal_year: {
    type: Number,
    required: true
  },
  periodStart: {
    type: Date,
    default: null
  },
  periodEnd: {
    type: Date,
    default: null
  },
  periodType: {
    type: String,
    enum: ['monthly', 'quarterly', 'yearly', 'custom'],
    default: 'yearly'
  },
  amount: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'approved', 'closed', 'cancelled', 'locked'],
    default: 'draft'
  },
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  approved_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  approved_at: {
    type: Date,
    default: null
  },
  locked_at: {
    type: Date,
    default: null
  },
  rejected_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  rejected_at: {
    type: Date,
    default: null
  },
  rejectionReason: {
    type: String,
    trim: true,
    default: ''
  },
  closed_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  closed_at: {
    type: Date,
    default: null
  },
  closeNotes: {
    type: String,
    trim: true,
    default: ''
  },
  notes: {
    type: String,
    trim: true,
    default: ''
  }
}, {
  timestamps: true
});

// One budget per fiscal year per company (can have multiple but track by name)
budgetSchema.index({ company_id: 1, fiscal_year: 1, name: 1 }, { unique: true });
budgetSchema.index({ company_id: 1, status: 1 });
budgetSchema.index({ company_id: 1, type: 1 });
budgetSchema.index({ company_id: 1, department: 1 });
budgetSchema.index({ company_id: 1, periodStart: 1, periodEnd: 1 });

module.exports = mongoose.model('Budget', budgetSchema);
