const BudgetService = require("../services/budgetService");

// ── CREATE ─────────────────────────────────────────────────────────────
exports.createBudget = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { name, fiscal_year } = req.body;

    if (!name || !fiscal_year) {
      return res
        .status(400)
        .json({ error: "name and fiscal_year are required" });
    }

    const budget = await BudgetService.create(companyId, req.body, userId);
    res.status(201).json({ success: true, data: budget });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: "BUDGET_DUPLICATE" });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── LIST ───────────────────────────────────────────────────────────────
exports.getBudgets = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const {
      status,
      fiscal_year,
      type,
      department,
      search,
      page,
      limit,
      startDate,
      endDate,
    } = req.query;

    const result = await BudgetService.findAll(companyId, {
      status,
      fiscal_year,
      type,
      department,
      search,
      page,
      limit,
      startDate,
      endDate,
    });
    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ── GET BY ID ──────────────────────────────────────────────────────────
exports.getBudgetById = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { id } = req.params;

    const budget = await BudgetService.findById(companyId, id);
    res.json({ success: true, data: budget });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Budget not found" });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── UPDATE ─────────────────────────────────────────────────────────────
exports.updateBudget = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id } = req.params;

    const budget = await BudgetService.update(companyId, id, req.body, userId);
    res.json({ success: true, data: budget });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Budget not found" });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── DELETE ─────────────────────────────────────────────────────────────
exports.deleteBudget = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { id } = req.params;

    await BudgetService.delete(companyId, id);
    res.json({ success: true, message: "Budget deleted successfully" });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Budget not found" });
    }
    if (error.message === "BUDGET_NOT_DRAFT") {
      return res.status(400).json({ error: "Can only delete draft budgets" });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── UPSERT LINES ──────────────────────────────────────────────────────
exports.upsertLines = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id } = req.params;
    const { lines } = req.body;

    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: "lines array is required" });
    }

    const result = await BudgetService.upsertLines(
      companyId,
      id,
      lines,
      userId,
    );
    res.json({ success: true, data: result });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Budget not found" });
    }
    if (error.message === "BUDGET_LOCKED") {
      return res.status(400).json({ error: "Budget is locked or closed" });
    }
    if (error.message === "ACCOUNT_NOT_FOUND") {
      return res
        .status(400)
        .json({ error: "Account not found or belongs to different company" });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── GET LINES ──────────────────────────────────────────────────────────
exports.getLines = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { id } = req.params;
    const { period_year, period_month } = req.query;

    const lines = await BudgetService.getLines(companyId, id, {
      period_year,
      period_month,
    });
    res.json({ success: true, data: lines });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ── APPROVE ────────────────────────────────────────────────────────────
exports.approveBudget = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id } = req.params;

    const budget = await BudgetService.approve(companyId, id, userId);
    res.json({
      success: true,
      data: budget,
      message: "Budget approved successfully",
    });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Budget not found" });
    }
    if (error.message === "BUDGET_NOT_DRAFT") {
      return res.status(400).json({ error: "Can only approve draft budgets" });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── REJECT ─────────────────────────────────────────────────────────────
exports.rejectBudget = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id } = req.params;
    const { reason } = req.body || {};

    const budget = await BudgetService.reject(
      companyId,
      id,
      userId,
      reason || "",
    );
    res.json({ success: true, data: budget, message: "Budget rejected" });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Budget not found" });
    }
    if (error.message === "BUDGET_CANNOT_REJECT") {
      return res
        .status(400)
        .json({ error: "Budget cannot be rejected in its current status" });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── LOCK ───────────────────────────────────────────────────────────────
exports.lockBudget = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id } = req.params;

    const budget = await BudgetService.lock(companyId, id, userId);
    res.json({
      success: true,
      data: budget,
      message: "Budget locked successfully",
    });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Budget not found" });
    }
    if (error.message === "BUDGET_NOT_APPROVED") {
      return res.status(400).json({ error: "Can only lock approved budgets" });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── UNLOCK ────────────────────────────────────────────────────────────
exports.unlockBudget = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id } = req.params;

    const budget = await BudgetService.unlock(companyId, id, userId);
    res.json({
      success: true,
      data: budget,
      message: "Budget unlocked successfully",
    });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Budget not found" });
    }
    if (error.message === "BUDGET_NOT_LOCKED") {
      return res.status(400).json({ error: "Can only unlock locked budgets" });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── CLOSE ──────────────────────────────────────────────────────────────
exports.closeBudget = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id } = req.params;
    const { notes } = req.body || {};

    const budget = await BudgetService.close(
      companyId,
      id,
      userId,
      notes || "",
    );
    res.json({
      success: true,
      data: budget,
      message: "Budget closed successfully",
    });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Budget not found" });
    }
    if (error.message === "BUDGET_ALREADY_CLOSED") {
      return res.status(400).json({ error: "Budget is already closed" });
    }
    if (error.message === "BUDGET_NOT_APPROVED") {
      return res.status(400).json({ error: "Cannot close a draft budget" });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── CLONE ──────────────────────────────────────────────────────────────
exports.cloneBudget = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id } = req.params;
    const { newPeriodStart, newPeriodEnd, newName } = req.body;

    if (!newPeriodStart || !newPeriodEnd) {
      return res
        .status(400)
        .json({ error: "newPeriodStart and newPeriodEnd are required" });
    }

    const budget = await BudgetService.clone(companyId, id, userId, {
      newPeriodStart,
      newPeriodEnd,
      newName,
    });
    res
      .status(201)
      .json({
        success: true,
        data: budget,
        message: "Budget cloned successfully",
      });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Source budget not found" });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── SUMMARY ────────────────────────────────────────────────────────────
