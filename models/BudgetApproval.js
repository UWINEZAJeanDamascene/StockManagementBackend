const mongoose = require("mongoose");

/**
 * BudgetApproval model tracks multi-level approval workflows
 * Contains both workflow configuration and approval instances
 */

const approvalStepSchema = new mongoose.Schema({
  step_number: {
    type: Number,
    required: true,
  },
  step_name: {
    type: String,
    required: true,
    trim: true,
  },
  // Who can approve at this step
  approver_type: {
    type: String,
    enum: ["user", "role", "department_head", "any_manager", "specific_user"],
    required: true,
  },
  approver_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  approver_role: {
    type: String,
    default: null,
  },
  // Approval requirements
  required_approvals: {
    type: Number,
    default: 1,
    min: 1,
  },
  // Amount threshold for this step (optional)
  min_amount: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
  },
  max_amount: {
    type: mongoose.Schema.Types.Decimal128,
    default: null,
  },
  // Business rules
  can_reject: {
    type: Boolean,
    default: true,
  },
  can_request_changes: {
    type: Boolean,
    default: true,
  },
  // Auto-approve after timeout (hours), null = no auto-approve
  auto_approve_hours: {
    type: Number,
    default: null,
  },
  // Notifications
  notify_approvers: {
    type: [String], // email addresses or user IDs
    default: [],
  },
}, { _id: true });

const approvalActionSchema = new mongoose.Schema({
  step_number: {
    type: Number,
    required: true,
  },
  action: {
    type: String,
    enum: ["approved", "rejected", "requested_changes", "delegated", "timeout"],
    required: true,
  },
  action_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  action_at: {
    type: Date,
    default: Date.now,
  },
  comments: {
    type: String,
    default: "",
  },
  // For delegation
  delegated_to: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
}, { _id: true });

const budgetApprovalSchema = new mongoose.Schema(
  {
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    // Reference to budget being approved
    budget_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Budget",
      required: true,
      index: true,
    },
    // Workflow type
    workflow_type: {
      type: String,
      enum: ["budget_creation", "budget_transfer", "budget_adjustment", "encumbrance"],
      required: true,
    },
    // Reference to workflow config
    workflow_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BudgetWorkflowConfig",
      default: null,
      index: true,
    },
    // Related document (for transfers, encumbrances, etc.)
    related_document_type: {
      type: String,
      enum: ["budget_transfer", "budget_line", "encumbrance", null],
      default: null,
    },
    related_document_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    // Amount being approved (for threshold checks)
    amount: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
    },
    // Workflow definition
    workflow_name: {
      type: String,
      required: true,
    },
    steps: [approvalStepSchema],
    // Current state
    current_step: {
      type: Number,
      default: 1,
    },
    total_steps: {
      type: Number,
      default: 1,
    },
    // Status
    status: {
      type: String,
      enum: ["pending", "in_progress", "approved", "rejected", "changes_requested", "cancelled", "timeout"],
      default: "pending",
      index: true,
    },
    // History of all actions
    actions: [approvalActionSchema],
    // Requester info
    requested_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    requested_at: {
      type: Date,
      default: Date.now,
    },
    request_comments: {
      type: String,
      default: "",
    },
    // Final approval
    final_approved_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    final_approved_at: {
      type: Date,
      default: null,
    },
    // Rejection info
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
      default: "",
    },
    // Changes requested
    changes_requested_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    changes_requested_at: {
      type: Date,
      default: null,
    },
    changes_required: {
      type: String,
      default: "",
    },
    // Cancellation
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
      default: "",
    },
    // Urgency
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },
    // Due date for approval
    due_date: {
      type: Date,
      default: null,
    },
    // Reminders sent
    reminders_sent: {
      type: Number,
      default: 0,
    },
    last_reminder_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function(doc, ret) {
        // Convert Decimal128 to numbers
        if (ret.amount && typeof ret.amount.toString === 'function') {
          ret.amount = parseFloat(ret.amount.toString());
        }
        // Convert step amounts
        if (ret.steps && Array.isArray(ret.steps)) {
          ret.steps = ret.steps.map(step => {
            if (step.min_amount && typeof step.min_amount.toString === 'function') {
              step.min_amount = parseFloat(step.min_amount.toString());
            }
            if (step.max_amount && typeof step.max_amount.toString === 'function') {
              step.max_amount = parseFloat(step.max_amount.toString());
            }
            return step;
          });
        }
        return ret;
      },
    },
  }
);

// Compound indexes
budgetApprovalSchema.index({ company_id: 1, budget_id: 1, status: 1 });
budgetApprovalSchema.index({ company_id: 1, status: 1, priority: 1, requested_at: -1 });
budgetApprovalSchema.index({ company_id: 1, workflow_type: 1, status: 1 });
budgetApprovalSchema.index({ workflow_id: 1, status: 1 });
budgetApprovalSchema.index({ requested_by: 1, status: 1 });
budgetApprovalSchema.index({ "actions.action_by": 1 });
budgetApprovalSchema.index({ related_document_type: 1, related_document_id: 1 });

module.exports = mongoose.model("BudgetApproval", budgetApprovalSchema);
