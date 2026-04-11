const mongoose = require("mongoose");

/**
 * BudgetWorkflowConfig model stores reusable multi-level approval workflow templates
 * These templates define the approval hierarchy based on amount thresholds and workflow types
 */

const workflowStepSchema = new mongoose.Schema({
  step_number: {
    type: Number,
    required: true,
    min: 1,
  },
  step_name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  description: {
    type: String,
    default: "",
    maxlength: 500,
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
  can_delegate: {
    type: Boolean,
    default: false,
  },
  // Auto-approve after timeout (hours), null = no auto-approve
  auto_approve_hours: {
    type: Number,
    default: null,
    min: 1,
  },
  // Notifications
  notify_approvers: {
    type: [String],
    default: [],
  },
  // Conditional logic (optional)
  condition: {
    type: String,
    enum: ["always", "amount_threshold", "department_match", "custom"],
    default: "always",
  },
  condition_config: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
}, { _id: true });

const budgetWorkflowConfigSchema = new mongoose.Schema(
  {
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    // Workflow identification
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      default: "",
      maxlength: 500,
    },
    // Workflow type this config applies to
    workflow_type: {
      type: String,
      enum: ["budget_creation", "budget_transfer", "budget_adjustment", "encumbrance", "expense", "all"],
      required: true,
      index: true,
    },
    // Amount range this workflow applies to
    min_amount: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
    },
    max_amount: {
      type: mongoose.Schema.Types.Decimal128,
      default: null, // null = no upper limit
    },
    // Department scope
    department_scope: {
      type: String,
      enum: ["all", "specific"],
      default: "all",
    },
    department_ids: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Department",
      default: [],
    },
    // The approval steps
    steps: [workflowStepSchema],
    // Workflow behavior
    is_active: {
      type: Boolean,
      default: true,
    },
    is_default: {
      type: Boolean,
      default: false,
      // If true, this is the fallback workflow when no specific match found
    },
    // Priority for workflow selection (higher = preferred)
    priority: {
      type: Number,
      default: 0,
    },
    // General workflow settings
    settings: {
      allow_parallel_approvals: {
        type: Boolean,
        default: false,
      },
      require_all_steps: {
        type: Boolean,
        default: true,
      },
      notify_requester_on_approval: {
        type: Boolean,
        default: true,
      },
      notify_requester_on_rejection: {
        type: Boolean,
        default: true,
      },
      escalation_hours: {
        type: Number,
        default: 48, // Escalate after 48 hours if no action
      },
      escalation_user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
    },
    // Usage statistics
    usage_count: {
      type: Number,
      default: 0,
    },
    last_used_at: {
      type: Date,
      default: null,
    },
    // Audit fields
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updated_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function(doc, ret) {
        // Convert Decimal128 to numbers
        if (ret.min_amount && typeof ret.min_amount.toString === "function") {
          ret.min_amount = parseFloat(ret.min_amount.toString());
        }
        if (ret.max_amount && typeof ret.max_amount.toString === "function") {
          ret.max_amount = parseFloat(ret.max_amount.toString());
        }
        // Convert step amounts
        if (ret.steps && Array.isArray(ret.steps)) {
          ret.steps = ret.steps.map(step => {
            if (step.min_amount && typeof step.min_amount.toString === "function") {
              step.min_amount = parseFloat(step.min_amount.toString());
            }
            if (step.max_amount && typeof step.max_amount.toString === "function") {
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

// Compound indexes for efficient queries
budgetWorkflowConfigSchema.index({ company_id: 1, workflow_type: 1, is_active: 1 });
budgetWorkflowConfigSchema.index({ company_id: 1, is_default: 1, workflow_type: 1 });
budgetWorkflowConfigSchema.index({ company_id: 1, priority: -1 });
budgetWorkflowConfigSchema.index({ company_id: 1, "steps.approver_role": 1 });

// Ensure only one default workflow per type per company
budgetWorkflowConfigSchema.index(
  { company_id: 1, workflow_type: 1, is_default: 1 },
  {
    unique: true,
    partialFilterExpression: { is_default: true },
  }
);

/**
 * Find the best matching workflow for given criteria
 */
budgetWorkflowConfigSchema.statics.findMatchingWorkflow = async function(
  companyId,
  workflowType,
  amount = 0,
  departmentId = null
) {
  const query = {
    company_id: companyId,
    workflow_type: { $in: [workflowType, "all"] },
    is_active: true,
  };

  // Find workflows that match the amount range
  const workflows = await this.find(query).sort({ priority: -1, createdAt: -1 });
  console.log('[DEBUG] findMatchingWorkflow found', workflows.length, 'workflows for type:', workflowType);

  for (const workflow of workflows) {
    // Check amount range
    const minAmt = workflow.min_amount ? parseFloat(workflow.min_amount.toString()) : 0;
    const maxAmt = workflow.max_amount ? parseFloat(workflow.max_amount.toString()) : Infinity;

    console.log('[DEBUG] Checking workflow:', workflow.name, 'amount range:', minAmt, '-', maxAmt === Infinity ? '∞' : maxAmt, 'vs budget:', amount);

    if (amount < minAmt || (maxAmt !== Infinity && amount > maxAmt)) {
      console.log('[DEBUG]  -> Amount mismatch, skipping');
      continue;
    }

    // Check department scope
    if (workflow.department_scope === "specific" && departmentId) {
      const deptIds = workflow.department_ids.map(id => id.toString());
      if (!deptIds.includes(departmentId.toString())) {
        console.log('[DEBUG]  -> Department mismatch, skipping');
        continue;
      }
    }

    console.log('[DEBUG]  -> MATCHED workflow:', workflow.name);
    return workflow;
  }

  // Return default workflow if no specific match
  console.log('[DEBUG] No specific match found, returning default workflow');
  return await this.findOne({
    company_id: companyId,
    workflow_type: workflowType,
    is_default: true,
    is_active: true,
  });
};

module.exports = mongoose.model("BudgetWorkflowConfig", budgetWorkflowConfigSchema);
