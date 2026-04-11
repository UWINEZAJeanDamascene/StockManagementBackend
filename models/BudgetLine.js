const mongoose = require("mongoose");

const budgetLineSchema = new mongoose.Schema(
  {
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    budget_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Budget",
      required: true,
    },
    account_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      required: true,
    },
    category: {
      type: String,
      trim: true,
      default: "",
    },
    period_month: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
    },
    period_year: {
      type: Number,
      required: true,
    },
    budgeted_amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      default: 0,
    },
    encumbered_amount: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
    },
    actual_amount: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function(doc, ret) {
        // Convert Decimal128 fields to numbers
        ['budgeted_amount', 'encumbered_amount', 'actual_amount'].forEach(field => {
          if (ret[field] && typeof ret[field] === 'object' && ret[field].$numberDecimal) {
            ret[field] = parseFloat(ret[field].$numberDecimal);
          } else if (ret[field] && typeof ret[field].toString === 'function') {
            ret[field] = parseFloat(ret[field].toString());
          }
        });
        return ret;
      },
    },
  },
);

// Compound indexes for efficient queries
budgetLineSchema.index({
  company_id: 1,
  budget_id: 1,
  period_year: 1,
  period_month: 1,
});
budgetLineSchema.index({
  company_id: 1,
  account_id: 1,
  period_year: 1,
  period_month: 1,
});
budgetLineSchema.index(
  {
    company_id: 1,
    budget_id: 1,
    account_id: 1,
    period_month: 1,
    period_year: 1,
  },
  { unique: true },
);

module.exports = mongoose.model("BudgetLine", budgetLineSchema);
