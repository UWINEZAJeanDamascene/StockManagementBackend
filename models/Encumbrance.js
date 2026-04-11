const mongoose = require("mongoose");

const encumbranceSchema = new mongoose.Schema(
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
    budget_line_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BudgetLine",
      required: true,
      index: true,
    },
    account_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      required: true,
    },
    // Source document that created this encumbrance
    source_type: {
      type: String,
      enum: ["purchase", "purchase_order", "goods_received_note", "expense_request", "manual"],
      required: true,
    },
    source_id: {
      type: String,
      required: true,
    },
    source_number: {
      type: String,
      required: true,
    },
    // Encumbrance details
    description: {
      type: String,
      required: true,
      trim: true,
    },
    encumbered_amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      default: 0,
    },
    liquidated_amount: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
    },
    released_amount: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
    },
    remaining_amount: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
    },
    // Status
    status: {
      type: String,
      enum: ["active", "partially_liquidated", "fully_liquidated", "released", "cancelled"],
      default: "active",
      index: true,
    },
    // Dates
    encumbrance_date: {
      type: Date,
      default: Date.now,
    },
    expected_liquidation_date: {
      type: Date,
      default: null,
    },
    liquidated_at: {
      type: Date,
      default: null,
    },
    released_at: {
      type: Date,
      default: null,
    },
    // References to liquidation documents
    liquidations: [
      {
        document_type: {
          type: String,
          enum: ["invoice", "payment", "journal_entry", "purchase_received", "purchase_payment", "goods_received_note", "expense_payment"],
        },
        document_id: String,
        document_number: String,
        amount: mongoose.Schema.Types.Decimal128,
        date: Date,
        notes: String,
      },
    ],
    // Metadata
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    released_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    release_reason: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function(doc, ret) {
        // Convert Decimal128 to numbers
        if (ret.encumbered_amount && typeof ret.encumbered_amount.toString === 'function') {
          ret.encumbered_amount = parseFloat(ret.encumbered_amount.toString());
        }
        if (ret.liquidated_amount && typeof ret.liquidated_amount.toString === 'function') {
          ret.liquidated_amount = parseFloat(ret.liquidated_amount.toString());
        }
        if (ret.released_amount && typeof ret.released_amount.toString === 'function') {
          ret.released_amount = parseFloat(ret.released_amount.toString());
        }
        if (ret.remaining_amount && typeof ret.remaining_amount.toString === 'function') {
          ret.remaining_amount = parseFloat(ret.remaining_amount.toString());
        }
        // Convert liquidation amounts
        if (ret.liquidations && Array.isArray(ret.liquidations)) {
          ret.liquidations = ret.liquidations.map(liq => {
            if (liq.amount && typeof liq.amount.toString === 'function') {
              liq.amount = parseFloat(liq.amount.toString());
            }
            return liq;
          });
        }
        return ret;
      },
    },
  }
);

// Compound indexes for efficient queries
encumbranceSchema.index({ company_id: 1, budget_id: 1, status: 1 });
encumbranceSchema.index({ company_id: 1, account_id: 1, status: 1 });
encumbranceSchema.index({ budget_line_id: 1, status: 1 });
encumbranceSchema.index({ source_type: 1, source_id: 1 });
encumbranceSchema.index({ encumbrance_date: -1 });

// Pre-save hook to calculate remaining amount
encumbranceSchema.pre("save", function (next) {
  const encumbered = Number(this.encumbered_amount?.toString() || 0);
  const liquidated = Number(this.liquidated_amount?.toString() || 0);
  const released = Number(this.released_amount?.toString() || 0);

  this.remaining_amount = encumbered - liquidated - released;

  // Auto-update status based on amounts
  if (released >= encumbered) {
    this.status = "released";
  } else if (liquidated >= encumbered) {
    this.status = "fully_liquidated";
  } else if (liquidated > 0) {
    this.status = "partially_liquidated";
  } else {
    this.status = "active";
  }

  next();
});

module.exports = mongoose.model("Encumbrance", encumbranceSchema);
