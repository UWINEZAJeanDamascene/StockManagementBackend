const mongoose = require('mongoose');

/**
 * TaxTransaction Model
 * 
 * Centralized model that captures every tax event across the entire system.
 * When any transaction creates a journal entry with tax lines, a TaxTransaction
 * record is automatically created here.
 * 
 * This provides a single source of truth for all tax tracking, eliminating
 * the need for manual tax recording.
 */
const taxTransactionSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },
  
  // ── Tax Classification ─────────────────────────────────────────────
  taxType: {
    type: String,
    enum: [
      'vat_input',           // Input VAT - purchases, expenses (reduces tax owed)
      'vat_output',          // Output VAT - sales (tax collected from customers)
      'vat_input_reversed',  // Input VAT reversed - purchase returns
      'vat_output_reversed', // Output VAT reversed - credit notes
      'paye',                // PAYE - employee income tax withheld
      'rssb_employee',       // RSSB employee contribution (3%)
      'rssb_employer',       // RSSB employer contribution (5%)
      'corporate_income',    // Corporate income tax
      'withholding',         // Withholding tax
      'trading_license'      // Trading license fee
    ],
    required: true,
    index: true
  },
  
  // ── Direction ──────────────────────────────────────────────────────
  // 'input' = reduces what you owe (VAT you paid, credit notes)
  // 'output' = increases what you owe (VAT collected, sales)
  // 'withheld' = tax withheld from employees
  // 'paid' = tax paid to authorities (settlement)
  direction: {
    type: String,
    enum: ['input', 'output', 'withheld', 'paid'],
    required: true,
    index: true
  },
  
  // ── Amounts ────────────────────────────────────────────────────────
  amount: {
    type: Number,
    required: true
  },
  
  // Net amount (excluding VAT) for VAT transactions
  netAmount: {
    type: Number,
    default: 0
  },
  
  // Gross amount (including VAT) for VAT transactions
  grossAmount: {
    type: Number,
    default: 0
  },
  
  // Tax rate percentage applied
  taxRate: {
    type: Number,
    default: 0
  },
  
  // ── Source Tracking ────────────────────────────────────────────────
  // What type of transaction generated this tax event
  sourceType: {
    type: String,
    enum: [
      'invoice',              // Sales invoice
      'credit_note',          // Credit note
      'purchase',             // Purchase / GRN
      'purchase_order',       // Purchase order
      'purchase_return',      // Purchase return
      'expense',              // Expense
      'petty_cash_expense',   // Petty cash expense
      'payroll_run',          // Payroll run
      'tax_settlement',       // Tax payment to authorities
      'asset_purchase',       // Asset purchase
      'manual'                // Manual adjustment
    ],
    required: true,
    index: true
  },
  
  // Reference to the source document
  sourceId: {
    type: mongoose.Schema.Types.ObjectId,
    index: true
  },
  
  // Human-readable reference (invoice number, purchase number, etc.)
  sourceReference: {
    type: String
  },
  
  // ── Journal Entry Link ─────────────────────────────────────────────
  journalEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JournalEntry',
    index: true
  },
  
  journalEntryNumber: {
    type: String
  },
  
  // The account code from the journal line that generated this tax event
  accountCode: {
    type: String,
    required: true,
    index: true
  },
  
  // The tax rate ID used for this transaction
  taxRateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TaxRate'
  },
  
  // Tax code (e.g., "VAT18")
  taxCode: {
    type: String
  },
  
  // ── Period Tracking ────────────────────────────────────────────────
  period: {
    month: { type: Number, min: 1, max: 12 },
    year: { type: Number }
  },
  
  // ── Transaction Date ───────────────────────────────────────────────
  date: {
    type: Date,
    required: true,
    index: true
  },
  
  // ── Description ────────────────────────────────────────────────────
  description: {
    type: String
  },
  
  // ── Status ─────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['posted', 'reversed', 'voided'],
    default: 'posted',
    index: true
  },
  
  // If this transaction was reversed, reference to reversal
  reversalOf: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TaxTransaction'
  },
  
  // ── Metadata ───────────────────────────────────────────────────────
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Additional context data
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ── Compound Indexes for Common Queries ───────────────────────────────
taxTransactionSchema.index({ company: 1, date: -1 });
taxTransactionSchema.index({ company: 1, taxType: 1, date: -1 });
taxTransactionSchema.index({ company: 1, direction: 1, date: -1 });
taxTransactionSchema.index({ company: 1, sourceType: 1, date: -1 });
taxTransactionSchema.index({ company: 1, status: 1, date: -1 });
taxTransactionSchema.index({ company: 1, 'period.year': 1, 'period.month': 1 });
taxTransactionSchema.index({ company: 1, taxType: 1, direction: 1, status: 1, date: -1 });

