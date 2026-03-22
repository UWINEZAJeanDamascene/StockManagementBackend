const mongoose = require('mongoose');

const exchangeRateSchema = new mongoose.Schema({
  company_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },
  from_currency: {
    type: String,
    required: true,
    uppercase: true
    // The foreign currency
  },
  to_currency: {
    type: String,
    required: true,
    uppercase: true
    // Always the company base currency (e.g. RWF)
  },
  rate: {
    type: Number,
    required: true,
    min: 0.000001
    // 1 unit of from_currency = rate units of to_currency
    // e.g. 1 USD = 1285.50 RWF
  },
  effective_date: {
    type: Date,
    required: true
    // Rate is valid from this date until a newer rate is set
  },
  source: {
    type: String,
    enum: ['manual', 'api', 'import'],
    default: 'manual'
  },
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

// One rate per currency pair per date per company — fast lookup for getRate
exchangeRateSchema.index(
  { company_id: 1, from_currency: 1, effective_date: -1 }
);

module.exports = mongoose.model('ExchangeRate', exchangeRateSchema);
