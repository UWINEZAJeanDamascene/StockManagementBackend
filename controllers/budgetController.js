const BudgetService = require('../services/budgetService');

/**
 * Create a new budget
 */
exports.createBudget = async (req, res) => {
  try {
    const companyId = req.companyId;
    const userId = req.userId;
    const { name, fiscal_year } = req.body;

    if (!name || !fiscal_year) {
      return res.status(400).json({ error: 'name and fiscal_year are required' });
    }

    const budget = await BudgetService.create(companyId, { name, fiscal_year }, userId);
    res.status(201).json(budget);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'BUDGET_DUPLICATE' });
    }
    res.status(400).json({ error: error.message });
  }
};

/**
 * Get all budgets for company
 */
exports.getBudgets = async (req, res) => {
  try {
    const companyId = req.companyId;
    const { status, fiscal_year } = req.query;
    
    const budgets = await BudgetService.findAll(companyId, { status, fiscal_year });
    res.json(budgets);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

/**
 * Get single budget by ID
 */
exports.getBudgetById = async (req, res) => {
  try {
    const companyId = req.companyId;
    const { id } = req.params;
    
    const budget = await BudgetService.findById(companyId, id);
    res.json(budget);
  } catch (error) {
    if (error.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Budget not found' });
    }
    res.status(400).json({ error: error.message });
  }
};

/**
 * Update a budget
 */
exports.updateBudget = async (req, res) => {
  try {
    const companyId = req.companyId;
    const { id } = req.params;
    const { name } = req.body;
    
    const budget = await BudgetService.update(companyId, id, { name });
    res.json(budget);
  } catch (error) {
    if (error.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Budget not found' });
    }
    res.status(400).json({ error: error.message });
  }
};

/**
 * Delete a budget
 */
exports.deleteBudget = async (req, res) => {
  try {
    const companyId = req.companyId;
    const { id } = req.params;
    
    await BudgetService.delete(companyId, id);
    res.json({ deleted: true });
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

/**
 * Upsert budget lines
 */
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
    res.json(result);
  } catch (error) {
    if (error.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Budget not found' });
    }
    if (error.message === 'BUDGET_LOCKED') {
      return res.status(400).json({ error: 'Budget is locked' });
    }
    if (error.message === 'ACCOUNT_NOT_FOUND') {
      return res.status(400).json({ error: 'Account not found or belongs to different company' });
    }
    res.status(400).json({ error: error.message });
  }
};

/**
 * Get budget lines
 */
exports.getLines = async (req, res) => {
  try {
    const companyId = req.companyId;
    const { id } = req.params;
    const { period_year, period_month } = req.query;
    
    const lines = await BudgetService.getLines(companyId, id, { period_year, period_month });
    res.json(lines);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

/**
 * Approve a budget
 */
exports.approveBudget = async (req, res) => {
  try {
    const companyId = req.companyId;
    const userId = req.userId;
    const { id } = req.params;
    
    const budget = await BudgetService.approve(companyId, id, userId);
    res.json(budget);
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

/**
 * Lock a budget
 */
exports.lockBudget = async (req, res) => {
  try {
    const companyId = req.companyId;
    const userId = req.userId;
    const { id } = req.params;
    
    const budget = await BudgetService.lock(companyId, id, userId);
    res.json(budget);
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

/**
 * Get variance report
 */
exports.getVarianceReport = async (req, res) => {
  try {
    const companyId = req.companyId;
    const { id } = req.params;
    const { periodStart, periodEnd } = req.query;
    
    if (!periodStart || !periodEnd) {
      return res.status(400).json({ error: 'periodStart and periodEnd are required' });
    }
    
    const report = await BudgetService.getVarianceReport(companyId, id, { periodStart, periodEnd });
    res.json(report);
  } catch (error) {
    if (error.message === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Budget not found' });
    }
    res.status(400).json({ error: error.message });
  }
};