// ── Virtual: isVAT ────────────────────────────────────────────────────
taxTransactionSchema.virtual('isVAT').get(function() {
  return ['vat_input', 'vat_output', 'vat_input_reversed', 'vat_output_reversed'].includes(this.taxType);
});

// ── Virtual: isPayroll ────────────────────────────────────────────────
taxTransactionSchema.virtual('isPayroll').get(function() {
  return ['paye', 'rssb_employee', 'rssb_employer'].includes(this.taxType);
});

// ── Static: Get balance for a tax type in a period ────────────────────
taxTransactionSchema.statics.getBalance = async function(companyId, taxType, periodStart, periodEnd) {
  const match = {
    company: new mongoose.Types.ObjectId(companyId),
    taxType,
    status: 'posted',
    date: {
      $gte: new Date(periodStart),
      $lte: new Date(periodEnd)
    }
  };
  
  const result = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$direction',
        total: { $sum: '$amount' }
      }
    }
  ]);
  
  const balances = {
    input: 0,
    output: 0,
    withheld: 0,
    paid: 0,
    net: 0
  };
  
  result.forEach(r => {
    balances[r._id] = Number(r.total);
  });
  
  // Net = output - input (for VAT)
  // Net = withheld (for PAYE/RSSB)
  if (taxType.startsWith('vat')) {
    balances.net = balances.output - balances.input;
  } else {
    balances.net = balances.withheld;
  }
  
  return balances;
};

// ── Static: Get dashboard summary ─────────────────────────────────────
taxTransactionSchema.statics.getDashboardSummary = async function(companyId, year, month) {
  const match = {
    company: new mongoose.Types.ObjectId(companyId),
    status: 'posted'
  };
  
  if (year) {
    match.date = {
      $gte: new Date(year, 0, 1),
      $lte: new Date(year, 11, 31)
    };
    
    if (month) {
      match.date = {
        $gte: new Date(year, month - 1, 1),
        $lte: new Date(year, month, 0)
      };
    }
  }
  
  const result = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          taxType: '$taxType',
          direction: '$direction'
        },
        total: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    }
  ]);
  
  // Organize into summary structure
  const summary = {
    vat: {
      output: 0,
      input: 0,
      output_reversed: 0,
      input_reversed: 0,
      net_payable: 0
    },
    paye: {
      withheld: 0,
      count: 0
    },
    rssb: {
      employee: 0,
      employer: 0,
      total: 0
    },
    corporate_income: {
      owed: 0
    },
    withholding: {
      collected: 0
    },
    trading_license: {
      fee: 0
    },
    total_tax_liability: 0,
    transaction_count: 0
  };
  
  result.forEach(r => {
    const { taxType, direction } = r._id;
    const total = Number(r.total);
    
    switch (taxType) {
      case 'vat_output':
        summary.vat.output = total;
        break;
      case 'vat_input':
        summary.vat.input = total;
        break;
      case 'vat_output_reversed':
        summary.vat.output_reversed = total;
        break;
      case 'vat_input_reversed':
        summary.vat.input_reversed = total;
        break;
      case 'paye':
        summary.paye.withheld = total;
        summary.paye.count = r.count;
        break;
      case 'rssb_employee':
        summary.rssb.employee = total;
        break;
      case 'rssb_employer':
        summary.rssb.employer = total;
        break;
      case 'corporate_income':
        summary.corporate_income.owed = total;
        break;
      case 'withholding':
        summary.withholding.collected = total;
        break;
      case 'trading_license':
        summary.trading_license.fee = total;
        break;
    }
    
    summary.transaction_count += r.count;
  });
  
  // Calculate derived values
  summary.vat.net_payable = summary.vat.output - summary.vat.input - summary.vat.output_reversed + summary.vat.input_reversed;
  summary.rssb.total = summary.rssb.employee + summary.rssb.employer;
  
  // Total tax liability
  summary.total_tax_liability = 
    (summary.vat.net_payable > 0 ? summary.vat.net_payable : 0) +
    summary.paye.withheld +
    summary.rssb.total +
    summary.corporate_income.owed +
    summary.withholding.collected +
    summary.trading_license.fee;
  
  return summary;
};

