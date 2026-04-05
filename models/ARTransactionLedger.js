const mongoose = require('mongoose');

/**
 * AR Transaction Ledger - Complete audit trail for all Accounts Receivable movements
 * 
 * This model tracks every change to AR balances ensuring:
 * 1. Complete audit trail for compliance
 * 2. Data integrity verification
 * 3. Automated reconciliation support
 * 4. Error detection and correction
 * 
 * Transaction Types:
 * - invoice_created: When invoice is confirmed (increases AR)
 * - invoice_cancelled: When invoice is cancelled (decreases AR)
 * - receipt_posted: When receipt is posted (decreases AR)
 * - receipt_reversed: When receipt is reversed (increases AR)
 * - allocation_made: When receipt is allocated to invoice
 * - allocation_removed: When allocation is removed
 * - credit_note_applied: When credit note reduces invoice balance
 * - credit_note_reversed: When credit note is reversed
 * - bad_debt_writeoff: When invoice is written off as bad debt
 * - bad_debt_reversed: When bad debt is reversed
 * - payment_recorded: Legacy invoice payment recording
 * - manual_adjustment: Manual AR balance correction
 */

const arTransactionSchema = new mongoose.Schema({
  // Company (multi-tenancy)
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Transaction must belong to a company']
  },

  // Client whose AR is affected
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: [true, 'Transaction must belong to a client']
  },

  // Invoice affected (if applicable)
  invoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    default: null
  },

  // Receipt involved (if applicable)
  receipt: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ARReceipt',
    default: null
  },

  // Transaction type
  transactionType: {
    type: String,
    required: true,
    enum: [
      'invoice_created',
      'invoice_cancelled',
      'receipt_posted',
      'receipt_reversed',
      'allocation_made',
      'allocation_removed',
      'credit_note_applied',
      'credit_note_reversed',
      'bad_debt_writeoff',
      'bad_debt_reversed',
      'payment_recorded',
      'payment_reversed',
      'manual_adjustment',
      'system_correction'
    ]
  },

  // Transaction date
  transactionDate: {
    type: Date,
    required: true,
    default: Date.now
  },

  // Reference number (invoice #, receipt #, etc.)
  referenceNo: {
    type: String,
    default: null
  },

  // Description of the transaction
  description: {
    type: String,
    required: true
  },

  // Amounts - DECIMAL(18,2)
  // Amount of this specific transaction (always positive)
  amount: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },

  // Direction: does this increase or decrease AR?
  direction: {
    type: String,
    enum: ['increase', 'decrease'],
    required: true
  },

  // Running balances after this transaction
  invoiceBalanceAfter: {
    type: mongoose.Schema.Types.Decimal128,
    default: null
  },

  clientBalanceAfter: {
    type: mongoose.Schema.Types.Decimal128,
    default: null
  },

  // Source document references for traceability
  sourceType: {
    type: String,
    required: true,
    enum: ['invoice', 'ar_receipt', 'credit_note', 'bad_debt_writeoff', 'journal_entry', 'manual', 'system']
  },

  sourceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },

  sourceReference: {
    type: String,
    default: null
  },

  // Related journal entry (if created)
  journalEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    default: null
  },

  // Additional metadata for context
  metadata: {
    // For receipts: payment method used
    paymentMethod: String,
    // For credit notes: credit note number
    creditNoteNumber: String,
    // For bad debt: reason for write-off
    badDebtReason: String,
    // For adjustments: reason code
    adjustmentReason: String,
    // Original values before change (for reversals)
    originalValues: {
      invoiceBalance: mongoose.Schema.Types.Decimal128,
      clientBalance: mongoose.Schema.Types.Decimal128
    }
  },

  // Reconciliation status
  reconciliationStatus: {
    type: String,
    enum: ['pending', 'verified', 'discrepancy', 'corrected'],
    default: 'pending'
  },

  // If discrepancy was found, store details
  discrepancyDetails: {
    expectedBalance: mongoose.Schema.Types.Decimal128,
    actualBalance: mongoose.Schema.Types.Decimal128,
    difference: mongoose.Schema.Types.Decimal128,
    detectedAt: Date,
    resolvedAt: Date,
    resolutionNotes: String
  },

  // User who triggered this transaction
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  // If this transaction reverses another, link them
  reversedFrom: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ARTransactionLedger',
    default: null
  },

  // If this transaction was reversed, link to the reversal
  reversedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ARTransactionLedger',
    default: null
  },

  // Period/Year for reporting
  fiscalYear: {
    type: Number,
    default: function() {
      return new Date().getFullYear();
    }
  },

  accountingPeriod: {
    type: String,
    default: function() {
      const date = new Date();
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }
  },

  // Audit fields
  ipAddress: {
    type: String,
    default: null
  },

  userAgent: {
    type: String,
    default: null
  }

}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret) {
      // Convert Decimal128 to Number for JSON
      if (ret.amount) ret.amount = parseFloat(ret.amount);
      if (ret.invoiceBalanceAfter) ret.invoiceBalanceAfter = parseFloat(ret.invoiceBalanceAfter);
      if (ret.clientBalanceAfter) ret.clientBalanceAfter = parseFloat(ret.clientBalanceAfter);
      if (ret.discrepancyDetails) {
        if (ret.discrepancyDetails.expectedBalance) {
          ret.discrepancyDetails.expectedBalance = parseFloat(ret.discrepancyDetails.expectedBalance);
        }
        if (ret.discrepancyDetails.actualBalance) {
          ret.discrepancyDetails.actualBalance = parseFloat(ret.discrepancyDetails.actualBalance);
        }
        if (ret.discrepancyDetails.difference) {
          ret.discrepancyDetails.difference = parseFloat(ret.discrepancyDetails.difference);
        }
      }
      return ret;
    }
  },
  toObject: {
    virtuals: true,
    transform: function(doc, ret) {
      if (ret.amount) ret.amount = parseFloat(ret.amount);
      if (ret.invoiceBalanceAfter) ret.invoiceBalanceAfter = parseFloat(ret.invoiceBalanceAfter);
      if (ret.clientBalanceAfter) ret.clientBalanceAfter = parseFloat(ret.clientBalanceAfter);
      return ret;
    }
  }
});

