const mongoose = require('mongoose');

const loanPaymentSchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  paymentDate: {
    type: Date,
    default: Date.now
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'bank_transfer', 'cheque', 'mobile_money'],
  },
  reference: String,
  notes: String,
  recordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
});

// Liability Transaction Schema - for tracking drawdowns, repayments, interest charges
const liabilityTransactionSchema = new mongoose.Schema({
  transactionDate: {
    type: Date,
    required: true
  },
  type: {
    type: String,
    enum: ['drawdown', 'repayment', 'interest_charge'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01
  },
  principalPortion: {
    type: Number,
    default: 0
  },
  interestPortion: {
    type: Number,
    default: 0
  },
  bankAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankAccount',
    default: null
  },
  journalEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    default: null
  },
  notes: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

const loanSchema = new mongoose.Schema({
  // Multi-tenancy: company reference
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Loan must belong to a company']
  },
  loanNumber: {
    type: String,
    uppercase: true
  },
  lenderName: {
    type: String,
    trim: true
  },
  lenderContact: String,
  
  // Liability name/description
  name: {
    type: String,
    required: [true, 'Please provide liability name'],
    trim: true
  },
  
  // Loan/Liability type - expanded to include hire_purchase and accrual
  loanType: {
    type: String,
    enum: ['short-term', 'long-term', 'loan', 'hire_purchase', 'accrual', 'other'],
    required: true
  },
  // Legacy alias for compatibility
  type: {
    type: String,
    enum: ['short-term', 'long-term', 'loan', 'hire_purchase', 'accrual', 'other']
  },
  purpose: {
    type: String,
    trim: true
  },
  
  // Financial amounts
  originalAmount: {
    type: Number,
    required: true,
    min: 0.01
  },
  // Outstanding balance - tracked separately
  outstandingBalance: {
    type: Number,
    required: true,
    default: function() { return this.originalAmount; }
  },
  
  // Interest
  interestRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  // Interest calculation method
  interestMethod: {
    type: String,
    enum: ['simple', 'compound'],
    default: 'simple'
  },
  // Duration in months (drives schedule calculation)
  durationMonths: {
    type: Number,
    min: 1
  },
  
  // Account references for journal entries
  liabilityAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccounts',
    required: [true, 'Liability account is required']
  },
  interestExpenseAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChartOfAccounts',
    default: null
  },
  
  // Dates
  startDate: {
    type: Date,
    required: true
  },
  endDate: Date,
  
  // Status
  status: {
    type: String,
    enum: ['active', 'paid-off', 'fully_repaid', 'defaulted', 'cancelled'],
    default: 'active'
  },
  
  // Payment tracking
  amountPaid: {
    type: Number,
    default: 0
  },
  payments: [loanPaymentSchema],
  // New: Liability transactions for drawdowns, repayments, interest
  transactions: [liabilityTransactionSchema],
  
  // Terms
  paymentTerms: {
    type: String,
    enum: ['monthly', 'quarterly', 'annually', 'bullet'],
    default: 'monthly'
  },
  monthlyPayment: Number,
  
  // Security/collateral
  collateral: String,
  notes: String,
  
  // User tracking
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Compound index for company + unique loan number
loanSchema.index({ company: 1, loanNumber: 1 }, { unique: true });
loanSchema.index({ company: 1 });
loanSchema.index({ company: 1, status: 1 });

// Auto-generate loan number
loanSchema.pre('save', async function(next) {
  if (this.isNew && !this.loanNumber) {
    const count = await mongoose.model('Loan').countDocuments({ company: this.company });
    this.loanNumber = `LN-${String(count + 1).padStart(5, '0')}`;
  }
  // Set outstandingBalance to originalAmount if not set
  if (this.isNew && !this.outstandingBalance) {
    this.outstandingBalance = this.originalAmount;
  }
  next();
});

// Virtual for remaining balance (alias for outstandingBalance)
loanSchema.virtual('remainingBalance').get(function() {
  return this.outstandingBalance || (this.originalAmount - this.amountPaid);
});

// Virtual for next payment due (simplified)
loanSchema.virtual('nextPaymentDue').get(function() {
  if (this.status !== 'active' || !this.startDate) return null;
  // Simplified calculation - in real system would track actual schedule
  const nextDate = new Date(this.startDate);
  const monthsPaid = this.amountPaid / (this.monthlyPayment || 1);
  nextDate.setMonth(nextDate.getMonth() + Math.ceil(monthsPaid) + 1);
  return nextDate;
});

loanSchema.set('toJSON', { virtuals: true });
loanSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Loan', loanSchema);
