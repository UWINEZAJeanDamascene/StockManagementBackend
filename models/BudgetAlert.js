const mongoose = require("mongoose");

/**
 * BudgetAlertConfiguration - Stores alert rules for budget monitoring
 * Can be set at company level (default) or budget-specific
 */

const budgetAlertSchema = new mongoose.Schema(
  {
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    // If null, this is the company default. If set, this is budget-specific.
    budget_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Budget",
      default: null,
      index: true,
    },
    // Alert enabled/disabled
    is_enabled: {
      type: Boolean,
      default: true,
    },
    // Alert thresholds (percentage of budget)
    thresholds: {
      warning: {
        type: Number,
        default: 75, // 75% - yellow warning
        min: 0,
        max: 100,
      },
      critical: {
        type: Number,
        default: 90, // 90% - orange critical
        min: 0,
        max: 100,
      },
      exceeded: {
        type: Number,
        default: 100, // 100% - red exceeded
        min: 0,
        max: 100,
      },
    },
    // Variance tolerance (percentage allowed over budget before alerting)
    variance_tolerance: {
      type: Number,
      default: 5, // 5% tolerance
      min: 0,
      max: 50,
    },
    // Alert frequency - how often to send repeated alerts
    alert_frequency: {
      type: String,
      enum: ["once", "daily", "weekly", "monthly"],
      default: "weekly",
    },
    // Last alert sent timestamp (to prevent spam)
    last_alert_sent: {
      type: Date,
      default: null,
    },
    // Who should receive alerts
    notify_users: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // Also notify specific roles
    notify_roles: [
      {
        type: String,
        enum: ["finance_manager", "department_head", "budget_owner", "admin"],
      },
    ],
    // Alert channels
    channels: {
      in_app: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
    },
    // Alert types to enable
    alert_types: {
      threshold_reached: { type: Boolean, default: true },
      budget_exceeded: { type: Boolean, default: true },
      variance_detected: { type: Boolean, default: true },
      encumbrance_warning: { type: Boolean, default: true },
      period_closing: { type: Boolean, default: true },
      unusual_spending: { type: Boolean, default: false }, // AI-detected anomalies
    },
    // Account-specific overrides (optional)
    account_overrides: [
      {
        account_id: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "ChartOfAccount",
        },
        thresholds: {
          warning: Number,
          critical: Number,
          exceeded: Number,
        },
      },
    ],
    // Quiet hours (don't send alerts during these hours)
    quiet_hours: {
      enabled: { type: Boolean, default: false },
      start: { type: Number, default: 22 }, // 10 PM
      end: { type: Number, default: 7 }, // 7 AM
    },
    // Metadata
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
budgetAlertSchema.index({ company_id: 1, budget_id: 1 }, { unique: true });
budgetAlertSchema.index({ company_id: 1, is_enabled: 1 });

// Pre-save validation - ensure thresholds are in correct order
budgetAlertSchema.pre("save", function (next) {
  if (this.thresholds.warning >= this.thresholds.critical) {
    return next(new Error("Warning threshold must be less than critical threshold"));
  }
  if (this.thresholds.critical >= this.thresholds.exceeded) {
    return next(new Error("Critical threshold must be less than exceeded threshold"));
  }
  next();
});

module.exports = mongoose.model("BudgetAlert", budgetAlertSchema);
