const mongoose = require('mongoose');
const { generateUniqueNumber } = require('./utils/autoIncrement');

// ar_bad_debt_writeoffs table - stores records of written-off invoices
const arBadDebtWriteoffSchema = new mongoose.Schema({
  // Reference number - BDW-YYYY-NNNNN format
  referenceNo: {
    type: String,
    uppercase: true,
    unique: true
  },

  // Reference to the invoice being written off
  invoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    required: [true, 'Invoice is required']
  },

  // Client reference
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: [true, 'Client is required']
  },

  // Write-off date
  writeoffDate: {
    type: Date,
    required: [true, 'Write-off date is required'],
    default: Date.now
  },

  // Amount being written off - DECIMAL(18,2)
  amount: {
    type: mongoose.Schema.Types.Decimal128,
    required: [true, 'Amount is required'],
    min: 0
  },

  // Reason for write-off
  reason: {
    type: String,
    required: [true, 'Reason is required']
  },

  // Additional notes
  notes: {
    type: String,
    default: null
  },

  // Journal entry reference
  journalEntry: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    default: null
  },

  // Posted by user
  postedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  // Status
  status: {
    type: String,
    enum: ['draft', 'posted', 'reversed'],
    default: 'draft'
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
  reverseJournalEntry: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    default: null
  },

  // Created by user
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Write-off must have a creator']
  },

  // Company (for multi-tenancy)
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret) {
      // Convert Decimal128 to string for JSON API
      if (ret.amount) ret.amount = ret.amount.toString();
      return ret;
    }
  },
  toObject: {
    virtuals: true,
    transform: function(doc, ret) {
      if (ret.amount) ret.amount = ret.amount.toString();
      return ret;
    }
  }
});

// Compound indexes for performance
arBadDebtWriteoffSchema.index({ company: 1, referenceNo: 1 }, { unique: true });
arBadDebtWriteoffSchema.index({ company: 1 });
arBadDebtWriteoffSchema.index({ company: 1, status: 1 });
arBadDebtWriteoffSchema.index({ company: 1, invoice: 1 });
arBadDebtWriteoffSchema.index({ company: 1, client: 1 });
arBadDebtWriteoffSchema.index({ company: 1, writeoffDate: 1 });
arBadDebtWriteoffSchema.index({ invoice: 1 });
arBadDebtWriteoffSchema.index({ journalEntry: 1 });

// Auto-generate reference number - BDW-YYYY-NNNNN format
arBadDebtWriteoffSchema.pre('save', async function(next) {
  if (this.isNew && !this.referenceNo) {
    try {
      // Need company - get from invoice or client lookup
      let companyId = this.company;
      if (!companyId && this.invoice) {
        const Invoice = require('./Invoice');
        const inv = await Invoice.findById(this.invoice).select('company');
        if (inv) companyId = inv.company;
      }
      if (!companyId && this.client) {
        const Client = require('./Client');
        const cl = await Client.findById(this.client).select('company');
        if (cl) companyId = cl.company;
      }
      if (companyId) {
        this.referenceNo = await generateUniqueNumber('BDW', mongoose.model('ARBadDebtWriteoff'), companyId, 'referenceNo');
      }
    } catch (err) {
      // Ignore errors - reference may be set manually
    }
  }
  next();
});

// Virtual for amount as number
arBadDebtWriteoffSchema.virtual('amountValue').get(function() {
  return parseFloat(this.amount) || 0;
});

module.exports = mongoose.model('ARBadDebtWriteoff', arBadDebtWriteoffSchema);
