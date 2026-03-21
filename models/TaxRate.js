const mongoose = require('mongoose');

const taxRateSchema = new mongoose.Schema({
  company: {
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
  code: {
    type: String,
    required: true,
    uppercase: true,
    trim: true
  },
  rate_pct: {
    type: Number,
    required: true,
    min: 0
  },
  type: {
    type: String,
    enum: ['vat', 'sales_tax', 'withholding', 'exempt', 'zero_rated'],
    required: true
  },
  input_account_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccounts',
    required: true
  },
  output_account_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccounts',
    required: true
  },
  // Account code strings for quick lookup in journal entries
  input_account_code: {
    type: String,
    required: true
  },
  output_account_code: {
    type: String,
    required: true
  },
  is_active: {
    type: Boolean,
    default: true
  },
  effective_from: {
    type: Date,
    required: true
  },
  effective_to: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// code unique per company — not globally
taxRateSchema.index({ company: 1, code: 1 }, { unique: true });
taxRateSchema.index({ company: 1, is_active: 1 });

const TaxRate = mongoose.model('TaxRate', taxRateSchema);

module.exports = TaxRate;
