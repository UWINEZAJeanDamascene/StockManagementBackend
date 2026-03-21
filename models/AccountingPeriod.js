const mongoose = require('mongoose');

const accountingPeriodSchema = new mongoose.Schema({
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
    // e.g. 'July 2025', 'Q1 FY2025'
  },
  period_type: {
    type: String,
    enum: ['month', 'quarter', 'year'],
    required: true,
    default: 'month'
  },
  start_date: {
    type: Date,
    required: true
  },
  end_date: {
    type: Date,
    required: true
  },
  fiscal_year: {
    type: Number,
    required: true
    // e.g. 2025 — the fiscal year this period belongs to
  },
  status: {
    type: String,
    enum: ['open', 'closed', 'locked'],
    default: 'open'
    // open   = journal entries can be posted
    // closed = no new entries, but reports can be run
    // locked = period archived, cannot be reopened
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
  year_end_close_entry_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    default: null
    // Set when year-end close journal entry is posted
  },
  is_year_end: {
    type: Boolean,
    default: false
    // True for the last period of a fiscal year
  }
}, {
  timestamps: true
});

// One period per date range per company
accountingPeriodSchema.index(
  { company_id: 1, start_date: 1, end_date: 1 },
  { unique: true }
);
accountingPeriodSchema.index({ company_id: 1, status: 1 });
accountingPeriodSchema.index({ company_id: 1, fiscal_year: 1 });

module.exports = mongoose.model('AccountingPeriod', accountingPeriodSchema);
