const JournalEntry = require('../models/JournalEntry');
const AccountBalance = require('../models/AccountBalance');

// POST /api/reconciliation/check or GET
exports.checkLedger = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    // optional asOfDate query param (ISO string)
    const { asOfDate } = req.query;
    const endDate = asOfDate ? new Date(asOfDate) : new Date();
    const startDate = new Date(0);

    // Get trial balance from Journal entries up to asOfDate
    const trial = await JournalEntry.getTrialBalance(companyId, startDate, endDate);

    // Normalize trial into map: accountCode -> { debit, credit, net }
    const trialMap = {};
    Object.values(trial || {}).forEach(acc => {
      const code = acc.code;
      const debit = acc.debit || 0;
      const credit = acc.credit || 0;
      trialMap[code] = { debit, credit, net: debit - credit, name: acc.name };
    });

    // Get AccountBalance snapshot
    const balances = await AccountBalance.find({ company: companyId }).lean();
    const balMap = {};
    balances.forEach(b => {
      const code = b.accountCode;
      const debit = b.debit || 0;
      const credit = b.credit || 0;
      balMap[code] = { debit, credit, net: debit - credit };
    });

    // Build combined set of account codes
    const allCodes = new Set([...Object.keys(trialMap), ...Object.keys(balMap)]);

    const discrepancies = [];
    let totalTrialDebit = 0, totalTrialCredit = 0, totalBalDebit = 0, totalBalCredit = 0;

    for (const code of allCodes) {
      const t = trialMap[code] || { debit: 0, credit: 0, net: 0 };
      const b = balMap[code] || { debit: 0, credit: 0, net: 0 };
      const diffNet = Math.round((t.net - b.net) * 100) / 100;

      totalTrialDebit += t.debit;
      totalTrialCredit += t.credit;
      totalBalDebit += b.debit;
      totalBalCredit += b.credit;

      if (Math.abs(diffNet) > 0.005) {
        discrepancies.push({
          accountCode: code,
          accountName: (t.name || null),
          trial: { debit: Math.round(t.debit * 100) / 100, credit: Math.round(t.credit * 100) / 100, net: Math.round(t.net * 100) / 100 },
          snapshot: { debit: Math.round(b.debit * 100) / 100, credit: Math.round(b.credit * 100) / 100, net: Math.round(b.net * 100) / 100 },
          difference: diffNet
        });
      }
    }

    const totalDiffNet = Math.round(((totalTrialDebit - totalTrialCredit) - (totalBalDebit - totalBalCredit)) * 100) / 100;

    res.json({
      success: true,
      asOfDate: endDate,
      counts: { accountsCompared: allCodes.size, discrepancies: discrepancies.length },
      totals: {
        trial: { debit: Math.round(totalTrialDebit * 100) / 100, credit: Math.round(totalTrialCredit * 100) / 100 },
        snapshot: { debit: Math.round(totalBalDebit * 100) / 100, credit: Math.round(totalBalCredit * 100) / 100 },
        differenceNet: totalDiffNet
      },
      discrepancies
    });
  } catch (error) {
    next(error);
  }
};

// Lightweight health-check endpoint: returns boolean ok if no discrepancies
exports.healthCheck = async (req, res, next) => {
  try {
    // Reuse checkLedger logic but only return ok flag and counts
    const companyId = req.user.company._id;
    const endDate = new Date();
    const trial = await JournalEntry.getTrialBalance(companyId, new Date(0), endDate);
    const trialMap = {};
    Object.values(trial || {}).forEach(acc => {
      const code = acc.code;
      const debit = acc.debit || 0;
      const credit = acc.credit || 0;
      trialMap[code] = { debit, credit, net: debit - credit };
    });
    const balances = await AccountBalance.find({ company: companyId }).lean();
    const balMap = {};
    balances.forEach(b => { balMap[b.accountCode] = { debit: b.debit || 0, credit: b.credit || 0, net: (b.debit || 0) - (b.credit || 0) }; });
    const allCodes = new Set([...Object.keys(trialMap), ...Object.keys(balMap)]);
    let hasDiscrepancy = false;
    for (const code of allCodes) {
      const t = trialMap[code] || { net: 0 };
      const b = balMap[code] || { net: 0 };
      if (Math.abs((t.net || 0) - (b.net || 0)) > 0.005) { hasDiscrepancy = true; break; }
    }
    res.json({ success: true, ok: !hasDiscrepancy });
  } catch (error) {
    next(error);
  }
};
