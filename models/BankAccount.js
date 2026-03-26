const mongoose = require('mongoose');
const { aggregateWithTimeout } = require('../utils/mongoAggregation');

// Bank Statement Line Schema (for reconciliation)
const bankStatementLineSchema = new mongoose.Schema({
  // Bank account reference
  bankAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankAccount',
    required: true,
    index: true
  },
  // Transaction date
  transactionDate: {
    type: Date,
    required: true,
    index: true
  },
  // Description from bank
  description: {
    type: String,
    required: true
  },
  // Money out (debit)
  debitAmount: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    get: function(value) {
      return value ? parseFloat(value.toString()) : 0;
    }
  },
  // Money in (credit)
  creditAmount: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    get: function(value) {
      return value ? parseFloat(value.toString()) : 0;
    }
  },
  // Running balance per statement (nullable - computed if not provided in CSV)
  // Per spec: computed as running_balance = opening_balance + credit - debit
  balance: {
    type: mongoose.Schema.Types.Decimal128,
    required: false,  // Nullable - can be computed during import
    get: function(value) {
      return value ? parseFloat(value.toString()) : null;
    }
  },
  // Reference number
  reference: {
    type: String,
    maxlength: 150,
    default: null
  },
  // Is reconciled - TRUE when SUM(matched amounts) = statement line amount (exact match)
  isReconciled: {
    type: Boolean,
    default: false
  },
  // Total matched amount from junction table (for reconciliation check)
  matchedAmount: {
    type: mongoose.Schema.Types.Decimal128,
    required: false,
    default: null,
    get: function(value) {
      return value ? parseFloat(value.toString()) : null;
    }
  },
  // When imported
  importedAt: {
    type: Date,
    default: Date.now
  },
  // Company (tenant)
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

// Index for reconciliation queries
bankStatementLineSchema.index({ bankAccount: 1, transactionDate: 1 });
bankStatementLineSchema.index({ bankAccount: 1, isReconciled: 1 });

// Bank Reconciliation Match Junction Table Schema
// Supports many-to-one and one-to-many matching
const bankReconciliationMatchSchema = new mongoose.Schema({
  // Bank statement line reference
  bankStatementLine: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankStatementLine',
    required: true,
    index: true
  },
  // Journal entry line reference (not entry - specifically the line)
  journalEntryLineId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  // Journal entry reference (for easier querying)
  journalEntry: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    required: true,
    index: true
  },
  // Bank account reference
  bankAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankAccount',
    required: true,
    index: true
  },
  // Company (tenant)
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },
  // Who matched this
  matchedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Amount matched in this specific match
  matchedAmount: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    get: function(value) {
      return value ? parseFloat(value.toString()) : 0;
    }
  },
  // When matched
  matchedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

// Compound unique index - same match can't be created twice
bankReconciliationMatchSchema.index({ bankStatementLine: 1, journalEntryLineId: 1 }, { unique: true });

// Bank Account Transaction Schema (for tracking all movements - existing)
const bankTransactionSchema = new mongoose.Schema({
  // Bank account reference (required to link transaction to specific account)
  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankAccount',
    required: [true, 'Transaction must be linked to a bank account']
  },
  // Transaction type
  type: {
    type: String,
    enum: ['deposit', 'withdrawal', 'transfer_in', 'transfer_out', 'adjustment', 'opening', 'closing'],
    required: true
  },
  // Amount
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  // Balance after transaction
  balanceAfter: {
    type: Number,
    required: true
  },
  // Reference to related document
  reference: {
    type: mongoose.Schema.Types.ObjectId
  },
  referenceType: {
    type: String,
    enum: ['Invoice', 'Expense', 'Purchase', 'PettyCashFloat', 'PettyCashExpense', 'PettyCashReplenishment', 'Loan', 'Payment', null],
    default: null
  },
  // Description
  description: {
    type: String,
    trim: true
  },
  // Date
  date: {
    type: Date,
    default: Date.now
  },
  // Payment method (for incoming payments)
  paymentMethod: {
    type: String,
    enum: ['cash', 'bank_transfer', 'cheque', 'mobile_money', 'card', 'other'],
    default: 'bank_transfer'
  },
  // Reference/cheque number
  referenceNumber: String,
  // Status
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'reversed'],
    default: 'completed'
  },
  // Created by
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Notes
  notes: String,
  // Attachments
  attachments: [{
    name: String,
    url: String
  }]
}, {
  timestamps: true
});