// Compound indexes for performance and queries
arTransactionSchema.index({ company: 1, transactionDate: -1 });
arTransactionSchema.index({ company: 1, client: 1, transactionDate: -1 });
arTransactionSchema.index({ company: 1, invoice: 1, transactionDate: -1 });
arTransactionSchema.index({ company: 1, transactionType: 1 });
arTransactionSchema.index({ company: 1, reconciliationStatus: 1 });
arTransactionSchema.index({ company: 1, fiscalYear: 1, accountingPeriod: 1 });
arTransactionSchema.index({ company: 1, sourceType: 1, sourceId: 1 });
arTransactionSchema.index({ reversedFrom: 1 });
arTransactionSchema.index({ reversedBy: 1 });

// Index for audit queries
arTransactionSchema.index({ company: 1, createdBy: 1, transactionDate: -1 });

// Virtual for signed amount (positive for increase, negative for decrease)
arTransactionSchema.virtual('signedAmount').get(function() {
  const amt = parseFloat(this.amount) || 0;
  return this.direction === 'increase' ? amt : -amt;
});

// Static method to record a transaction
arTransactionSchema.statics.recordTransaction = async function(data) {
  const transaction = new this(data);
  await transaction.save();
  return transaction;
};

// Static method to get client balance at a specific date
arTransactionSchema.statics.getClientBalanceAtDate = async function(companyId, clientId, date) {
  const result = await this.findOne({
    company: companyId,
    client: clientId,
    transactionDate: { $lte: date }
  }).sort({ transactionDate: -1, createdAt: -1 });

  return result ? parseFloat(result.clientBalanceAfter) || 0 : 0;
};

// Static method to get invoice balance at a specific date
arTransactionSchema.statics.getInvoiceBalanceAtDate = async function(companyId, invoiceId, date) {
  const result = await this.findOne({
    company: companyId,
    invoice: invoiceId,
    transactionDate: { $lte: date }
  }).sort({ transactionDate: -1, createdAt: -1 });

  return result ? parseFloat(result.invoiceBalanceAfter) || 0 : 0;
};

// Static method to find discrepancies
arTransactionSchema.statics.findDiscrepancies = async function(companyId, options = {}) {
  const { startDate, endDate, clientId } = options;
  
  const matchStage = {
    company: new mongoose.Types.ObjectId(companyId),
    reconciliationStatus: { $in: ['pending', 'discrepancy'] }
  };

  if (startDate || endDate) {
    matchStage.transactionDate = {};
    if (startDate) matchStage.transactionDate.$gte = new Date(startDate);
    if (endDate) matchStage.transactionDate.$lte = new Date(endDate);
  }

  if (clientId) {
    matchStage.client = new mongoose.Types.ObjectId(clientId);
  }

  const discrepancies = await this.aggregate([
    { $match: matchStage },
    {
      $lookup: {
        from: 'invoices',
        localField: 'invoice',
        foreignField: '_id',
        as: 'currentInvoice'
      }
    },
    {
      $lookup: {
        from: 'clients',
        localField: 'client',
        foreignField: '_id',
        as: 'currentClient'
      }
    },
    {
      $addFields: {
        currentInvoiceBalance: { $arrayElemAt: ['$currentInvoice.amountOutstanding', 0] },
        currentClientBalance: { $arrayElemAt: ['$currentClient.outstandingBalance', 0] }
      }
    },
    {
      $addFields: {
        invoiceDiscrepancy: {
          $cond: {
            if: { $ne: ['$invoice', null] },
            then: { $ne: ['$invoiceBalanceAfter', '$currentInvoiceBalance'] },
            else: false
          }
        },
        clientDiscrepancy: {
          $cond: {
            if: { $ne: ['$clientBalanceAfter', '$currentClientBalance'] },
            then: true,
            else: false
          }
        }
      }
    },
    {
      $match: {
        $or: [
          { invoiceDiscrepancy: true },
          { clientDiscrepancy: true }
        ]
      }
    },
    { $sort: { transactionDate: -1 } }
  ]);

  return discrepancies;
};

module.exports = mongoose.model('ARTransactionLedger', arTransactionSchema);
