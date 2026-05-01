const mongoose = require('mongoose');

const apPaymentSchema = new mongoose.Schema({
  // Reference number: PAY-YYYY-NNNNN
  referenceNo: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Supplier (foreign key to suppliers)
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true,
    index: true
  },
  
  // Payment date
  paymentDate: {
    type: Date,
    required: true,
    index: true
  },
  
  // Payment method
  paymentMethod: {
    type: String,
    enum: ['bank_transfer', 'cash', 'cheque', 'other'],
    required: true
  },
  
  // Bank account (where payment comes from)
  bankAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankAccount',
    default: null
  },
  
  // Amount paid (DECIMAL(18,2))
  amountPaid: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    get: function(value) {
      return value ? parseFloat(value.toString()) : null;
    }
  },
  
  // Currency code (ISO 4217)
  currencyCode: {
    type: String,
    required: true,
    default: 'USD',
    maxlength: 3
  },
  
  // Exchange rate (DECIMAL(18,6))
  exchangeRate: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    default: 1,
    get: function(value) {
      return value ? parseFloat(value.toString()) : 1;
    }
  },
  
  // Bank reference
  reference: {
    type: String,
    maxlength: 150,
    default: null
  },
  
  // Status
  status: {
    type: String,
    enum: ['draft', 'posted', 'reversed'],
    default: 'draft',
    required: true,
    index: true
  },
  
  // Journal entry (linked when posted)
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
  
  // Posted at timestamp
  postedAt: {
    type: Date,
    default: null
  },
  
  // Reversal
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
  
  // Reverse journal entry
  reverseJournalEntry: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    default: null
  },
  
  // Unallocated amount (for payments not fully allocated to GRNs)
  unallocatedAmount: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    get: function(value) {
      return value ? parseFloat(value.toString()) : 0;
    }
  },
  
  // Company (tenant)
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },
  
  // Created by
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

// Indexes for common queries
apPaymentSchema.index({ company: 1, supplier: 1 });
apPaymentSchema.index({ company: 1, paymentDate: 1 });
apPaymentSchema.index({ company: 1, status: 1 });

// Pre-save: generate reference number if not provided
apPaymentSchema.pre('save', async function(next) {
  if (!this.referenceNo) {
    const year = new Date().getFullYear();
    const { nextSequence } = require('../services/sequenceService');
    const seqNum = await nextSequence(this.company, 'ap_payment');
    this.referenceNo = `PAY-${year}-${seqNum}`;
  }
  next();
});

// Static method to find by reference
apPaymentSchema.statics.findByReference = function(referenceNo) {
  return this.findOne({ referenceNo });
};

module.exports = mongoose.model('APPayment', apPaymentSchema);
