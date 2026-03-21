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
  fiscal_year: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['draft', 'approved', 'locked'],
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
  }
}, {
  timestamps: true
});

// One budget per fiscal year per company (can have multiple but track by name)
budgetSchema.index({ company_id: 1, fiscal_year: 1, name: 1 }, { unique: true });
budgetSchema.index({ company_id: 1, status: 1 });

module.exports = mongoose.model('Budget', budgetSchema);
