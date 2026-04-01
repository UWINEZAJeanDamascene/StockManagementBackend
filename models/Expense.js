const mongoose = require('mongoose');

const expenseItemSchema = new mongoose.Schema({
  description: {
    type: String,
    trim: true,
    default: ''
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  date: {
    type: Date,
    default: Date.now
  },
  reference: String,
  notes: String
});

const expenseSchema = new mongoose.Schema({
  // Multi-tenancy: company reference (keeping existing pattern)
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Expense must belong to a company'],
    index: true
  },

  // Reference number - unique per company
  reference_no: {
    type: String
  },

  // Expense date
  expense_date: {
    type: Date,
    required: true
  },

  // Description
  description: {
    type: String,
    required: true,
    trim: true
  },

  // Expense account (ChartOfAccounts reference)
  expense_account_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    required: true
  },

  // Amount (net of tax)
  amount: {
    type: Number,
    required: true,
    min: 0.01
  },

  // Tax amount (VAT input)
  tax_amount: {
    type: Number,
    default: 0
  },

  // Total amount (including tax)
  total_amount: {
    type: Number,
    required: true
  },

  // Tax account for input VAT
  tax_account_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccount',
    default: null
  },

  // Payment method: bank, petty_cash, credit_card, payable
  payment_method: {
    type: String,
    enum: ['bank', 'cash', 'bank_transfer', 'cheque', 'mobile_money', 'credit_card', 'petty_cash', 'payable'],
    required: true
  },

  // Bank account (required when payment_method = 'bank')
  bank_account_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankAccount',
    default: null
  },

  // Petty cash fund (required when payment_method = 'petty_cash')
  petty_cash_fund_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PettyCashFund',
    default: null
  },

  // Supplier reference
  supplier_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    default: null
  },

  // Receipt reference
  receipt_ref: {
    type: String,
    default: null
  },

  // Status: pending, approved, rejected, posted, reversed, cancelled
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'posted', 'reversed', 'cancelled'],
    default: 'pending'
  },

  // Approval tracking
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  approvedAt: {
    type: Date,
    default: null
  },
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  rejectedAt: {
    type: Date,
    default: null
  },
  rejectionReason: {
    type: String,
    default: null
  },

  // Journal entry for the expense
  journal_entry_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    default: null
  },

  // Reversal journal entry
  reversal_journal_entry_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    default: null
  },

  // Posted by user
  posted_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Legacy fields - keeping for backward compatibility
  // Expense type/category (kept for reporting)
  type: {
    type: String,
    enum: [
      'salaries_wages',
      'rent',
      'utilities',
      'transport_delivery',
      'marketing_advertising',
      'other_expense',
      'interest_income',
      'other_income',
      'other_expense_income'
    ],
    default: 'other_expense'
  },

  // For backward compatibility - category name
  category: {
    type: String,
    default: function() {
      return this.type;
    }
  },

  // Reference number (legacy)
  expenseNumber: {
    type: String,
    uppercase: true
  },

  // Date (legacy)
  expenseDate: {
    type: Date
  },

  // Period for reporting (monthly)
  period: {
    type: String, // Format: YYYY-MM
    index: true
  },

  // Payment info (legacy)
  paymentMethod: {
    type: String,
    enum: ['bank', 'cash', 'bank_transfer', 'cheque', 'mobile_money', 'credit_card', 'petty_cash', 'payable'],
    default: 'bank'
  },
  paid: {
    type: Boolean,
    default: false
  },
  paidDate: Date,

  // Recurring
  isRecurring: {
    type: Boolean,
    default: false
  },
  recurringFrequency: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
    default: 'monthly'
  },

  // User tracking (legacy)
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Notes
  notes: String,

  // Attachments/references
  attachments: [{
    name: String,
    url: String
  }]
}, {
  timestamps: true
});

// Compound indexes for efficient queries
expenseSchema.index({ company: 1, reference_no: 1 }, { unique: true });
expenseSchema.index({ company: 1, expense_date: -1 });
expenseSchema.index({ company: 1, expense_account_id: 1 });
expenseSchema.index({ company: 1, payment_method: 1 });
expenseSchema.index({ company: 1, type: 1 });
expenseSchema.index({ company: 1, status: 1 });

// Auto-generate reference number
expenseSchema.pre('save', async function(next) {
  if (this.isNew && !this.reference_no) {
    const count = await mongoose.model('Expense').countDocuments({ company: this.company });
    this.reference_no = `EXP-${String(count + 1).padStart(5, '0')}`;
  }
  
  // Set period from expense_date
  if (this.expense_date) {
    const year = this.expense_date.getFullYear();
    const month = String(this.expense_date.getMonth() + 1).padStart(2, '0');
    this.period = `${year}-${month}`;
  }

  // Set total_amount if not set
  if (this.isNew && !this.total_amount && this.amount !== undefined) {
    this.total_amount = this.amount + (this.tax_amount || 0);
  }
  
  // Sync legacy fields
  if (this.isNew) {
    if (!this.expenseNumber) this.expenseNumber = this.reference_no;
    if (!this.expenseDate) this.expenseDate = this.expense_date;
    if (!this.createdBy) this.createdBy = this.posted_by;
  }
  
  next();
});

// Static method to get expenses by type for a period
expenseSchema.statics.getByTypeAndPeriod = async function(companyId, type, startDate, endDate) {
  const match = {
    company: companyId,
    type: type,
    status: { $ne: 'reversed' }
  };
  
  if (startDate || endDate) {
    match.expense_date = {};
    if (startDate) match.expense_date.$gte = startDate;
    if (endDate) match.expense_date.$lte = endDate;
  }
  
  const expenses = await this.find(match);
  const total = expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
  
  return { expenses, total };
};

// Static method to get all operating expenses for a period
expenseSchema.statics.getOperatingExpenses = async function(companyId, startDate, endDate) {
  const operatingTypes = [
    'salaries_wages',
    'rent',
    'utilities',
    'transport_delivery',
    'marketing_advertising',
    'other_expense'
  ];
  
  const result = {};
  let totalOperatingExpenses = 0;
  
  for (const type of operatingTypes) {
    const { total } = await this.getByTypeAndPeriod(companyId, type, startDate, endDate);
    const key = type.replace(/_([a-z])/g, (m, p1) => p1.toUpperCase());
    result[key] = total;
    totalOperatingExpenses += total;
  }
  
  return { ...result, total: totalOperatingExpenses };
};

// Static method to get other income/expenses for a period
expenseSchema.statics.getOtherIncomeExpenses = async function(companyId, startDate, endDate) {
  const result = {
    interestIncome: 0,
    otherIncome: 0,
    otherExpense: 0,
    netOtherIncome: 0
  };
  
  // Interest Income
  const interestIncomeData = await this.getByTypeAndPeriod(companyId, 'interest_income', startDate, endDate);
  result.interestIncome = interestIncomeData.total;
  
  // Other Income
  const otherIncomeData = await this.getByTypeAndPeriod(companyId, 'other_income', startDate, endDate);
  result.otherIncome = otherIncomeData.total;
  
  // Other Expense (from income statement perspective)
  const otherExpenseData = await this.getByTypeAndPeriod(companyId, 'other_expense_income', startDate, endDate);
  result.otherExpense = otherExpenseData.total;
  
  // Net Other Income = Interest Income + Other Income - Other Expense
  result.netOtherIncome = result.interestIncome + result.otherIncome - result.otherExpense;
  
  return result;
};

module.exports = mongoose.model('Expense', expenseSchema);
