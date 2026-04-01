const { getHealthReport } = require('../services/accountingHealthService');

// GET /api/accounting/health
exports.healthCheck = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const report = await getHealthReport(companyId);
    // Coerce possible Decimal128 aggregation results to plain numbers for API/tests
    const coerce = (val) => {
      if (val == null) return 0;
      if (typeof val === 'number') return val;
      if (typeof val === 'string') return Number(val);
      if (val && typeof val === 'object') {
        if (val.$numberDecimal) return Number(val.$numberDecimal);
        try { return Number(val.toString()); } catch (e) { return 0; }
      }
      return Number(val) || 0;
    };

    const totals = report.journal && report.journal.totals ? report.journal.totals : {};
    const totalDebit = coerce(totals.totalDebit);
    const totalCredit = coerce(totals.totalCredit);

    res.json({ 
      success: true, 
      healthy: report.healthy, 
      totalDebit, 
      totalCredit, 
      journal_balanced: report.journal_balanced,
      stock_reconciled: report.stock_reconciled,
      vat_reconciled: report.vat_reconciled,
      paye_reconciled: report.paye_reconciled,
      rssb_reconciled: report.rssb_reconciled,
      journal: report.journal, 
      stock: report.stock,
      vat: report.vat,
      paye: report.paye,
      rssb: report.rssb
    });
  } catch (err) {
    next(err);
  }
};