// ── Static: Get transactions by source type ───────────────────────────
taxTransactionSchema.statics.getBySourceType = async function(companyId, sourceType, options = {}) {
  const { page = 1, limit = 50, startDate, endDate } = options;
  const skip = (page - 1) * limit;
  
  const match = {
    company: new mongoose.Types.ObjectId(companyId),
    sourceType,
    status: 'posted'
  };
  
  if (startDate || endDate) {
    match.date = {};
    if (startDate) match.date.$gte = new Date(startDate);
    if (endDate) match.date.$lte = new Date(endDate);
  }
  
  const total = await this.countDocuments(match);
  const transactions = await this.find(match)
    .sort({ date: -1 })
    .skip(skip)
    .limit(limit)
    .populate('journalEntryId', 'entryNumber')
    .populate('taxRateId', 'name code rate_pct');
  
  return {
    transactions,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

// ── Static: Get all tax sources summary ───────────────────────────────
taxTransactionSchema.statics.getTaxSourcesSummary = async function(companyId, periodStart, periodEnd) {
  const match = {
    company: new mongoose.Types.ObjectId(companyId),
    status: 'posted',
    date: {
      $gte: new Date(periodStart),
      $lte: new Date(periodEnd)
    }
  };
  
  const result = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          sourceType: '$sourceType',
          taxType: '$taxType',
          direction: '$direction'
        },
        totalAmount: { $sum: '$amount' },
        totalCount: { $sum: 1 },
        avgAmount: { $avg: '$amount' },
        minAmount: { $min: '$amount' },
        maxAmount: { $max: '$amount' }
      }
    },
    { $sort: { '_id.sourceType': 1, '_id.taxType': 1 } }
  ]);
  
  // Organize by source type
  const sources = {};
  result.forEach(r => {
    const { sourceType, taxType, direction } = r._id;
    if (!sources[sourceType]) {
      sources[sourceType] = {
        sourceType,
        transactions: [],
        totalAmount: 0,
        totalCount: 0
      };
    }
    
    sources[sourceType].transactions.push({
      taxType,
      direction,
      totalAmount: Number(r.totalAmount),
      totalCount: r.totalCount,
      avgAmount: Number(r.avgAmount),
      minAmount: Number(r.minAmount),
      maxAmount: Number(r.maxAmount)
    });
    
    sources[sourceType].totalAmount += Number(r.totalAmount);
    sources[sourceType].totalCount += r.totalCount;
  });
  
  return Object.values(sources);
};

// ── Static: Get period comparison ─────────────────────────────────────
taxTransactionSchema.statics.getPeriodComparison = async function(companyId, currentYear, currentMonth) {
  const currentDate = new Date(currentYear, currentMonth - 1, 1);
  const previousDate = new Date(currentYear, currentMonth - 2, 1);
  
  const getCurrentPeriod = async (year, month) => {
    return this.getDashboardSummary(companyId, year, month);
  };
  
  const [current, previous] = await Promise.all([
    getCurrentPeriod(currentYear, currentMonth),
    getCurrentPeriod(previousDate.getFullYear(), previousDate.getMonth() + 1)
  ]);
  
  const calculateChange = (curr, prev) => {
    if (prev === 0) return { amount: curr, percentage: curr > 0 ? 100 : 0 };
    const amount = curr - prev;
    const percentage = ((amount / Math.abs(prev)) * 100);
    return { amount, percentage: Math.round(percentage * 100) / 100 };
  };
  
  return {
    current_period: { year: currentYear, month: currentMonth, summary: current },
    previous_period: { year: previousDate.getFullYear(), month: previousDate.getMonth() + 1, summary: previous },
    changes: {
      vat_net: calculateChange(current.vat.net_payable, previous.vat.net_payable),
      paye: calculateChange(current.paye.withheld, previous.paye.withheld),
      rssb: calculateChange(current.rssb.total, previous.rssb.total),
      total_liability: calculateChange(current.total_tax_liability, previous.total_tax_liability)
    }
  };
};

module.exports = mongoose.model('TaxTransaction', taxTransactionSchema);
