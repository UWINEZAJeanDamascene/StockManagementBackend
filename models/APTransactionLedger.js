const mongoose = require('mongoose');

/**
 * AP Transaction Ledger Schema
 * Mirrors ARTransactionLedger for Accounts Payable tracking
 * Records all AP movements for audit trail and reconciliation
 */
const apTransactionLedgerSchema = new mongoose.Schema({
  // Company (tenant)
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },

  // Supplier (foreign key)
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true,
    index: true
  },

  // Transaction type
  transactionType: {
    type: String,
    enum: [
      'grn_received',           // GRN received - increases AP
      'payment_posted',         // Payment posted - decreases AP
      'payment_allocation',     // Payment allocated to GRN
      'payment_reversed',       // Payment reversed - increases AP back
      'adjustment',             // Manual adjustment
      'opening_balance',        // Opening balance entry
      'write_off'               // Bad debt/write-off
    ],
    required: true,
    index: true
  },

  // Transaction date
  transactionDate: {
    type: Date,
    required: true,
    index: true
  },

  // Reference number (GRN #, Payment #, etc.)
  referenceNo: {
    type: String,
    required: true,
    index: true
  },

  // Description
  description: {
    type: String,
    required: true
  },

  // Amount (DECIMAL 18,2)
  amount: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    get: function(value) {
      return value ? parseFloat(value.toString()) : 0;
    }
  },

  // Direction: 'increase' (adds to AP) or 'decrease' (reduces AP)
  direction: {
    type: String,
    enum: ['increase', 'decrease'],
    required: true
  },

  // Running balance after this transaction (at supplier level)
  supplierBalanceAfter: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    get: function(value) {
      return value ? parseFloat(value.toString()) : 0;
    }
  },

  // GRN balance after (if applicable)
  grnBalanceAfter: {
    type: mongoose.Schema.Types.Decimal128,
    default: null,
    get: function(value) {
      return value ? parseFloat(value.toString()) : null;
    }
  },

  // Related GRN (if applicable)
  grn: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GoodsReceivedNote',
    default: null,
    index: true
  },

  // Related Payment (if applicable)
  payment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'APPayment',
    default: null,
    index: true
  },

  // Source document type and ID for traceability
  sourceType: {
    type: String,
    enum: ['grn', 'ap_payment', 'ap_allocation', 'manual', 'opening_balance'],
    required: true
  },

  sourceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },

  sourceReference: {
    type: String,
    default: null
  },

  // User who created this entry
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Reconciliation status
  reconciliationStatus: {
    type: String,
    enum: ['pending', 'verified', 'discrepancy', 'corrected'],
    default: 'pending',
    index: true
  },

  // Verification timestamp
  verifiedAt: {
    type: Date,
    default: null
  },

  // Discrepancy details (if any)
  discrepancyDetails: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },

  // Metadata for additional context
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

// Compound indexes for common queries
apTransactionLedgerSchema.index({ company: 1, supplier: 1, transactionDate: -1 });
apTransactionLedgerSchema.index({ company: 1, transactionType: 1, transactionDate: -1 });
apTransactionLedgerSchema.index({ company: 1, reconciliationStatus: 1, transactionDate: -1 });
apTransactionLedgerSchema.index({ company: 1, sourceType: 1, sourceId: 1 });

// Static method to get supplier balance at a point in time
apTransactionLedgerSchema.statics.getSupplierBalanceAtDate = async function(companyId, supplierId, asOfDate) {
  const latestEntry = await this.findOne({
    company: companyId,
    supplier: supplierId,
    transactionDate: { $lte: asOfDate }
  }).sort({ transactionDate: -1, createdAt: -1 });

  return latestEntry ? latestEntry.supplierBalanceAfter : 0;
};

// Static method to get transaction history for a supplier
apTransactionLedgerSchema.statics.getSupplierHistory = async function(companyId, supplierId, options = {}) {
  const { startDate, endDate, limit = 100, skip = 0 } = options;

  const query = {
    company: companyId,
    supplier: supplierId
  };

  if (startDate) query.transactionDate = { $gte: startDate };
  if (endDate) {
    query.transactionDate = query.transactionDate || {};
    query.transactionDate.$lte = endDate;
  }

  return this.find(query)
    .sort({ transactionDate: -1, createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .populate('grn', 'referenceNo grnNumber')
    .populate('payment', 'referenceNo')
    .populate('createdBy', 'name');
};

// Static method to verify data integrity
apTransactionLedgerSchema.statics.verifyIntegrity = async function(companyId, options = {}) {
  const { supplierId, startDate, endDate } = options;

  const matchConditions = { company: new mongoose.Types.ObjectId(companyId) };
  if (supplierId) matchConditions.supplier = new mongoose.Types.ObjectId(supplierId);
  if (startDate || endDate) {
    matchConditions.transactionDate = {};
    if (startDate) matchConditions.transactionDate.$gte = new Date(startDate);
    if (endDate) matchConditions.transactionDate.$lte = new Date(endDate);
  }

  // Aggregate to calculate running totals and detect discrepancies
  const pipeline = [
    { $match: matchConditions },
    { $sort: { supplier: 1, transactionDate: 1, createdAt: 1 } },
    {
      $group: {
        _id: '$supplier',
        transactions: {
          $push: {
            _id: '$_id',
            type: '$transactionType',
            amount: { $toDouble: '$amount' },
            direction: '$direction',
            balanceAfter: { $toDouble: '$supplierBalanceAfter' },
            date: '$transactionDate'
          }
        },
        lastBalance: { $last: '$supplierBalanceAfter' }
      }
    }
  ];

  const results = await this.aggregate(pipeline);

  // Verify each supplier's balance chain
  const discrepancies = [];

  for (const result of results) {
    let expectedBalance = 0;

    for (const tx of result.transactions) {
      if (tx.direction === 'increase') {
        expectedBalance += tx.amount;
      } else {
        expectedBalance -= tx.amount;
      }

      // Allow small rounding differences (0.01)
      if (Math.abs(expectedBalance - tx.balanceAfter) > 0.01) {
        discrepancies.push({
          supplierId: result._id,
          transactionId: tx._id,
          expectedBalance: expectedBalance.toFixed(2),
          actualBalance: tx.balanceAfter.toFixed(2),
          difference: (expectedBalance - tx.balanceAfter).toFixed(2),
          date: tx.date
        });
      }
    }
  }

  return {
    verified: discrepancies.length === 0,
    discrepancyCount: discrepancies.length,
    discrepancies
  };
};

module.exports = mongoose.model('APTransactionLedger', apTransactionLedgerSchema);
