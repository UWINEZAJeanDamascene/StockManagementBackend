const mongoose = require('mongoose');

const payrollRunSchema = new mongoose.Schema({
  // Multi-tenancy - company reference
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },

  // Reference number - unique per company
  reference_no: {
    type: String,
    required: true
  },

  // Pay period
  pay_period_start: {
    type: Date,
    required: true
  },
  pay_period_end: {
    type: Date,
    required: true
  },
  payment_date: {
    type: Date,
    required: true
  },

  // Status: draft, posted, reversed
  status: {
    type: String,
    enum: ['draft', 'posted', 'reversed'],
    default: 'draft'
  },

  // Totals
  total_gross: {
    type: Number,
    required: true,
    min: 0
  },
  total_tax: {
    type: Number,
    required: true,
    min: 0
  },
  total_other_deductions: {
    type: Number,
    default: 0
  },
  total_net: {
    type: Number,
    required: true,
    min: 0
  },

  // Account references - required for journal entry
  bank_account_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankAccount',
    required: true
  },
  salary_account_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccounts',
    required: true
    // Must be 6100-series Salaries & Wages account
  },
  tax_payable_account_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccounts',
    required: true
    // Must be 2200-series Tax Payable account
  },
  other_deductions_account_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccounts',
    default: null
    // Required only if total_other_deductions > 0
  },

  // Journal entry reference
  journal_entry_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    default: null
  },
  reversal_journal_entry_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    default: null
  },

  // Notes
  notes: {
    type: String,
    default: null
  },

  // Audit
  posted_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  // Employee lines
  lines: [
    {
      employee_name: { type: String, required: true },
      employee_id: { type: String, required: true },
      gross_salary: { type: Number, required: true },
      tax_deduction: { type: Number, required: true },
      other_deductions: { type: Number, default: 0 },
      rssb_employer: { type: Number, default: 0 },
      net_pay: { type: Number, required: true },
      payroll_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Payroll' }
    }
  ],

  // Count of employee records
  employee_count: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes
payrollRunSchema.index({ company: 1, reference_no: 1 }, { unique: true });
payrollRunSchema.index({ company: 1, payment_date: -1 });
payrollRunSchema.index({ company: 1, status: 1 });

// Prevent duplicate payroll for same period (only for non-reversed)
payrollRunSchema.index(
  { company: 1, pay_period_start: 1, pay_period_end: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $ne: 'reversed' } }
  }
);

// Auto-generate reference number
payrollRunSchema.pre('save', async function(next) {
  if (this.isNew && !this.reference_no) {
    const count = await mongoose.model('PayrollRun').countDocuments({ company: this.company });
    this.reference_no = `PYRL-${String(count + 1).padStart(5, '0')}`;
  }
  next();
});

module.exports = mongoose.model('PayrollRun', payrollRunSchema);
