const mongoose = require("mongoose");

// Petty Cash Expense Schema (individual expense entries per Module 4 spec)
const pettyCashExpenseSchema = new mongoose.Schema(
  {
    // Company reference
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    // Float reference (fund_id per Module 4 spec)
    float: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PettyCashFloat",
      required: true,
    },
    // Description (per Module 4 spec)
    description: {
      type: String,
      required: true,
      trim: true,
    },
    // Amount (per Module 4 spec)
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    // Expense account ID (per Module 4 spec: expense_account_id - required for type=expense)
    expenseAccountId: {
      type: String,
      default: "5100",
    },
    category: {
      type: String,
      enum: [
        "transport",
        "office_supplies",
        "meals",
        "communications",
        "utilities",
        "maintenance",
        "miscellaneous",
        "postage",
        "stationery",
        "refreshments",
        "medical",
        "other",
      ],
      default: "miscellaneous",
    },
    date: {
      type: Date,
      default: Date.now,
    },
    receiptNumber: String,
    receiptImage: {
      name: String,
      url: String,
    },
    notes: String,
    // Voucher number for tracking (format: PCV-YYYY-NNNNN)
    voucherNumber: {
      type: String,
      unique: true,
      sparse: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "reimbursed"],
      default: "pending",
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    approvedAt: Date,
  },
  {
    timestamps: true,
  },
);

// Auto-generate voucher number for expenses
pettyCashExpenseSchema.pre("save", async function (next) {
  if (this.isNew && !this.voucherNumber) {
    const year = new Date().getFullYear();
    const count = await mongoose.model("PettyCashExpense").countDocuments({
      company: this.company,
    });
    this.voucherNumber = `PCV-${year}-${String(count + 1).padStart(5, "0")}`;
  }
  next();
});

// Petty Cash Float/Balance Schema (per Module 4 spec)
const pettyCashFloatSchema = new mongoose.Schema(
  {
    // Company reference
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Petty cash must belong to a company"],
    },
    // Float name (e.g., "Main Office", "Branch 1")
    name: {
      type: String,
      trim: true,
      maxlength: 100,
      required: [true, "Please provide a petty cash fund name"],
    },
    // Ledger account ID (1050 = Petty Cash per chart of accounts)
    ledgerAccountId: {
      type: String,
      default: "1050",
    },
    // Opening/float balance
    openingBalance: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    // Current balance (calculated automatically)
    currentBalance: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    // Target float level (per Module 4 spec: float_amount)
    floatAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    // Imprest mode - fixed float system (true = imprest, false = fluctuating)
    imprestMode: {
      type: Boolean,
      default: true, // Default to imprest for proper petty cash control
    },
    // Minimum threshold for replenishment (kept for backwards compatibility)
    minimumBalance: {
      type: Number,
      default: 10000,
    },
    // Responsible person (custodian_id per Module 4 spec)
    custodian: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Please specify a custodian"],
    },
    // Location/description
    location: String,
    // Status (is_active per Module 4 spec)
    isActive: {
      type: Boolean,
      default: true,
    },
    // Cached balance (similar to BankAccount)
    cachedBalance: {
      type: Number,
      default: 0,
    },
    // Cache validity flag
    cacheValid: {
      type: Boolean,
      default: false,
    },
    // Timestamp when cache was last computed
    cacheLastComputed: {
      type: Date,
      default: null,
    },
    // Notes
    notes: String,
  },
  {
    timestamps: true,
  },
);

// Index for efficient queries
pettyCashFloatSchema.index({ company: 1, isActive: 1 });

// Static method to invalidate cache for all floats linked to a ledger account
// Called by JournalService when journal entries are posted
pettyCashFloatSchema.statics.invalidateCacheForLedgerAccount = async function (
  companyId,
  ledgerAccountId,
) {
  return this.updateMany(
    { company: companyId, ledgerAccountId: ledgerAccountId },
    { $set: { cacheValid: false } },
  );
};
pettyCashExpenseSchema.index({ company: 1, float: 1, date: -1 });
pettyCashExpenseSchema.index({ company: 1, status: 1 });

// Pre-save middleware to initialize new floats
pettyCashFloatSchema.pre("save", async function (next) {
  if (this.isNew) {
    // Set floatAmount default if not provided
    this.floatAmount = this.floatAmount || this.openingBalance;
    // currentBalance will be calculated from transactions
    this.currentBalance = 0;
    this.cachedBalance = 0;
    this.cacheValid = false;
    this.cacheLastComputed = null;
  }
  next();
});