// Bank Account Schema (updated per Module 3.2)
const bankAccountSchema = new mongoose.Schema({
  // Company reference
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Bank account must belong to a company'],
    index: true
  },
  
  // === Core Fields per Module 3.2 ===
  
  // Account name (e.g. "Main Operating Account")
  name: {
    type: String,
    required: [true, 'Please provide an account name'],
    trim: true,
    maxlength: 150
  },
  
  // Actual bank account number
  accountNumber: {
    type: String,
    maxlength: 50,
    default: null,
    trim: true
  },
  
  // Bank name
  bankName: {
    type: String,
    maxlength: 100,
    default: null,
    trim: true
  },
  
  // Currency code (ISO 4217)
  currencyCode: {
    type: String,
    required: true,
    default: 'USD',
    maxlength: 3
  },
  
  // Ledger account ID (maps to 1100-series account)
  ledgerAccountId: {
    type: String,  // Could be ObjectId ref to ChartOfAccounts or account code string
    default: '1100'
  },
  
  // Opening balance at system go-live
  openingBalance: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    default: 0,
    get: function(value) {
      return value ? parseFloat(value.toString()) : 0;
    }
  },
  
  // Opening balance date
  openingBalanceDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  
  // Is active
  isActive: {
    type: Boolean,
    required: true,
    default: true
  },
  
  // Is default (only one default allowed per company)
  isDefault: {
    type: Boolean,
    required: true,
    default: false
  },
  
  // === Additional Existing Fields ===
  
  // Account type (kept for backwards compatibility)
  accountType: {
    type: String,
    enum: ['bk_bank', 'equity_bank', 'im_bank', 'cogebanque', 'ecobank', 'mtn_momo', 'airtel_money', 'cash_in_hand'],
    default: 'bk_bank'
  },
  
  // Branch (for bank accounts)
  branch: {
    type: String,
    trim: true
  },
  
  // SWIFT/IBAN code
  swiftCode: String,
  
  // Cached balance - computed from journal entries per spec 3.3
  // Uses dirty flag pattern: cacheValid=FALSE means recompute needed
  cachedBalance: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    get: function(value) {
      return value ? parseFloat(value.toString()) : 0;
    }
  },
  // Cache validity flag - TRUE means cachedBalance is valid, FALSE means recompute
  cacheValid: {
    type: Boolean,
    default: false
  },
  // Timestamp when cache was last computed
  cacheLastComputed: {
    type: Date,
    default: null
  },
  
  // Minimum/Target balance
  targetBalance: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    get: function(value) {
      return value ? parseFloat(value.toString()) : 0;
    }
  },
  
  // Account holder name (for mobile money)
  holderName: String,
  
  // Status for reconciliation
  lastReconciledAt: Date,
  lastReconciledBalance: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    get: function(value) {
      return value ? parseFloat(value.toString()) : 0;
    }
  },
  
  // Notes
  notes: String,
  
  // Color for UI identification
  color: {
    type: String,
    default: '#3B82F6'
  },
  
  // Icon for UI
  icon: {
    type: String,
    default: 'bank'
  },
  
  // Created by (who created this account)
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

// Indexes for efficient queries
bankAccountSchema.index({ company: 1, isActive: 1 });
bankAccountSchema.index({ company: 1, accountType: 1 });
bankAccountSchema.index({ company: 1, isDefault: 1 });
bankTransactionSchema.index({ company: 1, account: 1, date: -1 });
bankTransactionSchema.index({ company: 1, reference: 1 });

// Transform for JSON serialization - ensures Decimal128 fields are converted to numbers
bankTransactionSchema.set('toJSON', {
  transform: function(doc, ret) {
    // Convert Decimal128 fields to numbers
    if (ret.amount && ret.amount.$numberDecimal) {
      ret.amount = parseFloat(ret.amount.$numberDecimal);
    }
    if (ret.balanceAfter && ret.balanceAfter.$numberDecimal) {
      ret.balanceAfter = parseFloat(ret.balanceAfter.$numberDecimal);
    }
    if (ret.debitAmount && ret.debitAmount.$numberDecimal) {
      ret.debitAmount = parseFloat(ret.debitAmount.$numberDecimal);
    }
    if (ret.creditAmount && ret.creditAmount.$numberDecimal) {
      ret.creditAmount = parseFloat(ret.creditAmount.$numberDecimal);
    }
    return ret;
  }
});
bankTransactionSchema.set('toObject', {
  transform: function(doc, ret) {
    // Convert Decimal128 fields to numbers
    if (ret.amount && ret.amount.$numberDecimal) {
      ret.amount = parseFloat(ret.amount.$numberDecimal);
    }
    if (ret.balanceAfter && ret.balanceAfter.$numberDecimal) {
      ret.balanceAfter = parseFloat(ret.balanceAfter.$numberDecimal);
    }
    if (ret.debitAmount && ret.debitAmount.$numberDecimal) {
      ret.debitAmount = parseFloat(ret.debitAmount.$numberDecimal);
    }
    if (ret.creditAmount && ret.creditAmount.$numberDecimal) {
      ret.creditAmount = parseFloat(ret.creditAmount.$numberDecimal);
    }
    return ret;
  }
});

