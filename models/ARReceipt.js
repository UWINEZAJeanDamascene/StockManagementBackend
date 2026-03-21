const mongoose = require('mongoose');
const { generateUniqueNumber } = require('./utils/autoIncrement');

// ar_receipts table - records a customer payment against one or more invoices
const arReceiptSchema = new mongoose.Schema({
  // Reference number - RCP-YYYY-NNNNN format
  referenceNo: {
    type: String,
    uppercase: true,
    unique: true,
    default: function() {
      return `RCP-AUTO-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    }
  },

  // Client reference
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: [true, 'Receipt must belong to a client']
  },

  // Company (multi-tenancy)
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Receipt must belong to a company']
  },

  // Receipt date
  receiptDate: {
    type: Date,
    required: [true, 'Receipt date is required'],
    default: Date.now
  },

  // Payment method
  paymentMethod: {
    type: String,
    enum: ['bank_transfer', 'cash', 'cheque', 'card', 'other'],
    required: [true, 'Payment method is required']
  },

  // Bank account that received the money
  bankAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankAccount',
    default: null
  },

  // Total amount received in this receipt - DECIMAL(18,2)
  amountReceived: {
    type: mongoose.Schema.Types.Decimal128,
    required: [true, 'Amount received is required'],
    min: 0
  },

  // Currency code
  currencyCode: {
    type: String,
    required: [true, 'Currency code is required'],
    default: 'USD',
    maxlength: 3
  },

  // Exchange rate - DECIMAL(18,6)
  exchangeRate: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    default: 1
  },

  // Bank reference or cheque number
  reference: {
    type: String,
    maxlength: 150,
    default: null
  },

  // Status: draft, posted, reversed
  status: {
    type: String,
    enum: ['draft', 'posted', 'reversed'],
    default: 'draft'
  },

  // Journal entry reference
  journalEntry: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    default: null
  },

  // Notes
  notes: {
    type: String,
    default: null
  },

  // Posted by user
  postedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  // Posted timestamp
  postedAt: {
    type: Date,
    default: null
  },

  // Reversal fields
  reversedAt: {
    type: Date,
    default: null
  },
  reversedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  reversalReason: {
    type: String,
    default: null
  },

  // Reverse journal entry for reversal
  reverseJournalEntry: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    default: null
  },

  // Unallocated amount - difference between receipt and allocations
  unallocatedAmount: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0
  },

  // Created by user
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Receipt must have a creator']
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret) {
      // Convert Decimal128 to string for JSON API
      if (ret.amountReceived) ret.amountReceived = ret.amountReceived.toString();
      if (ret.exchangeRate) ret.exchangeRate = ret.exchangeRate.toString();
      if (ret.unallocatedAmount) ret.unallocatedAmount = ret.unallocatedAmount.toString();
      return ret;
    }
  },
  toObject: {
    virtuals: true,
    transform: function(doc, ret) {
      if (ret.amountReceived) ret.amountReceived = ret.amountReceived.toString();
      if (ret.exchangeRate) ret.exchangeRate = ret.exchangeRate.toString();
      if (ret.unallocatedAmount) ret.unallocatedAmount = ret.unallocatedAmount.toString();
      return ret;
    }
  }
});

// Compound indexes for performance
arReceiptSchema.index({ company: 1, referenceNo: 1 }, { unique: true, sparse: true });
arReceiptSchema.index({ company: 1 });
arReceiptSchema.index({ company: 1, status: 1 });
arReceiptSchema.index({ company: 1, client: 1 });
arReceiptSchema.index({ company: 1, receiptDate: 1 });
arReceiptSchema.index({ journalEntry: 1 });

// Note: company is now an explicit schema field (multi-tenancy)

// Auto-generate receipt number - RCP-YYYY-NNNNN format
arReceiptSchema.pre('save', async function(next) {
  try {
    if (this.isNew && !this.referenceNo) {
      // Need company - get from client lookup or use provided
      let companyId = this._company;
      if (!companyId && this.client) {
        const Client = require('./Client');
        const clientDoc = await Client.findById(this.client).select('company');
        if (clientDoc) companyId = clientDoc.company;
      }
      if (companyId) {
        this.referenceNo = await generateUniqueNumber('RCP', mongoose.model('ARReceipt'), companyId, 'referenceNo');
      }
    }
  } catch (e) {
    // Fallback: ensure a unique referenceNo to avoid unique-null index collisions
    try {
      this.referenceNo = `RCP-TMP-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    } catch (ee) {
      // ignore
    }
  }
  next();
});

// Ensure company is set from client
arReceiptSchema.pre('validate', async function(next) {
  try {
    if (!this._company && this.client) {
      const Client = require('./Client');
      const clientDoc = await Client.findById(this.client).select('company');
      if (clientDoc) {
        this._company = clientDoc.company;
      }
    }
  } catch (e) {
    // Ignore errors - company may be set elsewhere
  }
  next();
});

// Virtual for amount as number
arReceiptSchema.virtual('amount').get(function() {
  return parseFloat(this.amountReceived) || 0;
});

module.exports = mongoose.model('ARReceipt', arReceiptSchema);