exports.getSummary = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const summary = await BudgetService.getSummary(companyId);
    res.json({ success: true, data: summary });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ── COMPARE ALL ────────────────────────────────────────────────────────
exports.getAllComparisons = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { status, type, periodStart, periodEnd } = req.query;

    const result = await BudgetService.getAllComparisons(companyId, {
      status,
      type,
      periodStart,
      periodEnd,
    });
    res.json({ success: true, data: result.data, summary: result.summary });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ── COMPARE SINGLE ────────────────────────────────────────────────────
exports.getComparison = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { id } = req.params;

    const comparison = await BudgetService.getComparison(companyId, id);
    res.json({ success: true, data: comparison });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Budget not found" });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── VARIANCE REPORT ────────────────────────────────────────────────────
exports.getVarianceReport = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { id } = req.params;
    const { periodStart, periodEnd } = req.query;

    if (!periodStart || !periodEnd) {
      return res
        .status(400)
        .json({ error: "periodStart and periodEnd are required" });
    }

    const report = await BudgetService.getVarianceReport(companyId, id, {
      periodStart,
      periodEnd,
    });
    res.json({ success: true, data: report });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Budget not found" });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── FORECASTS ──────────────────────────────────────────────────────────
exports.getRevenueForecast = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const months = Math.min(36, Math.max(1, parseInt(req.query.months) || 6));

    const forecast = await BudgetService.getRevenueForecast(companyId, months);
    res.json({ success: true, data: forecast });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getExpenseForecast = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const months = Math.min(36, Math.max(1, parseInt(req.query.months) || 6));

    const forecast = await BudgetService.getExpenseForecast(companyId, months);
    res.json({ success: true, data: forecast });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getCashFlowForecast = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const months = Math.min(36, Math.max(1, parseInt(req.query.months) || 6));

    const forecast = await BudgetService.getCashFlowForecast(companyId, months);
    res.json({ success: true, data: forecast });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ── BUDGET TRANSFERS ───────────────────────────────────────────────────

