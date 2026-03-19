const Period = require('../models/Period');

const periodService = {
  // Returns true if the given date falls inside a closed period for the company
  async isDateInClosedPeriod(companyId, date) {
    if (!date) date = new Date();
    const d = new Date(date);
    // Normalize to date-only for comparison
    const dayStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
    const dayEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
    const closed = await Period.findOne({
      company: companyId,
      status: 'closed',
      startDate: { $lte: dayEnd },
      endDate: { $gte: dayStart }
    }).lean();
    return !!closed;
  }
};

module.exports = periodService;
