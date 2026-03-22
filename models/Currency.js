const mongoose = require('mongoose');

const currencySchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    unique: true
    // ISO 4217: USD, EUR, GBP, KES, UGX, TZS, RWF
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  symbol: {
    type: String,
    trim: true,
    default: null
    // e.g. $, €, £, Ksh
  },
  decimal_places: {
    type: Number,
    default: 2
    // Some currencies have 0 decimal places (e.g. JPY)
  },
  is_active: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Currency', currencySchema);
