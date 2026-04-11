const mongoose = require("mongoose");

/**
 * BudgetRevision - Tracks all changes made to budgets for audit and rollback
 * Stores before/after snapshots with field-level diff tracking
 */

const fieldChangeSchema = new mongoose.Schema({
  field: {
    type: String,
    required: true,
  },
  old_value: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  new_value: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  change_type: {
    type: String,
    enum: ["added", "modified", "removed"],
    required: true,
  },
});

const budgetRevisionSchema = new mongoose.Schema(
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
    // Revision number (auto-incrementing per budget)
    revision_number: {
      type: Number,
      required: true,
    },
    // Type of change
    change_type: {
      type: String,
      enum: ["create", "update", "delete", "status_change", "line_added", "line_updated", "line_removed", "transfer", "adjustment"],
      required: true,
    },
    // Description of the change
    description: {
      type: String,
      required: true,
    },
    // Detailed field changes
    field_changes: [fieldChangeSchema],
    // Complete before/after snapshots for major changes
    before_snapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    after_snapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    // For line item changes - reference to the specific line
    affected_line_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    // Amount impact tracking
    amount_impact: {
      type: Number,
      default: 0,
    },
    // User who made the change
    changed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    changed_at: {
      type: Date,
      default: Date.now,
    },
    // IP address and user agent for audit
    ip_address: {
      type: String,
      default: null,
    },
    user_agent: {
      type: String,
      default: null,
    },
    // Rollback information (if this revision was rolled back)
    rolled_back: {
      type: Boolean,
      default: false,
    },
    rolled_back_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    rolled_back_at: {
      type: Date,
      default: null,
    },
    rollback_reason: {
      type: String,
      default: null,
    },
    // Link to related documents (transfers, approvals, etc.)
    related_document_type: {
      type: String,
      enum: ["budget_transfer", "budget_approval", "encumbrance", "purchase_order", "manual_adjustment", null],
      default: null,
    },
    related_document_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    // Comments/notes about this revision
    comments: {
      type: String,
      default: null,
    },
    // Tags for categorizing revisions
    tags: [{
      type: String,
    }],
  },
  {
    timestamps: true,
  }
);

// Compound indexes
budgetRevisionSchema.index({ company_id: 1, budget_id: 1, revision_number: 1 }, { unique: true });
budgetRevisionSchema.index({ company_id: 1, budget_id: 1, changed_at: -1 });
budgetRevisionSchema.index({ company_id: 1, changed_by: 1 });
budgetRevisionSchema.index({ change_type: 1 });

// Pre-save hook to auto-increment revision number
budgetRevisionSchema.pre("save", async function (next) {
  if (this.isNew) {
    const lastRevision = await this.constructor.findOne(
      { company_id: this.company_id, budget_id: this.budget_id },
      { revision_number: 1 },
      { sort: { revision_number: -1 } }
    );
    this.revision_number = lastRevision ? lastRevision.revision_number + 1 : 1;
  }
  next();
});

// Method to compare two objects and generate field changes
budgetRevisionSchema.statics.generateFieldChanges = function (before, after, options = {}) {
  const changes = [];
  const fieldsToTrack = options.fields || Object.keys({ ...before, ...after });
  const excludeFields = options.exclude || ["_id", "createdAt", "updatedAt", "__v"];

  for (const field of fieldsToTrack) {
    if (excludeFields.includes(field)) continue;

    const oldVal = before?.[field];
    const newVal = after?.[field];

    // Handle nested objects
    if (typeof oldVal === "object" && typeof newVal === "object" && !Array.isArray(oldVal)) {
      const nestedChanges = this.generateFieldChanges(oldVal, newVal, {
        ...options,
        prefix: `${field}.`,
      });
      changes.push(...nestedChanges);
      continue;
    }

    // Compare values
    const oldStr = JSON.stringify(oldVal);
    const newStr = JSON.stringify(newVal);

    if (oldStr !== newStr) {
      let changeType = "modified";
      if (oldVal === undefined || oldVal === null) changeType = "added";
      else if (newVal === undefined || newVal === null) changeType = "removed";

      changes.push({
        field: options.prefix ? `${options.prefix}${field}` : field,
        old_value: oldVal,
        new_value: newVal,
        change_type: changeType,
      });
    }
  }

  return changes;
};

module.exports = mongoose.model("BudgetRevision", budgetRevisionSchema);
