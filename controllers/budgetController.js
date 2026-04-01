const BudgetService = require('../services/budgetService');

// ── CREATE ─────────────────────────────────────────────────────────────
exports.createBudget = async (req, res) => {
  try {
    const companyId = req.companyId;
    const userId = req.userId;
    const { name, fiscal_year } = req.body;

    if (!name || !fiscal_year) {
      return res.status(400).json({ error: 'name and fiscal_year are required' });
    }

    const budget = await BudgetService.create(companyId, req.body, userId);
    res.status(201).json({ success: true, data: budget });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'BUDGET_DUPLICATE' });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── LIST ───────────────────────────────────────────────────────────────
exports.getBudgets = async (req, res) => {
  try {
    const companyId = req.companyId;
    const { status, fiscal_year, type, department, search, page, limit, startDate, endDate } = req.query;

    const result = await BudgetService.findAll(companyId, {
      status, fiscal_year, type, department, search, page, limit, startDate, endDate
    });
    res.json({ success: true, data: result.data, pagination: result.pagination });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ── GET BY ID ──────────────────────────────────────────────────────────
exports.getBudgetById = async (req, res) => {
  try {
    const companyId = req.companyId;
    const { id } = req.params;

    const budget = await BudgetService.findById(companyId, id);
    res.json({ success: true, data: budget });
  } catch (error) {
    if (error.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Budget not found' });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── UPDATE ─────────────────────────────────────────────────────────────
exports.updateBudget = async (req, res) => {
  try {
    const companyId = req.companyId;
    const { id } = req.params;

    const budget = await BudgetService.update(companyId, id, req.body);
    res.json({ success: true, data: budget });
  } catch (error) {
    if (error.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Budget not found' });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── DELETE ─────────────────────────────────────────────────────────────
exports.deleteBudget = async (req, res) => {
  try {
    const companyId = req.companyId;
    const { id } = req.params;

    await BudgetService.delete(companyId, id);
    res.json({ success: true, message: 'Budget deleted successfully' });
  } catch (error) {
    if (error.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Budget not found' });
    }
    if (error.message === 'BUDGET_NOT_DRAFT') {
      return res.status(400).json({ error: 'Can only delete draft budgets' });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── UPSERT LINES ──────────────────────────────────────────────────────
exports.upsertLines = async (req, res) => {
  try {
    const companyId = req.companyId;
    const userId = req.userId;
    const { id } = req.params;
    const { lines } = req.body;

    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'lines array is required' });
    }

    const result = await BudgetService.upsertLines(companyId, id, lines, userId);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Budget not found' });
    }
    if (error.message === 'BUDGET_LOCKED') {
      return res.status(400).json({ error: 'Budget is locked or closed' });
    }
    if (error.message === 'ACCOUNT_NOT_FOUND') {
      return res.status(400).json({ error: 'Account not found or belongs to different company' });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── GET LINES ──────────────────────────────────────────────────────────
exports.getLines = async (req, res) => {
  try {
    const companyId = req.companyId;
    const { id } = req.params;
    const { period_year, period_month } = req.query;

    const lines = await BudgetService.getLines(companyId, id, { period_year, period_month });
    res.json({ success: true, data: lines });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ── APPROVE ────────────────────────────────────────────────────────────
exports.approveBudget = async (req, res) => {
  try {
    const companyId = req.companyId;
    const userId = req.userId;
    const { id } = req.params;

    const budget = await BudgetService.approve(companyId, id, userId);
    res.json({ success: true, data: budget, message: 'Budget approved successfully' });
  } catch (error) {
    if (error.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Budget not found' });
    }
    if (error.message === 'BUDGET_NOT_DRAFT') {
      return res.status(400).json({ error: 'Can only approve draft budgets' });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── REJECT ─────────────────────────────────────────────────────────────
exports.rejectBudget = async (req, res) => {
  try {
    const companyId = req.companyId;
    const userId = req.userId;
    const { id } = req.params;
    const { reason } = req.body || {};

    const budget = await BudgetService.reject(companyId, id, userId, reason || '');
    res.json({ success: true, data: budget, message: 'Budget rejected' });
  } catch (error) {
    if (error.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Budget not found' });
    }
    if (error.message === 'BUDGET_CANNOT_REJECT') {
      return res.status(400).json({ error: 'Budget cannot be rejected in its current status' });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── LOCK ───────────────────────────────────────────────────────────────
exports.lockBudget = async (req, res) => {
  try {
    const companyId = req.companyId;
    const userId = req.userId;
    const { id } = req.params;

    const budget = await BudgetService.lock(companyId, id, userId);
    res.json({ success: true, data: budget, message: 'Budget locked successfully' });
  } catch (error) {
    if (error.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Budget not found' });
    }
    if (error.message === 'BUDGET_NOT_APPROVED') {
      return res.status(400).json({ error: 'Can only lock approved budgets' });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── CLOSE ──────────────────────────────────────────────────────────────
exports.closeBudget = async (req, res) => {
  try {
    const companyId = req.companyId;
    const userId = req.userId;
    const { id } = req.params;
    const { notes } = req.body || {};

    const budget = await BudgetService.close(companyId, id, userId, notes || '');
    res.json({ success: true, data: budget, message: 'Budget closed successfully' });
  } catch (error) {
    if (error.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Budget not found' });
    }
    if (error.message === 'BUDGET_ALREADY_CLOSED') {
      return res.status(400).json({ error: 'Budget is already closed' });
    }
    if (error.message === 'BUDGET_NOT_APPROVED') {
      return res.status(400).json({ error: 'Cannot close a draft budget' });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── CLONE ──────────────────────────────────────────────────────────────
exports.cloneBudget = async (req, res) => {
  try {
    const companyId = req.companyId;
    const userId = req.userId;
    const { id } = req.params;
    const { newPeriodStart, newPeriodEnd, newName } = req.body;

    if (!newPeriodStart || !newPeriodEnd) {
      return res.status(400).json({ error: 'newPeriodStart and newPeriodEnd are required' });
    }

    const budget = await BudgetService.clone(companyId, id, userId, { newPeriodStart, newPeriodEnd, newName });
    res.status(201).json({ success: true, data: budget, message: 'Budget cloned successfully' });
  } catch (error) {
    if (error.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Source budget not found' });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── SUMMARY ────────────────────────────────────────────────────────────
exports.getSummary = async (req, res) => {
  try {
    const companyId = req.companyId;
    const summary = await BudgetService.getSummary(companyId);
    res.json({ success: true, data: summary });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ── COMPARE ALL ────────────────────────────────────────────────────────
exports.getAllComparisons = async (req, res) => {
  try {
    const companyId = req.companyId;
    const { status, type, periodStart, periodEnd } = req.query;

    const result = await BudgetService.getAllComparisons(companyId, { status, type, periodStart, periodEnd });
    res.json({ success: true, data: result.data, summary: result.summary });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// ── COMPARE SINGLE ────────────────────────────────────────────────────
exports.getComparison = async (req, res) => {
  try {
    const companyId = req.companyId;
    const { id } = req.params;

    const comparison = await BudgetService.getComparison(companyId, id);
    res.json({ success: true, data: comparison });
  } catch (error) {
    if (error.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Budget not found' });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── VARIANCE REPORT ────────────────────────────────────────────────────
exports.getVarianceReport = async (req, res) => {
  try {
    const companyId = req.companyId;
    const { id } = req.params;
    const { periodStart, periodEnd } = req.query;

    if (!periodStart || !periodEnd) {
      return res.status(400).json({ error: 'periodStart and periodEnd are required' });
    }

    const report = await BudgetService.getVarianceReport(companyId, id, { periodStart, periodEnd });
    res.json({ success: true, data: report });
  } catch (error) {
    if (error.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Budget not found' });
    }
    res.status(400).json({ error: error.message });
  }
};

// ── FORECASTS ──────────────────────────────────────────────────────────
exports.getRevenueForecast = async (req, res) => {
  try {
    const companyId = req.companyId;
    const months = parseInt(req.query.months) || 6;

    const forecast = await BudgetService.getRevenueForecast(companyId, months);
    res.json({ success: true, data: forecast });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getExpenseForecast = async (req, res) => {
  try {
    const companyId = req.companyId;
    const months = parseInt(req.query.months) || 6;

    const forecast = await BudgetService.getExpenseForecast(companyId, months);
    res.json({ success: true, data: forecast });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getCashFlowForecast = async (req, res) => {
  try {
    const companyId = req.companyId;
    const months = parseInt(req.query.months) || 6;

    const forecast = await BudgetService.getCashFlowForecast(companyId, months);
    res.json({ success: true, data: forecast });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
