/**
 * MODULE 7 - Opening Balance Controller
 * 
 * Handles HTTP requests for opening balance operations.
 */

const OpeningBalanceService = require('../services/OpeningBalanceService');

/**
 * Preview opening balances without committing
 * POST /api/opening-balances/preview
 */
exports.preview = async (req, res) => {
  try {
    const company_id = req.company?._id || req.company;
    const { asOfDate, balances } = req.body;

    if (!balances || !Array.isArray(balances)) {
      return res.status(400).json({
        success: false,
        error: 'BALANCES_REQUIRED',
        message: 'Balances array is required'
      });
    }

    const result = await OpeningBalanceService.preview(company_id, { asOfDate, balances });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('OpeningBalanceController.preview error:', error);
    res.status(400).json({
      success: false,
      error: error.code || 'PREVIEW_FAILED',
      message: error.message
    });
  }
};

/**
 * Import opening balances
 * POST /api/opening-balances/import
 */
exports.import = async (req, res) => {
  try {
    const company_id = req.company?._id || req.company;
    const { asOfDate, balances } = req.body;
    const userId = req.user?._id || req.user?.id || req.body.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'USER_REQUIRED',
        message: 'User ID is required'
      });
    }

    const result = await OpeningBalanceService.import(company_id, { asOfDate, balances }, userId);

    res.status(201).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('OpeningBalanceController.import error:', error);
    res.status(400).json({
      success: false,
      error: error.code || 'IMPORT_FAILED',
      message: error.message
    });
  }
};

/**
 * Import opening balances from CSV
 * POST /api/opening-balances/csv
 */
exports.importCSV = async (req, res) => {
  try {
    const company_id = req.company?._id || req.company;
    const { csvData, asOfDate } = req.body;
    const userId = req.user?._id || req.user?.id || req.body.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'USER_REQUIRED',
        message: 'User ID is required'
      });
    }

    if (!csvData || !Array.isArray(csvData)) {
      return res.status(400).json({
        success: false,
        error: 'CSV_DATA_REQUIRED',
        message: 'CSV data array is required'
      });
    }

    const result = await OpeningBalanceService.importFromCSV(company_id, csvData, userId, asOfDate);

    res.status(201).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('OpeningBalanceController.importCSV error:', error);
    res.status(400).json({
      success: false,
      error: error.code || 'CSV_IMPORT_FAILED',
      message: error.message
    });
  }
};

/**
 * Get posted opening balance entry
 * GET /api/opening-balances
 */
exports.get = async (req, res) => {
  try {
    const company_id = req.company?._id || req.company;

    const result = await OpeningBalanceService.get(company_id);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'OPENING_BALANCE_NOT_FOUND',
        message: 'No opening balance entry has been posted'
      });
    }

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('OpeningBalanceController.get error:', error);
    res.status(500).json({
      success: false,
      error: error.code || 'GET_FAILED',
      message: error.message
    });
  }
};
