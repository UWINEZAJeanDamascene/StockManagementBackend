const mongoose = require("mongoose");

/**
 * BudgetPeriodLock model tracks which accounting periods are locked for each budget
 * Prevents editing actuals in closed periods
 */

const lockedPeriodSchema = new mongoose.Schema({
  year: {
    type: Number,
    required: true,
  },
  month: {
    type: Number,
    required: true,
    min: 1,
    max: 12,
  },
  locked_at: {
    type: Date,
    default: Date.now,
  },
  locked_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  reason: {
    type: String,
    default: "Period closed",
  },
  // Whether to allow budget transfers even when locked
  allow_transfers: {
    type: Boolean,
    default: true,
  },
  // Whether to allow encumbrances even when locked
  allow_encumbrances: {
    type: Boolean,
    default: false,
  },
});

const budgetPeriodLockSchema = new mongoose.Schema(
  {
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    budget_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Budget",
      required: true,
      index: true,
    },
    // Array of locked periods
    locked_periods: [lockedPeriodSchema],
    // Auto-lock settings
    auto_lock: {
      enabled: {
        type: Boolean,
        default: false,
      },
      days_after_period_end: {
        type: Number,
        default: 30, // Auto-lock 30 days after period ends
      },
    },
    // Fiscal year end settings
    fiscal_year_end: {
      month: {
        type: Number,
        default: 12,
      },
      day: {
        type: Number,
        default: 31,
      },
    },
    // Lock settings for year-end closing
    year_end_lock: {
      lock_previous_year: {
        type: Boolean,
        default: true,
      },
      require_approval: {
        type: Boolean,
        default: true,
      },
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    updated_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes
budgetPeriodLockSchema.index({ company_id: 1, budget_id: 1 }, { unique: true });
budgetPeriodLockSchema.index({ "locked_periods.year": 1, "locked_periods.month": 1 });

// Method to check if a period is locked
budgetPeriodLockSchema.methods.isPeriodLocked = function (year, month) {
  return this.locked_periods.some(
    (p) => p.year === year && p.month === month
  );
};

module.exports = mongoose.model("BudgetPeriodLock", budgetPeriodLockSchema);