// Transform for JSON serialization - ensures Decimal128 fields are converted to numbers
bankAccountSchema.set('toJSON', {
  transform: function(doc, ret) {
    // Convert Decimal128 fields to numbers
    if (ret.openingBalance && ret.openingBalance.$numberDecimal) {
      ret.openingBalance = parseFloat(ret.openingBalance.$numberDecimal);
    }
    if (ret.cachedBalance && ret.cachedBalance.$numberDecimal) {
      ret.cachedBalance = parseFloat(ret.cachedBalance.$numberDecimal);
    }
    if (ret.targetBalance && ret.targetBalance.$numberDecimal) {
      ret.targetBalance = parseFloat(ret.targetBalance.$numberDecimal);
    }
    return ret;
  }
});
bankAccountSchema.set('toObject', {
  transform: function(doc, ret) {
    // Convert Decimal128 fields to numbers
    if (ret.openingBalance && ret.openingBalance.$numberDecimal) {
      ret.openingBalance = parseFloat(ret.openingBalance.$numberDecimal);
    }
    if (ret.cachedBalance && ret.cachedBalance.$numberDecimal) {
      ret.cachedBalance = parseFloat(ret.cachedBalance.$numberDecimal);
    }
    if (ret.targetBalance && ret.targetBalance.$numberDecimal) {
      ret.targetBalance = parseFloat(ret.targetBalance.$numberDecimal);
    }
    return ret;
  }
});

// Pre-save middleware
bankAccountSchema.pre('save', async function(next) {
  if (this.isNew) {
    // Per spec 3.3: Opening balance is stored, live balance computed from journal
    // Initialize cache with opening balance (valid until first journal entry posts)
    const openingBal = parseFloat(this.openingBalance?.toString() || '0');
    this.cachedBalance = mongoose.Types.Decimal128.fromString(openingBal.toString());
    this.cacheValid = true;  // Opening balance is valid until journal entries exist
    this.cacheLastComputed = new Date();
    
    // Auto-set ledger account code based on account type if not provided
    if (!this.ledgerAccountId) {
      const typeToCode = {
        'bk_bank': '1100',
        'equity_bank': '1100',
        'im_bank': '1100',
        'cogebanque': '1100',
        'ecobank': '1100',
        'mtn_momo': '1200',
        'airtel_money': '1200',
        'cash_in_hand': '1000'
      };
      this.ledgerAccountId = typeToCode[this.accountType] || '1100';
    }
    
    // Set opening balance date if not provided
    if (!this.openingBalanceDate) {
      this.openingBalanceDate = new Date();
    }
  }
  
  // Ensure only one default account per company
  if (this.isDefault && this.isModified('isDefault')) {
    await this.constructor.updateMany(
      { company: this.company, _id: { $ne: this._id } },
      { isDefault: false }
    );
  }
  
  next();
});

// Static method to get total cash position (uses cached balance)
bankAccountSchema.statics.getTotalCashPosition = async function(companyId) {
  const accounts = await this.find({ company: companyId, isActive: true });
  
  const result = {
    total: 0,
    byType: {
      bk_bank: 0,
      equity_bank: 0,
      im_bank: 0,
      cogebanque: 0,
      ecobank: 0,
      mtn_momo: 0,
      airtel_money: 0,
      cash_in_hand: 0
    },
    accounts: []
  };
  
  accounts.forEach(account => {
    // Use cached balance per spec 3.3
    const balance = parseFloat(account.cachedBalance?.toString() || '0');
    result.total += balance;
    result.byType[account.accountType] += balance;
    result.accounts.push({
      _id: account._id,
      name: account.name,
      accountType: account.accountType,
      balance: balance,
      cacheValid: account.cacheValid
    });
  });
  
  return result;
};

// Static method to invalidate cache for all accounts linked to a ledger account
// Called by JournalService when journal entries are posted
bankAccountSchema.statics.invalidateCacheForLedgerAccount = async function(companyId, ledgerAccountId) {
  return this.updateMany(
    { company: companyId, ledgerAccountId: ledgerAccountId },
    { cacheValid: false }
  );
};

// Static method to get account by type
bankAccountSchema.statics.getByType = async function(companyId, accountType) {
  return this.find({ company: companyId, accountType, isActive: true });
};

// Static method to get default account
bankAccountSchema.statics.getDefault = async function(companyId) {
  return this.findOne({ company: companyId, isDefault: true, isActive: true });
};

