const mongoose = require("mongoose");

const budgetSchema = new mongoose.Schema(
  {
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    category: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: ["revenue", "expense", "profit"],
      default: "expense",
    },
    fiscal_year: {
      type: Number,
      required: true,
    },
    periodStart: {
      type: Date,
      default: null,
    },
    periodEnd: {
      type: Date,
      default: null,
    },
    periodType: {
      type: String,
      enum: ["monthly", "quarterly", "yearly", "custom"],
      default: "yearly",
    },
    amount: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
    },
    status: {
      type: String,
      enum: [
        "draft",
        "pending_approval",
        "active",
        "approved",
        "rejected",
        "closed",
        "cancelled",
        "locked",
      ],
      default: "draft",
    },
    workflow_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BudgetWorkflowConfig",
      default: null,
      index: true,
    },
    current_approval_step: {
      type: Number,
      default: 0,
    },
    total_approval_steps: {
      type: Number,
      default: 0,
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
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
    locked_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    locked_at: {
      type: Date,
      default: null,
    },
    unlocked_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    unlocked_at: {
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
    rejectionReason: {
      type: String,
      trim: true,
      default: "",
    },
    closed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    closed_at: {
      type: Date,
      default: null,
    },
    closeNotes: {
      type: String,
      trim: true,
      default: "",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    // Auto-lock settings
    auto_lock: {
      enabled: {
        type: Boolean,
        default: false,
      },
      days_after_period_end: {
        type: Number,
        default: 0,
      },
    },
    fiscal_year_end: {
      type: Date,
      default: null,
    },
    year_end_lock: {
      type: Boolean,
      default: false,
    },
    auto_locked: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function(doc, ret) {
        // Convert Decimal128 to number
        if (ret.amount && typeof ret.amount === 'object' && ret.amount.$numberDecimal) {
          ret.amount = parseFloat(ret.amount.$numberDecimal);
        } else if (ret.amount && typeof ret.amount.toString === 'function') {
          ret.amount = parseFloat(ret.amount.toString());
        }
        return ret;
      },
    },
  },
);

// One budget per fiscal year per company (can have multiple but track by name)
budgetSchema.index(
  { company_id: 1, fiscal_year: 1, name: 1 },
  { unique: true },
);
budgetSchema.index({ company_id: 1, status: 1 });
budgetSchema.index({ company_id: 1, type: 1 });
budgetSchema.index({ company_id: 1, department: 1 });
budgetSchema.index({ company_id: 1, periodStart: 1, periodEnd: 1 });

module.exports = mongoose.model("Budget", budgetSchema);
