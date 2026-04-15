/**
 * Monthly Reports Service
 *
 * Generates comprehensive monthly management accounting reports.
 * All reports include current month, prior month comparison, and YTD columns where applicable.
 *
 * Reports:
 * 1. Profit & Loss Statement
 * 2. Balance Sheet
 * 3. Trial Balance
 * 4. Cash Flow Statement (Indirect Method)
 * 5. Stock Valuation Report
 * 6. Sales by Customer
 * 7. Sales by Product Category
 * 8. Purchases by Supplier
 * 9. Accounts Receivable Aging
 * 10. Accounts Payable Aging
 * 11. Payroll Summary
 * 12. VAT Return Worksheet
 * 13. Bank Reconciliation
 * 14. Budget vs Actual
 * 15. General Ledger Activity
 */

const mongoose = require('mongoose');

// Format currency in Rwandan Francs
const formatRWF = (amount) => {
  if (amount === null || amount === undefined) return '-';
  return 'RWF ' + Math.abs(amount).toLocaleString('en-RW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

// Get month range
const getMonthRange = (year, month) => {
  const start = new Date(year, month - 1, 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(year, month, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

// Get prior month
const getPriorMonth = (year, month) => {
  if (month === 1) {
    return { year: year - 1, month: 12 };
  }
  return { year, month: month - 1 };
};

// Get year-to-date range
const getYearToDateRange = (year, month) => {
  const start = new Date(year, 0, 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(year, month, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

// Get month name
const getMonthName = (month) => {
  const names = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return names[month - 1];
};

class MonthlyReportsService {
  /**
   * 1. Monthly Profit & Loss Statement
   * Shows revenue, COGS, gross profit, operating expenses, EBITDA, depreciation,
   * interest, and net profit with prior month and YTD columns
   */
  static async getProfitAndLoss(companyId, year, month) {
    const { start, end } = getMonthRange(year, month);
    const prior = getPriorMonth(year, month);
    const priorRange = getMonthRange(prior.year, prior.month);
    const ytdRange = getYearToDateRange(year, month);

    const [Invoice, Purchase, Expense, JournalEntry, ChartOfAccount] = await Promise.all([
      mongoose.model('Invoice'),
      mongoose.model('Purchase'),
      mongoose.model('Expense'),
      mongoose.model('JournalEntry'),
      mongoose.model('ChartOfAccount')
    ]);

    // Revenue - current month
    const revenueCurrent = await Invoice.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          invoiceDate: { $gte: start, $lte: end },
          status: { $in: ['fully_paid', 'partially_paid', 'confirmed', 'sent'] }
        }
      },
      { $group: { _id: null, total: { $sum: { $toDouble: { $ifNull: ['$subtotal', '$total'] } } } } }
    ]);

    // Revenue - prior month
    const revenuePrior = await Invoice.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          invoiceDate: { $gte: priorRange.start, $lte: priorRange.end },
          status: { $in: ['fully_paid', 'partially_paid', 'confirmed', 'sent'] }
        }
      },
      { $group: { _id: null, total: { $sum: { $toDouble: { $ifNull: ['$subtotal', '$total'] } } } } }
    ]);

    // Revenue - YTD
    const revenueYTD = await Invoice.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          invoiceDate: { $gte: ytdRange.start, $lte: ytdRange.end },
          status: { $in: ['fully_paid', 'partially_paid', 'confirmed', 'sent'] }
        }
      },
      { $group: { _id: null, total: { $sum: { $toDouble: { $ifNull: ['$subtotal', '$total'] } } } } }
    ]);

    // COGS - current month (from purchase costs and inventory movements)
    const cogsCurrent = await this._calculateCOGS(companyId, start, end);
    const cogsPrior = await this._calculateCOGS(companyId, priorRange.start, priorRange.end);
    const cogsYTD = await this._calculateCOGS(companyId, ytdRange.start, ytdRange.end);

    // Operating Expenses by Category
    const expensesCurrent = await this._getExpensesByCategory(companyId, start, end);
    const expensesPrior = await this._getExpensesByCategory(companyId, priorRange.start, priorRange.end);
    const expensesYTD = await this._getExpensesByCategory(companyId, ytdRange.start, ytdRange.end);

    // Depreciation from journal entries
    const depreciationCurrent = await this._getAccountTotal(companyId, start, end, ['depreciation', 'accumulated_depreciation']);
    const depreciationPrior = await this._getAccountTotal(companyId, priorRange.start, priorRange.end, ['depreciation', 'accumulated_depreciation']);
    const depreciationYTD = await this._getAccountTotal(companyId, ytdRange.start, ytdRange.end, ['depreciation', 'accumulated_depreciation']);

    // Interest expense
    const interestCurrent = await this._getAccountTotal(companyId, start, end, ['interest', 'interest_expense']);
    const interestPrior = await this._getAccountTotal(companyId, priorRange.start, priorRange.end, ['interest', 'interest_expense']);
    const interestYTD = await this._getAccountTotal(companyId, ytdRange.start, ytdRange.end, ['interest', 'interest_expense']);

    const revCurrent = revenueCurrent[0]?.total || 0;
    const revPrior = revenuePrior[0]?.total || 0;
    const revYTD = revenueYTD[0]?.total || 0;

    const cogsCur = cogsCurrent;
    const cogsPr = cogsPrior;
    const cogsYt = cogsYTD;

    const grossProfitCurrent = revCurrent - cogsCur;
    const grossProfitPrior = revPrior - cogsPr;
    const grossProfitYTD = revYTD - cogsYt;

    const totalOpExCurrent = expensesCurrent.reduce((sum, e) => sum + e.amount, 0);
    const totalOpExPrior = expensesPrior.reduce((sum, e) => sum + e.amount, 0);
    const totalOpExYTD = expensesYTD.reduce((sum, e) => sum + e.amount, 0);

    const depCurrent = depreciationCurrent || 0;
    const depPrior = depreciationPrior || 0;
    const depYTD = depreciationYTD || 0;

    // Operating Expenses including depreciation
    const totalOpExWithDA = totalOpExCurrent + depCurrent;
    const totalOpExWithDAPrior = totalOpExPrior + depPrior;
    const totalOpExWithDAYTD = totalOpExYTD + depYTD;

    // EBIT = Gross Profit - Operating Expenses (incl. D&A)
    const ebitCurrent = grossProfitCurrent - totalOpExWithDA;
    const ebitPrior = grossProfitPrior - totalOpExWithDAPrior;
    const ebitYTD = grossProfitYTD - totalOpExWithDAYTD;

    // EBITDA = EBIT + Depreciation (add D&A back)
    const ebitdaCurrent = ebitCurrent + depCurrent;
    const ebitdaPrior = ebitPrior + depPrior;
    const ebitdaYTD = ebitYTD + depYTD;

    const intCurrent = interestCurrent || 0;
    const intPrior = interestPrior || 0;
    const intYTD = interestYTD || 0;

    // Net Profit = EBITDA - Depreciation - Interest
    const netProfitCurrent = ebitdaCurrent - depCurrent - intCurrent;
    const netProfitPrior = ebitdaPrior - depPrior - intPrior;
    const netProfitYTD = ebitdaYTD - depYTD - intYTD;

    return {
      reportName: 'Monthly Profit & Loss Statement',
      period: `${getMonthName(month)} ${year}`,
      year,
      month,
      companyId,
      sections: [
        {
          title: 'Revenue',
          current: revCurrent,
          prior: revPrior,
          ytd: revYTD
        },
        {
          title: 'Cost of Goods Sold',
          current: cogsCur,
          prior: cogsPr,
          ytd: cogsYt
        },
        {
          title: 'Gross Profit',
          current: grossProfitCurrent,
          prior: grossProfitPrior,
          ytd: grossProfitYTD,
          isSubtotal: true
        },
        {
          title: 'Operating Expenses',
          items: [
            ...expensesCurrent.map((e, i) => ({
              name: e.category,
              current: e.amount,
              prior: expensesPrior[i]?.amount || 0,
              ytd: expensesYTD[i]?.amount || 0
            })),
            {
              name: 'Depreciation & Amortization',
              current: depCurrent,
              prior: depPrior,
              ytd: depYTD
            }
          ],
          current: totalOpExWithDA,
          prior: totalOpExWithDAPrior,
          ytd: totalOpExWithDAYTD
        },
        {
          title: 'EBIT (Operating Profit)',
          current: ebitCurrent,
          prior: ebitPrior,
          ytd: ebitYTD,
          isSubtotal: true
        },
        {
          title: 'Add: Depreciation & Amortization',
          current: depCurrent,
          prior: depPrior,
          ytd: depYTD
        },
        {
          title: 'EBITDA',
          current: ebitdaCurrent,
          prior: ebitdaPrior,
          ytd: ebitdaYTD,
          isSubtotal: true
        },
        {
          title: 'Less: Interest Expense',
          current: intCurrent,
          prior: intPrior,
          ytd: intYTD
        },
        {
          title: 'Net Profit/(Loss)',
          current: netProfitCurrent,
          prior: netProfitPrior,
          ytd: netProfitYTD,
          isTotal: true
        }
      ],
      generatedAt: new Date().toISOString()
    };
  }

  // Helper: Calculate COGS
  static async _calculateCOGS(companyId, start, end) {
    const StockMovement = mongoose.model('StockMovement');
    const Purchase = mongoose.model('Purchase');

    const [stockOut, purchases] = await Promise.all([
      StockMovement.aggregate([
        {
          $match: {
            company: new mongoose.Types.ObjectId(companyId),
            movementDate: { $gte: start, $lte: end },
            type: 'out',
            reason: { $in: ['sale', 'dispatch'] }
          }
        },
        { $group: { _id: null, total: { $sum: { $multiply: [{ $toDouble: '$quantity' }, { $toDouble: { $ifNull: ['$unitCost', 0] } }] } } } }
      ]),
      Purchase.aggregate([
        {
          $match: {
            company: new mongoose.Types.ObjectId(companyId),
            purchaseDate: { $gte: start, $lte: end }
          }
        },
        { $group: { _id: null, total: { $sum: { $toDouble: { $ifNull: ['$subtotal', '$grandTotal'] } } } } }
      ])
    ]);

    return (stockOut[0]?.total || 0) + (purchases[0]?.total || 0) * 0.7; // Approximation
  }

  // Helper: Get expenses by category
  static async _getExpensesByCategory(companyId, start, end) {
    const Expense = mongoose.model('Expense');
    const JournalEntry = mongoose.model('JournalEntry');

    const expenses = await Expense.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          date: { $gte: start, $lte: end },
          status: 'posted'
        }
      },
      {
        $group: {
          _id: '$category',
          amount: { $sum: { $toDouble: '$amount' } }
        }
      },
      { $sort: { amount: -1 } }
    ]);

    return expenses.map(e => ({ category: e._id || 'Uncategorized', amount: e.amount }));
  }

  // Helper: Get account total by account type/name
  static async _getAccountTotal(companyId, start, end, accountPatterns) {
    const JournalEntry = mongoose.model('JournalEntry');
    const ChartOfAccount = mongoose.model('ChartOfAccount');

    const accounts = await ChartOfAccount.find({
      company: companyId,
      $or: accountPatterns.map(p => ({
        $or: [
          { name: { $regex: p, $options: 'i' } },
          { code: { $regex: p, $options: 'i' } }
        ]
      }))
    });

    if (accounts.length === 0) return 0;

    const accountIds = accounts.map(a => a._id.toString());

    const result = await JournalEntry.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          date: { $gte: start, $lte: end }
        }
      },
      { $unwind: '$lines' },
      {
        $match: {
          $or: accountIds.map(id => ({ 'lines.account': new mongoose.Types.ObjectId(id) }))
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $toDouble: '$lines.debit' } }
        }
      }
    ]);

    return result[0]?.total || 0;
  }

  /**
   * 2. Monthly Balance Sheet
   * Shows assets, liabilities, and equity as at month end with prior month comparison
   */
  static async getBalanceSheet(companyId, year, month) {
    const { start, end } = getMonthRange(year, month);
    const prior = getPriorMonth(year, month);
    const priorEnd = new Date(prior.year, prior.month, 0, 23, 59, 59, 999);

    const [ChartOfAccount, JournalEntry, BankAccount, Product, AccountBalance] = await Promise.all([
      mongoose.model('ChartOfAccount'),
      mongoose.model('JournalEntry'),
      mongoose.model('BankAccount'),
      mongoose.model('Product'),
      mongoose.model('AccountBalance')
    ]);

    // Get all accounts with balances at month end
    const accounts = await ChartOfAccount.find({ company: companyId, isActive: true });

    const calculateBalance = async (asOfDate, accountTypes) => {
      // Filter accounts by type and get their codes (trimmed)
      const typeAccounts = accounts.filter(a => accountTypes.includes(a.type));
      const accountCodes = typeAccounts.map(a => String(a.code || '').trim());

      // Build a lookup map from code to account for quick access
      const accountByCode = new Map();
      typeAccounts.forEach(acc => {
        accountByCode.set(String(acc.code || '').trim(), acc);
      });

      // Get AccountBalance records
      const balanceRecords = await AccountBalance.find({
        company: new mongoose.Types.ObjectId(companyId),
        accountCode: { $in: accountCodes }
      });

      // Build map from AccountBalance
      const balanceMap = new Map();
      balanceRecords.forEach(b => {
        const code = String(b.accountCode || '').trim();
        const account = accountByCode.get(code);
        // AccountBalance stores net as (debit - credit)
        // For assets/expenses/cogs: use net directly (positive = debit balance)
        // For liabilities/equity/revenue: use negative net (positive = credit balance)
        const normalBalance = ['asset', 'expense', 'cogs'].includes(account?.type) ? 'debit' : 'credit';
        const balance = normalBalance === 'debit' ? b.net : -b.net;
        balanceMap.set(code, { balance, source: 'AccountBalance' });
      });

      // ALWAYS fetch JournalEntry data for ALL accounts (not just missing ones)
      // JournalEntry is the authoritative source of truth
      const entries = await JournalEntry.aggregate([
        { $match: { company: new mongoose.Types.ObjectId(companyId), date: { $lte: asOfDate }, status: 'posted' } },
        { $unwind: '$lines' },
        { $match: { 'lines.accountCode': { $in: accountCodes } } },
        {
          $group: {
            _id: '$lines.accountCode',
            debit: { $sum: { $toDouble: '$lines.debit' } },
            credit: { $sum: { $toDouble: '$lines.credit' } }
          }
        }
      ]);

      // Merge JournalEntry data - it takes precedence over AccountBalance
      entries.forEach(e => {
        const code = String(e._id || '').trim();
        if (!code) return;
        const account = accountByCode.get(code);
        // Calculate balance based on normal balance direction
        // Assets, Expenses, COGS have normal DEBIT balance
        // Liabilities, Equity, Revenue have normal CREDIT balance
        const normalBalance = ['asset', 'expense', 'cogs'].includes(account?.type) ? 'debit' : 'credit';
        const balance = normalBalance === 'debit' ? (e.debit - e.credit) : (e.credit - e.debit);
        // JournalEntry overrides AccountBalance
        balanceMap.set(code, { balance, source: 'JournalEntry' });
      });

      // Build final items list (include ALL accounts, even zero balance)
      const items = typeAccounts.map(acc => {
        const code = String(acc.code || '').trim();
        const balData = balanceMap.get(code);
        return {
          code: acc.code,
          name: acc.name,
          balance: balData?.balance || 0
        };
      });

      return { total: items.reduce((s, i) => s + i.balance, 0), items };
    };

    // Calculate for current and prior month
    const [assetsCurrent, assetsPrior] = await Promise.all([
      calculateBalance(end, ['asset']),
      calculateBalance(priorEnd, ['asset'])
    ]);

    const [liabilitiesCurrent, liabilitiesPrior] = await Promise.all([
      calculateBalance(end, ['liability']),
      calculateBalance(priorEnd, ['liability'])
    ]);

    const [equityCurrent, equityPrior] = await Promise.all([
      calculateBalance(end, ['equity']),
      calculateBalance(priorEnd, ['equity'])
    ]);

    // Calculate Net Profit/Loss from Revenue and Expense accounts
    const [revenueCurrent, expenseCurrent] = await Promise.all([
      calculateBalance(end, ['revenue']),
      calculateBalance(end, ['expense', 'cogs'])
    ]);

    // Net Profit = Revenue - Expenses (positive = profit, negative = loss)
    const netProfit = revenueCurrent.total - expenseCurrent.total;

    // Add Net Profit to Retained Earnings (3100)
    // If Retained Earnings account exists, add net profit to its balance
    // If it doesn't exist, create it with the net profit balance
    const retainedEarningsIndex = equityCurrent.items.findIndex(i => String(i.code).trim() === '3100');
    if (retainedEarningsIndex >= 0) {
      // Add net profit to existing Retained Earnings balance
      equityCurrent.items[retainedEarningsIndex].balance += netProfit;
      equityCurrent.total += netProfit;
    } else if (netProfit !== 0) {
      // Create new Retained Earnings entry
      equityCurrent.items.push({
        code: '3100',
        name: 'Retained Earnings',
        balance: netProfit
      });
      equityCurrent.total += netProfit;
    }

    // Bank and Inventory values should already be in ChartOfAccount asset balances
    // Only fetch for display purposes if not already in items
    const bankAccounts = await BankAccount.find({ company: companyId, isActive: true });
    const bankTotal = bankAccounts.reduce((sum, a) => {
      const balance = a.cachedBalance ? parseFloat(a.cachedBalance.toString()) : 0;
      return sum + balance;
    }, 0);

    const inventory = await Product.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(companyId), isActive: true } },
      {
        $project: {
          value: { $multiply: [{ $toDouble: { $ifNull: ['$quantityOnHand', 0] } }, { $toDouble: { $ifNull: ['$averageCost', '$unitCost', 0] } }] }
        }
      },
      { $group: { _id: null, total: { $sum: '$value' } } }
    ]);
    const inventoryValue = inventory[0]?.total || 0;

    // Check if bank/inventory already in asset items
    const hasBank = assetsCurrent.items.some(i => 
      i.name?.toLowerCase().includes('bank') || i.name?.toLowerCase().includes('cash')
    );
    const hasInventory = assetsCurrent.items.some(i => 
      i.name?.toLowerCase().includes('inventory') || i.name?.toLowerCase().includes('stock')
    );

    // Build asset items list - include ALL asset accounts from ChartOfAccount
    // Trim account codes to handle tabs/spaces in database
    const allAssetAccounts = accounts
      .filter(a => a.type === 'asset')
    const assetItems = allAssetAccounts.map(acc => {
      const code = String(acc.code || '').trim();
      const currentRecord = assetsCurrent.items.find(i => String(i.code || '').trim() === code);
      const priorRecord = assetsPrior.items.find(i => String(i.code || '').trim() === code);
      return {
        code: acc.code,
        name: acc.name,
        subtype: acc.subtype || 'current',
        current: currentRecord?.balance || 0,
        prior: priorRecord?.balance || 0
      };
    });

    // Only add bank/inventory if not already in ChartOfAccount data
    if (!hasBank && bankTotal > 0) {
      assetItems.unshift({ code: '1000', name: 'Cash & Bank', subtype: 'current', current: bankTotal, prior: 0 });
    }
    if (!hasInventory && inventoryValue > 0) {
      assetItems.unshift({ code: '1200', name: 'Inventory', subtype: 'current', current: inventoryValue, prior: 0 });
    }

    // Separate into Current and Fixed (Non-Current) Assets
    const fixedAssetPatterns = ['equipment', 'building', 'machinery', 'vehicle', 'furniture', 'land', 'fixture', 'plant', 'hardware', 'accumulated depreciation'];
    const currentAssets = assetItems.filter(a => !fixedAssetPatterns.some(p => a.name?.toLowerCase().includes(p)));
    const fixedAssets = assetItems.filter(a => fixedAssetPatterns.some(p => a.name?.toLowerCase().includes(p)));

    // Calculate totals
    const totalCurrentAssets = currentAssets.reduce((sum, i) => sum + i.current, 0);
    const totalFixedAssets = fixedAssets.reduce((sum, i) => sum + i.current, 0);
    const totalAssets = totalCurrentAssets + totalFixedAssets;

    return {
      reportName: 'Monthly Balance Sheet',
      asOfDate: end.toISOString().split('T')[0],
      year,
      month,
      companyId,
      assets: {
        current: totalAssets,
        prior: assetsPrior.total,
        currentAssets: {
          total: totalCurrentAssets,
          items: currentAssets
        },
        fixedAssets: {
          total: totalFixedAssets,
          items: fixedAssets
        },
        items: assetItems
      },
      liabilities: {
        current: liabilitiesCurrent.total,
        prior: liabilitiesPrior.total,
        items: liabilitiesCurrent.items.map(i => ({
          name: i.name,
          current: i.balance,
          prior: liabilitiesPrior.items.find(p => p.name === i.name)?.balance || 0
        }))
      },
      equity: {
        current: equityCurrent.total,
        prior: equityPrior.total,
        items: equityCurrent.items.map(i => ({
          name: i.name,
          current: i.balance,
          prior: equityPrior.items.find(p => p.name === i.name)?.balance || 0
        }))
      },
      totalLiabilitiesAndEquity: liabilitiesCurrent.total + equityCurrent.total,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 3. Monthly Trial Balance
   * Lists all accounts with debit/credit balance confirming agreement
   */
  static async getTrialBalance(companyId, year, month) {
    const { end } = getMonthRange(year, month);

    const [ChartOfAccount, JournalEntry] = await Promise.all([
      mongoose.model('ChartOfAccount'),
      mongoose.model('JournalEntry')
    ]);

    const accounts = await ChartOfAccount.find({ company: companyId, isActive: true }).sort('code');

    // Build account lookup by code (trimmed)
    const accountByCode = new Map();
    accounts.forEach(a => {
      accountByCode.set(String(a.code || '').trim(), a);
    });

    const entries = await JournalEntry.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(companyId), date: { $lte: end }, status: 'posted' } },
      { $unwind: '$lines' },
      {
        $group: {
          _id: '$lines.accountCode',
          totalDebit: { $sum: { $toDouble: '$lines.debit' } },
          totalCredit: { $sum: { $toDouble: '$lines.credit' } }
        }
      }
    ]);

    const items = entries.map(e => {
      const code = String(e._id || '').trim();
      if (!code) return null;
      const account = accountByCode.get(code);
      const normalBalance = ['asset', 'expense', 'cogs'].includes(account?.type) ? 'debit' : 'credit';
      const balance = normalBalance === 'debit' ? e.totalDebit - e.totalCredit : e.totalCredit - e.totalDebit;

      // For display: positive balance goes in normal column, negative goes in opposite column
      const absBalance = Math.abs(balance);
      const isDebit = normalBalance === 'debit';
      const debit = balance > 0 && isDebit ? balance : (balance < 0 && !isDebit ? absBalance : 0);
      const credit = balance > 0 && !isDebit ? balance : (balance < 0 && isDebit ? absBalance : 0);

      return {
        code: code,
        name: account?.name || 'Unknown',
        accountType: account?.type || 'unknown',
        debit,
        credit,
        balance
      };
    }).filter(i => i && i.balance !== 0);

    const totalDebits = items.reduce((s, i) => s + i.debit, 0);
    const totalCredits = items.reduce((s, i) => s + i.credit, 0);

    return {
      reportName: 'Monthly Trial Balance',
      asOfDate: end.toISOString().split('T')[0],
      year,
      month,
      companyId,
      accounts: items,
      totalDebits,
      totalCredits,
      isBalanced: Math.abs(totalDebits - totalCredits) < 0.01,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 4. Monthly Cash Flow Statement (Indirect Method)
   * Reconciles net profit to net cash from operating, investing, financing
   * Uses JournalEntry for accurate cash-based calculations
   */
  static async getCashFlowStatement(companyId, year, month) {
    const { start, end } = getMonthRange(year, month);
    const priorEnd = new Date(start);
    priorEnd.setMilliseconds(priorEnd.getMilliseconds() - 1);

    const [ChartOfAccount, JournalEntry, BankAccount] = await Promise.all([
      mongoose.model('ChartOfAccount'),
      mongoose.model('JournalEntry'),
      mongoose.model('BankAccount')
    ]);

    // Get all accounts with their types
    const accounts = await ChartOfAccount.find({ company: companyId, isActive: true });
    const accountByCode = new Map();
    accounts.forEach(a => {
      accountByCode.set(String(a.code || '').trim(), a);
    });

    // Get all journal entries for the period
    const entries = await JournalEntry.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(companyId), date: { $gte: start, $lte: end }, status: 'posted' } },
      { $unwind: '$lines' },
      {
        $group: {
          _id: '$lines.accountCode',
          debit: { $sum: { $toDouble: '$lines.debit' } },
          credit: { $sum: { $toDouble: '$lines.credit' } }
        }
      }
    ]);

    // Calculate balances by account type
    let revenueTotal = 0;
    let expenseTotal = 0;
    let arChange = 0;
    let apChange = 0;
    let inventoryChange = 0;
    let investingCashFlow = 0;
    let financingCashFlow = 0;

    entries.forEach(e => {
      const code = String(e._id || '').trim();
      const account = accountByCode.get(code);
      if (!account) return;

      const net = e.credit - e.debit; // Credit - Debit = balance for most accounts

      switch (account.type) {
        case 'revenue':
          revenueTotal += net;
          break;
        case 'expense':
        case 'cogs':
          expenseTotal += e.debit - e.credit;
          break;
        case 'asset':
          if (code.startsWith('14')) { // 1400 = Inventory
            inventoryChange += e.debit - e.credit;
          } else if (code.startsWith('13')) { // 1300 = Receivables
            arChange += e.debit - e.credit;
          } else if (code.startsWith('17') || code.startsWith('18')) { 
            // 1700+ = Fixed Assets = investing
            investingCashFlow -= e.debit - e.credit; // Outflow when debited
          }
          break;
        case 'liability':
          if (code.startsWith('20') || code.startsWith('21') || code.startsWith('22') || code.startsWith('26') || code.startsWith('27')) {
            // Payables/Accruals = AP change
            apChange += net;
          } else if (code.startsWith('28')) { // Loans = financing
            financingCashFlow += net;
          }
          break;
        case 'equity':
          financingCashFlow += net;
          break;
      }
    });

    // Net profit = Revenue - Expenses
    const netProfit = revenueTotal - expenseTotal;

    // Operating cash flow = Net Profit - AR Change + AP Change - Inventory Change
    const operatingCashFlow = netProfit - arChange + apChange - inventoryChange;

    // Net cash change
    const netCashChange = operatingCashFlow + investingCashFlow + financingCashFlow;

    // Beginning and ending cash (from BankAccount cachedBalance)
    const bankAccounts = await BankAccount.find({ company: companyId, isActive: true });
    const endingCash = bankAccounts.reduce((sum, a) => {
      return sum + (a.cachedBalance ? parseFloat(a.cachedBalance.toString()) : 0);
    }, 0);
    
    // Beginning cash = prior period ending (calculate backwards from current ending)
    // But if we have no prior activity, use the JournalEntry based calculation
    const priorEntries = await JournalEntry.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(companyId), date: { $lt: start }, status: 'posted' } },
      { $unwind: '$lines' },
      { $match: { 'lines.accountCode': { $regex: '^10|^11' } } }, // Cash accounts 1000-1199
      { $group: { _id: null, debit: { $sum: { $toDouble: '$lines.debit' } }, credit: { $sum: { $toDouble: '$lines.credit' } } } }
    ]);
    const priorCashActivity = priorEntries[0]?.debit - priorEntries[0]?.credit || 0;
    const beginningCash = Math.max(0, priorCashActivity); // Don't show negative beginning cash

    return {
      reportName: 'Monthly Cash Flow Statement',
      period: `${getMonthName(month)} ${year}`,
      year,
      month,
      companyId,
      operating: {
        netProfit,
        adjustments: {
          accountsReceivableChange: arChange,
          accountsPayableChange: apChange,
          inventoryChange
        },
        netOperatingCashFlow: operatingCashFlow
      },
      investing: {
        purchases: -Math.abs(investingCashFlow),
        netInvestingCashFlow: investingCashFlow
      },
      financing: {
        netFinancingCashFlow: financingCashFlow
      },
      summary: {
        beginningCash,
        netCashChange,
        endingCash
      },
      generatedAt: new Date().toISOString()
    };
  }

  // Helper: Get receivables change
  static async _getReceivablesChange(companyId, start, end) {
    const Invoice = mongoose.model('Invoice');
    const beginning = await Invoice.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(companyId), invoiceDate: { $lt: start }, status: { $in: ['sent', 'partially_paid'] } } },
      { $group: { _id: null, total: { $sum: { $toDouble: '$balanceDue' } } } }
    ]);
    const ending = await Invoice.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(companyId), invoiceDate: { $lte: end }, status: { $in: ['sent', 'partially_paid'] } } },
      { $group: { _id: null, total: { $sum: { $toDouble: '$balanceDue' } } } }
    ]);
    return (ending[0]?.total || 0) - (beginning[0]?.total || 0);
  }

  // Helper: Get payables change
  static async _getPayablesChange(companyId, start, end) {
    const Purchase = mongoose.model('Purchase');
    const beginning = await Purchase.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(companyId), purchaseDate: { $lt: start }, status: { $in: ['received', 'partial'] } } },
      { $group: { _id: null, total: { $sum: { $toDouble: '$balanceDue' } } } }
    ]);
    const ending = await Purchase.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(companyId), purchaseDate: { $lte: end }, status: { $in: ['received', 'partial'] } } },
      { $group: { _id: null, total: { $sum: { $toDouble: '$balanceDue' } } } }
    ]);
    return (ending[0]?.total || 0) - (beginning[0]?.total || 0);
  }

  // Helper: Get inventory change
  static async _getInventoryChange(companyId, start, end) {
    const StockMovement = mongoose.model('StockMovement');
    const movements = await StockMovement.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(companyId), movementDate: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: '$type',
          value: { $sum: { $multiply: [{ $toDouble: '$quantity' }, { $toDouble: { $ifNull: ['$unitCost', 0] } }] } }
        }
      }
    ]);
    const stockIn = movements.find(m => m._id === 'in')?.value || 0;
    const stockOut = movements.find(m => m._id === 'out')?.value || 0;
    return stockIn - stockOut;
  }

  // Helper: Get investing cash flow
  static async _getInvestingCashFlow(companyId, start, end) {
    const JournalEntry = mongoose.model('JournalEntry');
    const result = await JournalEntry.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(companyId), date: { $gte: start, $lte: end } } },
      { $unwind: '$lines' },
      { $match: { 'lines.accountName': { $regex: 'asset', $options: 'i' } } },
      { $group: { _id: null, total: { $sum: { $toDouble: '$lines.debit' } } } }
    ]);
    return -(result[0]?.total || 0);
  }

  // Helper: Get financing cash flow
  static async _getFinancingCashFlow(companyId, start, end) {
    const JournalEntry = mongoose.model('JournalEntry');
    const result = await JournalEntry.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(companyId), date: { $gte: start, $lte: end } } },
      { $unwind: '$lines' },
      { $match: { 'lines.accountName': { $regex: 'equity|loan|capital', $options: 'i' } } },
      { $group: { _id: null, total: { $sum: { $toDouble: '$lines.credit' } } } }
    ]);
    return result[0]?.total || 0;
  }

  // Helper: Get cash balance at date
  static async _getCashBalance(companyId, asOfDate) {
    const BankAccount = mongoose.model('BankAccount');
    const accounts = await BankAccount.find({ company: companyId, isActive: true });
    return accounts.reduce((sum, a) => {
      const bal = typeof a.balance === 'object' && a.balance?.$numberDecimal
        ? parseFloat(a.balance.$numberDecimal)
        : Number(a.balance) || 0;
      return sum + bal;
    }, 0);
  }

  /**
   * 5. Monthly Stock Valuation Report
   * Shows inventory items with weighted average cost, total value, slow-moving flags
   */
  static async getStockValuation(companyId, year, month) {
    const { end } = getMonthRange(year, month);

    const [Product, StockMovement] = await Promise.all([
      mongoose.model('Product'),
      mongoose.model('StockMovement')
    ]);

    // Get all products with their current valuation
    // Try multiple field names for quantity (quantityOnHand, stock, quantity)
    const products = await Product.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(companyId), isActive: true } },
      {
        $project: {
          name: 1,
          sku: 1,
          category: 1,
          quantityOnHand: {
            $toDouble: {
              $ifNull: ['$currentStock', 0]
            }
          },
          unitCost: { $toDouble: { $ifNull: ['$averageCost', { $ifNull: ['$unitCost', '$costPrice'] }, 0] } }
        }
      },
      {
        $project: {
          name: 1,
          sku: 1,
          category: 1,
          quantityOnHand: 1,
          unitCost: 1,
          totalValue: { $multiply: ['$quantityOnHand', '$unitCost'] }
        }
      }
    ]);

    // Get last movement date for each product to determine slow-moving status
    const lastMovements = await StockMovement.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(companyId) } },
      {
        $group: {
          _id: '$product',
          lastMovement: { $max: '$movementDate' }
        }
      }
    ]);

    const lastMovementMap = new Map(lastMovements.map(m => [m._id.toString(), m.lastMovement]));

    const ninetyDaysAgo = new Date(end);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const items = products.map(p => {
      const lastMove = lastMovementMap.get(p._id.toString());
      const daysSinceMovement = lastMove ? Math.floor((end - new Date(lastMove)) / (1000 * 60 * 60 * 24)) : 999;

      return {
        productId: p._id,
        name: p.name,
        sku: p.sku,
        category: p.category,
        quantityOnHand: p.quantityOnHand,
        unitCost: p.unitCost,
        totalValue: p.totalValue,
        lastMovementDate: lastMove,
        daysSinceMovement,
        isSlowMoving: daysSinceMovement > 90,
        isAgedStock: daysSinceMovement > 180
      };
    });

    const totalValue = items.reduce((sum, i) => sum + i.totalValue, 0);
    const slowMovingValue = items.filter(i => i.isSlowMoving).reduce((sum, i) => sum + i.totalValue, 0);

    return {
      reportName: 'Monthly Stock Valuation Report',
      asOfDate: end.toISOString().split('T')[0],
      year,
      month,
      companyId,
      summary: {
        totalItems: items.length,
        totalValue,
        slowMovingItems: items.filter(i => i.isSlowMoving).length,
        slowMovingValue,
        agedStockItems: items.filter(i => i.isAgedStock).length,
        agedStockValue: items.filter(i => i.isAgedStock).reduce((sum, i) => sum + i.totalValue, 0)
      },
      items,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 6. Monthly Sales by Customer
   * Ranked customer list by revenue with invoice count, AOV, outstanding balance
   */
  static async getSalesByCustomer(companyId, year, month) {
    const { start, end } = getMonthRange(year, month);

    const Invoice = mongoose.model('Invoice');

    const customerSales = await Invoice.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          invoiceDate: { $gte: start, $lte: end },
          status: { $in: ['fully_paid', 'partially_paid', 'confirmed', 'sent'] }
        }
      },
      {
        $group: {
          _id: '$client',
          totalRevenue: { $sum: { $toDouble: '$total' } },
          invoiceCount: { $sum: 1 },
          outstandingBalance: { $sum: { $toDouble: { $ifNull: ['$balanceDue', 0] } } }
        }
      },
      { $sort: { totalRevenue: -1 } },
      {
        $lookup: {
          from: 'clients',
          localField: '_id',
          foreignField: '_id',
          as: 'client'
        }
      },
      { $unwind: { path: '$client', preserveNullAndEmptyArrays: true } }
    ]);

    const customers = customerSales.map(c => ({
      customerId: c._id,
      customerName: c.client?.name || 'Unknown',
      totalRevenue: c.totalRevenue,
      invoiceCount: c.invoiceCount,
      averageOrderValue: c.totalRevenue / c.invoiceCount,
      outstandingBalance: c.outstandingBalance
    }));

    return {
      reportName: 'Monthly Sales by Customer',
      period: `${getMonthName(month)} ${year}`,
      year,
      month,
      companyId,
      summary: {
        totalCustomers: customers.length,
        totalRevenue: customers.reduce((s, c) => s + c.totalRevenue, 0),
        totalInvoices: customers.reduce((s, c) => s + c.invoiceCount, 0),
        totalOutstanding: customers.reduce((s, c) => s + c.outstandingBalance, 0)
      },
      customers,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 7. Monthly Sales by Product Category
   * Revenue and units sold by category with gross margin per category
   */
  static async getSalesByCategory(companyId, year, month) {
    const { start, end } = getMonthRange(year, month);

    const Invoice = mongoose.model('Invoice');

    const categorySales = await Invoice.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          invoiceDate: { $gte: start, $lte: end },
          status: { $in: ['fully_paid', 'partially_paid', 'sent', 'confirmed'] }
        }
      },
      { $unwind: '$lines' },
      {
        $lookup: {
          from: 'products',
          localField: 'lines.product',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'categories',
          localField: 'product.category',
          foreignField: '_id',
          as: 'category'
        }
      },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$category.name',
          totalRevenue: {
            $sum: { $multiply: [{ $toDouble: '$lines.qty' }, { $toDouble: '$lines.unitPrice' }] }
          },
          totalUnits: { $sum: { $toDouble: '$lines.qty' } },
          totalCost: {
            $sum: { $multiply: [{ $toDouble: '$lines.qty' }, { $toDouble: { $ifNull: ['$lines.unitCost', '$product.averageCost', '$product.unitCost', 0] } }] }
          }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);

    const categories = categorySales.map(c => ({
      category: c._id || 'Uncategorized',
      totalRevenue: c.totalRevenue,
      totalUnits: c.totalUnits,
      totalCost: c.totalCost,
      grossProfit: c.totalRevenue - c.totalCost,
      grossMargin: c.totalRevenue > 0 ? ((c.totalRevenue - c.totalCost) / c.totalRevenue) * 100 : 0
    }));

    return {
      reportName: 'Monthly Sales by Product Category',
      period: `${getMonthName(month)} ${year}`,
      year,
      month,
      companyId,
      summary: {
        totalCategories: categories.length,
        totalRevenue: categories.reduce((s, c) => s + c.totalRevenue, 0),
        totalUnits: categories.reduce((s, c) => s + c.totalUnits, 0),
        totalGrossProfit: categories.reduce((s, c) => s + c.grossProfit, 0),
        overallMargin: categories.length > 0
          ? categories.reduce((s, c) => s + c.grossProfit, 0) / categories.reduce((s, c) => s + c.totalRevenue, 0) * 100
          : 0
      },
      categories,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 8. Monthly Purchases by Supplier
   * Ranked suppliers by total spend with PO count and order vs invoiced variance
   */
  static async getPurchasesBySupplier(companyId, year, month) {
    const { start, end } = getMonthRange(year, month);

    const Purchase = mongoose.model('Purchase');
    const PurchaseOrder = mongoose.model('PurchaseOrder');

    // Get direct purchases
    const directPurchases = await Purchase.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          purchaseDate: { $gte: start, $lte: end },
          status: { $in: ['received', 'partial', 'completed', 'paid'] }
        }
      },
      {
        $group: {
          _id: '$supplier',
          totalOrdered: { $sum: { $toDouble: { $ifNull: ['$grandTotal', '$subtotal', '$total', 0] } } },
          poCount: { $sum: 1 },
          totalInvoiced: { $sum: { $cond: [{ $ne: ['$supplierInvoiceNumber', null] }, { $toDouble: { $ifNull: ['$grandTotal', '$subtotal', '$total', 0] } }, 0] } }
        }
      }
    ]);

    // Get purchase orders (use correct status and field name totalAmount)
    const purchaseOrders = await PurchaseOrder.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          orderDate: { $gte: start, $lte: end },
          status: { $in: ['ordered', 'received', 'partial', 'completed', 'paid', 'fully_received', 'partially_received', 'confirmed'] }
        }
      },
      {
        $group: {
          _id: '$supplier',
          totalOrdered: { $sum: { $toDouble: { $ifNull: ['$totalAmount', '$subtotal', 0] } } },
          poCount: { $sum: 1 },
          totalInvoiced: { $sum: { $cond: [{ $ne: ['$supplierInvoiceNumber', null] }, { $toDouble: { $ifNull: ['$totalAmount', '$subtotal', 0] } }, 0] } }
        }
      }
    ]);

    // Merge both sources
    const supplierMap = new Map();
    
    [...directPurchases, ...purchaseOrders].forEach(item => {
      const existing = supplierMap.get(item._id?.toString());
      if (existing) {
        existing.totalOrdered += item.totalOrdered || 0;
        existing.poCount += item.poCount || 0;
        existing.totalInvoiced += item.totalInvoiced || 0;
      } else {
        supplierMap.set(item._id?.toString(), {
          _id: item._id,
          totalOrdered: item.totalOrdered || 0,
          poCount: item.poCount || 0,
          totalInvoiced: item.totalInvoiced || 0
        });
      }
    });

    const supplierIds = [...supplierMap.values()].map(s => s._id).filter(Boolean);
    
    // Get supplier names
    const Supplier = mongoose.model('Supplier');
    const suppliersData = await Supplier.find({ _id: { $in: supplierIds } }).select('name');
    const supplierNameMap = new Map(suppliersData.map(s => [s._id.toString(), s.name]));

    const supplierPurchases = [...supplierMap.values()].map(s => ({
      ...s,
      supplier: { name: supplierNameMap.get(s._id?.toString()) || 'Unknown' }
    })).sort((a, b) => b.totalOrdered - a.totalOrdered);

    const suppliers = supplierPurchases.map(s => ({
      supplierId: s._id,
      supplierName: s.supplier?.name || 'Unknown',
      totalSpend: s.totalOrdered,
      poCount: s.poCount,
      totalInvoiced: s.totalInvoiced,
      variance: s.totalOrdered - s.totalInvoiced,
      variancePercent: s.totalOrdered > 0 ? ((s.totalOrdered - s.totalInvoiced) / s.totalOrdered) * 100 : 0
    }));

    return {
      reportName: 'Monthly Purchases by Supplier',
      period: `${getMonthName(month)} ${year}`,
      year,
      month,
      companyId,
      summary: {
        totalSuppliers: suppliers.length,
        totalSpend: suppliers.reduce((s, sup) => s + sup.totalSpend, 0),
        totalPOs: suppliers.reduce((s, sup) => s + sup.poCount, 0),
        totalVariance: suppliers.reduce((s, sup) => s + sup.variance, 0)
      },
      suppliers,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 9. Monthly Accounts Receivable Aging
   * 30/60/90/90+ day buckets with provision for doubtful debts
   */
  static async getARAging(companyId, year, month) {
    const { end } = getMonthRange(year, month);

    const Invoice = mongoose.model('Invoice');

    const invoices = await Invoice.find({
      company: new mongoose.Types.ObjectId(companyId),
      status: { $in: ['sent', 'partially_paid'] },
      balanceDue: { $gt: 0 }
    }).populate('client', 'name');

    const buckets = {
      current: { amount: 0, count: 0 },
      days30: { amount: 0, count: 0 },
      days60: { amount: 0, count: 0 },
      days90: { amount: 0, count: 0 },
      days90plus: { amount: 0, count: 0 }
    };

    const customerAging = [];

    invoices.forEach(inv => {
      const dueDate = new Date(inv.dueDate || inv.invoiceDate);
      const daysOverdue = Math.floor((end - dueDate) / (1000 * 60 * 60 * 24));
      const balance = Number(inv.balanceDue) || 0;

      let bucket;
      if (daysOverdue <= 0) bucket = 'current';
      else if (daysOverdue <= 30) bucket = 'days30';
      else if (daysOverdue <= 60) bucket = 'days60';
      else if (daysOverdue <= 90) bucket = 'days90';
      else bucket = 'days90plus';

      buckets[bucket].amount += balance;
      buckets[bucket].count += 1;

      const existing = customerAging.find(c => c.customerId === inv.client?._id?.toString());
      if (existing) {
        existing[bucket] += balance;
        existing.total += balance;
      } else {
        customerAging.push({
          customerId: inv.client?._id?.toString() || 'unknown',
          customerName: inv.client?.name || 'Unknown',
          current: bucket === 'current' ? balance : 0,
          days30: bucket === 'days30' ? balance : 0,
          days60: bucket === 'days60' ? balance : 0,
          days90: bucket === 'days90' ? balance : 0,
          days90plus: bucket === 'days90plus' ? balance : 0,
          total: balance
        });
      }
    });

    const totalAR = Object.values(buckets).reduce((s, b) => s + b.amount, 0);
    const provision = buckets.days90.amount * 0.5 + buckets.days90plus.amount * 0.8;

    return {
      reportName: 'Monthly Accounts Receivable Aging',
      asOfDate: end.toISOString().split('T')[0],
      year,
      month,
      companyId,
      summary: {
        totalAR,
        totalInvoices: invoices.length,
        provisionForDoubtfulDebts: provision,
        netAR: totalAR - provision
      },
      buckets: {
        current: buckets.current,
        days30: buckets.days30,
        days60: buckets.days60,
        days90: buckets.days90,
        days90plus: buckets.days90plus
      },
      customers: customerAging.sort((a, b) => b.total - a.total),
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 10. Monthly Accounts Payable Aging
   * 30/60/90/90+ day buckets
   */
  static async getAPAging(companyId, year, month) {
    const { end } = getMonthRange(year, month);

    const Purchase = mongoose.model('Purchase');

    const purchases = await Purchase.find({
      company: new mongoose.Types.ObjectId(companyId),
      status: { $in: ['received', 'partial'] },
      balanceDue: { $gt: 0 }
    }).populate('supplier', 'name');

    const buckets = {
      current: { amount: 0, count: 0 },
      days30: { amount: 0, count: 0 },
      days60: { amount: 0, count: 0 },
      days90: { amount: 0, count: 0 },
      days90plus: { amount: 0, count: 0 }
    };

    const supplierAging = [];

    purchases.forEach(p => {
      const dueDate = new Date(p.dueDate || p.purchaseDate);
      const daysOverdue = Math.floor((end - dueDate) / (1000 * 60 * 60 * 24));
      const balance = Number(p.balanceDue) || 0;

      let bucket;
      if (daysOverdue <= 0) bucket = 'current';
      else if (daysOverdue <= 30) bucket = 'days30';
      else if (daysOverdue <= 60) bucket = 'days60';
      else if (daysOverdue <= 90) bucket = 'days90';
      else bucket = 'days90plus';

      buckets[bucket].amount += balance;
      buckets[bucket].count += 1;

      const existing = supplierAging.find(s => s.supplierId === p.supplier?._id?.toString());
      if (existing) {
        existing[bucket] += balance;
        existing.total += balance;
      } else {
        supplierAging.push({
          supplierId: p.supplier?._id?.toString() || 'unknown',
          supplierName: p.supplier?.name || 'Unknown',
          current: bucket === 'current' ? balance : 0,
          days30: bucket === 'days30' ? balance : 0,
          days60: bucket === 'days60' ? balance : 0,
          days90: bucket === 'days90' ? balance : 0,
          days90plus: bucket === 'days90plus' ? balance : 0,
          total: balance
        });
      }
    });

    const totalAP = Object.values(buckets).reduce((s, b) => s + b.amount, 0);

    return {
      reportName: 'Monthly Accounts Payable Aging',
      asOfDate: end.toISOString().split('T')[0],
      year,
      month,
      companyId,
      summary: {
        totalAP,
        totalBills: purchases.length
      },
      buckets: {
        current: buckets.current,
        days30: buckets.days30,
        days60: buckets.days60,
        days90: buckets.days90,
        days90plus: buckets.days90plus
      },
      suppliers: supplierAging.sort((a, b) => b.total - a.total),
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 11. Monthly Payroll Summary
   * Employee-level detail: gross pay, PAYE, RSSB, deductions, net pay, employer costs
   */
  static async getPayrollSummary(companyId, year, month) {
    const Payroll = mongoose.model('Payroll');

    const payrollRecords = await Payroll.find({
      company: new mongoose.Types.ObjectId(companyId),
      'period.year': year,
      'period.month': month,
      status: { $in: ['processed', 'paid', 'Paid', undefined, null] }
    });

    const employees = payrollRecords.map(p => ({
      employeeId: p._id,
      employeeNumber: p.employee?.employeeId || 'N/A',
      name: `${p.employee?.firstName || ''} ${p.employee?.lastName || ''}`.trim() || 'Unknown',
      grossPay: p.salary?.grossSalary || 0,
      taxableIncome: p.salary?.grossSalary || 0,
      paye: p.deductions?.paye || 0,
      rssbEmployee: (p.deductions?.rssbEmployeePension || 0) + (p.deductions?.rssbEmployeeMaternity || 0),
      rssbEmployer: (p.contributions?.rssbEmployerPension || 0) + (p.contributions?.rssbEmployerMaternity || 0),
      otherDeductions: (p.deductions?.healthInsurance || 0) + (p.deductions?.otherDeductions || 0) + (p.deductions?.loanDeductions || 0),
      totalDeductions: p.deductions?.totalDeductions || 0,
      netPay: p.netPay || 0,
      employerCost: (p.salary?.grossSalary || 0) + (p.contributions?.rssbEmployerPension || 0) + (p.contributions?.rssbEmployerMaternity || 0) + (p.contributions?.occupationalHazard || 0)
    }));

    return {
      reportName: 'Monthly Payroll Summary',
      period: `${getMonthName(month)} ${year}`,
      year,
      month,
      companyId,
      summary: {
        totalEmployees: employees.length,
        totalGrossPay: employees.reduce((s, e) => s + e.grossPay, 0),
        totalPAYE: employees.reduce((s, e) => s + e.paye, 0),
        totalRSSBEmployee: employees.reduce((s, e) => s + e.rssbEmployee, 0),
        totalRSSBEmployer: employees.reduce((s, e) => s + e.rssbEmployer, 0),
        totalOtherDeductions: employees.reduce((s, e) => s + e.otherDeductions, 0),
        totalNetPay: employees.reduce((s, e) => s + e.netPay, 0),
        totalEmployerCost: employees.reduce((s, e) => s + e.employerCost, 0)
      },
      employees,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 12. Monthly VAT Return Worksheet
   * Output VAT from sales, input VAT from purchases, net VAT, RRA filing format
   */
  static async getVATReturn(companyId, year, month) {
    const { start, end } = getMonthRange(year, month);

    const [Invoice, Purchase, JournalEntry] = await Promise.all([
      mongoose.model('Invoice'),
      mongoose.model('Purchase'),
      mongoose.model('JournalEntry')
    ]);

    // Output VAT from sales
    const outputVAT = await Invoice.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          invoiceDate: { $gte: start, $lte: end },
          status: { $in: ['fully_paid', 'partially_paid', 'confirmed', 'sent'] }
        }
      },
      { $unwind: { path: '$lines', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$lines.taxCode',
          taxCode: { $first: '$lines.taxCode' },
          taxRate: { $first: '$lines.taxRate' },
          taxableAmount: { $sum: { $toDouble: { $ifNull: ['$lines.lineSubtotal', 0] } } },
          taxAmount: { $sum: { $toDouble: { $ifNull: ['$lines.lineTax', 0] } } }
        }
      }
    ]);

    // Input VAT from direct purchases
    const inputVAT = await Purchase.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          purchaseDate: { $gte: start, $lte: end },
          status: { $in: ['received', 'partial', 'completed', 'paid'] }
        }
      },
      {
        $group: {
          _id: null,
          totalInputVAT: { $sum: { $toDouble: { $ifNull: ['$totalTax', 0] } } },
          totalPurchases: { $sum: { $toDouble: { $ifNull: ['$subtotal', '$grandTotal'] } } }
        }
      }
    ]);

    // Input VAT from purchase orders
    const PurchaseOrder = mongoose.model('PurchaseOrder');
    const poInputVAT = await PurchaseOrder.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          orderDate: { $gte: start, $lte: end },
          status: { $in: ['ordered', 'received', 'partial', 'completed', 'paid', 'fully_received', 'partially_received'] }
        }
      },
      {
        $group: {
          _id: null,
          totalInputVAT: { $sum: { $toDouble: { $ifNull: ['$taxAmount', 0] } } },
          totalPurchases: { $sum: { $toDouble: { $ifNull: ['$subtotal', '$totalAmount', 0] } } }
        }
      }
    ]);

    const totalOutputVAT = outputVAT.reduce((s, v) => s + (v.taxAmount || 0), 0);
    const totalInputVAT = (inputVAT[0]?.totalInputVAT || 0) + (poInputVAT[0]?.totalInputVAT || 0);
    const totalPurchases = (inputVAT[0]?.totalPurchases || 0) + (poInputVAT[0]?.totalPurchases || 0);
    const netVAT = totalOutputVAT - totalInputVAT;

    return {
      reportName: 'Monthly VAT Return Worksheet',
      taxPeriod: `${getMonthName(month)} ${year}`,
      year,
      month,
      companyId,
      summary: {
        netVATPAYABLE: netVAT,
        totalOutputVAT,
        totalInputVAT
      },
      outputVAT: {
        total: totalOutputVAT,
        totalTaxable: outputVAT.reduce((s, v) => s + v.taxableAmount, 0),
        breakdown: outputVAT.map(v => ({
          taxCode: v.taxCode || 'VAT',
          taxRate: v.taxRate || 18,
          taxableAmount: v.taxableAmount,
          taxAmount: v.taxAmount
        }))
      },
      inputVAT: {
        total: totalInputVAT,
        inputVAT: totalInputVAT,
        totalPurchases
      },
      netVAT: {
        amount: Math.abs(netVAT),
        type: netVAT >= 0 ? 'payable' : 'reclaimable'
      },
      rraBoxes: {
        box1Sales: outputVAT.reduce((s, v) => s + v.taxableAmount, 0),
        box2OutputVAT: totalOutputVAT,
        box3Purchases: totalPurchases,
        box4InputVAT: totalInputVAT,
        box5NetVAT: netVAT
      },
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 13. Monthly Bank Reconciliation Report
   * Book balance, outstanding deposits/checks, bank balance, reconciling items
   */
  static async getBankReconciliation(companyId, year, month) {
    const { start, end } = getMonthRange(year, month);

    const [BankAccount, BankTransaction] = await Promise.all([
      mongoose.model('BankAccount'),
      mongoose.model('BankTransaction')
    ]);

    const accounts = await BankAccount.find({ company: companyId, isActive: true });

    const reconciliations = await Promise.all(
      accounts.map(async (account) => {
        // Use cachedBalance (computed from journal entries) as the book balance
        const bookBalance = typeof account.cachedBalance === 'object' && account.cachedBalance?.$numberDecimal
          ? parseFloat(account.cachedBalance.$numberDecimal)
          : Number(account.cachedBalance) || 0;

        // Get uncleared deposits (transactions after statement cutoff)
        const unclearedDeposits = await BankTransaction.aggregate([
          {
            $match: {
              company: new mongoose.Types.ObjectId(companyId),
              account: account._id,
              type: 'deposit',
              status: { $ne: 'reconciled' },
              date: { $lte: end }
            }
          },
          { $group: { _id: null, total: { $sum: { $toDouble: '$amount' } } } }
        ]);

        // Get uncleared checks/payments
        const unclearedChecks = await BankTransaction.aggregate([
          {
            $match: {
              company: new mongoose.Types.ObjectId(companyId),
              account: account._id,
              type: 'withdrawal',
              status: { $ne: 'reconciled' },
              date: { $lte: end }
            }
          },
          { $group: { _id: null, total: { $sum: { $toDouble: '$amount' } } } }
        ]);

        const outstandingDeposits = unclearedDeposits[0]?.total || 0;
        const outstandingChecks = unclearedChecks[0]?.total || 0;

        // Get reconciling items
        const reconcilingItems = await BankTransaction.find({
          company: companyId,
          account: account._id,
          isReconcilingItem: true,
          date: { $lte: end }
        }).sort({ date: -1 });

        // Get latest bank statement balance
        const BankStatementLine = mongoose.model('BankStatementLine');
        
        // Check for statement lines in the period first, then fall back to any prior statement
        let latestStatementLine = await BankStatementLine.findOne({
          bankAccount: account._id,
          transactionDate: { $gte: start, $lte: end }
        }).sort({ transactionDate: -1, _id: -1 });
        const reconciliationDifference = bookBalance - adjustedBankBalance;
        
        const isReconciled = Math.abs(reconciliationDifference) < 0.01;

        return {
          accountId: account._id,
          accountName: account.name,
          accountNumber: account.accountNumber,
          bankName: account.bankName,
          currency: account.currency,
          bookBalance,
          bankStatementBalance,
          outstandingDeposits,
          outstandingChecks,
          adjustedBankBalance,
          reconciliationDifference,
          isReconciled,
          statementDate: latestStatementLine?.transactionDate || null,
          reconcilingItems: reconcilingItems.map(r => ({
            date: r.date,
            description: r.description,
            amount: r.amount,
            type: r.type
          }))
        };
      })
    );

    return {
      reportName: 'Monthly Bank Reconciliation Report',
      asOfDate: end.toISOString().split('T')[0],
      year,
      month,
      companyId,
      accounts: reconciliations,
      summary: {
        totalBookBalance: reconciliations.reduce((s, a) => s + a.bookBalance, 0),
        totalBankStatementBalance: reconciliations.reduce((s, a) => s + a.bankStatementBalance, 0),
        totalOutstandingDeposits: reconciliations.reduce((s, a) => s + a.outstandingDeposits, 0),
        totalOutstandingChecks: reconciliations.reduce((s, a) => s + a.outstandingChecks, 0),
        totalAdjustedBankBalance: reconciliations.reduce((s, a) => s + a.adjustedBankBalance, 0),
        totalReconciliationDifference: reconciliations.reduce((s, a) => s + a.reconciliationDifference, 0),
        isFullyReconciled: reconciliations.every(a => a.isReconciled)
      },
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 14. Monthly Budget vs Actual
   * Expense/revenue lines vs monthly budget with variance %
   */
  static async getBudgetVsActual(companyId, year, month) {
    const { start, end } = getMonthRange(year, month);

    const [Budget, Invoice, Expense, Purchase, Payroll] = await Promise.all([
      mongoose.model('Budget'),
      mongoose.model('Invoice'),
      mongoose.model('Expense'),
      mongoose.model('Purchase'),
      mongoose.model('Payroll')
    ]);

    // Get budget for the month - query by fiscal_year and period date range
    const budgets = await Budget.find({
      company_id: new mongoose.Types.ObjectId(companyId),
      fiscal_year: year,
      periodStart: { $lte: end },
      periodEnd: { $gte: start },
      status: { $in: ['active', 'approved'] }
    });

    // Get actual revenue
    const actualRevenue = await Invoice.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          invoiceDate: { $gte: start, $lte: end },
          status: { $in: ['fully_paid', 'partially_paid', 'confirmed', 'sent'] }
        }
      },
      { $group: { _id: null, total: { $sum: { $toDouble: '$total' } } } }
    ]);

    // Get actual expenses from multiple sources: Expense, Purchase (paid), Payroll
    const [expenseAgg, purchaseAgg, payrollAgg] = await Promise.all([
      // Direct expenses
      Expense.aggregate([
        { $match: { company: new mongoose.Types.ObjectId(companyId), expense_date: { $gte: start, $lte: end } } },
        { $group: { _id: '$category', actual: { $sum: { $toDouble: '$amount' } } } }
      ]),
      // Purchase orders that are paid/received
      Purchase.aggregate([
        { 
          $match: { 
            company: new mongoose.Types.ObjectId(companyId), 
            purchaseDate: { $gte: start, $lte: end },
            status: { $in: ['paid', 'received', 'partially_paid', 'confirmed'] }
          } 
        },
        { $group: { _id: '$category', actual: { $sum: { $toDouble: '$total' } } } }
      ]),
      // Payroll expenses
      Payroll.aggregate([
        { 
          $match: { 
            company: new mongoose.Types.ObjectId(companyId), 
            'period.year': year,
            'period.month': month,
            status: { $in: ['processed', 'paid', 'Paid', undefined, null] }
          } 
        },
        { $group: { _id: 'Payroll', actual: { $sum: { $toDouble: '$netPay' } } } }
      ])
    ]);

    // Merge all expense sources - assign default category for null/undefined
    const actualExpenses = [];
    [...expenseAgg, ...purchaseAgg, ...payrollAgg].forEach(e => {
      // Assign default category if null/undefined
      const category = e._id || 'Operations';
      const existing = actualExpenses.find(a => a._id === category);
      if (existing) {
        existing.actual += e.actual;
      } else {
        actualExpenses.push({ _id: category, actual: e.actual });
      }
    });

    const revenueBudget = budgets.find(b => b.type === 'revenue');
    const expenseBudgets = budgets.filter(b => b.type === 'expense');

    // Helper to parse Decimal128
    const parseAmount = (val) => {
      if (!val) return 0;
      if (typeof val === 'object' && val.$numberDecimal) return parseFloat(val.$numberDecimal);
      if (typeof val === 'object' && val.toString) return parseFloat(val.toString());
      return Number(val) || 0;
    };

    const revenueBudgetAmount = parseAmount(revenueBudget?.amount);

    const revenueLine = {
      category: 'Revenue',
      budget: revenueBudgetAmount,
      actual: actualRevenue[0]?.total || 0,
      variance: (actualRevenue[0]?.total || 0) - revenueBudgetAmount,
      variancePercent: revenueBudgetAmount ? ((actualRevenue[0]?.total || 0) - revenueBudgetAmount) / revenueBudgetAmount * 100 : 0
    };

    const expenseLines = expenseBudgets.map(b => {
      // Try to match by budget category first, then name/description
      const budgetCategory = b.category;
      const budgetName = b.name || b.description || '';
      
      let actual = 0;
      
      // Try exact match with budget category
      if (budgetCategory) {
        actual = actualExpenses.find(e => e._id?.toLowerCase() === budgetCategory.toLowerCase())?.actual || 0;
      }
      
      // If no match, try partial match with expense categories
      if (actual === 0) {
        const match = actualExpenses.find(e => {
          if (!e._id) return false;
          const expCat = e._id.toLowerCase();
          const budgetNameLower = budgetName.toLowerCase();
          const budgetCatLower = budgetCategory?.toLowerCase() || '';
          // Check if expense category contains budget category OR budget contains expense
          const isMatch = expCat.includes(budgetCatLower) || 
                 budgetNameLower.includes(expCat) ||
                 budgetCatLower.includes(expCat);
          return isMatch;
        });
        actual = match?.actual || 0;
      }
      
      // If still no match and this is Operations budget, assign all uncategorized expenses
      if (actual === 0 && budgetCategory === 'Operations') {
        const uncategorized = actualExpenses.find(e => e._id === 'Operations');
        actual = uncategorized?.actual || 0;
      }
      
      const budgetAmount = parseAmount(b.amount);
      // Variance for expenses: budget - actual (positive when under budget is favorable)
      const variance = budgetAmount - actual;
      return {
        category: b.name,
        budget: budgetAmount,
        actual,
        variance,
        variancePercent: budgetAmount ? variance / budgetAmount * 100 : 0
      };
    });

    // Total budget should show total revenue budget (the income target), not net
    const totalBudget = revenueBudgetAmount;
    const totalExpenseBudget = expenseBudgets.reduce((s, b) => s + parseAmount(b.amount), 0);
    const totalActual = revenueLine.actual;
    const totalExpenseActual = expenseLines.reduce((s, e) => s + e.actual, 0);

    // Add status to expense lines
    // Variance for expenses: budget - actual (positive = under budget, negative = over budget)
    const expenseLinesWithStatus = expenseLines.map(e => {
      let status;
      if (e.actual === 0) {
        status = 'Not Started';
      } else if (e.variance >= 0) {
        status = 'On Track'; // Under budget (positive variance is good for expenses)
      } else {
        status = 'Over Budget'; // Over budget (negative variance)
      }
      return { ...e, status };
    });

    return {
      reportName: 'Monthly Budget vs Actual',
      period: `${getMonthName(month)} ${year}`,
      year,
      month,
      companyId,
      revenue: revenueLine,
      expenses: expenseLinesWithStatus,
      summary: {
        totalBudget,
        totalExpenseBudget,
        totalActual,
        totalExpenseActual,
        totalVariance: totalActual - totalBudget,
        variancePercent: totalBudget ? (totalActual - totalBudget) / totalBudget * 100 : 0
      },
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 15. Monthly General Ledger Activity
   * Monthly GL movements by account
   */
  static async getGeneralLedger(companyId, year, month) {
    const { start, end } = getMonthRange(year, month);

    const [ChartOfAccount, JournalEntry] = await Promise.all([
      mongoose.model('ChartOfAccount'),
      mongoose.model('JournalEntry')
    ]);

    const accounts = await ChartOfAccount.find({ company: companyId, isActive: true }).sort('code');

    const accountActivity = await Promise.all(
      accounts.map(async (account) => {
        const entries = await JournalEntry.aggregate([
          {
            $match: {
              company: new mongoose.Types.ObjectId(companyId),
              date: { $gte: start, $lte: end },
              status: 'posted'
            }
          },
          { $unwind: '$lines' },
          { $match: { 'lines.accountCode': account.code } },
          {
            $group: {
              _id: null,
              debit: { $sum: { $toDouble: '$lines.debit' } },
              credit: { $sum: { $toDouble: '$lines.credit' } },
              count: { $sum: 1 }
            }
          }
        ]);

        const activity = entries[0];
        if (!activity || (activity.debit === 0 && activity.credit === 0)) return null;

        return {
          accountId: account._id,
          code: account.code,
          name: account.name,
          accountType: account.type,
          debit: activity.debit,
          credit: activity.credit,
          netMovement: activity.debit - activity.credit,
          transactionCount: activity.count
        };
      })
    );

    const filteredActivity = accountActivity.filter(a => a !== null);

    return {
      reportName: 'Monthly General Ledger Activity',
      period: `${getMonthName(month)} ${year}`,
      year,
      month,
      companyId,
      summary: {
        totalAccounts: filteredActivity.length,
        totalDebits: filteredActivity.reduce((s, a) => s + a.debit, 0),
        totalCredits: filteredActivity.reduce((s, a) => s + a.credit, 0),
        totalTransactions: filteredActivity.reduce((s, a) => s + a.transactionCount, 0)
      },
      accounts: filteredActivity,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = MonthlyReportsService;
