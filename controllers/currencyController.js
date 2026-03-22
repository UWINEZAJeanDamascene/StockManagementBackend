const Currency = require('../models/Currency');
const { parsePagination, paginationMeta } = require('../utils/pagination');

// @desc    List all active currencies
// @route   GET /api/currencies
// @access  Public (or protect if needed)
exports.listCurrencies = async (req, res, next) => {
  try {
    const q = { is_active: true };
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const total = await Currency.countDocuments(q);
    const currencies = await Currency.find(q)
      .sort({ code: 1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({
      success: true,
      data: currencies,
      pagination: paginationMeta(page, limit, total),
    });
  } catch (error) {
    next(error);
  }
};
