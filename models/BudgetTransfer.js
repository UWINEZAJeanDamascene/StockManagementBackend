const mongoose = require("mongoose");

const budgetTransferSchema = new mongoose.Schema(
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
    // Source line
    from_line_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BudgetLine",
      required: true,
    },
    from_account_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      required: true,
    },
    from_account_code: {
      type: String,
      required: true,
    },
    from_account_name: {
      type: String,
      required: true,
    },
    // Destination line
    to_line_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BudgetLine",
      required: true,
    },
    to_account_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      required: true,
    },
    to_account_code: {
      type: String,
      required: true,
    },
    to_account_name: {
      type: String,
      required: true,
    },
    // Transfer details
    amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },
    transfer_date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    // Workflow
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "executed", "cancelled"],
      default: "pending",
      index: true,
    },
    requested_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    requested_at: {
      type: Date,
      default: Date.now,
    },
    approved_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approved_at: {
      type: Date,
      default: null,
    },
    rejected_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    rejected_at: {
      type: Date,
      default: null,
    },
    rejection_reason: {
      type: String,
      trim: true,
      default: "",
    },
    executed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    executed_at: {
      type: Date,
      default: null,
    },
    cancelled_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    cancelled_at: {
      type: Date,
      default: null,
    },
    cancellation_reason: {
      type: String,
      trim: true,
      default: "",
    },
    // Post-execution tracking
    original_from_budgeted: {
      type: mongoose.Schema.Types.Decimal128,
      default: null,
    },
    original_to_budgeted: {
      type: mongoose.Schema.Types.Decimal128,
      default: null,
    },
    new_from_budgeted: {
      type: mongoose.Schema.Types.Decimal128,
      default: null,
    },
    new_to_budgeted: {
      type: mongoose.Schema.Types.Decimal128,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function(doc, ret) {
        // Convert Decimal128 to numbers
        if (ret.amount && typeof ret.amount === 'object' && ret.amount.$numberDecimal) {
          ret.amount = parseFloat(ret.amount.$numberDecimal);
        } else if (ret.amount && typeof ret.amount.toString === 'function') {
          ret.amount = parseFloat(ret.amount.toString());
        }
        if (ret.original_from_budgeted && typeof ret.original_from_budgeted.toString === 'function') {
          ret.original_from_budgeted = parseFloat(ret.original_from_budgeted.toString());
        }
        if (ret.original_to_budgeted && typeof ret.original_to_budgeted.toString === 'function') {
          ret.original_to_budgeted = parseFloat(ret.original_to_budgeted.toString());
        }
        if (ret.new_from_budgeted && typeof ret.new_from_budgeted.toString === 'function') {
          ret.new_from_budgeted = parseFloat(ret.new_from_budgeted.toString());
        }
        if (ret.new_to_budgeted && typeof ret.new_to_budgeted.toString === 'function') {
          ret.new_to_budgeted = parseFloat(ret.new_to_budgeted.toString());
        }
        return ret;
      },
    },
  }
);

// Compound indexes for efficient queries
budgetTransferSchema.index({ company_id: 1, budget_id: 1, status: 1 });
budgetTransferSchema.index({ company_id: 1, status: 1, requested_at: -1 });
budgetTransferSchema.index({ from_line_id: 1 });
budgetTransferSchema.index({ to_line_id: 1 });
budgetTransferSchema.index({ requested_by: 1 });

// Prevent duplicate pending transfers for same lines
budgetTransferSchema.index(
  { from_line_id: 1, to_line_id: 1, status: 1 },
  {
    partialFilterExpression: { status: { $in: ["pending", "approved"] } },
    unique: true,
  }
);

module.exports = mongoose.model("BudgetTransfer", budgetTransferSchema);
