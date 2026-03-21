const PeriodService = require('../services/periodService');

/**
 * Period Controller
 * Handles accounting period CRUD operations
 */

// Generate 12 monthly periods for a fiscal year
exports.generateFiscalYear = async (req, res) => {
  try {
    const { company } = req.user;
    const { fiscal_year: fiscalYear } = req.body;

    if (!fiscalYear) {
      return res.status(400).json({
        success: false,
        error: 'FISCAL_YEAR_REQUIRED'
      });
    }

    const periods = await PeriodService.generateFiscalYear(
      company,
      fiscalYear,
      req.user._id
    );

    res.status(201).json({
      success: true,
      data: periods
    });
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    res.status(400).json({
      success: false,
      error: errorMessage
    });
  }
};

// Get all periods
exports.getAllPeriods = async (req, res) => {
  try {
    const { company } = req.user;
    const { fiscal_year: fiscalYear, status, period_type: periodType } = req.query;

    const filters = {};
    if (fiscalYear) filters.fiscal_year = parseInt(fiscalYear);
    if (status) filters.status = status;
    if (periodType) filters.period_type = periodType;

    const periods = await PeriodService.getAll(company, filters);

    res.json({
      success: true,
      data: periods
    });
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    res.status(400).json({
      success: false,
      error: errorMessage
    });
  }
};

// Get period by ID
exports.getPeriod = async (req, res) => {
  try {
    const { company } = req.user;
    const { id } = req.params;

    const period = await PeriodService.getById(company, id);

    res.json({
      success: true,
      data: period
    });
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    const statusCode = errorMessage.includes('NOT_FOUND') ? 404 : 400;
    res.status(statusCode).json({
      success: false,
      error: errorMessage
    });
  }
};

// Close a period
exports.closePeriod = async (req, res) => {
  try {
    const { company } = req.user;
    const { id } = req.params;

    const result = await PeriodService.closePeriod(company, id, req.user._id);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    const statusCode = errorMessage.includes('NOT_FOUND') ? 404 : 400;
    res.status(statusCode).json({
      success: false,
      error: errorMessage
    });
  }
};

// Reopen a closed period
exports.reopenPeriod = async (req, res) => {
  try {
    const { company } = req.user;
    const { id } = req.params;

    const result = await PeriodService.reopenPeriod(company, id, req.user._id);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    const statusCode = errorMessage.includes('NOT_FOUND') ? 404 : 400;
    res.status(statusCode).json({
      success: false,
      error: errorMessage
    });
  }
};

// Lock a period permanently
exports.lockPeriod = async (req, res) => {
  try {
    const { company } = req.user;
    const { id } = req.params;

    const result = await PeriodService.lockPeriod(company, id, req.user._id);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    const statusCode = errorMessage.includes('NOT_FOUND') ? 404 : 400;
    res.status(statusCode).json({
      success: false,
      error: errorMessage
    });
  }
};

// Perform year-end close
exports.performYearEndClose = async (req, res) => {
  try {
    const { company } = req.user;
    const { fiscal_year: fiscalYear } = req.body;

    if (!fiscalYear) {
      return res.status(400).json({
        success: false,
        error: 'FISCAL_YEAR_REQUIRED'
      });
    }

    const result = await PeriodService.performYearEndClose(
      company,
      fiscalYear,
      req.user._id
    );

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    res.status(400).json({
      success: false,
      error: errorMessage
    });
  }
};

// Get current period
exports.getCurrentPeriod = async (req, res) => {
  try {
    const { company } = req.user;

    const period = await PeriodService.getCurrentPeriod(company);

    if (!period) {
      return res.status(404).json({
        success: false,
        error: 'NO_OPEN_PERIOD'
      });
    }

    res.json({
      success: true,
      data: period
    });
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    res.status(400).json({
      success: false,
      error: errorMessage
    });
  }
};
