const mongoose = require('mongoose');

const budgetLineSchema = new mongoose.Schema({
  company_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
  },
  budget_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Budget',
    required: true,
  },
  account_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    required: true
  },
  category: {
    type: String,
    trim: true,
    default: ''
  },
  period_month: {
    type: Number,
    required: true,
    min: 1,
    max: 12
  },
  period_year: {
    type: Number,
    required: true
  },
  budgeted_amount: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    default: 0
  },
  notes: {
    type: String,
    trim: true,
    default: ''
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
budgetLineSchema.index({ company_id: 1, budget_id: 1, period_year: 1, period_month: 1 });
budgetLineSchema.index({ company_id: 1, account_id: 1, period_year: 1, period_month: 1 });
budgetLineSchema.index({ company_id: 1, budget_id: 1, account_id: 1 }, { unique: true });

module.exports = mongoose.model('BudgetLine', budgetLineSchema);