// Static method to get current balance for a float
pettyCashFloatSchema.statics.getCurrentBalance = async function (floatId) {
  const pettyCashFloat = await this.findById(floatId);
  if (!pettyCashFloat) return 0;

  // Calculate from transactions (opening transaction already includes the opening balance)
  const PettyCashTransaction = mongoose.model("PettyCashTransaction");
  const transactions = await PettyCashTransaction.find({ float: floatId });

  const balance = transactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);

  return balance;
};

// Petty Cash Replenishment Request Schema
const pettyCashReplenishmentSchema = new mongoose.Schema(
  {
    // Company reference
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    // Float reference
    float: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PettyCashFloat",
      required: true,
    },
    // Replenishment amount requested
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    // Amount actually provided
    actualAmount: {
      type: Number,
      min: 0,
    },
    // Reason for replenishment
    reason: {
      type: String,
      trim: true,
    },
    // Supporting documents
    receipts: [
      {
        name: String,
        url: String,
      },
    ],
    // Status
    status: {
      type: String,
      enum: ["pending", "approved", "completed", "rejected", "cancelled"],
      default: "pending",
    },
    // Requested by
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Approved by
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    approvedAt: Date,
    // Completed by (who provided the cash)
    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    completedAt: Date,
    // Notes
    notes: String,
    // Reference number
    replenishmentNumber: String,
    // Source bank account (required for journal entry when completing replenishment)
    bank_account_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BankAccount",
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for efficient querying
pettyCashReplenishmentSchema.index({ company: 1, float: 1, status: 1 });
pettyCashReplenishmentSchema.index({ company: 1, status: 1 });
pettyCashReplenishmentSchema.index({ company: 1, createdAt: -1 });

// Petty Cash Cash Count / Reconciliation Schema
// For periodic physical cash verification (daily/monthly)
const cashCountDenominationSchema = new mongoose.Schema({
  denomination: { type: Number, required: true }, // e.g., 100, 50, 20, 10, 5, 1, 0.5, 0.25
  count: { type: Number, required: true, min: 0, default: 0 },
  total: { type: Number, required: true, min: 0 }, // denomination * count
});

const pettyCashReconciliationSchema = new mongoose.Schema(
  {
    // Company reference
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    // Float reference
    float: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PettyCashFloat",
      required: true,
    },
    // Reconciliation number (auto-generated)
    reconciliationNumber: {
      type: String,
      unique: true,
    },
    // Count date
    countDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    // System balance at time of count
    systemBalance: {
      type: Number,
      required: true,
    },
    // Physical cash count by denomination
    cashDenominations: [cashCountDenominationSchema],
    // Total physical cash counted
    physicalCashTotal: {
      type: Number,
      required: true,
      min: 0,
    },
    // Calculated difference
    difference: {
      type: Number,
      required: true,
    },
    // Difference type for categorization
    differenceType: {
      type: String,
      enum: ["balanced", "shortage", "overage"],
      required: true,
    },
    // Status of reconciliation
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    // Who performed the count (custodian)
    countedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Who verified/approved the count (supervisor)
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    approvedAt: Date,
    // Notes on the count
    notes: String,
    // Unexplained shortage/overage explanation
    discrepancyExplanation: String,
    // GL account for posting shortage/overage
    shortageOverageAccountId: {
      type: String,
      default: "5900", // Miscellaneous Expenses for shortage, Income for overage
    },
    // Journal entry reference for shortage/overage adjustment
    journalEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JournalEntry",
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for efficient querying
pettyCashReconciliationSchema.index({ company: 1, float: 1, countDate: -1 });
pettyCashReconciliationSchema.index({ company: 1, status: 1 });
pettyCashReconciliationSchema.index({ company: 1, reconciliationNumber: 1 });

// Auto-generate reconciliation number (PCR-YYYY-NNNNN)
pettyCashReconciliationSchema.pre("save", async function (next) {
  if (this.isNew && !this.reconciliationNumber) {
    const year = new Date().getFullYear();
    const count = await mongoose
      .model("PettyCashReconciliation")
      .countDocuments({ company: this.company });
    this.reconciliationNumber = `PCR-${year}-${String(count + 1).padStart(5, "0")}`;
  }
  next();
});

// Auto-generate replenishment number
pettyCashReplenishmentSchema.pre("save", async function (next) {
  if (this.isNew && !this.replenishmentNumber) {
    const count = await mongoose
      .model("PettyCashReplenishment")
      .countDocuments({ company: this.company });
    this.replenishmentNumber = `REPL-${String(count + 1).padStart(5, "0")}`;
  }
  next();
});

// Main Petty Cash Transaction Schema (tracks all activities per Module 4 spec)
// NOTE: Schema includes nullable fields for future approval workflow support
// In v1 (simple mode): all transactions have status='posted', approved_by=NULL
// In v2 (workflow mode): add pending→approved state transitions without migration
const pettyCashTransactionSchema = new mongoose.Schema(
  {
    // Company reference
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    // Float reference (fund_id per Module 4 spec)
    float: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PettyCashFloat",
      required: true,
    },
    // Reference number (PCT-YYYY-NNNNN per Module 4 spec)
    // Auto-generated in pre-save hook if not provided
    referenceNo: {
      type: String,
      unique: true,
      sparse: true, // allows null during creation before pre-save hook runs
    },
    // Voucher number (PCV-YYYY-NNNNN) - links to expense voucher
    voucherNumber: {
      type: String,
      unique: true,
      sparse: true,
    },
    // Transaction type (top_up, expense per Module 4 spec)
    type: {
      type: String,
      enum: [
        "top_up",
        "expense",
        "opening",
        "replenishment",
        "adjustment",
        "closing",
      ],
      required: true,
    },
    // Transaction date (per Module 4 spec)
    transactionDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    // Status: 'posted' (v1 simple mode), or 'pending','approved','rejected' (v2 workflow mode)
    status: {
      type: String,
      enum: ["posted", "pending", "approved", "rejected"],
      default: "posted",
      required: true,
    },
    // Approved by (nullable - for future workflow support)
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Approved at timestamp (nullable - for future workflow support)
    approvedAt: {
      type: Date,
      default: null,
    },
    // Reference to related document
    reference: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "referenceType",
    },
    referenceType: {
      type: String,
      enum: ["PettyCashExpense", "PettyCashReplenishment", null],
      default: null,
    },
    // Amount (per Module 4 spec)
    // For expenses, use negative amount to reduce balance; positive for top-ups
    amount: {
      type: Number,
      required: true,
    },
    // Receipt reference (receipt_ref per Module 4 spec)
    receiptRef: {
      type: String,
      maxlength: 100,
      default: null,
    },
    // Expense account ID used for journal entry (for expense transactions)
    expenseAccountId: {
      type: String,
      default: null,
    },
    // Balance after transaction
    balanceAfter: {
      type: Number,
      required: true,
    },
    // Description (per Module 4 spec)
    description: {
      type: String,
      required: true,
    },
    // Journal entry ID (per Module 4 spec: journal_entry_id)
    journalEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JournalEntry",
      default: null,
    },
    // User who created the transaction (posted_by per Module 4 spec)
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Notes
    notes: String,
  },
  {
    timestamps: true,
  },
);