// Method to add transaction
// Note: Per spec 3.3, balance should be computed from journal, not stored
// This method is kept for backwards compatibility - BankTransaction tracks movements
// When transactions are added, cache is invalidated (must recompute from journal)
bankAccountSchema.methods.addTransaction = async function(transactionData) {
  const BankTransaction = mongoose.model('BankTransaction');
  
  // Use cached balance
  const currentBal = parseFloat(this.cachedBalance?.toString() || '0');
  
  const transaction = new BankTransaction({
    ...transactionData,
    account: this._id,
    company: this.company,
    balanceAfter: currentBal
  });
  
  await transaction.save();
  
  // Update balance based on transaction type (for backwards compatibility)
  let newBal = currentBal;
  if (transaction.type === 'deposit' || transaction.type === 'transfer_in' || transaction.type === 'opening') {
    newBal += transaction.amount;
  } else if (transaction.type === 'withdrawal' || transaction.type === 'transfer_out' || transaction.type === 'closing') {
    newBal -= transaction.amount;
  } else if (transaction.type === 'adjustment') {
    newBal = transaction.balanceAfter;
  }
  
  // Per spec 3.3: Invalidate cache when transaction is added
  // The balance must be recomputed from journal
  this.cachedBalance = mongoose.Types.Decimal128.fromString(newBal.toString());
  this.cacheValid = false;  // Must recompute from journal
  this.cacheLastComputed = null;
  await this.save();
  
  return transaction;
};

// Method to get balance with caching per spec 3.3
// Returns cached balance if valid, otherwise recomputes from journal
bankAccountSchema.methods.getBalance = async function(JournalEntry, asOfDate) {
  // If cache is valid, return cached balance
  if (this.cacheValid) {
    return {
      balance: parseFloat(this.cachedBalance?.toString() || '0'),
      cached: true,
      computedAt: this.cacheLastComputed
    };
  }
  
  // Cache invalid - must recompute from journal
  const ledgerAccountId = this.ledgerAccountId || '1100';
  const openingBalance = parseFloat(this.openingBalance?.toString() || '0');
  const openingBalanceDate = this.openingBalanceDate || new Date(0);
  
  // Build date query: entry_date >= opening_balance_date
  const dateQuery = { $gte: openingBalanceDate };
  if (asOfDate) {
    dateQuery.$lte = new Date(asOfDate);
  }
  
  // Get all posted journal entries for this bank's ledger account
  // Use aggregation to robustly compute DR and CR totals for the ledger account
  const matchStage = {
    company: this.company,
    status: 'posted',
    date: dateQuery
  };

  const agg = await aggregateWithTimeout(JournalEntry, [
    { $match: matchStage },
    { $unwind: '$lines' },
    { $match: { 'lines.accountCode': ledgerAccountId } },
    { $group: {
      _id: null,
      totalDebits: { $sum: { $toDouble: { $ifNull: [ '$lines.debit', 0 ] } } },
      totalCredits: { $sum: { $toDouble: { $ifNull: [ '$lines.credit', 0 ] } } },
      journalCount: { $sum: 1 }
    } }
  ], 'report').allowDiskUse(true);

  let totalDebits = 0;
  let totalCredits = 0;
  const journalEntryCount = (agg && agg[0]) ? agg[0].journalCount : 0;
  if (agg && agg[0]) {
    totalDebits = agg[0].totalDebits || 0;
    totalCredits = agg[0].totalCredits || 0;
  }
  
  // current_balance = opening_balance + DR - CR
  const computedBalance = openingBalance + totalDebits - totalCredits;
  const now = new Date();
  
  // Update cache
  this.cachedBalance = mongoose.Types.Decimal128.fromString(computedBalance.toString());
  this.cacheValid = true;
  this.cacheLastComputed = now;
  await this.save();
  
    return {
      balance: computedBalance,
      cached: false,
      computedAt: now,
      details: {
        openingBalance,
        totalDebits,
        totalCredits,
        journalEntryCount: journalEntryCount || 0
      }
    };
};

// Create models
const BankAccount = mongoose.model('BankAccount', bankAccountSchema);
mongoose.model('BankTransaction', bankTransactionSchema);
mongoose.model('BankStatementLine', bankStatementLineSchema);
mongoose.model('BankReconciliationMatch', bankReconciliationMatchSchema);

// Export BankAccount as the module default (consistent with other models)
// Also attach related models as properties so callers can destructure:
// const { BankAccount, BankTransaction, BankStatementLine, BankReconciliationMatch } = require('../models/BankAccount')
module.exports = BankAccount;
module.exports.BankAccount = BankAccount;
module.exports.BankTransaction = mongoose.model('BankTransaction');
module.exports.BankStatementLine = mongoose.model('BankStatementLine');
module.exports.BankReconciliationMatch = mongoose.model('BankReconciliationMatch');
