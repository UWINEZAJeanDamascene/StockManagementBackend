const FinancialRatiosService = require('../services/financialRatiosService');

/**
 * Financial Ratios Controller
 * 
 * Computes 9 financial ratios from the current ledger state.
 */
const getFinancialRatios = async (req, res) => {
  try {
    const { companyId } = req;
    const { as_of_date, date_from, date_to } = req.query;

    if (!as_of_date) {
      return res.status(400).json({ 
        error: 'AS_OF_DATE_REQUIRED',
        message: 'as_of_date query parameter is required'
      });
    }

    if (!date_from || !date_to) {
      return res.status(400).json({ 
        error: 'DATE_RANGE_REQUIRED',
        message: 'date_from and date_to query parameters are required'
      });
    }

    const ratios = await FinancialRatiosService.compute(companyId, {
      asOfDate: as_of_date,
      dateFrom: date_from,
      dateTo: date_to
    });

    res.json(ratios);
  } catch (error) {
    console.error('Error computing financial ratios:', error);
    res.status(500).json({ 
      error: error.message || 'INTERNAL_ERROR',
      message: 'Failed to compute financial ratios'
    });
  }
};

module.exports = {
  getFinancialRatios
};