// Index for efficient queries
pettyCashTransactionSchema.index({ company: 1, float: 1, transactionDate: -1 });
pettyCashTransactionSchema.index({ company: 1, referenceNo: 1 });

// Auto-generate reference number (PCT-YYYY-NNNNN per Module 4 spec)
pettyCashTransactionSchema.pre("save", async function (next) {
  if (this.isNew && !this.referenceNo) {
    const year = new Date().getFullYear();
    const count = await mongoose.model("PettyCashTransaction").countDocuments({
      company: this.company,
    });
    this.referenceNo = `PCT-${year}-${String(count + 1).padStart(5, "0")}`;
  }
  next();
});

// Create models
const PettyCashFloat = mongoose.model("PettyCashFloat", pettyCashFloatSchema);
const PettyCashExpense = mongoose.model(
  "PettyCashExpense",
  pettyCashExpenseSchema,
);
const PettyCashReplenishment = mongoose.model(
  "PettyCashReplenishment",
  pettyCashReplenishmentSchema,
);
const PettyCashTransaction = mongoose.model(
  "PettyCashTransaction",
  pettyCashTransactionSchema,
);
const PettyCashReconciliation = mongoose.model(
  "PettyCashReconciliation",
  pettyCashReconciliationSchema,
);

// Export all models
module.exports = {
  PettyCashFloat,
  PettyCashExpense,
  PettyCashReplenishment,
  PettyCashTransaction,
  PettyCashReconciliation,
};