exports.createTransfer = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id } = req.params;
    const { from_line_id, to_line_id, amount, transfer_date, reason, notes } = req.body;

    if (!from_line_id || !to_line_id || !amount || !reason) {
      return res.status(400).json({
        error: "from_line_id, to_line_id, amount, and reason are required",
      });
    }

    const transfer = await BudgetService.createTransfer(companyId, id, {
      from_line_id,
      to_line_id,
      amount,
      transfer_date,
      reason,
      notes,
    }, userId);

    res.status(201).json({
      success: true,
      data: transfer,
      message: "Budget transfer request created successfully",
    });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Budget not found" });
    }
    if (error.message === "BUDGET_NOT_ACTIVE") {
      return res.status(400).json({ error: "Budget is not in an active state" });
    }
    if (error.message === "TRANSFER_INVALID_DATA") {
      return res.status(400).json({ error: "Invalid transfer data provided" });
    }
    if (error.message === "TRANSFER_SAME_LINE") {
      return res.status(400).json({ error: "Cannot transfer to the same budget line" });
    }
    if (error.message === "BUDGET_LINE_NOT_FOUND") {
      return res.status(404).json({ error: "One or both budget lines not found" });
    }
    if (error.message === "TRANSFER_INSUFFICIENT_BUDGET") {
      return res.status(400).json({ error: "Insufficient budget in source line" });
    }
    if (error.message === "TRANSFER_ALREADY_PENDING") {
      return res.status(400).json({ error: "A transfer between these lines is already pending" });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.getTransfers = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { id } = req.params;
    const { status } = req.query;

    const transfers = await BudgetService.getTransfersByBudget(companyId, id, { status });
    res.json({ success: true, data: transfers });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.approveTransfer = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id, transferId } = req.params;

    const transfer = await BudgetService.approveTransfer(companyId, transferId, userId);
    res.json({
      success: true,
      data: transfer,
      message: "Budget transfer approved successfully",
    });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Transfer not found" });
    }
    if (error.message === "TRANSFER_NOT_PENDING") {
      return res.status(400).json({ error: "Transfer is not in pending status" });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.rejectTransfer = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id, transferId } = req.params;
    const { reason } = req.body;

    const transfer = await BudgetService.rejectTransfer(companyId, transferId, userId, reason);
    res.json({
      success: true,
      data: transfer,
      message: "Budget transfer rejected",
    });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Transfer not found" });
    }
    if (error.message === "TRANSFER_CANNOT_REJECT") {
      return res.status(400).json({ error: "Transfer cannot be rejected in its current status" });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.executeTransfer = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id, transferId } = req.params;

    const result = await BudgetService.executeTransfer(companyId, transferId, userId);
    res.json({
      success: true,
      data: result,
      message: "Budget transfer executed successfully",
    });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Transfer not found" });
    }
    if (error.message === "TRANSFER_NOT_APPROVED") {
      return res.status(400).json({ error: "Transfer must be approved before execution" });
    }
    if (error.message === "BUDGET_LINE_NOT_FOUND") {
      return res.status(404).json({ error: "Budget line no longer exists" });
    }
    if (error.message === "TRANSFER_INSUFFICIENT_BUDGET") {
      return res.status(400).json({ error: "Insufficient budget available for transfer" });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.cancelTransfer = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id, transferId } = req.params;
    const { reason } = req.body;

    const transfer = await BudgetService.cancelTransfer(companyId, transferId, userId, reason);
    res.json({
      success: true,
      data: transfer,
      message: "Budget transfer cancelled",
    });
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Transfer not found" });
    }
    if (error.message === "TRANSFER_CANNOT_CANCEL") {
      return res.status(400).json({ error: "Transfer cannot be cancelled in its current status" });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── ENCUMBRANCES ───────────────────────────────────────────────────────

exports.createEncumbrance = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id } = req.params;
    const { account_id, source_type, source_id, source_number, description, amount, expected_liquidation_date, notes } = req.body;

    if (!account_id || !source_type || !source_id || !amount || !description) {
      return res.status(400).json({ error: "account_id, source_type, source_id, amount, and description are required" });
    }

    const encumbrance = await BudgetService.createEncumbrance(companyId, {
      budget_id: id,
      account_id,
      source_type,
      source_id,
      source_number,
      description,
      amount,
      expected_liquidation_date,
      notes,
    }, userId);

    res.status(201).json({ success: true, data: encumbrance, message: "Encumbrance created successfully" });
  } catch (error) {
    if (error.message === "BUDGET_NOT_FOUND") {
      return res.status(404).json({ error: "Budget not found" });
    }
    if (error.message === "BUDGET_NOT_ACTIVE") {
      return res.status(400).json({ error: "Budget is not in an active state" });
    }
    if (error.message === "BUDGET_LINE_NOT_FOUND") {
      return res.status(404).json({ error: "No budget line found for this account" });
    }
    if (error.message === "INSUFFICIENT_BUDGET") {
      return res.status(400).json({ error: "Insufficient available budget for this encumbrance" });
    }
    if (error.message === "ENCUMBRANCE_ALREADY_EXISTS") {
      return res.status(400).json({ error: "An encumbrance already exists for this source document" });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.getEncumbrances = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { id } = req.params;
    const { status, account_id } = req.query;

    const encumbrances = await BudgetService.getEncumbrances(companyId, id, { status, account_id });
    res.json({ success: true, data: encumbrances });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getEncumbranceSummary = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { id } = req.params;

    const summary = await BudgetService.getEncumbranceSummary(companyId, id);
    res.json({ success: true, data: summary });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.liquidateEncumbrance = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { sourceType, sourceId } = req.params;
    const { document_type, document_id, document_number, amount, date, notes } = req.body;

    if (!document_type || !document_id || !amount) {
      return res.status(400).json({ error: "document_type, document_id, and amount are required" });
    }

    const encumbrance = await BudgetService.liquidateEncumbrance(companyId, sourceType, sourceId, {
      document_type,
      document_id,
      document_number,
      amount,
      date,
      notes,
    }, userId);

    res.json({ success: true, data: encumbrance, message: "Encumbrance liquidated successfully" });
  } catch (error) {
    if (error.message === "ENCUMBRANCE_NOT_FOUND") {
      return res.status(404).json({ error: "Encumbrance not found" });
    }
    if (error.message === "LIQUIDATION_EXCEEDS_ENCUMBRANCE") {
      return res.status(400).json({ error: "Liquidation amount exceeds remaining encumbrance" });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.releaseEncumbrance = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { sourceType, sourceId } = req.params;
    const { reason } = req.body;

    const encumbrance = await BudgetService.releaseEncumbrance(companyId, sourceType, sourceId, reason, userId);

    res.json({ success: true, data: encumbrance, message: "Encumbrance released successfully" });
  } catch (error) {
    if (error.message === "ENCUMBRANCE_NOT_FOUND") {
      return res.status(404).json({ error: "Encumbrance not found" });
    }
    if (error.message === "NO_REMAINING_ENCUMBRANCE") {
      return res.status(400).json({ error: "No remaining encumbrance to release" });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.adjustEncumbrance = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { encumbranceId } = req.params;
    const { new_amount, reason } = req.body;

    if (!new_amount || !reason) {
      return res.status(400).json({ error: "new_amount and reason are required" });
    }

    const encumbrance = await BudgetService.adjustEncumbrance(companyId, encumbranceId, new_amount, reason, userId);

    res.json({ success: true, data: encumbrance, message: "Encumbrance adjusted successfully" });
  } catch (error) {
    if (error.message === "ENCUMBRANCE_NOT_FOUND") {
      return res.status(404).json({ error: "Encumbrance not found" });
    }
    if (error.message === "ENCUMBRANCE_CANNOT_ADJUST") {
      return res.status(400).json({ error: "Cannot adjust encumbrance in current status" });
    }
    if (error.message === "NEW_AMOUNT_BELOW_LIQUIDATED") {
      return res.status(400).json({ error: "New amount cannot be below already liquidated amount" });
    }
    if (error.message === "INSUFFICIENT_BUDGET_FOR_ADJUSTMENT") {
      return res.status(400).json({ error: "Insufficient budget for this adjustment" });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── MULTI-LEVEL APPROVALS ─────────────────────────────────────────────

exports.submitForApproval = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id } = req.params;
    const { workflow_type, related_document_type, related_document_id, workflow_name, custom_steps, comments, priority, due_date } = req.body;

    const approval = await BudgetService.submitForApproval(companyId, {
      budget_id: id,
      workflow_type,
      related_document_type,
      related_document_id,
      workflow_name,
      custom_steps,
      comments,
      priority,
      due_date,
    }, userId);

    res.status(201).json({ success: true, data: approval, message: "Submitted for approval successfully" });
  } catch (error) {
    if (error.message === "BUDGET_NOT_FOUND") {
      return res.status(404).json({ error: "Budget not found" });
    }
    if (error.message === "APPROVAL_ALREADY_PENDING") {
      return res.status(400).json({ error: "An approval is already pending for this item" });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.approveStep = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id, approvalId } = req.params;
    const { comments } = req.body;

    const approval = await BudgetService.approveStep(companyId, approvalId, userId, comments);

    res.json({ success: true, data: approval, message: "Approved successfully" });
  } catch (error) {
    if (error.message === "APPROVAL_NOT_FOUND") {
      return res.status(404).json({ error: "Approval not found" });
    }
    if (error.message === "APPROVAL_NOT_ACTIVE") {
      return res.status(400).json({ error: "Approval is not in an active state" });
    }
    if (error.message === "ALREADY_APPROVED") {
      return res.status(400).json({ error: "You have already approved this step" });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.rejectApproval = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id, approvalId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: "Rejection reason is required" });
    }

    const approval = await BudgetService.rejectApproval(companyId, approvalId, userId, reason);

    res.json({ success: true, data: approval, message: "Approval rejected" });
  } catch (error) {
    if (error.message === "APPROVAL_NOT_FOUND") {
      return res.status(404).json({ error: "Approval not found" });
    }
    if (error.message === "APPROVAL_NOT_ACTIVE") {
      return res.status(400).json({ error: "Approval is not in an active state" });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.requestChanges = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id, approvalId } = req.params;
    const { changes_required } = req.body;

    if (!changes_required) {
      return res.status(400).json({ error: "Changes required description is needed" });
    }

    const approval = await BudgetService.requestChanges(companyId, approvalId, userId, changes_required);

    res.json({ success: true, data: approval, message: "Changes requested" });
  } catch (error) {
    if (error.message === "APPROVAL_NOT_FOUND") {
      return res.status(404).json({ error: "Approval not found" });
    }
    if (error.message === "APPROVAL_NOT_ACTIVE") {
      return res.status(400).json({ error: "Approval is not in an active state" });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.resubmitApproval = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id, approvalId } = req.params;
    const { comments } = req.body;

    const approval = await BudgetService.resubmitApproval(companyId, approvalId, userId, comments);

    res.json({ success: true, data: approval, message: "Resubmitted for approval" });
  } catch (error) {
    if (error.message === "APPROVAL_NOT_FOUND") {
      return res.status(404).json({ error: "Approval not found" });
    }
    if (error.message === "NO_CHANGES_REQUESTED") {
      return res.status(400).json({ error: "No changes were requested for this approval" });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.cancelApproval = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id, approvalId } = req.params;
    const { reason } = req.body;

    const approval = await BudgetService.cancelApproval(companyId, approvalId, userId, reason);

    res.json({ success: true, data: approval, message: "Approval cancelled" });
  } catch (error) {
    if (error.message === "APPROVAL_NOT_FOUND") {
      return res.status(404).json({ error: "Approval not found" });
    }
    if (error.message === "CANNOT_CANCEL") {
      return res.status(400).json({ error: "Cannot cancel approval in current state" });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.getApprovalHistory = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { id } = req.params;

    const approvals = await BudgetService.getApprovalHistory(companyId, id);
    res.json({ success: true, data: approvals });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getApproval = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { id, approvalId } = req.params;

    const approval = await BudgetService.getApproval(companyId, approvalId);
    res.json({ success: true, data: approval });
  } catch (error) {
    if (error.message === "APPROVAL_NOT_FOUND") {
      return res.status(404).json({ error: "Approval not found" });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.getMyPendingApprovals = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const userRole = req.user?.role || req.role;

    const approvals = await BudgetService.getPendingApprovals(companyId, userId, userRole);
    res.json({ success: true, data: approvals, count: approvals.length });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ── VARIANCE ALERTS ───────────────────────────────────────────────────

exports.getAlertConfiguration = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { id } = req.params;

    const config = await BudgetService.getAlertConfiguration(companyId, id === "default" ? null : id);
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateAlertConfiguration = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id } = req.params;
    const data = req.body;

    const config = await BudgetService.updateAlertConfiguration(
      companyId,
      id === "default" ? null : id,
      data,
      userId
    );
    res.json({ success: true, data: config, message: "Alert configuration updated" });
  } catch (error) {
    if (error.message.includes("Warning threshold must be less than critical")) {
      return res.status(400).json({ error: "Invalid thresholds: warning < critical < exceeded required" });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.checkVariance = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { id } = req.params;

    const result = await BudgetService.checkVarianceAndAlert(companyId, id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getBudgetsNeedingAttention = async (req, res) => {
  try {
    const companyId = req.user.company._id;

    const budgets = await BudgetService.getBudgetsNeedingAttention(companyId);
    res.json({ success: true, data: budgets, count: budgets.length });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.runVarianceChecks = async (req, res) => {
  try {
    const companyId = req.user.company._id;

    const results = await BudgetService.runVarianceChecks(companyId);
    res.json({ success: true, data: results, message: `Checked ${results.checked} budgets, ${results.alerted} alerted` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ── BUDGET PERIOD LOCKING ─────────────────────────────────────────────

exports.getPeriodLocks = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { id } = req.params;
    const { year } = req.query;

    const locks = await BudgetService.getPeriodLocks(companyId, id);
    const periods = await BudgetService.getLockedPeriods(companyId, id, { year: year ? parseInt(year) : undefined });

    res.json({
      success: true,
      data: {
        settings: {
          auto_lock: locks.auto_lock,
          fiscal_year_end: locks.fiscal_year_end,
          year_end_lock: locks.year_end_lock,
        },
        locked_periods: periods,
      },
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.lockPeriod = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id } = req.params;
    const { year, month, reason, allow_transfers, allow_encumbrances } = req.body;

    if (!year || !month) {
      return res.status(400).json({ error: "Year and month are required" });
    }

    const locks = await BudgetService.lockPeriod(companyId, id, year, month, {
      reason,
      allow_transfers,
      allow_encumbrances,
    }, userId);

    res.json({ success: true, data: locks, message: `Period ${year}-${month} locked successfully` });
  } catch (error) {
    if (error.message === "BUDGET_NOT_FOUND") {
      return res.status(404).json({ error: "Budget not found" });
    }
    if (error.message === "PERIOD_ALREADY_LOCKED") {
      return res.status(400).json({ error: "Period is already locked" });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.unlockPeriod = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id } = req.params;
    const { year, month } = req.body;

    if (!year || !month) {
      return res.status(400).json({ error: "Year and month are required" });
    }

    const locks = await BudgetService.unlockPeriod(companyId, id, year, month, userId);

    res.json({ success: true, data: locks, message: `Period ${year}-${month} unlocked successfully` });
  } catch (error) {
    if (error.message === "NO_LOCKS_FOUND") {
      return res.status(404).json({ error: "No locks found for this budget" });
    }
    if (error.message === "PERIOD_NOT_LOCKED") {
      return res.status(400).json({ error: "Period is not locked" });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.checkPeriodLock = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { id } = req.params;
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({ error: "Year and month are required" });
    }

    const isLocked = await BudgetService.isPeriodLocked(companyId, id, parseInt(year), parseInt(month));

    res.json({ success: true, data: { is_locked: isLocked } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateLockSettings = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id } = req.params;
    const { auto_lock, fiscal_year_end, year_end_lock } = req.body;

    const locks = await BudgetService.updateAutoLockSettings(companyId, id, {
      auto_lock,
      fiscal_year_end,
      year_end_lock,
    }, userId);

    res.json({ success: true, data: locks, message: "Lock settings updated successfully" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.runAutoLock = async (req, res) => {
  try {
    const companyId = req.user.company._id;

    const results = await BudgetService.runAutoLock(companyId);
    res.json({
      success: true,
      data: results,
      message: `Auto-lock processed ${results.processed} budgets, locked ${results.locked} periods`,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ── REVISION TRACKING ─────────────────────────────────────────────────

exports.getRevisionHistory = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { id } = req.params;
    const { change_type, startDate, endDate, limit } = req.query;

    const revisions = await BudgetService.getRevisionHistory(companyId, id, {
      change_type,
      startDate,
      endDate,
      limit: limit ? parseInt(limit) : 100,
    });

    res.json({ success: true, data: revisions, count: revisions.length });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getRevision = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { id, revisionNumber } = req.params;

    const revision = await BudgetService.getRevision(companyId, id, parseInt(revisionNumber));
    res.json({ success: true, data: revision });
  } catch (error) {
    if (error.message === "REVISION_NOT_FOUND") {
      return res.status(404).json({ error: "Revision not found" });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.compareRevisions = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { id } = req.params;
    const { rev1, rev2 } = req.query;

    if (!rev1 || !rev2) {
      return res.status(400).json({ error: "Two revision numbers required (rev1 and rev2)" });
    }

    const comparison = await BudgetService.compareRevisions(companyId, id, parseInt(rev1), parseInt(rev2));
    res.json({ success: true, data: comparison });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.rollbackToRevision = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const { id } = req.params;
    const { revisionNumber, reason } = req.body;

    if (!revisionNumber) {
      return res.status(400).json({ error: "Revision number is required" });
    }

    if (!reason) {
      return res.status(400).json({ error: "Rollback reason is required" });
    }

    const result = await BudgetService.rollbackToRevision(companyId, id, revisionNumber, userId, reason);
    res.json({ success: true, data: result, message: `Rolled back to revision ${revisionNumber}` });
  } catch (error) {
    if (error.message === "REVISION_NOT_FOUND") {
      return res.status(404).json({ error: "Revision not found" });
    }
    if (error.message === "CANNOT_ROLLBACK_NO_SNAPSHOT") {
      return res.status(400).json({ error: "Cannot rollback - no snapshot available for this revision" });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.getRevisionStats = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { id } = req.params;

    const stats = await BudgetService.getRevisionStats(companyId, id);
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ── WORKFLOW CONFIGURATION ─────────────────────────────────────────────

exports.getWorkflowConfigs = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const BudgetWorkflowConfig = require("../models/BudgetWorkflowConfig");

    const { workflow_type, is_active, is_default } = req.query;

    const query = { company_id: companyId };
    if (workflow_type) query.workflow_type = workflow_type;
    if (is_active !== undefined) query.is_active = is_active === "true";
    if (is_default !== undefined) query.is_default = is_default === "true";

    const configs = await BudgetWorkflowConfig.find(query)
      .sort({ priority: -1, createdAt: -1 });

    res.json({ success: true, data: configs });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getWorkflowConfigById = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const BudgetWorkflowConfig = require("../models/BudgetWorkflowConfig");
    const { configId } = req.params;

    const config = await BudgetWorkflowConfig.findOne({
      _id: configId,
      company_id: companyId,
    });

    if (!config) {
      return res.status(404).json({ error: "Workflow configuration not found" });
    }

    res.json({ success: true, data: config });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.createWorkflowConfig = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const BudgetWorkflowConfig = require("../models/BudgetWorkflowConfig");

    const {
      name,
      description,
      workflow_type,
      min_amount,
      max_amount,
      department_scope,
      department_ids,
      steps,
      is_default,
      priority,
      settings,
    } = req.body;

    if (!name || !workflow_type || !steps || steps.length === 0) {
      return res.status(400).json({
        error: "name, workflow_type, and at least one step are required",
      });
    }

    // Validate steps
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step.step_name || !step.approver_type) {
        return res.status(400).json({
          error: `Step ${i + 1} must have step_name and approver_type`,
        });
      }
      // Ensure step_number is sequential
      step.step_number = i + 1;
    }

    // If setting as default, unset any existing default for this type
    if (is_default) {
      await BudgetWorkflowConfig.updateMany(
        { company_id: companyId, workflow_type, is_default: true },
        { $set: { is_default: false } }
      );
    }

    const config = await BudgetWorkflowConfig.create({
      company_id: companyId,
      name,
      description,
      workflow_type,
      min_amount: min_amount || 0,
      max_amount: max_amount || null,
      department_scope: department_scope || "all",
      department_ids: department_ids || [],
      steps,
      is_default: is_default || false,
      priority: priority || 0,
      settings: settings || {},
      created_by: userId,
    });

    res.status(201).json({
      success: true,
      data: config,
      message: "Workflow configuration created successfully",
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        error: "A default workflow already exists for this type",
      });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.updateWorkflowConfig = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const BudgetWorkflowConfig = require("../models/BudgetWorkflowConfig");
    const { configId } = req.params;

    const {
      name,
      description,
      workflow_type,
      min_amount,
      max_amount,
      department_scope,
      department_ids,
      steps,
      is_active,
      is_default,
      priority,
      settings,
    } = req.body;

    const config = await BudgetWorkflowConfig.findOne({
      _id: configId,
      company_id: companyId,
    });

    if (!config) {
      return res.status(404).json({ error: "Workflow configuration not found" });
    }

    // Re-validate step numbers if steps provided
    if (steps && steps.length > 0) {
      for (let i = 0; i < steps.length; i++) {
        steps[i].step_number = i + 1;
      }
    }

    // If setting as default, unset any existing default for this type
    if (is_default && !config.is_default) {
      await BudgetWorkflowConfig.updateMany(
        {
          company_id: companyId,
          workflow_type: workflow_type || config.workflow_type,
          is_default: true,
          _id: { $ne: configId },
        },
        { $set: { is_default: false } }
      );
    }

    // Update fields
    if (name !== undefined) config.name = name;
    if (description !== undefined) config.description = description;
    if (workflow_type !== undefined) config.workflow_type = workflow_type;
    if (min_amount !== undefined) config.min_amount = min_amount;
    if (max_amount !== undefined) config.max_amount = max_amount;
    if (department_scope !== undefined) config.department_scope = department_scope;
    if (department_ids !== undefined) config.department_ids = department_ids;
    if (steps !== undefined) config.steps = steps;
    if (is_active !== undefined) config.is_active = is_active;
    if (is_default !== undefined) config.is_default = is_default;
    if (priority !== undefined) config.priority = priority;
    if (settings !== undefined) config.settings = { ...config.settings, ...settings };

    config.updated_by = userId;
    await config.save();

    res.json({
      success: true,
      data: config,
      message: "Workflow configuration updated successfully",
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        error: "A default workflow already exists for this type",
      });
    }
    res.status(400).json({ error: error.message });
  }
};

exports.deleteWorkflowConfig = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const BudgetWorkflowConfig = require("../models/BudgetWorkflowConfig");
    const { configId } = req.params;

    const config = await BudgetWorkflowConfig.findOne({
      _id: configId,
      company_id: companyId,
    });

    if (!config) {
      return res.status(404).json({ error: "Workflow configuration not found" });
    }

    // Prevent deleting the last active default workflow
    if (config.is_default) {
      const otherDefault = await BudgetWorkflowConfig.findOne({
        company_id: companyId,
        workflow_type: config.workflow_type,
        is_default: true,
        _id: { $ne: configId },
        is_active: true,
      });

      if (!otherDefault) {
        return res.status(400).json({
          error: "Cannot delete the only default workflow for this type. Create another default first.",
        });
      }
    }

    await BudgetWorkflowConfig.deleteOne({ _id: configId });

    res.json({
      success: true,
      message: "Workflow configuration deleted successfully",
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.setDefaultWorkflowConfig = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user.id;
    const BudgetWorkflowConfig = require("../models/BudgetWorkflowConfig");
    const { configId } = req.params;

    const config = await BudgetWorkflowConfig.findOne({
      _id: configId,
      company_id: companyId,
    });

    if (!config) {
      return res.status(404).json({ error: "Workflow configuration not found" });
    }

    // Unset any existing default for this workflow type
    await BudgetWorkflowConfig.updateMany(
      {
        company_id: companyId,
        workflow_type: config.workflow_type,
        is_default: true,
        _id: { $ne: configId },
      },
      { $set: { is_default: false } }
    );

    config.is_default = true;
    config.updated_by = userId;
    await config.save();

    res.json({
      success: true,
      data: config,
      message: "Workflow set as default successfully",
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.testWorkflowMatch = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const BudgetWorkflowConfig = require("../models/BudgetWorkflowConfig");

    const { workflow_type, amount, department_id } = req.body;

    if (!workflow_type) {
      return res.status(400).json({ error: "workflow_type is required" });
    }

    const matchingWorkflow = await BudgetWorkflowConfig.findMatchingWorkflow(
      companyId,
      workflow_type,
      amount || 0,
      department_id || null
    );

    if (!matchingWorkflow) {
      return res.json({
        success: true,
        data: null,
        message: "No matching workflow found",
      });
    }

    res.json({
      success: true,
      data: {
        workflow: matchingWorkflow,
        matched_criteria: {
          workflow_type,
          amount,
          department_id,
        },
      },
      message: "Matching workflow found",
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
