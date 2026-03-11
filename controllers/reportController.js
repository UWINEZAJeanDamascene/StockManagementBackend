const Product = require('../models/Product');
const Invoice = require('../models/Invoice');
const StockMovement = require('../models/StockMovement');
const Client = require('../models/Client');
const Supplier = require('../models/Supplier');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const Purchase = require('../models/Purchase');
const Budget = require('../models/Budget');
const Company = require('../models/Company');
const FixedAsset = require('../models/FixedAsset');
const Loan = require('../models/Loan');
const CreditNote = require('../models/CreditNote');
const Expense = require('../models/Expense');
const PurchaseReturn = require('../models/PurchaseReturn');
const cacheService = require('../services/cacheService');

// Shared helper: declining-balance rate (mirrors FixedAsset model logic)
function _dbRateReport(cost, salvage, years) {
  if (salvage > 0 && cost > 0) return 1 - Math.pow(salvage / cost, 1 / years);
  return 2 / years;
}

// Shared helper: calculate total depreciation expense for a list of fixed assets
// within a specific reporting period. Respects the "1st of purchase month" start rule.
// P&L uses this so that: annual P&L shows the full annual slice (same every year for SL),
// and partial periods show a proportional monthly amount.
function calculateDepreciationForPeriod(assets, periodStart, periodEnd) {
  let total = 0;

  assets.forEach(asset => {
    if (!asset.purchaseDate || !asset.purchaseCost || !asset.usefulLifeYears) return;

    const purchaseDate = new Date(asset.purchaseDate);
    // Snap to 1st of purchase month — use UTC getters to avoid timezone day-shift
    // when dates are stored as "YYYY-MM-01T00:00:00.000Z" (UTC midnight)
    const depStart    = new Date(Date.UTC(purchaseDate.getUTCFullYear(), purchaseDate.getUTCMonth(), 1));
    const totalMonths = asset.usefulLifeYears * 12;
    // Depreciation ends at 1st of the month after useful life expires
    const depEnd = new Date(Date.UTC(depStart.getUTCFullYear(), depStart.getUTCMonth() + totalMonths, 1));

    const depreciable = (asset.purchaseCost || 0) - (asset.salvageValue || 0);
    if (depreciable <= 0) return;

    // Work in absolute month indices (year * 12 + month) — all UTC
    const depStartAbs    = depStart.getUTCFullYear()    * 12 + depStart.getUTCMonth();
    const depEndAbs      = depEnd.getUTCFullYear()      * 12 + depEnd.getUTCMonth();
    const periodStartAbs = periodStart.getUTCFullYear() * 12 + periodStart.getUTCMonth();
    const periodEndAbs   = periodEnd.getUTCFullYear()   * 12 + periodEnd.getUTCMonth();

    const overlapStart = Math.max(depStartAbs, periodStartAbs);
    const overlapEnd   = Math.min(depEndAbs, periodEndAbs + 1); // inclusive end month

    if (overlapEnd <= overlapStart) return; // no overlap

    // Sum monthly depreciation for each month in the overlap
    for (let abs = overlapStart; abs < overlapEnd; abs++) {
      const monthsIntoLife = abs - depStartAbs;
      if (monthsIntoLife < 0 || monthsIntoLife >= totalMonths) continue;

      const yearIdx = Math.floor(monthsIntoLife / 12); // 0-indexed year in asset's life

      let monthlyDep = 0;
      switch (asset.depreciationMethod || 'straight-line') {
        case 'straight-line':
          monthlyDep = depreciable / totalMonths;
          break;
        case 'sum-of-years': {
          const syd = (asset.usefulLifeYears * (asset.usefulLifeYears + 1)) / 2;
          const remainingLife = asset.usefulLifeYears - yearIdx;
          monthlyDep = (depreciable * remainingLife) / syd / 12;
          break;
        }
        case 'declining-balance': {
          const rate = _dbRateReport(asset.purchaseCost, asset.salvageValue || 0, asset.usefulLifeYears);
          let bv = asset.purchaseCost;
          for (let y = 0; y < yearIdx; y++) {
            const dep = Math.min(bv * rate, Math.max(0, bv - (asset.salvageValue || 0)));
            bv -= dep;
          }
          const yearlyDep = Math.min(bv * rate, Math.max(0, bv - (asset.salvageValue || 0)));
          monthlyDep = yearlyDep / 12;
          break;
        }
        default:
          monthlyDep = depreciable / totalMonths;
      }
      total += monthlyDep;
    }
  });

  return total;
}

// Shared helper: calculates interest expense for a list of active loans within a reporting period.
// Handles both simple interest (fixed monthly interest on outstanding balance) and
// compound/EMI interest (amortizing schedule – interest portion of each EMI).
function calculateLoanInterest(loans, periodStart, periodEnd) {
  let interestExpense = 0;

  loans.forEach(loan => {
    const loanStart  = new Date(loan.startDate);
    const loanEnd    = loan.endDate ? new Date(loan.endDate) : null;
    const method     = loan.interestMethod || 'simple';
    const annualRate = loan.interestRate   || 0;
    const r          = annualRate / 100 / 12; // monthly rate

    if (method === 'compound' && loan.durationMonths && r > 0) {
      // ── COMPOUND / EMI ────────────────────────────────────────────────────
      // Walk the full amortization schedule; sum interest only for months that
      // fall inside the reporting period.
      const n   = loan.durationMonths;
      const P   = loan.originalAmount;
      const emi = P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);

      let balance = P;
      for (let m = 0; m < n; m++) {
        const monthDate  = new Date(loanStart);
        monthDate.setMonth(monthDate.getMonth() + m);

        const interest    = balance * r;
        const principal   = emi - interest;

        const mY = monthDate.getFullYear(), mM = monthDate.getMonth();
        const sY = periodStart.getFullYear(), sM = periodStart.getMonth();
        const eY = periodEnd.getFullYear(),   eM = periodEnd.getMonth();

        const afterStart = (mY > sY) || (mY === sY && mM >= sM);
        const beforeEnd  = (mY < eY) || (mY === eY && mM <= eM);

        if (afterStart && beforeEnd) interestExpense += interest;

        balance -= principal;
        if (balance < 0.01) break;
      }
    } else {
      // ── SIMPLE INTEREST ───────────────────────────────────────────────────
      // For simple interest the FULL interest for the entire loan duration is
      // recognised immediately (front-loaded) — both in P&L and Balance Sheet.
      // We still clamp to the reporting period to avoid including loans that
      // haven't started yet or have already ended.
      const effectiveStart = loanStart > periodStart ? loanStart : periodStart;
      const effectiveEnd   = (loanEnd && loanEnd < periodEnd) ? loanEnd : periodEnd;

      if (effectiveEnd < effectiveStart) return; // not active in this period

      // Use the full contractual duration, not just the reporting-period slice.
      // Fall back to the clamped window only when durationMonths is not recorded.
      const totalDurationMonths = loan.durationMonths || Math.max(1,
        ((effectiveEnd.getFullYear() - effectiveStart.getFullYear()) * 12 +
          effectiveEnd.getMonth() - effectiveStart.getMonth()) + 1
      );

      // Simple interest: full interest for entire loan term, recognised immediately
      const monthlyInterest = (loan.originalAmount * annualRate / 100) / 12;
      interestExpense += monthlyInterest * totalDurationMonths;
    }
  });

  return interestExpense;
}

// Shared helper: computes NET PROFIT (AFTER TAX) using the EXACT same logic as getProfitAndLossFull.
// This ensures Balance Sheet → Equity → Current Period Profit always matches P&L → Net Profit (After Tax).
// Any change to the P&L formula will automatically be reflected in the Balance Sheet.
async function computeCurrentPeriodProfit(companyId, periodStart, periodEnd) {
  // ── REVENUE ──────────────────────────────────────────────────────────────
  const paidInvoices = await Invoice.find({
    company: companyId,
    status: 'paid',
    paidDate: { $gte: periodStart, $lte: periodEnd }
  }).populate('items.product', 'averageCost');

  const salesRevenueExVAT = paidInvoices.reduce((sum, inv) => sum + (inv.subtotal || 0), 0);
  const discountsGiven = paidInvoices.reduce((sum, inv) => sum + (inv.totalDiscount || 0), 0);

  const creditNotes = await CreditNote.find({
    company: companyId,
    status: { $in: ['issued', 'applied', 'refunded', 'partially_refunded'] },
    issueDate: { $gte: periodStart, $lte: periodEnd }
  });
  const salesReturns = creditNotes.reduce((sum, cn) => sum + (cn.subtotal || 0), 0);

  const netRevenue = salesRevenueExVAT - salesReturns - discountsGiven;

  // ── COGS ─────────────────────────────────────────────────────────────────
  const purchases = await Purchase.find({
    company: companyId,
    status: { $in: ['received', 'paid'] },
    purchaseDate: { $gte: periodStart, $lte: periodEnd }
  });
  const purchasesExVAT = purchases.reduce((sum, p) => sum + (p.subtotal || 0) - (p.totalDiscount || 0), 0);

  const purchaseReturnsData = await PurchaseReturn.aggregate([
    {
      $match: {
        company: companyId,
        status: { $in: ['approved', 'refunded'] },
        returnDate: { $gte: periodStart, $lte: periodEnd }
      }
    },
    { $group: { _id: null, subtotal: { $sum: '$subtotal' } } }
  ]);
  const purchaseReturns = purchaseReturnsData[0]?.subtotal || 0;

  const products = await Product.find({ company: companyId, isArchived: false });
  const closingStockValue = products.reduce((sum, p) => sum + (p.currentStock * p.averageCost), 0);

  // openingStockValue defaults to 0 (same as P&L Full when no previousPeriod provided)
  const totalCOGS = purchasesExVAT - purchaseReturns - closingStockValue;

  const grossProfit = netRevenue - totalCOGS;

  // ── OPERATING EXPENSES (from Expense model – mirrors P&L Full exactly) ──
  const expenseSummary = await Expense.aggregate([
    {
      $match: {
        company: companyId,
        status: { $ne: 'cancelled' }
        // No date filter – matches P&L Full behaviour
      }
    },
    { $group: { _id: '$type', total: { $sum: '$amount' } } }
  ]);

  const expenseData = {};
  expenseSummary.forEach(item => { expenseData[item._id] = item.total; });

  const salariesWages         = expenseData['salaries_wages'] || 0;
  const rent                  = expenseData['rent'] || 0;
  const utilities             = expenseData['utilities'] || 0;
  const transportDelivery     = expenseData['transport_delivery'] || 0;
  const marketingAdvertising  = expenseData['marketing_advertising'] || 0;
  const otherExpenses         = expenseData['other_expense'] || 0;

  // Depreciation — period-aware, starts from 1st of purchase month
  const fixedAssets = await FixedAsset.find({ company: companyId, status: 'active' });
  const depreciationExpense = calculateDepreciationForPeriod(fixedAssets, periodStart, periodEnd);

  const totalOperatingExpenses =
    salariesWages + rent + utilities + transportDelivery +
    marketingAdvertising + depreciationExpense + otherExpenses;

  const operatingProfit = grossProfit - totalOperatingExpenses;

  // ── OTHER INCOME / EXPENSES ───────────────────────────────────────────────
  const interestIncome        = expenseData['interest_income'] || 0;
  const otherIncome           = expenseData['other_income'] || 0;
  const otherExpenseFromModule = expenseData['other_expense_income'] || 0;

  const activeLoans = await Loan.find({
    company: companyId,
    status: 'active',
    startDate: { $lte: periodEnd },
    $or: [{ endDate: { $exists: false } }, { endDate: null }, { endDate: { $gte: periodStart } }]
  });
  const interestExpense = calculateLoanInterest(activeLoans, periodStart, periodEnd);

  const netOtherIncome = interestIncome + otherIncome - interestExpense - otherExpenseFromModule;

  // ── PROFIT BEFORE TAX ─────────────────────────────────────────────────────
  const profitBeforeTax = operatingProfit + netOtherIncome;

  // ── CORPORATE INCOME TAX (30%) ────────────────────────────────────────────
  const corporateIncomeTax = Math.max(0, profitBeforeTax * 0.30);

  // ── NET PROFIT (AFTER TAX) ────────────────────────────────────────────────
  const netProfit = profitBeforeTax - corporateIncomeTax;

  return {
    netProfit,
    corporateIncomeTax,
    profitBeforeTax,
    netRevenue,
    grossProfit,
    invoicesConsidered: paidInvoices.length
  };
}
// @desc    Get stock valuation report
// @route   GET /api/reports/stock-valuation
// @access  Private
exports.getStockValuationReport = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { categoryId } = req.query;
    const cacheKey = { companyId, categoryId: categoryId || 'all' };
    
    const cached = await cacheService.fetchOrExecute(
      'stock',
      async () => {
        const query = { isArchived: false, company: companyId };
        if (categoryId) {
          query.category = categoryId;
        }

        const products = await Product.find(query)
          .populate('category', 'name')
          .sort({ name: 1 });

        const report = products.map(product => ({
          sku: product.sku,
          name: product.name,
          category: product.category?.name,
          unit: product.unit,
          currentStock: product.currentStock,
          averageCost: product.averageCost,
          totalValue: product.currentStock * product.averageCost
        }));

        const totalValue = report.reduce((sum, item) => sum + item.totalValue, 0);

        return {
          items: report,
          summary: {
            totalProducts: report.length,
            totalValue
          }
        };
      },
      cacheKey,
      { ttl: 60, useCompanyPrefix: true } // 1 minute cache - stock changes frequently
    );

    res.json({
      success: true,
      data: cached.data,
      fromCache: cached.fromCache
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get sales summary report
// @route   GET /api/reports/sales-summary
// @access  Private
exports.getSalesSummaryReport = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate, clientId } = req.query;
    const cacheKey = { companyId, startDate, endDate, clientId };
    
    const cached = await cacheService.fetchOrExecute(
      'report',
      async () => {
        const query = { status: { $in: ['paid', 'partial'] }, company: companyId };

        if (startDate || endDate) {
          query.invoiceDate = {};
          if (startDate) query.invoiceDate.$gte = new Date(startDate);
          if (endDate) query.invoiceDate.$lte = new Date(endDate);
        }

        if (clientId) {
          query.client = clientId;
        }

        const invoices = await Invoice.find(query)
          .populate('client', 'name code')
          .populate('items.product', 'name sku')
          .sort({ invoiceDate: -1 });

        const summary = {
          totalInvoices: invoices.length,
          totalSales: invoices.reduce((sum, inv) => sum + inv.grandTotal, 0),
          totalPaid: invoices.reduce((sum, inv) => sum + inv.amountPaid, 0),
          totalDiscount: invoices.reduce((sum, inv) => sum + inv.totalDiscount, 0),
          totalTax: invoices.reduce((sum, inv) => sum + inv.totalTax, 0)
        };

        // Sales by product
        const productSales = {};
        invoices.forEach(invoice => {
          invoice.items.forEach(item => {
            const productId = item.product?._id?.toString();
            if (!productSales[productId]) {
              productSales[productId] = {
                product: item.product,
                quantity: 0,
                revenue: 0
              };
            }
            productSales[productId].quantity += item.quantity;
            productSales[productId].revenue += item.total;
          });
        });

        return {
          invoices,
          summary,
          productSales: Object.values(productSales)
        };
      },
      cacheKey,
      { ttl: 120, useCompanyPrefix: true } // 2 minute cache
    );

    res.json({
      success: true,
      data: cached.data,
      fromCache: cached.fromCache
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get product movement report
// @route   GET /api/reports/product-movement
// @access  Private
exports.getProductMovementReport = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate, productId, type } = req.query;
    const query = { company: companyId };

    if (startDate || endDate) {
      query.movementDate = {};
      if (startDate) query.movementDate.$gte = new Date(startDate);
      if (endDate) query.movementDate.$lte = new Date(endDate);
    }

    if (productId) {
      query.product = productId;
    }

    if (type) {
      query.type = type;
    }

    const movements = await StockMovement.find(query)
      .populate('product', 'name sku unit')
      .populate('supplier', 'name code')
      .populate('performedBy', 'name email')
      .sort({ movementDate: -1 });

    const summary = {
      totalMovements: movements.length,
      totalIn: movements.filter(m => m.type === 'in').reduce((sum, m) => sum + m.quantity, 0),
      totalOut: movements.filter(m => m.type === 'out').reduce((sum, m) => sum + m.quantity, 0),
      totalCost: movements.reduce((sum, m) => sum + (m.totalCost || 0), 0)
    };

    res.json({
      success: true,
      data: {
        movements,
        summary
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get client sales report
// @route   GET /api/reports/client-sales
// @access  Private
exports.getClientSalesReport = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate } = req.query;
    const cacheKey = { companyId, startDate, endDate };
    
    const cached = await cacheService.fetchOrExecute(
      'report',
      async () => {
        const matchStage = { status: { $in: ['paid', 'partial'] }, company: companyId };

        if (startDate || endDate) {
          matchStage.invoiceDate = {};
          if (startDate) matchStage.invoiceDate.$gte = new Date(startDate);
          if (endDate) matchStage.invoiceDate.$lte = new Date(endDate);
        }

        const clientSales = await Invoice.aggregate([
          { $match: matchStage },
          { $group: {
            _id: '$client',
            totalInvoices: { $sum: 1 },
            totalSales: { $sum: '$grandTotal' },
            totalPaid: { $sum: '$amountPaid' },
            totalBalance: { $sum: '$balance' }
          }},
          { $sort: { totalSales: -1 } }
        ]);

        await Client.populate(clientSales, { 
          path: '_id', 
          select: 'name code contact type'
        });

        return clientSales;
      },
      cacheKey,
      { ttl: 120, useCompanyPrefix: true } // 2 minute cache
    );

    res.json({
      success: true,
      count: cached.data.length,
      data: cached.data,
      fromCache: cached.fromCache
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get profit and loss report (gross margin, net profit)
// @route   GET /api/reports/profit-and-loss
// @access  Private
exports.getProfitAndLossReport = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate } = req.query;
    
    // NO CACHING for P&L - used by Balance Sheet for Current Period Profit
    // Must always reflect real-time data

    // For Profit & Loss, we only consider PAID invoices
    // Revenue is only recognized when payment is received
    const invMatch = { status: 'paid', company: companyId };
    if (startDate || endDate) {
      invMatch.invoiceDate = {};
      if (startDate) invMatch.invoiceDate.$gte = new Date(startDate);
      if (endDate) invMatch.invoiceDate.$lte = new Date(endDate);
    }

    const invoices = await Invoice.find(invMatch).populate('items.product', 'averageCost');

    // Total Revenue: Sum of all paid invoice amounts (INCLUDING tax)
    // Revenue includes tax - tax will be subtracted as expense
    const revenue = invoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);

    // COGS (Cost of Goods Sold): Sum of cost price × quantity sold for all products on paid invoices
    // We use the product's averageCost as the cost price (this is the best available approximation)
    let cogs = 0;
    invoices.forEach(inv => {
      inv.items.forEach(item => {
        const costPrice = item.product?.averageCost || 0;
        cogs += (costPrice * (item.quantity || 0));
      });
    });

    // Gross Profit = Revenue - COGS
    const grossProfit = revenue - cogs;

    // Gross Margin % = (Gross Profit / Revenue) × 100
    const grossMarginPercent = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

    // NOTE: Purchase Expenses are NOT included in P&L
    // In accrual accounting, purchases are recorded as Assets (Inventory) in the Balance Sheet
    // Only COGS (Cost of Goods Sold) is recorded as expense when products are sold
    const purchaseExpenses = 0;

    // Taxes: Sum of actual tax amounts recorded on each paid invoice
    const taxes = invoices.reduce((sum, inv) => sum + (inv.totalTax || 0), 0);

    // Discounts: Sum of all discounts applied on paid invoices in this period
    const discounts = invoices.reduce((sum, inv) => sum + (inv.totalDiscount || 0), 0);

    // Net Profit = Gross Profit - Taxes - Discounts
    // (Purchase expenses removed - purchases are now assets, not expenses)
    const netProfit = grossProfit - taxes - discounts;

    // Net Margin % = (Net Profit / Revenue) × 100
    const netMarginPercent = revenue > 0 ? (netProfit / revenue) * 100 : 0;

    res.json({
      success: true,
      data: {
        revenue,
        cogs,
        grossProfit,
        grossMarginPercent: Math.round(grossMarginPercent * 100) / 100,
        purchaseExpenses,
        taxes,
        discounts,
        netProfit,
        netMarginPercent: Math.round(netMarginPercent * 100) / 100,
        invoicesCount: invoices.length
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get detailed Profit & Loss Statement (Comprehensive)
// @route   GET /api/reports/profit-and-loss-detailed
// @access  Private
exports.getProfitAndLossDetailed = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate } = req.query;
    
    // Set default period to current quarter if not provided
    const now = new Date();
    const periodStart = startDate ? new Date(startDate) : new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    const periodEnd = endDate ? new Date(endDate) : new Date();
    
    // Get company info
    const company = await Company.findById(companyId);
    const companyName = company?.name || 'N/A';
    const companyTin = company?.tin || 'N/A';
    
    // =============================================
    // REVENUE SECTION
    // =============================================
    
    // Sales Revenue (excluding VAT) - Cash-basis: revenue recognised when payment is received.
    // Use paidDate (not invoiceDate) so that invoices issued before the period but paid
    // within it are correctly included, and unpaid invoices are excluded.
    const salesInvoiceMatch = { 
      status: 'paid', 
      company: companyId,
      paidDate: { $gte: periodStart, $lte: periodEnd }
    };
    
    const paidInvoices = await Invoice.find(salesInvoiceMatch).populate('items.product', 'averageCost');
    
    // Sales Revenue (ex. VAT) = Gross sales before discounts (subtotal is pre-discount, pre-tax)
    // Discounts are shown as a separate line below, so do NOT subtract them here
    const salesRevenueExVAT = paidInvoices.reduce((sum, inv) => {
      return sum + (inv.subtotal || 0);
    }, 0);
    
    // Sales Returns (Credit Notes issued) in period
    const creditNoteMatch = {
      company: companyId,
      status: { $in: ['issued', 'applied', 'refunded', 'partially_refunded'] },
      issueDate: { $gte: periodStart, $lte: periodEnd }
    };
    
    const creditNotes = await CreditNote.find(creditNoteMatch);
    const salesReturns = creditNotes.reduce((sum, cn) => sum + (cn.subtotal || 0), 0);
    
    // Discounts Given - from paid invoices (item-level discounts + invoice-level discounts)
    const discountsGiven = paidInvoices.reduce((sum, inv) => sum + (inv.totalDiscount || 0), 0);
    
    // NET REVENUE = Sales Revenue - Sales Returns - Discounts
    const netRevenue = salesRevenueExVAT - salesReturns - discountsGiven;
    
    // =============================================
    // COST OF GOODS SOLD (COGS) SECTION
    // =============================================
    
    // For COGS, we calculate from ACTUAL items sold on paid invoices
    // This is more accurate than the inventory method which requires historical data
    
    const products = await Product.find({ company: companyId, isArchived: false });
    
    // Opening Stock: simply use 0 - stock returns only affect Closing Stock
    const openingStockValue = 0;
    
    // Purchases (ex. VAT) - from RECEIVED/PAID purchases in period
    const purchaseMatch = {
      company: companyId,
      status: { $in: ['received', 'paid'] },
      purchaseDate: { $gte: periodStart, $lte: periodEnd }
    };
    
    const purchases = await Purchase.find(purchaseMatch);
    const purchasesExVAT = purchases.reduce((sum, p) => {
      return sum + (p.subtotal || 0) - (p.totalDiscount || 0);
    }, 0);

    // Purchase Returns (ex. VAT) - approved/refunded purchase returns in period
    const purchaseReturnMatchDetailed = {
      company: companyId,
      status: { $in: ['approved', 'refunded', 'partially_refunded'] },
      returnDate: { $gte: periodStart, $lte: periodEnd }
    };
    const purchaseReturnsAggDetailed = await PurchaseReturn.aggregate([
      { $match: purchaseReturnMatchDetailed },
      { $group: { _id: null, subtotal: { $sum: '$subtotal' }, count: { $sum: 1 } } }
    ]);
    const purchaseReturnsDetailed = purchaseReturnsAggDetailed[0]?.subtotal || 0;
    const purchaseReturnsCountDetailed = purchaseReturnsAggDetailed[0]?.count || 0;
    
    // Closing Stock Value (current inventory)
    const closingStockValue = products.reduce((sum, product) => {
      return sum + (product.currentStock * product.averageCost);
    }, 0);
    
    // COGS: Opening Stock + Purchases - Purchase Returns - Closing Stock
    const totalCOGS = openingStockValue + purchasesExVAT - purchaseReturnsDetailed - closingStockValue;
    
    // =============================================
    // GROSS PROFIT
    // =============================================
    const grossProfit = netRevenue - totalCOGS;
    const grossMarginPercent = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
    
    // =============================================
    // OPERATING EXPENSES
    // =============================================
    
    // 1. Depreciation — period-aware, starts from 1st of purchase month
    const fixedAssets = await FixedAsset.find({ company: companyId, status: 'active' });
    const depreciationExpense = calculateDepreciationForPeriod(fixedAssets, periodStart, periodEnd);
    
    // 2. Interest Expense (from Loans)
    const loanMatch = {
      company: companyId,
      status: 'active',
      startDate: { $lte: periodEnd },
      $or: [{ endDate: { $exists: false } }, { endDate: null }, { endDate: { $gte: periodStart } }]
    };
    const activeLoans = await Loan.find(loanMatch);

    // Calculate interest expense for the period (prorated, on outstanding balance)
    const interestExpense = calculateLoanInterest(activeLoans, periodStart, periodEnd);
    
    // 3. Transport & Delivery (from invoice shipping/transport if tracked)
    // Note: Not currently in invoice model, set to 0
    const transportDelivery = 0;
    
    // 4. VAT Expense (Output VAT - Input VAT) for the period
    // Output VAT from sales
    const outputVAT = paidInvoices.reduce((sum, inv) => sum + (inv.totalTax || 0), 0);
    // Input VAT from purchases
    const inputVAT = purchases.reduce((sum, p) => sum + (p.totalTax || 0), 0);
    // Net VAT = Output VAT - Input VAT (if positive, you owe VAT to RRA; if negative, you have VAT credit/receivable from RRA)
    const vatLiability = outputVAT - inputVAT;
    
    // For now, we'll set other operating expenses to 0 
    // In a full system, you'd have an Expense model to track these
    const salariesWages = 0;
    const rent = 0;
    const utilities = 0;
    const marketingAdvertising = 0;
    const otherExpenses = 0;
    
    const totalOperatingExpenses = 
      salariesWages + 
      rent + 
      utilities + 
      transportDelivery + 
      marketingAdvertising + 
      depreciationExpense + 
      otherExpenses;
    
    // =============================================
    // OPERATING PROFIT (EBIT)
    // =============================================
    const operatingProfit = grossProfit - totalOperatingExpenses;
    const operatingMarginPercent = netRevenue > 0 ? (operatingProfit / netRevenue) * 100 : 0;
    
    // =============================================
    // OTHER INCOME / EXPENSES
    // =============================================
    
    // Interest Income (could be from deposits - not currently tracked)
    const interestIncome = 0;
    
    // Other Income (not currently tracked)
    const otherIncome = 0;
    
    // Other Expense (not currently tracked)
    const otherExpense = 0;
    
    const netOtherIncome = interestIncome - interestExpense + otherIncome - otherExpense;
    
    // =============================================
    // PROFIT BEFORE TAX (PBT)
    // =============================================
    const profitBeforeTax = operatingProfit + netOtherIncome;
    
    // =============================================
    // TAX
    // =============================================
    
    // VAT is collected on behalf of RRA - it's neither income nor expense
    // It appears on the Balance Sheet as either a liability (VAT Payable) or asset (VAT Receivable)
    // Therefore, we set vatExpense to 0 for P&L purposes - it does NOT affect profit
    const vatExpense = 0;
    
    // Corporate Income Tax (30% of Profit Before Tax)
    const corporateTaxRate = 0.30;
    const corporateIncomeTax = Math.max(0, profitBeforeTax * corporateTaxRate);
    
    const totalTax = vatExpense + corporateIncomeTax;

    // =============================================
    // NET PROFIT (AFTER TAX)
    // Use formula-based COGS for consistency with the display
    // =============================================
    let netProfit = profitBeforeTax - totalTax;
    
    // Use the formula-based approach for net profit (same as COGS calculation above)
    // This ensures NET PROFIT is dynamic and consistent with the report display
    const netProfitFromFormula = netRevenue - totalCOGS - totalOperatingExpenses + netOtherIncome - corporateIncomeTax;
    netProfit = netProfitFromFormula;
    const netMarginPercent = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;
    
    // =============================================
    // RESPONSE
    // =============================================
    res.json({
      success: true,
      data: {
        // Header
        company: {
          name: companyName,
          tin: companyTin
        },
        period: {
          start: periodStart,
          end: periodEnd,
          formatted: `${periodStart.toLocaleDateString('en-GB')} - ${periodEnd.toLocaleDateString('en-GB')}`
        },
        
        // REVENUE
        revenue: {
          salesRevenueExVAT: Math.round(salesRevenueExVAT * 100) / 100,
          salesReturns: Math.round(salesReturns * 100) / 100,
          discountsGiven: Math.round(discountsGiven * 100) / 100,
          netRevenue: Math.round(netRevenue * 100) / 100
        },
        
        // COST OF GOODS SOLD
        cogs: {
          openingStockValue: Math.round(openingStockValue * 100) / 100,
          purchasesExVAT: Math.round(purchasesExVAT * 100) / 100,
          purchaseReturns: Math.round(purchaseReturnsDetailed * 100) / 100,
          closingStockValue: Math.round(closingStockValue * 100) / 100,
          totalCOGS: Math.round(totalCOGS * 100) / 100
        },
        
        // GROSS PROFIT
        grossProfit: {
          amount: Math.round(grossProfit * 100) / 100,
          marginPercent: Math.round(grossMarginPercent * 100) / 100
        },
        
        // OPERATING EXPENSES
        operatingExpenses: {
          salariesAndWages: salariesWages,
          rent: rent,
          utilities: utilities,
          transportAndDelivery: transportDelivery,
          marketingAndAdvertising: marketingAdvertising,
          depreciation: Math.round(depreciationExpense * 100) / 100,
          otherExpenses: otherExpenses,
          total: Math.round(totalOperatingExpenses * 100) / 100
        },
        
        // OPERATING PROFIT (EBIT)
        operatingProfit: {
          amount: Math.round(operatingProfit * 100) / 100,
          marginPercent: Math.round(operatingMarginPercent * 100) / 100
        },
        
        // OTHER INCOME / EXPENSES
        otherIncomeExpenses: {
          interestIncome: interestIncome,
          interestExpense: Math.round(interestExpense * 100) / 100,
          otherIncome: otherIncome,
          otherExpense: otherExpense,
          netOtherIncome: Math.round(netOtherIncome * 100) / 100
        },
        
        // PROFIT BEFORE TAX
        profitBeforeTax: {
          amount: Math.round(profitBeforeTax * 100) / 100
        },
        
        // TAX
        tax: {
          vatLiability: Math.round(vatExpense * 100) / 100,
          outputVAT: Math.round(outputVAT * 100) / 100,
          inputVAT: Math.round(inputVAT * 100) / 100,
          corporateIncomeTax: Math.round(corporateIncomeTax * 100) / 100,
          corporateTaxRate: corporateTaxRate * 100,
          totalTax: Math.round(totalTax * 100) / 100
        },
        
        // NET PROFIT
        netProfit: {
          amount: Math.round(netProfit * 100) / 100,
          marginPercent: Math.round(netMarginPercent * 100) / 100
        },
        
        // Summary for Balance Sheet integration
        balanceSheetFlow: {
          currentPeriodProfit: Math.round(netProfit * 100) / 100,
          flowsToEquity: true
        },
        
        // Additional details
        details: {
          paidInvoicesCount: paidInvoices.length,
          creditNotesCount: creditNotes.length,
          purchasesCount: purchases.length,
          purchaseReturnsCount: purchaseReturnsCountDetailed,
          fixedAssetsCount: fixedAssets.length,
          activeLoansCount: activeLoans.length,
          productsCount: products.length
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get aging report (receivables or payables)
// @route   GET /api/reports/aging
// @access  Private
exports.getAgingReport = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { type = 'receivables' } = req.query; // type: receivables|payables
    const cacheKey = { companyId, type };
    const now = new Date();
    
    const cached = await cacheService.fetchOrExecute(
      'report',
      async () => {
        if (type === 'receivables') {
          const invoices = await Invoice.find({ balance: { $gt: 0 }, company: companyId }).populate('client', 'name');

          const buckets = { current: [], '1-30': [], '31-60': [], '61-90': [], '90+': [] };

          invoices.forEach(inv => {
            const due = inv.dueDate || inv.invoiceDate;
            const days = Math.floor((now - new Date(due)) / (1000 * 60 * 60 * 24));
            const entry = { invoice: inv, balance: inv.balance, days };

            if (days <= 0) buckets.current.push(entry);
            else if (days <= 30) buckets['1-30'].push(entry);
            else if (days <= 60) buckets['31-60'].push(entry);
            else if (days <= 90) buckets['61-90'].push(entry);
            else buckets['90+'].push(entry);
          });

          return { count: invoices.length, buckets };
        } else {
          // payables
          const purchases = await Purchase.find({ balance: { $gt: 0 }, company: companyId }).populate('supplier', 'name');
          const buckets = { current: [], '1-30': [], '31-60': [], '61-90': [], '90+': [] };

          purchases.forEach(p => {
            const due = p.expectedDeliveryDate || p.purchaseDate;
            const days = Math.floor((now - new Date(due)) / (1000 * 60 * 60 * 24));
            const entry = { purchase: p, balance: p.balance, days };

            if (days <= 0) buckets.current.push(entry);
            else if (days <= 30) buckets['1-30'].push(entry);
            else if (days <= 60) buckets['31-60'].push(entry);
            else if (days <= 90) buckets['61-90'].push(entry);
            else buckets['90+'].push(entry);
          });

          return { count: purchases.length, buckets };
        }
      },
      cacheKey,
      { ttl: 120, useCompanyPrefix: true } // 2 minute cache
    );

    res.json({
      success: true,
      data: cached.data,
      fromCache: cached.fromCache
    });
  } catch (error) {
    next(error);
  }
};

// @desc    VAT summary report
// @route   GET /api/reports/vat-summary
// @access  Private
exports.getVATSummaryReport = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate, recalculate } = req.query;
    const cacheKey = { companyId, startDate, endDate };
    
    // If recalculate flag is set, fix tax codes in invoices first
    if (recalculate === 'true') {
      await fixTaxCodesInInvoices(companyId);
    }
    
    const cached = await cacheService.fetchOrExecute(
      'report_vat_summary_v4',
      async () => {
        const match = { status: { $in: ['paid', 'partial', 'confirmed'] }, company: companyId };
        if (startDate || endDate) {
          match.invoiceDate = {};
          if (startDate) match.invoiceDate.$gte = new Date(startDate);
          if (endDate) match.invoiceDate.$lte = new Date(endDate);
        }

        const agg = await Invoice.aggregate([
          { $match: match },
          { $unwind: '$items' },
          { $group: {
            _id: { $ifNull: ['$items.taxCode', 'None'] },
            taxableBase: { $sum: { $subtract: [
              { $multiply: [{ $ifNull: ['$items.quantity', 0] }, { $ifNull: ['$items.unitPrice', 0] }] },
              { $ifNull: ['$items.discount', 0] }
            ]} },
            taxAmount: { $sum: { $ifNull: ['$items.taxAmount', 0] } }
          } }
        ]);

        const summary = {};
        agg.forEach(a => {
          const taxCode = a._id;
          if (taxCode && (a.taxableBase > 0 || a.taxAmount > 0)) {
            summary[taxCode] = { 
              taxableBase: Math.round((a.taxableBase || 0) * 100) / 100, 
              taxAmount: Math.round((a.taxAmount || 0) * 100) / 100 
            };
          }
        });

        return { summary };
      },
      cacheKey,
      { ttl: 30, useCompanyPrefix: true }
    );

    res.json({
      success: true,
      data: cached.data,
      fromCache: cached.fromCache
    });
  } catch (error) {
    next(error);
  }
};

// Helper function to fix tax codes in invoices based on taxRate
async function fixTaxCodesInInvoices(companyId) {
  try {
    // Find all invoices with items that have incorrect taxCode
    const invoices = await Invoice.find({ 
      company: companyId,
      status: { $in: ['paid', 'partial', 'confirmed'] }
    });

    let fixedCount = 0;
    for (const invoice of invoices) {
      let needsSave = false;
      
      for (const item of invoice.items) {
        // Determine correct taxCode based on taxRate
        // If taxRate is 0 or undefined, it should be 'A' (exempt)
        // If taxRate > 0, it should be 'B' (18%)
        const taxRate = item.taxRate || 0;
        
        if (taxRate === 0 && item.taxCode !== 'A') {
          item.taxCode = 'A';
          needsSave = true;
        } else if (taxRate > 0 && item.taxCode !== 'B') {
          item.taxCode = 'B';
          needsSave = true;
        }
      }
      
      if (needsSave) {
        // Recalculate totals before saving
        invoice.markModified('items');
        await invoice.save();
        fixedCount++;
      }
    }
    
    console.log(`Fixed tax codes in ${fixedCount} invoices`);
    return fixedCount;
  } catch (error) {
    console.error('Error fixing tax codes:', error);
    throw error;
  }
}

// @desc    Product performance (sales, quantity, margin)
// @route   GET /api/reports/product-performance
// @access  Private
exports.getProductPerformanceReport = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate, limit = 50 } = req.query;
    const cacheKey = { companyId, startDate, endDate, limit };
    
    const cached = await cacheService.fetchOrExecute(
      'report',
      async () => {
        const match = { status: { $in: ['paid', 'partial', 'confirmed'] }, company: companyId };
        if (startDate || endDate) {
          match.invoiceDate = {};
          if (startDate) match.invoiceDate.$gte = new Date(startDate);
          if (endDate) match.invoiceDate.$lte = new Date(endDate);
        }

        const agg = await Invoice.aggregate([
          { $match: match },
          { $unwind: '$items' },
          { $group: {
            _id: '$items.product',
            quantitySold: { $sum: '$items.quantity' },
            revenue: { $sum: '$items.totalWithTax' }
          } },
          { $sort: { revenue: -1 } },
          { $limit: parseInt(limit, 10) }
        ]);

        // populate product and compute margin
        const populated = await Product.populate(agg, { path: '_id', select: 'name sku averageCost' });
        const report = populated.map(row => {
          const avgCost = row._id?.averageCost || 0;
          const cogs = avgCost * (row.quantitySold || 0);
          const margin = (row.revenue || 0) - cogs;
          return {
            product: row._id,
            quantitySold: row.quantitySold,
            revenue: row.revenue,
            cogs,
            margin
          };
        });

        return { count: report.length, data: report };
      },
      cacheKey,
      { ttl: 300, useCompanyPrefix: true } // 5 minute cache
    );

    res.json({
      success: true,
      data: cached.data,
      fromCache: cached.fromCache
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Customer Lifetime Value (CLV)
// @route   GET /api/reports/clv
// @access  Private
exports.getCLVReport = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { limit = 100 } = req.query;
    const cacheKey = { companyId, limit };
    
    const cached = await cacheService.fetchOrExecute(
      'report',
      async () => {
        const match = { status: { $in: ['paid', 'partial', 'confirmed'] }, company: companyId };

        const agg = await Invoice.aggregate([
          { $match: match },
          { $group: {
            _id: '$client',
            totalSales: { $sum: '$grandTotal' },
            orders: { $sum: 1 },
            avgOrder: { $avg: '$grandTotal' },
            firstOrder: { $min: '$invoiceDate' },
            lastOrder: { $max: '$invoiceDate' }
          } },
          { $sort: { totalSales: -1 } },
          { $limit: parseInt(limit, 10) }
        ]);

        await Client.populate(agg, { path: '_id', select: 'name code contact' });

        return { count: agg.length, data: agg };
      },
      cacheKey,
      { ttl: 300, useCompanyPrefix: true } // 5 minute cache
    );

    res.json({
      success: true,
      data: cached.data,
      fromCache: cached.fromCache
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Cash flow statement (inflows from invoice payments, outflows from purchase payments)
// @route   GET /api/reports/cash-flow
// @access  Private
exports.getCashFlowStatement = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate, period = 'monthly' } = req.query;
    const cacheKey = { companyId, startDate, endDate, period };
    
    const cached = await cacheService.fetchOrExecute(
      'report',
      async () => {
        const start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), 0, 1);
        const end = endDate ? new Date(endDate) : new Date();

        // Determine date format based on period
        let groupByFormat;
        switch (period) {
          case 'weekly':
            groupByFormat = { $dateToString: { format: '%Y-W%V', date: '$payments.paidDate' } };
            break;
          case 'yearly':
            groupByFormat = { $dateToString: { format: '%Y', date: '$payments.paidDate' } };
            break;
          case 'monthly':
          default:
            groupByFormat = { $dateToString: { format: '%Y-%m', date: '$payments.paidDate' } };
            break;
        }

        // Invoice payments (inflows)
        const invoicePayments = await Invoice.aggregate([
          { $match: { company: companyId } },
          { $unwind: '$payments' },
          { $match: { 'payments.paidDate': { $gte: start, $lte: end } } },
          { $group: {
            _id: groupByFormat,
            inflow: { $sum: '$payments.amount' }
          } },
          { $sort: { _id: 1 } }
        ]);

        // Purchase payments (outflows)
        const purchasePayments = await Purchase.aggregate([
          { $match: { company: companyId } },
          { $unwind: '$payments' },
          { $match: { 'payments.paidDate': { $gte: start, $lte: end } } },
          { $group: {
            _id: groupByFormat,
            outflow: { $sum: '$payments.amount' }
          } },
          { $sort: { _id: 1 } }
        ]);

        // Merge by period
        const map = {};
        invoicePayments.forEach(r => { map[r._id] = map[r._id] || { period: r._id, inflow: 0, outflow: 0 }; map[r._id].inflow = r.inflow; });
        purchasePayments.forEach(r => { map[r._id] = map[r._id] || { period: r._id, inflow: 0, outflow: 0 }; map[r._id].outflow = r.outflow; });

        const months = Object.values(map).sort((a, b) => a.period.localeCompare(b.period));

        return { period: { start, end }, periodType: period, months };
      },
      cacheKey,
      { ttl: 300, useCompanyPrefix: true } // 5 minute cache
    );

    res.json({
      success: true,
      data: cached.data,
      fromCache: cached.fromCache
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Budget vs Actual report
// @route   GET /api/reports/budget-vs-actual
// @access  Private
exports.getBudgetVsActualReport = async (req, res, next) => {
  try {
    const { budgetId } = req.query;
    if (!budgetId) return res.status(400).json({ success: false, message: 'budgetId is required' });

    const budget = await Budget.findById(budgetId);
    if (!budget) return res.status(404).json({ success: false, message: 'Budget not found' });

    const start = budget.periodStart;
    const end = budget.periodEnd || new Date();

    let actual = 0;
    if (budget.type === 'revenue') {
      const invAgg = await Invoice.aggregate([
        { $match: { company: budget.company, invoiceDate: { $gte: start, $lte: end } } },
        { $group: { _id: null, total: { $sum: '$grandTotal' } } }
      ]);
      actual = invAgg[0]?.total || 0;
    } else {
      const purAgg = await Purchase.aggregate([
        { $match: { company: budget.company, purchaseDate: { $gte: start, $lte: end } } },
        { $group: { _id: null, total: { $sum: '$grandTotal' } } }
      ]);
      actual = purAgg[0]?.total || 0;
    }

    const variance = budget.amount - actual;

    res.json({ success: true, data: { budget, actual, variance } });
  } catch (error) {
    next(error);
  }
};

// @desc    Get supplier purchase report
// @route   GET /api/reports/supplier-purchase
// @access  Private
exports.getSupplierPurchaseReport = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate } = req.query;
    const matchStage = { 
      type: 'in',
      reason: 'purchase',
      company: companyId
    };

    if (startDate || endDate) {
      matchStage.movementDate = {};
      if (startDate) matchStage.movementDate.$gte = new Date(startDate);
      if (endDate) matchStage.movementDate.$lte = new Date(endDate);
    }

    const supplierPurchases = await StockMovement.aggregate([
      { $match: matchStage },
      { $group: {
        _id: '$supplier',
        totalPurchases: { $sum: 1 },
        totalQuantity: { $sum: '$quantity' },
        totalCost: { $sum: '$totalCost' }
      }},
      { $sort: { totalCost: -1 } }
    ]);

    await Supplier.populate(supplierPurchases, { 
      path: '_id', 
      select: 'name code contact'
    });

    res.json({
      success: true,
      count: supplierPurchases.length,
      data: supplierPurchases
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Export report to Excel
// @route   GET /api/reports/export/excel/:reportType
// @access  Private
exports.exportReportToExcel = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { reportType } = req.params;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Report');

    let data;

    switch (reportType) {
      case 'products':
      case 'stock-valuation':
        const productsExcel = await Product.find({ isArchived: false, company: companyId })
          .populate('category', 'name')
          .populate('supplier', 'name')
          .sort({ name: 1 });

        worksheet.columns = [
          { header: 'SKU', key: 'sku', width: 15 },
          { header: 'Product Name', key: 'name', width: 30 },
          { header: 'Category', key: 'category', width: 20 },
          { header: 'Supplier', key: 'supplier', width: 20 },
          { header: 'Unit', key: 'unit', width: 10 },
          { header: 'Stock', key: 'stock', width: 12 },
          { header: 'Avg Cost', key: 'cost', width: 12 },
          { header: 'Total Value', key: 'value', width: 15 }
        ];

        productsExcel.forEach(product => {
          worksheet.addRow({
            sku: product.sku,
            name: product.name,
            category: product.category?.name || 'N/A',
            supplier: product.supplier?.name || 'N/A',
            unit: product.unit,
            stock: product.currentStock,
            cost: product.averageCost,
            value: product.currentStock * product.averageCost
          });
        });
        break;

      case 'suppliers':
        const suppliersExcel = await Supplier.find({ company: companyId })
          .sort({ name: 1 });

        worksheet.columns = [
          { header: 'Code', key: 'code', width: 15 },
          { header: 'Supplier Name', key: 'name', width: 30 },
          { header: 'Email', key: 'email', width: 25 },
          { header: 'Phone', key: 'phone', width: 15 },
          { header: 'Address', key: 'address', width: 30 },
          { header: 'City', key: 'city', width: 15 },
          { header: 'Total Purchases', key: 'totalPurchases', width: 15 },
          { header: 'Balance Due', key: 'balance', width: 15 }
        ];

        // Get purchase data for each supplier
        for (const supplier of suppliersExcel) {
          const purchases = await Purchase.find({ supplier: supplier._id, status: { $in: ['received', 'paid', 'partial'] } });
          const totalPurchases = purchases.reduce((sum, p) => sum + (p.grandTotal || 0), 0);
          const balance = purchases.reduce((sum, p) => sum + (p.balance || 0), 0);
          
          worksheet.addRow({
            code: supplier.code,
            name: supplier.name,
            email: supplier.contact?.email || 'N/A',
            phone: supplier.contact?.phone || 'N/A',
            address: supplier.contact?.address || 'N/A',
            city: supplier.contact?.city || 'N/A',
            totalPurchases: totalPurchases,
            balance: balance
          });
        }
        break;

      case 'sales-summary':
        const invoicesExcel = await Invoice.find({ status: { $in: ['paid', 'partial'] }, company: companyId })
          .populate('client', 'name code')
          .sort({ invoiceDate: -1 });

        worksheet.columns = [
          { header: 'Invoice #', key: 'invoiceNumber', width: 20 },
          { header: 'Date', key: 'date', width: 15 },
          { header: 'Client', key: 'client', width: 25 },
          { header: 'Subtotal', key: 'subtotal', width: 12 },
          { header: 'Tax', key: 'tax', width: 12 },
          { header: 'Total', key: 'total', width: 12 },
          { header: 'Paid', key: 'paid', width: 12 },
          { header: 'Balance', key: 'balance', width: 12 },
          { header: 'Status', key: 'status', width: 12 }
        ];

        invoicesExcel.forEach(invoice => {
          worksheet.addRow({
            invoiceNumber: invoice.invoiceNumber,
            date: invoice.invoiceDate.toLocaleDateString(),
            client: invoice.client?.name || 'N/A',
            subtotal: invoice.subtotal,
            tax: invoice.totalTax,
            total: invoice.grandTotal,
            paid: invoice.amountPaid,
            balance: invoice.balance,
            status: invoice.status
          });
        });
        break;

      case 'profit-loss':
        // Get P&L detailed data for export
        const now = new Date();
        const plPeriodStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
        const plPeriodEnd = new Date();
        
        const plCompany = await Company.findById(companyId);
        const plPaidInvoices = await Invoice.find({ 
          status: 'paid', 
          company: companyId,
          paidDate: { $gte: plPeriodStart, $lte: plPeriodEnd }
        }).populate('items.product', 'averageCost');

        const plCreditNotes = await CreditNote.find({
          company: companyId,
          status: { $in: ['issued', 'applied', 'refunded', 'partially_refunded'] },
          issueDate: { $gte: plPeriodStart, $lte: plPeriodEnd }
        });

        const plPurchases = await Purchase.find({
          company: companyId,
          status: { $in: ['received', 'paid'] },
          purchaseDate: { $gte: plPeriodStart, $lte: plPeriodEnd }
        });

        const plProducts = await Product.find({ company: companyId, isArchived: false });
        const plFixedAssets = await FixedAsset.find({ company: companyId, status: 'active' });
        const plLoans = await Loan.find({ company: companyId, status: 'active', startDate: { $lte: plPeriodEnd } });

        // Calculate P&L values
        const plSalesRevenueExVAT = plPaidInvoices.reduce((sum, inv) => sum + (inv.subtotal || 0), 0);
        const plSalesReturns = plCreditNotes.reduce((sum, cn) => sum + (cn.subtotal || 0), 0);
        const plDiscountsGiven = plPaidInvoices.reduce((sum, inv) => sum + (inv.totalDiscount || 0), 0);
        const plNetRevenue = plSalesRevenueExVAT - plSalesReturns - plDiscountsGiven;

        const plClosingStockValue = plProducts.reduce((sum, product) => sum + (product.currentStock * product.averageCost), 0);
        const plPurchasesExVAT = plPurchases.reduce((sum, p) => sum + ((p.subtotal || 0) - (p.totalDiscount || 0)), 0);

        // Opening Stock: simply use 0
        const plOpeningStockValue = 0;

        // COGS: Formula-based approach - Opening Stock + Purchases - Closing Stock
        const plTotalCOGS = plOpeningStockValue + plPurchasesExVAT - plClosingStockValue;

        const plGrossProfit = plNetRevenue - plTotalCOGS;
        const plGrossMarginPercent = plNetRevenue > 0 ? (plGrossProfit / plNetRevenue) * 100 : 0;

        // Depreciation — period-aware, starts from 1st of purchase month
        const plDepreciationExpense = calculateDepreciationForPeriod(plFixedAssets, plPeriodStart, plPeriodEnd);

        // Interest expense
        let plInterestExpense = 0;
        plLoans.forEach(loan => {
          const monthlyInterest = (loan.originalAmount * (loan.interestRate || 0) / 100) / 12;
          plInterestExpense += monthlyInterest * plPeriodMonths;
        });

        // VAT
        const plOutputVAT = plPaidInvoices.reduce((sum, inv) => sum + (inv.totalTax || 0), 0);
        const plInputVAT = plPurchases.reduce((sum, p) => sum + (p.totalTax || 0), 0);

        const plOperatingExpenses = plDepreciationExpense;
        const plOperatingProfit = plGrossProfit - plOperatingExpenses;
        const plNetOtherIncome = -plInterestExpense;
        const plProfitBeforeTax = plOperatingProfit + plNetOtherIncome;
        const plCorporateIncomeTax = Math.max(0, plProfitBeforeTax * 0.30);
        const plTotalTax = plCorporateIncomeTax;
        const plNetProfit = plProfitBeforeTax - plTotalTax;
        const plNetMarginPercent = plNetRevenue > 0 ? (plNetProfit / plNetRevenue) * 100 : 0;

        worksheet.columns = [
          { header: 'Item', key: 'item', width: 30 },
          { header: 'Amount', key: 'amount', width: 20 },
          { header: 'Notes', key: 'notes', width: 40 }
        ];

        // Header
        worksheet.addRow({ item: 'PROFIT & LOSS STATEMENT', amount: '', notes: `Period: ${plPeriodStart.toLocaleDateString()} - ${plPeriodEnd.toLocaleDateString()}` });
        worksheet.addRow({ item: 'Company: ' + (plCompany?.name || 'N/A'), amount: '', notes: 'TIN: ' + (plCompany?.tin || 'N/A') });
        worksheet.addRow({ item: '', amount: '', notes: '' });

        // Revenue Section
        worksheet.addRow({ item: 'REVENUE', amount: '', notes: '' });
        worksheet.addRow({ item: '  Sales Revenue (ex. VAT)', amount: plSalesRevenueExVAT, notes: `${plPaidInvoices.length} paid invoices` });
        worksheet.addRow({ item: '  Less: Sales Returns', amount: -plSalesReturns, notes: `${plCreditNotes.length} credit notes` });
        worksheet.addRow({ item: '  Less: Discounts Given', amount: -plDiscountsGiven, notes: '' });
        worksheet.addRow({ item: 'NET REVENUE', amount: plNetRevenue, notes: `Margin: ${plGrossMarginPercent.toFixed(1)}%` });
        worksheet.addRow({ item: '', amount: '', notes: '' });

        // COGS Section
        worksheet.addRow({ item: 'COST OF GOODS SOLD', amount: '', notes: '' });
        worksheet.addRow({ item: '  Opening Stock', amount: plOpeningStockValue, notes: '' });
        worksheet.addRow({ item: '  Add: Purchases (ex. VAT)', amount: plPurchasesExVAT, notes: `${plPurchases.length} purchases` });
        worksheet.addRow({ item: '  Less: Closing Stock', amount: -plClosingStockValue, notes: '' });
        worksheet.addRow({ item: 'TOTAL COGS', amount: plTotalCOGS, notes: '' });
        worksheet.addRow({ item: '', amount: '', notes: '' });

        // Gross Profit
        worksheet.addRow({ item: 'GROSS PROFIT', amount: plGrossProfit, notes: `Margin: ${plGrossMarginPercent.toFixed(1)}%` });
        worksheet.addRow({ item: '', amount: '', notes: '' });

        // Operating Expenses
        worksheet.addRow({ item: 'OPERATING EXPENSES', amount: '', notes: '' });
        worksheet.addRow({ item: '  Depreciation', amount: -plDepreciationExpense, notes: `${plFixedAssets.length} fixed assets` });
        worksheet.addRow({ item: 'TOTAL OPERATING EXPENSES', amount: -plOperatingExpenses, notes: '' });
        worksheet.addRow({ item: '', amount: '', notes: '' });

        // Operating Profit
        worksheet.addRow({ item: 'OPERATING PROFIT', amount: plOperatingProfit, notes: '' });
        worksheet.addRow({ item: '', amount: '', notes: '' });

        // Other Income / Expenses
        worksheet.addRow({ item: 'OTHER INCOME / EXPENSES', amount: '', notes: '' });
        worksheet.addRow({ item: '  Interest Expense', amount: -plInterestExpense, notes: `${plLoans.length} active loans` });
        worksheet.addRow({ item: 'NET OTHER INCOME', amount: plNetOtherIncome, notes: '' });
        worksheet.addRow({ item: '', amount: '', notes: '' });

        // Tax & Net Profit
        worksheet.addRow({ item: 'PROFIT BEFORE TAX', amount: plProfitBeforeTax, notes: '' });
        worksheet.addRow({ item: '  Less: Corporate Tax (30%)', amount: -plCorporateIncomeTax, notes: '' });
        worksheet.addRow({ item: 'NET PROFIT', amount: plNetProfit, notes: `Margin: ${plNetMarginPercent.toFixed(1)}%` });
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid report type'
        });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${reportType}-report.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
};

// @desc    Export report to PDF
// @route   GET /api/reports/export/pdf/:reportType
// @access  Private
exports.exportReportToPDF = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { reportType } = req.params;
    const doc = new PDFDocument({ margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${reportType}-report.pdf`);

    doc.pipe(res);

    doc.fontSize(20).text(`${reportType.toUpperCase().replace('-', ' ')} REPORT`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).text(`Generated on: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(2);

    switch (reportType) {
      case 'products':
      case 'stock-valuation':
        const productsPdf = await Product.find({ isArchived: false, company: companyId })
          .populate('category', 'name')
          .sort({ name: 1 });

        // Get company info
        const companyPdf = await Company.findById(companyId);
        
        doc.fontSize(16).text(companyPdf?.name || 'Company', { align: 'center' });
        doc.fontSize(10).text(`TIN: ${companyPdf?.tin || 'N/A'}`, { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(14).text('PRODUCTS INVENTORY REPORT', { align: 'center', underline: true });
        doc.fontSize(9).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
        doc.moveDown(2);

        // Table header
        const productHeaders = ['SKU', 'Product Name', 'Category', 'Unit', 'Stock', 'Unit Cost', 'Total Value'];
        const productColWidths = [50, 100, 60, 30, 40, 50, 60];
        
        doc.fontSize(9).font('Helvetica-Bold');
        let productX = 30;
        productHeaders.forEach((header, i) => {
          doc.text(header, productX, doc.y, { width: productColWidths[i] });
          productX += productColWidths[i];
        });
        doc.moveDown(0.5);
        doc.font('Helvetica').fontSize(8);

        let totalProductValue = 0;
        productsPdf.forEach(product => {
          const value = product.currentStock * product.averageCost;
          totalProductValue += value;
          
          const rowData = [
            product.sku || '-',
            (product.name || '-').substring(0, 25),
            (product.category?.name || '-').substring(0, 15),
            product.unit || '-',
            product.currentStock.toString(),
            `${product.averageCost.toFixed(2)}`,
            `${value.toFixed(2)}`
          ];
          
          productX = 30;
          rowData.forEach((cell, i) => {
            doc.text(cell, productX, doc.y, { width: productColWidths[i] });
            productX += productColWidths[i];
          });
          doc.moveDown(0.3);
        });

        doc.moveDown(1);
        doc.fontSize(10).font('Helvetica-Bold');
        doc.text(`Total Products: ${productsPdf.length}`, 30);
        doc.text(`Total Inventory Value: ${totalProductValue.toFixed(2)}`, 200);
        break;

      case 'suppliers':
        // Fetch suppliers and company info
        const suppliersPdf = await Supplier.find({ company: companyId }).sort({ name: 1 });
        const companySupPdf = await Company.findById(companyId);

        // Header block
        doc.fontSize(16).text(companySupPdf?.name || 'Company', { align: 'center' });
        doc.fontSize(10).text(`TIN: ${companySupPdf?.tin || 'N/A'}`, { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(14).text('SUPPLIERS LIST', { align: 'center', underline: true });
        doc.fontSize(9).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
        doc.moveDown(1.5);

        let totalSupplierPurchases = 0;
        let totalSupplierBalance = 0;

        if (suppliersPdf.length === 0) {
          doc.fontSize(10).text('No suppliers found.', { align: 'center' });
          break;
        }

        // Helpers for layout and pagination
        const currencyFmt = (v) => Number(v || 0).toFixed(2);
        let pageNum = 1;

        const drawFooter = (p) => {
          const bottom = doc.page.height - 40;
          doc.fontSize(8).fillColor('#9ca3af').font('Helvetica');
          doc.text(`Generated: ${new Date().toLocaleString()}`, 50, bottom, { align: 'left' });
          doc.text(`Page ${p}`, 0, bottom, { align: 'right' });
        };

        const supHeaders = ['Code', 'Supplier Name', 'Email', 'Phone', 'Address', 'Total Purchases', 'Balance'];

        // Compute responsive column widths so total equals available page space
        const leftMargin = 48;
        const rightMargin = 48;
        const availWidth = Math.round(doc.page.width - leftMargin - rightMargin);
        const supColPercents = [0.07, 0.20, 0.16, 0.10, 0.25, 0.11, 0.11];
        let supColWidths = supColPercents.map(p => Math.floor(availWidth * p));
        // Fix rounding error by ensuring last column fills remainder
        const widthsSum = supColWidths.reduce((s, v) => s + v, 0);
        if (widthsSum < availWidth) supColWidths[supColWidths.length - 1] += (availWidth - widthsSum);

        const truncateText = (text, width) => {
          if (!text) return '-';
          const approxChars = Math.max(6, Math.floor(width / 6));
          if (String(text).length <= approxChars) return String(text);
          return String(text).substring(0, approxChars - 3) + '...';
        };

        const renderTableHeader = (y) => {
          doc.rect(leftMargin - 8, y, availWidth + 16, 28).fill('#111827');
          doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold');
          let x = leftMargin;
          supHeaders.forEach((h, i) => {
            doc.text(h, x, y + 8, { width: supColWidths[i] });
            x += supColWidths[i];
          });
        };

        // Start table
        let y = doc.y;
        renderTableHeader(y);
        y += 36;
        doc.font('Helvetica').fontSize(9).fillColor('#111827');

        for (const [idx, supplier] of suppliersPdf.entries()) {
          // Pagination: start new page if low space
          if (y > doc.page.height - 150) {
            drawFooter(pageNum);
            doc.addPage();
            pageNum += 1;
            // reprint title header on new page
            doc.fontSize(14).text('SUPPLIERS LIST', { align: 'center', underline: true });
            doc.moveDown(0.5);
            renderTableHeader(120);
            y = 156;
            doc.font('Helvetica').fontSize(9).fillColor('#111827');
          }

          // compute totals
          const purchases = await Purchase.find({ supplier: supplier._id, status: { $in: ['received', 'paid', 'partial'] } });
          const totalPurchases = purchases.reduce((sum, p) => sum + (p.grandTotal || 0), 0);
          const balance = purchases.reduce((sum, p) => sum + (p.balance || 0), 0);
          totalSupplierPurchases += totalPurchases;
          totalSupplierBalance += balance;

          // Alternate row shading
          if (idx % 2 === 0) {
            doc.rect(40, y - 6, doc.page.width - 80, 18).fill('#f9fafb');
            doc.fillColor('#111827');
          }

          // Row values: show full text (no truncation). Calculate wrapping heights and render rows with dynamic height.
          const rowTexts = [
            supplier.code || '-',
            supplier.name || '-',
            supplier.contact?.email || '-',
            supplier.contact?.phone || '-',
            supplier.contact?.address || '-',
            currencyFmt(totalPurchases),
            currencyFmt(balance)
          ];

          doc.font('Helvetica').fontSize(9);
          // compute height for each cell (text may wrap)
          const cellHeights = rowTexts.map((t, i) => {
            // numeric columns shouldn't wrap much, but measure anyway
            try {
              return doc.heightOfString(String(t), { width: supColWidths[i] });
            } catch (e) {
              return 12;
            }
          });
          const maxHeight = Math.max(...cellHeights, 12);

          // If not enough space on page, add new page and re-render header
          if (y + maxHeight > doc.page.height - 150) {
            drawFooter(pageNum);
            doc.addPage();
            pageNum += 1;
            doc.fontSize(14).text('SUPPLIERS LIST', { align: 'center', underline: true });
            doc.moveDown(0.5);
            renderTableHeader(120);
            y = 156;
            doc.font('Helvetica').fontSize(9).fillColor('#111827');
          }

          // Alternate row shading with dynamic height
          if (idx % 2 === 0) {
            doc.rect(leftMargin - 8, y - 6, availWidth + 16, maxHeight + 8).fill('#f9fafb');
            doc.fillColor('#111827');
          }

          // Render each cell; numeric columns are right-aligned
          let x = leftMargin;
          rowTexts.forEach((cellText, i) => {
            if (i >= 5) {
              doc.text(String(cellText), x, y, { width: supColWidths[i], align: 'right' });
            } else {
              doc.text(String(cellText), x, y, { width: supColWidths[i] });
            }
            x += supColWidths[i];
          });

          // advance y by the row height plus small padding
          y += maxHeight + 8;
        }

        // Totals area
        if (y > doc.page.height - 180) {
          drawFooter(pageNum);
          doc.addPage();
          pageNum += 1;
          y = 120;
        }

        doc.moveTo(leftMargin - 8, y).lineTo(doc.page.width - rightMargin + 8, y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
        y += 10;
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#111827');
        doc.text(`Total Suppliers: ${suppliersPdf.length}`, leftMargin, y);
        doc.text(`Total Purchases: ${totalSupplierPurchases.toFixed(2)}`, leftMargin, y + 16);
        doc.text(`Total Balance Due: ${totalSupplierBalance.toFixed(2)}`, leftMargin + Math.floor(availWidth * 0.5), y + 16);
        drawFooter(pageNum);
        break;

      case 'sales-summary':
        const invoicesPdf = await Invoice.find({ status: { $in: ['paid', 'partial', 'confirmed', 'draft'] }, company: companyId })
          .populate('client', 'name')
          .sort({ invoiceDate: -1 })
          .limit(100);

        const companyInvPdf = await Company.findById(companyId);
        
        doc.fontSize(16).text(companyInvPdf?.name || 'Company', { align: 'center' });
        doc.fontSize(10).text(`TIN: ${companyInvPdf?.tin || 'N/A'}`, { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(14).text('SALES INVOICES REPORT', { align: 'center', underline: true });
        doc.fontSize(9).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
        doc.moveDown(2);

        // Summary
        const totalInvoices = invoicesPdf.length;
        const totalSales = invoicesPdf.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);
        const totalPaid = invoicesPdf.reduce((sum, inv) => sum + (inv.amountPaid || 0), 0);
        const totalBalance = invoicesPdf.reduce((sum, inv) => sum + (inv.balance || 0), 0);

        doc.fontSize(10);
        doc.text(`Total Invoices: ${totalInvoices}`, 30);
        doc.text(`Total Sales: ${totalSales.toFixed(2)}`, 30);
        doc.moveDown(0.5);
        doc.text(`Total Paid: ${totalPaid.toFixed(2)}`, 30);
        doc.text(`Total Balance: ${totalBalance.toFixed(2)}`, 200);
        doc.moveDown(2);

        // Table header
        const invHeaders = ['Invoice #', 'Date', 'Client', 'Total', 'Paid', 'Balance', 'Status'];
        const invColWidths = [50, 40, 80, 50, 50, 50, 40];
        
        doc.fontSize(9).font('Helvetica-Bold');
        let invX = 30;
        invHeaders.forEach((header, i) => {
          doc.text(header, invX, doc.y, { width: invColWidths[i] });
          invX += invColWidths[i];
        });
        doc.moveDown(0.5);
        doc.font('Helvetica').fontSize(8);

        invoicesPdf.forEach(invoice => {
          const rowData = [
            invoice.invoiceNumber || '-',
            invoice.invoiceDate ? invoice.invoiceDate.toLocaleDateString() : '-',
            (invoice.client?.name || '-').substring(0, 20),
            `${(invoice.grandTotal || 0).toFixed(2)}`,
            `${(invoice.amountPaid || 0).toFixed(2)}`,
            `${(invoice.balance || 0).toFixed(2)}`,
            invoice.status || '-'
          ];
          
          invX = 30;
          rowData.forEach((cell, i) => {
            doc.text(cell, invX, doc.y, { width: invColWidths[i] });
            invX += invColWidths[i];
          });
          doc.moveDown(0.3);
        });
        break;

      case 'profit-loss':
        // Get P&L detailed data for PDF export
        const pdfNow = new Date();
        const pdfPeriodStart = new Date(pdfNow.getFullYear(), Math.floor(pdfNow.getMonth() / 3) * 3, 1);
        const pdfPeriodEnd = new Date();
        
        const pdfPlCompany = await Company.findById(companyId);
        const pdfPlInvoices = await Invoice.find({ 
          status: 'paid', 
          company: companyId,
          paidDate: { $gte: pdfPeriodStart, $lte: pdfPeriodEnd }
        }).populate('items.product', 'averageCost');

        const pdfPlCreditNotes = await CreditNote.find({
          company: companyId,
          status: { $in: ['issued', 'applied', 'refunded', 'partially_refunded'] },
          issueDate: { $gte: pdfPeriodStart, $lte: pdfPeriodEnd }
        });

        const pdfPlPurchases = await Purchase.find({
          company: companyId,
          status: { $in: ['received', 'paid'] },
          purchaseDate: { $gte: pdfPeriodStart, $lte: pdfPeriodEnd }
        });

        const pdfPlProducts = await Product.find({ company: companyId, isArchived: false });
        const pdfPlFixedAssets = await FixedAsset.find({ company: companyId, status: 'active' });
        const pdfPlLoans = await Loan.find({ company: companyId, status: 'active', startDate: { $lte: pdfPeriodEnd } });

        // Calculate P&L values
        const pdfPlSalesRevenueExVAT = pdfPlInvoices.reduce((sum, inv) => sum + (inv.subtotal || 0), 0);
        const pdfPlSalesReturns = pdfPlCreditNotes.reduce((sum, cn) => sum + (cn.subtotal || 0), 0);
        const pdfPlDiscountsGiven = pdfPlInvoices.reduce((sum, inv) => sum + (inv.totalDiscount || 0), 0);
        const pdfPlNetRevenue = pdfPlSalesRevenueExVAT - pdfPlSalesReturns - pdfPlDiscountsGiven;

        const pdfPlClosingStockValue = pdfPlProducts.reduce((sum, product) => sum + (product.currentStock * product.averageCost), 0);
        const pdfPlPurchasesExVAT = pdfPlPurchases.reduce((sum, p) => sum + ((p.subtotal || 0) - (p.totalDiscount || 0)), 0);

        // Opening Stock: simply use 0
        const pdfPlOpeningStockValue = 0;

        // COGS: Formula-based approach - Opening Stock + Purchases - Closing Stock
        const pdfPlTotalCOGS = pdfPlOpeningStockValue + pdfPlPurchasesExVAT - pdfPlClosingStockValue;

        const pdfPlGrossProfit = pdfPlNetRevenue - pdfPlTotalCOGS;
        const pdfPlGrossMarginPercent = pdfPlNetRevenue > 0 ? (pdfPlGrossProfit / pdfPlNetRevenue) * 100 : 0;

        // Depreciation — period-aware, starts from 1st of purchase month
        const pdfPlDepreciationExpense = calculateDepreciationForPeriod(pdfPlFixedAssets, pdfPeriodStart, pdfPeriodEnd);

        // Interest expense
        let pdfPlInterestExpense = 0;
        pdfPlLoans.forEach(loan => {
          const monthlyInterest = (loan.originalAmount * (loan.interestRate || 0) / 100) / 12;
          pdfPlInterestExpense += monthlyInterest * pdfPlPeriodMonths;
        });

        // VAT
        const pdfPlOutputVAT = pdfPlInvoices.reduce((sum, inv) => sum + (inv.totalTax || 0), 0);
        const pdfPlInputVAT = pdfPlPurchases.reduce((sum, p) => sum + (p.totalTax || 0), 0);

        const pdfPlOperatingExpenses = pdfPlDepreciationExpense;
        const pdfPlOperatingProfit = pdfPlGrossProfit - pdfPlOperatingExpenses;
        const pdfPlNetOtherIncome = -pdfPlInterestExpense;
        const pdfPlProfitBeforeTax = pdfPlOperatingProfit + pdfPlNetOtherIncome;
        const pdfPlCorporateIncomeTax = Math.max(0, pdfPlProfitBeforeTax * 0.30);
        const pdfPlTotalTax = pdfPlCorporateIncomeTax;
        const pdfPlNetProfit = pdfPlProfitBeforeTax - pdfPlTotalTax;
        const pdfPlNetMarginPercent = pdfPlNetRevenue > 0 ? (pdfPlNetProfit / pdfPlNetRevenue) * 100 : 0;

        // PDF Header
        const plLeft = 40;
        const plRight = 48;
        const plAmountX = doc.page.width - plRight - 110; // position for amounts
        const plItemWidth = plAmountX - plLeft - 10;

        const fmt = (v) => {
          const n = Number(v || 0);
          return n < 0 ? `(${Math.abs(n).toFixed(2)})` : n.toFixed(2);
        };

        const printLine = (label, amount, y, indent = 0) => {
          const labelX = plLeft + indent * 12;
          doc.font('Helvetica').fontSize(10).text(label, labelX, y, { width: plItemWidth - indent * 12 });
          doc.font('Helvetica').fontSize(10).text(fmt(amount), plAmountX, y, { width: 100, align: 'right' });
        };

        doc.fontSize(16).text(pdfPlCompany?.name || 'Company', { align: 'center' });
        doc.fontSize(10).text(`TIN: ${pdfPlCompany?.tin || 'N/A'}`, { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(14).text('PROFIT & LOSS STATEMENT', { align: 'center', underline: true });
        doc.fontSize(9).text(`Period: ${pdfPeriodStart.toLocaleDateString()} - ${pdfPeriodEnd.toLocaleDateString()}`, { align: 'center' });
        doc.fontSize(9).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
        doc.moveDown(1.2);

        // Compact summary block
        let ypl = doc.y;
        printLine('Net Revenue', pdfPlNetRevenue, ypl);
        ypl += 16;
        printLine('Total COGS', pdfPlTotalCOGS, ypl);
        ypl += 16;
        printLine('Gross Profit', pdfPlGrossProfit, ypl);
        ypl += 16;
        printLine('Operating Profit', pdfPlOperatingProfit, ypl);
        ypl += 20;
        doc.font('Helvetica-Bold').fontSize(11);
        printLine('NET PROFIT', pdfPlNetProfit, ypl);
        doc.font('Helvetica').fontSize(10);
        doc.moveDown(1.5);

        // Sections
        const section = (title, rows) => {
          doc.font('Helvetica-Bold').fontSize(11).text(title, plLeft);
          let yy = doc.y + 6;
          doc.font('Helvetica').fontSize(10);
          rows.forEach(r => {
            printLine(r.label, r.amount, yy, r.indent || 0);
            yy += 14;
          });
          doc.moveDown(0.5);
        };

        section('REVENUE', [
          { label: 'Sales Revenue (ex. VAT)', amount: pdfPlSalesRevenueExVAT },
          { label: 'Less: Sales Returns', amount: -pdfPlSalesReturns, indent: 1 },
          { label: 'Less: Discounts Given', amount: -pdfPlDiscountsGiven, indent: 1 },
          { label: 'NET REVENUE', amount: pdfPlNetRevenue }
        ]);

        section('COST OF GOODS SOLD', [
          { label: 'Opening Stock', amount: pdfPlOpeningStockValue },
          { label: 'Add: Purchases (ex. VAT)', amount: pdfPlPurchasesExVAT },
          { label: 'Less: Closing Stock', amount: -pdfPlClosingStockValue },
          { label: 'TOTAL COGS', amount: pdfPlTotalCOGS }
        ]);

        section('OPERATING EXPENSES', [
          { label: 'Depreciation', amount: -pdfPlDepreciationExpense },
          { label: 'TOTAL OPERATING EXPENSES', amount: -pdfPlOperatingExpenses }
        ]);

        section('OTHER INCOME / EXPENSES', [
          { label: 'Interest Expense', amount: -pdfPlInterestExpense, indent: 1 },
          { label: 'NET OTHER INCOME', amount: pdfPlNetOtherIncome }
        ]);

        const yfinal = doc.y + 8;
        doc.font('Helvetica-Bold').fontSize(12);
        printLine('PROFIT BEFORE TAX', pdfPlProfitBeforeTax, yfinal);
        doc.moveDown(0.6);
        doc.font('Helvetica-Bold').fontSize(11);
        printLine('Less: Corporate Tax (30%)', -pdfPlCorporateIncomeTax, doc.y);
        doc.moveDown(0.8);
        doc.fontSize(12).font('Helvetica-Bold');
        printLine('NET PROFIT', pdfPlNetProfit, doc.y);
        break;

      default:
        doc.fontSize(12).text('Invalid report type', { align: 'center' });
    }

    doc.end();
  } catch (error) {
    next(error);
  }
};

// @desc    Get comprehensive Profit & Loss Statement (Full P&L)
// @route   GET /api/reports/profit-and-loss-full
// @access  Private
// 
// Comprehensive P&L with all components:
// REVENUE: Sales Revenue (ex VAT) - Sales Returns - Discounts = Net Revenue
// COGS: Opening Stock + Purchases - Purchase Returns - Closing Stock = Total COGS
// GROSS PROFIT: Net Revenue - Total COGS
// OPERATING EXPENSES: Manual entries from Expense module + Depreciation
// OPERATING PROFIT (EBIT): Gross Profit - Operating Expenses
// OTHER INCOME/EXPENSES: Interest Income + Other Income - Interest Expense - Other Expense
// PROFIT BEFORE TAX: EBIT + Net Other Income
// TAX: Corporate Income Tax (30%)
// NET PROFIT: PBT - Corporate Tax
// 
exports.getProfitAndLossFull = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate, previousPeriodStart, previousPeriodEnd } = req.query;
    
    // Set default period to current quarter if not provided
    const now = new Date();
    const periodStart = startDate ? new Date(startDate) : new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    const periodEnd = endDate ? new Date(endDate) : new Date();
    
    // Get company info
    const company = await Company.findById(companyId);
    const companyName = company?.name || 'N/A';
    const companyTin = company?.tin || 'N/A';
    
    // =============================================
    // REVENUE SECTION
    // =============================================
    
    // Sales Revenue (excluding VAT) - Cash-basis: revenue recognised when payment is received.
    // Use paidDate so invoices issued before the period but paid within it are correctly included
    const salesInvoiceMatch = { 
      status: 'paid', 
      company: companyId,
      paidDate: { $gte: periodStart, $lte: periodEnd }
    };
    
    const paidInvoices = await Invoice.find(salesInvoiceMatch).populate('items.product', 'averageCost');
    
    // Sales Revenue (ex. VAT) = Gross sales before discounts (subtotal is pre-discount, pre-tax)
    const salesRevenueExVAT = paidInvoices.reduce((sum, inv) => {
      return sum + (inv.subtotal || 0);
    }, 0);
    
    // Sales Returns (Credit Notes issued) in period
    const creditNoteMatch = {
      company: companyId,
      status: { $in: ['issued', 'applied', 'refunded', 'partially_refunded'] },
      issueDate: { $gte: periodStart, $lte: periodEnd }
    };
    
    const creditNotes = await CreditNote.find(creditNoteMatch);
    const salesReturns = creditNotes.reduce((sum, cn) => sum + (cn.subtotal || 0), 0);
    
    // Discounts Given - from paid invoices
    const discountsGiven = paidInvoices.reduce((sum, inv) => sum + (inv.totalDiscount || 0), 0);
    
    // NET REVENUE = Sales Revenue - Sales Returns - Discounts
    const netRevenue = salesRevenueExVAT - salesReturns - discountsGiven;
    
    // =============================================
    // COST OF GOODS SOLD (COGS) SECTION
    // =============================================
    
    const products = await Product.find({ company: companyId, isArchived: false });
    
    // Opening Stock: Previous period's closing stock
    // If previous period dates provided, calculate from that; otherwise use 0
    let openingStockValue = 0;
    if (previousPeriodStart && previousPeriodEnd) {
      const prevStart = new Date(previousPeriodStart);
      const prevEnd = new Date(previousPeriodEnd);
      
      // Get purchases in previous period for COGS calculation
      const prevPurchases = await Purchase.find({
        company: companyId,
        status: { $in: ['received', 'paid'] },
        purchaseDate: { $gte: prevStart, $lte: prevEnd }
      });
      const prevPurchasesExVAT = prevPurchases.reduce((sum, p) => sum + (p.subtotal || 0) - (p.totalDiscount || 0), 0);
      
      // Use simple approach: previous period purchases = opening stock for this period
      openingStockValue = prevPurchasesExVAT;
    }
    
    // Purchases (ex. VAT) - from RECEIVED/PAID purchases in period
    const purchaseMatch = {
      company: companyId,
      status: { $in: ['received', 'paid'] },
      purchaseDate: { $gte: periodStart, $lte: periodEnd }
    };
    
    const purchases = await Purchase.find(purchaseMatch);
    const purchasesExVAT = purchases.reduce((sum, p) => {
      return sum + (p.subtotal || 0) - (p.totalDiscount || 0);
    }, 0);
    
    // Purchase Returns - from PurchaseReturn model
    // Get approved/refunded purchase returns in the period
    const purchaseReturnMatch = {
      company: companyId,
      status: { $in: ['approved', 'refunded'] },
      returnDate: { $gte: periodStart, $lte: periodEnd }
    };
    
    const purchaseReturnsData = await PurchaseReturn.aggregate([
      { $match: purchaseReturnMatch },
      {
        $group: {
          _id: null,
          total: { $sum: '$grandTotal' },
          subtotal: { $sum: '$subtotal' },
          count: { $sum: 1 }
        }
      }
    ]);
    
    const purchaseReturns = purchaseReturnsData[0]?.subtotal || 0; // Use subtotal (excl tax) for COGS
    const purchaseReturnsCount = purchaseReturnsData[0]?.count || 0;
    
    console.log('P&L Full - Purchase Returns:', purchaseReturns, 'count:', purchaseReturnsCount);
    
    // Closing Stock Value (current inventory)
    const closingStockValue = products.reduce((sum, product) => {
      return sum + (product.currentStock * product.averageCost);
    }, 0);
    
    // TOTAL COGS = Opening Stock + Purchases - Purchase Returns - Closing Stock
    const totalCOGS = openingStockValue + purchasesExVAT - purchaseReturns - closingStockValue;
    
    // =============================================
    // GROSS PROFIT
    // =============================================
    const grossProfit = netRevenue - totalCOGS;
    const grossMarginPercent = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
    
    // =============================================
    // OPERATING EXPENSES (from Expense module)
    // =============================================
    
    // Get manual expenses from Expense model - query ALL expenses (no date filter)
    // This ensures expenses show up in P&L regardless of when they were recorded
    // Users can filter by date in the Expenses page
    console.log('P&L Full - Querying ALL expenses for company:', companyId);
    const expenseSummary = await Expense.aggregate([
      {
        $match: {
          company: companyId,
          status: { $ne: 'cancelled' }
          // No date filter - show all expenses
        }
      },
      {
        $group: {
          _id: '$type',
          total: { $sum: '$amount' }
        }
      }
    ]);
    
    console.log('P&L Full - Expense summary result:', expenseSummary);
    
    // Transform expense summary
    const expenseData = {};
    expenseSummary.forEach(item => {
      expenseData[item._id] = item.total;
    });
    
    const salariesWages = expenseData['salaries_wages'] || 0;
    const rent = expenseData['rent'] || 0;
    const utilities = expenseData['utilities'] || 0;
    const transportDelivery = expenseData['transport_delivery'] || 0;
    const marketingAdvertising = expenseData['marketing_advertising'] || 0;
    const otherExpenses = expenseData['other_expense'] || 0;
    
    // Depreciation — period-aware, starts from 1st of purchase month
    const fixedAssets = await FixedAsset.find({ company: companyId, status: 'active' });
    const depreciationExpense = calculateDepreciationForPeriod(fixedAssets, periodStart, periodEnd);

    // Per-asset breakdown so users can trace exactly which asset contributes what amount
    const depreciationBreakdown = fixedAssets
      .map(a => ({
        name: a.name,
        assetCode: a.assetCode || null,
        category: a.category,
        purchaseCost: a.purchaseCost,
        usefulLifeYears: a.usefulLifeYears,
        depreciationMethod: a.depreciationMethod,
        annualDepreciation: Math.round((a.annualDepreciation || 0) * 100) / 100,
        periodDepreciation: Math.round(calculateDepreciationForPeriod([a], periodStart, periodEnd) * 100) / 100
      }))
      .filter(a => a.periodDepreciation > 0);
    
    const totalOperatingExpenses = 
      salariesWages + 
      rent + 
      utilities + 
      transportDelivery + 
      marketingAdvertising + 
      depreciationExpense + 
      otherExpenses;
    
    // =============================================
    // OPERATING PROFIT (EBIT)
    // =============================================
    const operatingProfit = grossProfit - totalOperatingExpenses;
    const operatingMarginPercent = netRevenue > 0 ? (operatingProfit / netRevenue) * 100 : 0;
    
    // =============================================
    // OTHER INCOME / EXPENSES
    // =============================================
    
    // Interest Income (from Expense module)
    const interestIncome = expenseData['interest_income'] || 0;
    
    // Interest Expense (from Loans)
    const loanMatch = {
      company: companyId,
      status: 'active',
      startDate: { $lte: periodEnd },
      $or: [{ endDate: { $exists: false } }, { endDate: null }, { endDate: { $gte: periodStart } }]
    };
    const activeLoans = await Loan.find(loanMatch);

    // Calculate interest expense for the period (prorated, on outstanding balance)
    const interestExpense = calculateLoanInterest(activeLoans, periodStart, periodEnd);
    
    // Other Income (from Expense module)
    const otherIncome = expenseData['other_income'] || 0;
    
    // Other Expense (from Expense module - treated separately in P&L)
    const otherExpenseFromModule = expenseData['other_expense_income'] || 0;
    
    const netOtherIncome = interestIncome + otherIncome - interestExpense - otherExpenseFromModule;
    
    // =============================================
    // PROFIT BEFORE TAX (PBT)
    // =============================================
    const profitBeforeTax = operatingProfit + netOtherIncome;
    
    // =============================================
    // TAX
    // =============================================
    
    // VAT Info (Output VAT - Net Input VAT) - For information only, not an expense
    const outputVAT = paidInvoices.reduce((sum, inv) => sum + (inv.totalTax || 0), 0);
    const inputVAT = purchases.reduce((sum, p) => sum + (p.totalTax || 0), 0);
    // Purchase Return VAT reduces the claimable Input VAT (VAT on returned goods is no longer claimable)
    // Uses a $lookup fallback: if totalTax=0 (old records), compute proportionally from linked purchase
    const purchaseReturnVATFull = await PurchaseReturn.aggregate([
      {
        $match: {
          company: companyId,
          status: { $in: ['approved', 'refunded', 'partially_refunded'] },
          returnDate: { $gte: periodStart, $lte: periodEnd }
        }
      },
      { $lookup: { from: 'purchases', localField: 'purchase', foreignField: '_id', as: 'linkedPurchase' } },
      { $addFields: { linkedPurchase: { $arrayElemAt: ['$linkedPurchase', 0] } } },
      {
        $addFields: {
          effectiveTax: {
            $cond: {
              if: { $gt: ['$totalTax', 0] },
              then: '$totalTax',
              else: {
                $cond: {
                  if: { $and: [
                    { $gt: [{ $ifNull: ['$linkedPurchase.subtotal', 0] }, 0] },
                    { $gt: [{ $ifNull: ['$linkedPurchase.totalTax', 0] }, 0] }
                  ]},
                  then: { $multiply: [{ $divide: ['$subtotal', '$linkedPurchase.subtotal'] }, '$linkedPurchase.totalTax'] },
                  else: 0
                }
              }
            }
          }
        }
      },
      { $group: { _id: null, totalTax: { $sum: '$effectiveTax' } } }
    ]);
    const inputVATReturn = purchaseReturnVATFull[0]?.totalTax || 0;
    const netInputVAT = inputVAT - inputVATReturn;
    const netVAT = outputVAT - netInputVAT; // Positive = VAT payable, Negative = VAT receivable
    
    // Corporate Income Tax (30% of Profit Before Tax)
    const corporateTaxRate = 0.30;
    const corporateIncomeTax = Math.max(0, profitBeforeTax * corporateTaxRate);
    
    const totalTax = corporateIncomeTax;
    
    // =============================================
    // NET PROFIT (AFTER TAX)
    // =============================================
    const netProfit = profitBeforeTax - totalTax;
    const netMarginPercent = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;
    
    // =============================================
    // RESPONSE
    // =============================================
    res.json({
      success: true,
      data: {
        // Header
        company: {
          name: companyName,
          tin: companyTin
        },
        period: {
          start: periodStart,
          end: periodEnd,
          formatted: `${periodStart.toLocaleDateString('en-GB')} - ${periodEnd.toLocaleDateString('en-GB')}`
        },
        
        // REVENUE
        revenue: {
          salesRevenueExVAT: Math.round(salesRevenueExVAT * 100) / 100,
          salesReturns: Math.round(salesReturns * 100) / 100,
          discountsGiven: Math.round(discountsGiven * 100) / 100,
          netRevenue: Math.round(netRevenue * 100) / 100
        },
        
        // COST OF GOODS SOLD
        cogs: {
          openingStockValue: Math.round(openingStockValue * 100) / 100,
          purchasesExVAT: Math.round(purchasesExVAT * 100) / 100,
          purchaseReturns: Math.round(purchaseReturns * 100) / 100,
          closingStockValue: Math.round(closingStockValue * 100) / 100,
          totalCOGS: Math.round(totalCOGS * 100) / 100
        },
        
        // GROSS PROFIT
        grossProfit: {
          amount: Math.round(grossProfit * 100) / 100,
          marginPercent: Math.round(grossMarginPercent * 100) / 100
        },
        
        // OPERATING EXPENSES
        operatingExpenses: {
          salariesAndWages: Math.round(salariesWages * 100) / 100,
          rent: Math.round(rent * 100) / 100,
          utilities: Math.round(utilities * 100) / 100,
          transportAndDelivery: Math.round(transportDelivery * 100) / 100,
          marketingAndAdvertising: Math.round(marketingAdvertising * 100) / 100,
          depreciation: Math.round(depreciationExpense * 100) / 100,
          otherExpenses: Math.round(otherExpenses * 100) / 100,
          total: Math.round(totalOperatingExpenses * 100) / 100
        },
        
        // OPERATING PROFIT (EBIT)
        operatingProfit: {
          amount: Math.round(operatingProfit * 100) / 100,
          marginPercent: Math.round(operatingMarginPercent * 100) / 100
        },
        
        // OTHER INCOME / EXPENSES
        otherIncomeExpenses: {
          interestIncome: Math.round(interestIncome * 100) / 100,
          interestExpense: Math.round(interestExpense * 100) / 100,
          otherIncome: Math.round(otherIncome * 100) / 100,
          otherExpense: Math.round(otherExpenseFromModule * 100) / 100,
          netOtherIncome: Math.round(netOtherIncome * 100) / 100
        },
        
        // PROFIT BEFORE TAX
        profitBeforeTax: {
          amount: Math.round(profitBeforeTax * 100) / 100
        },
        
        // TAX
        tax: {
          vatInfo: {
            outputVAT: Math.round(outputVAT * 100) / 100,
            inputVAT: Math.round(inputVAT * 100) / 100,
            inputVATReturn: Math.round(inputVATReturn * 100) / 100,
            netInputVAT: Math.round(netInputVAT * 100) / 100,
            netVAT: Math.round(netVAT * 100) / 100
          },
          corporateIncomeTax: Math.round(corporateIncomeTax * 100) / 100,
          corporateTaxRate: corporateTaxRate * 100,
          totalTax: Math.round(totalTax * 100) / 100
        },
        
        // NET PROFIT
        netProfit: {
          amount: Math.round(netProfit * 100) / 100,
          marginPercent: Math.round(netMarginPercent * 100) / 100
        },
        
        // Summary for Balance Sheet integration
        balanceSheetFlow: {
          currentPeriodProfit: Math.round(netProfit * 100) / 100,
          flowsToEquity: true
        },
        
        // Additional details (including per-asset depreciation so UI can show the source)
        details: {
          paidInvoicesCount: paidInvoices.length,
          creditNotesCount: creditNotes.length,
          purchasesCount: purchases.length,
          purchaseReturnsCount: purchaseReturnsCount,
          fixedAssetsCount: fixedAssets.length,
          activeLoansCount: activeLoans.length,
          productsCount: products.length,
          openingStockNote: previousPeriodStart ? 'Calculated from previous period' : 'Default value (0)',
          depreciationBreakdown  // per-asset: [{name, category, purchaseCost, annualDepreciation, periodDepreciation}]
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get Balance Sheet report
// @route   GET /api/reports/balance-sheet
// @access  Private
exports.getBalanceSheet = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { asOfDate } = req.query;
    
    // Use provided date or current date
    const reportDate = asOfDate ? new Date(asOfDate) : new Date();

    // NO CACHING for Balance Sheet - profit calculation depends on dynamic paidDate data
    // and must always reflect current period profit (YTD)
    
    // Run parallel aggregations for better performance
    const [
      invoiceData,
      purchaseData,
      inventoryData,
      fixedAssetsData,
      loansData,
      company
    ] = await Promise.all([
      Invoice.aggregate([
        { $match: { company: companyId } },
        { $facet: {
          payments: [
            { $unwind: '$payments' },
            { $group: { _id: null, total: { $sum: '$payments.amount' } } }
          ],
          receivables: [
            { $match: { status: { $in: ['draft', 'confirmed', 'partial'] } } },
            { $group: { _id: null, total: { $sum: '$balance' } } }
          ],
          outputVAT: [
            { $match: { status: { $in: ['paid', 'partial', 'confirmed'] } } },
            { $group: { _id: null, total: { $sum: '$totalTax' } } }
          ]
        }}
      ]),
      Purchase.aggregate([
        { $match: { company: companyId } },
        { $facet: {
          payments: [
            { $unwind: '$payments' },
            { $group: { _id: null, total: { $sum: '$payments.amount' } } }
          ],
          payables: [
            { $match: { status: { $in: ['draft', 'ordered', 'received', 'partial'] } } },
            { $group: { _id: null, total: { $sum: '$balance' } } }
          ],
          inputVAT: [
            { $match: { status: { $in: ['received', 'partial', 'paid'] } } },
            { $group: { _id: null, total: { $sum: '$totalTax' } } }
          ]
        }}
      ]),
      Product.aggregate([
        { $match: { company: companyId, isArchived: false } },
        { $project: { stockValue: { $multiply: ['$currentStock', '$averageCost'] } } },
        { $group: { _id: null, totalValue: { $sum: '$stockValue' } } }
      ]),
      // Use .find() so Mongoose virtuals (accumulatedDepreciation, netBookValue) are available.
      // Aggregate cannot access virtuals — they are computed in JS, not stored in MongoDB.
      FixedAsset.find({ company: companyId, status: 'active' }),
      Loan.aggregate([
        { $match: { company: companyId, status: 'active' } },
        { $group: {
          _id: '$loanType',
          totalBalance: { $sum: { $subtract: ['$originalAmount', '$amountPaid'] } }
        }}
      ]),
      Company.findById(companyId).lean()
    ]);

    // Extract invoice data
    const invoiceResult = invoiceData[0] || {};
    const totalInflows = invoiceResult.payments?.[0]?.total || 0;
    const accountsReceivable = invoiceResult.receivables?.[0]?.total || 0;
    const outputVAT = invoiceResult.outputVAT?.[0]?.total || 0;
    
    // Get credit notes issued in the period to reduce Cash & Bank
    // Credit notes reduce the cash balance because money is being returned to customers
    // Use same date range as P&L (current quarter) for consistency
    // Note: defaultQuarterStart is declared later in this function
    const creditNoteDateStart = new Date(reportDate.getFullYear(), Math.floor(reportDate.getMonth() / 3) * 3, 1);
    const creditNoteDateEnd = reportDate;
    
    // DEBUG: Log the date range being used
    console.log('Balance Sheet - Credit Note Date Range:', creditNoteDateStart, 'to', creditNoteDateEnd);
    console.log('Balance Sheet - Company ID being used:', companyId);
    
    // Use expanded status filter - include all non-cancelled statuses
    // Also remove date filter temporarily to debug why no credit notes are found
    const creditNoteData = await CreditNote.aggregate([
      { $match: { 
        company: companyId,
        status: { $in: ['draft', 'issued', 'applied', 'refunded', 'partially_refunded'] }
      }},
      { $group: { _id: null, total: { $sum: '$grandTotal' }, totalTax: { $sum: '$totalTax' } } }
    ]);
    
    // DEBUG: Log ALL credit notes found for this company to see what's in DB
    const allCreditNotes = await CreditNote.find({ company: companyId });
    console.log('Balance Sheet - All Credit Notes for company:', allCreditNotes.length, allCreditNotes.map(cn => ({ number: cn.creditNoteNumber, status: cn.status, total: cn.grandTotal })));
    
    // DEBUG: Log the credit note data found
    console.log('Balance Sheet - Credit Note Data (expanded):', creditNoteData);
    
    const totalCreditNoteAmount = creditNoteData[0]?.total || 0;
    const totalCreditNoteTax = creditNoteData[0]?.totalTax || 0;
    
    // DEBUG: Log the totals
    console.log('Balance Sheet - Total Credit Note Amount:', totalCreditNoteAmount, 'Total Tax:', totalCreditNoteTax);
    
    // Net cash inflows = payments received - credit notes issued (money returned)
    const netCashInflows = Math.max(0, totalInflows - totalCreditNoteAmount);

    // Extract purchase data
    const purchaseResult = purchaseData[0] || {};
    const totalOutflows = purchaseResult.payments?.[0]?.total || 0;
    const accountsPayable = purchaseResult.payables?.[0]?.total || 0;
    const inputVAT = purchaseResult.inputVAT?.[0]?.total || 0;

    // Purchase Return VAT - reduces the claimable Input VAT on the Balance Sheet
    // Uses a $lookup fallback: if totalTax=0 (old records), compute proportionally from linked purchase
    const purchaseReturnVATAggBS = await PurchaseReturn.aggregate([
      {
        $match: {
          company: companyId,
          status: { $in: ['approved', 'refunded', 'partially_refunded'] }
        }
      },
      { $lookup: { from: 'purchases', localField: 'purchase', foreignField: '_id', as: 'linkedPurchase' } },
      { $addFields: { linkedPurchase: { $arrayElemAt: ['$linkedPurchase', 0] } } },
      {
        $addFields: {
          effectiveTax: {
            $cond: {
              if: { $gt: ['$totalTax', 0] },
              then: '$totalTax',
              else: {
                $cond: {
                  if: { $and: [
                    { $gt: [{ $ifNull: ['$linkedPurchase.subtotal', 0] }, 0] },
                    { $gt: [{ $ifNull: ['$linkedPurchase.totalTax', 0] }, 0] }
                  ]},
                  then: { $multiply: [{ $divide: ['$subtotal', '$linkedPurchase.subtotal'] }, '$linkedPurchase.totalTax'] },
                  else: 0
                }
              }
            }
          }
        }
      },
      { $group: { _id: null, totalTax: { $sum: '$effectiveTax' } } }
    ]);
    const inputVATReturn = purchaseReturnVATAggBS[0]?.totalTax || 0;
    const netInputVAT = inputVAT - inputVATReturn;

    // Extract inventory value
    const inventoryValue = inventoryData[0]?.totalValue || 0;

    // Extract fixed assets — categorized by type.
    // fixedAssetsData is now an array of documents (with virtuals) from FixedAsset.find().
    // Gross cost is stored per category; accumulated depreciation is the running total (virtual).
    // Balance Sheet displays: Gross Assets, Less: Accumulated Depreciation, = Net Book Value.
    let equipmentValue = 0;
    let furnitureValue = 0;
    let vehiclesValue = 0;
    let buildingsValue = 0;
    let computersValue = 0;
    let machineryValue = 0;
    let otherAssetsValue = 0;
    let totalDepreciation = 0; // accumulated depreciation across all fixed assets
    fixedAssetsData.forEach(asset => {
      totalDepreciation += asset.accumulatedDepreciation || 0;
      switch (asset.category) {
        case 'equipment': equipmentValue += asset.purchaseCost || 0; break;
        case 'furniture': furnitureValue += asset.purchaseCost || 0; break;
        case 'vehicles':  vehiclesValue  += asset.purchaseCost || 0; break;
        case 'buildings': buildingsValue += asset.purchaseCost || 0; break;
        case 'computers': computersValue += asset.purchaseCost || 0; break;
        case 'machinery': machineryValue += asset.purchaseCost || 0; break;
        case 'other':     otherAssetsValue += asset.purchaseCost || 0; break;
        default:          equipmentValue  += asset.purchaseCost || 0;
      }
    });

    // Extract loans
    let shortTermLoans = 0;
    let longTermLoans = 0;
    loansData.forEach(loan => {
      if (loan._id === 'short-term') shortTermLoans = loan.totalBalance || 0;
      else if (loan._id === 'long-term') longTermLoans = loan.totalBalance || 0;
    });

    // ── ACCRUED INTEREST (ALL active loans — short-term + long-term) ────────
    // Total interest for the full loan term is recognised as a current liability.
    //   Simple interest  : Total = P × (annualRate / 12 / 100) × durationMonths
    //   Compound / EMI   : Total = EMI × n  −  P
    const allActiveLoans = await Loan.find({ company: companyId, status: 'active' });
    const accruedInterest = allActiveLoans.reduce((sum, loan) => {
      const months = loan.durationMonths || 0;
      const P      = loan.originalAmount || 0;
      const rate   = loan.interestRate   || 0;
      if (!months || !P || !rate) return sum;

      if (loan.interestMethod === 'compound') {
        const r   = rate / 100 / 12;
        const emi = r > 0 ? (P * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1) : P / months;
        const totalInterest = emi * months - P;
        return sum + Math.max(0, totalInterest);
      } else {
        // Simple interest — full term, recognised immediately
        const totalInterest = (P * rate / 100 / 12) * months;
        return sum + totalInterest;
      }
    }, 0);

    // Calculate derived values
    // Show Cash & Bank as total invoice payments (totalInflows) — money received from goods sold.
    // Subtract credit note amounts since money is being returned to customers.
    const cashAndBank = netCashInflows || 0;
    // Get Prepaid Expenses from Company settings (manual entry)
    const prepaidExpenses = company?.assets?.prepaidExpenses || 0;
    // VAT Receivable = Net Input VAT - Output VAT + Credit Note VAT
    // Net Input VAT = Input VAT - VAT on purchase returns (VAT on returned goods is no longer claimable)
    const vatReceivable = Math.max(0, netInputVAT - outputVAT + totalCreditNoteTax);
    const vatPayable = Math.max(0, outputVAT - netInputVAT - totalCreditNoteTax);

    const totalCurrentAssets = cashAndBank + accountsReceivable + inventoryValue + prepaidExpenses + vatReceivable;
    const totalFixedAssets = equipmentValue + furnitureValue + vehiclesValue + buildingsValue + computersValue + machineryValue + otherAssetsValue;
    // Net book value = gross cost − accumulated depreciation (Balance Sheet standard)
    const totalNonCurrentAssets = Math.max(0, totalFixedAssets - totalDepreciation);
    const totalAssets = totalCurrentAssets + totalNonCurrentAssets;

    // ── CURRENT PERIOD PROFIT (pulled from P&L) ─────────────────────────────
    // Uses the EXACT same formula as getProfitAndLossFull so the Balance Sheet
    // Equity → Current Period Profit always equals the P&L NET PROFIT (AFTER TAX).
    // Default period: Jan 1 of asOfDate year → end-of-day asOfDate (fiscal year to date).
    // The user can override by passing startDate/endDate query params — set these to the
    // same dates as the P&L report for an exact match.
    const { startDate: bsStartDate, endDate: bsEndDate } = req.query || {};

    // Default: fiscal year start (Jan 1) of the asOfDate year
    const fiscalYearStart = new Date(reportDate.getFullYear(), 0, 1);
    const periodStart = bsStartDate ? new Date(bsStartDate) : fiscalYearStart;

    // periodEnd: end-of-day on asOfDate so all transactions on that calendar day are included
    let periodEnd;
    if (bsEndDate) {
      periodEnd = new Date(bsEndDate);
      periodEnd.setHours(23, 59, 59, 999);
    } else {
      periodEnd = new Date(reportDate);
      periodEnd.setHours(23, 59, 59, 999);
    }

    const {
      netProfit,
      corporateIncomeTax: incomeTaxPayable,
      netRevenue: plNetRevenue,
      invoicesConsidered: plInvoicesConsidered
    } = await computeCurrentPeriodProfit(companyId, periodStart, periodEnd);

    const pl_debug = {
      invoicesConsidered: plInvoicesConsidered,
      paymentsMatchedCount: 0,
      plNetProfit: netProfit,
      plRevenue: plNetRevenue
    };

    // Get custom liabilities from Company
    const companyCurrentLiabilities = company?.liabilities?.currentLiabilities || [];
    const companyNonCurrentLiabilities = company?.liabilities?.nonCurrentLiabilities || [];
    
    // Get Accrued Expenses from Company settings (manual entry - current liability)
    const accruedExpenses = company?.liabilities?.accruedExpenses || 0;
    
    // Get Other Long-term Liabilities from Company settings (manual entry - non-current liability)
    const otherLongTermLiabilities = company?.liabilities?.otherLongTermLiabilities || 0;
    
    // Sum up custom current liabilities
    const customCurrentLiabilitiesTotal = companyCurrentLiabilities.reduce((sum, liab) => sum + (liab.amount || 0), 0);
    const customCurrentLiabilitiesList = companyCurrentLiabilities.map(liab => ({
      name: liab.name,
      amount: Math.round((liab.amount || 0) * 100) / 100,
      description: liab.description
    }));
    
    // Sum up custom non-current liabilities
    const customNonCurrentLiabilitiesTotal = companyNonCurrentLiabilities.reduce((sum, liab) => sum + (liab.amount || 0), 0);
    const customNonCurrentLiabilitiesList = companyNonCurrentLiabilities.map(liab => ({
      name: liab.name,
      amount: Math.round((liab.amount || 0) * 100) / 100,
      description: liab.description,
      dueDate: liab.dueDate
    }));

    // Compute liabilities totals including Income Tax Payable (current period corporate tax),
    // Accrued Expenses, Accrued Interest (simple interest loans) and custom liabilities
    const totalCurrentLiabilities = accountsPayable + vatPayable + shortTermLoans + incomeTaxPayable + customCurrentLiabilitiesTotal + accruedExpenses + accruedInterest;
    const totalNonCurrentLiabilities = longTermLoans + customNonCurrentLiabilitiesTotal + otherLongTermLiabilities;
    const totalLiabilities = totalCurrentLiabilities + totalNonCurrentLiabilities;

    // Share Capital & Retained Earnings from Company
    const shareCapital = company?.equity?.shareCapital || 0;
    const retainedEarnings = company?.equity?.retainedEarnings || 0;
    const totalEquity = shareCapital + retainedEarnings + netProfit;
    const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
    const isBalanced = Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01;

    res.json({
      success: true,
      data: {
        asOfDate: reportDate,
        company: company ? { name: company.name, tin: company.tin } : { name: 'N/A', tin: 'N/A' },
        assets: {
          currentAssets: {
            cashAndBank: Math.round(cashAndBank * 100) / 100,
            accountsReceivable: Math.round(accountsReceivable * 100) / 100,
            inventoryStockValue: Math.round(inventoryValue * 100) / 100,
            prepaidExpenses: Math.round(prepaidExpenses * 100) / 100,
            vatReceivable: Math.round(vatReceivable * 100) / 100,
            totalCurrentAssets: Math.round(totalCurrentAssets * 100) / 100
          },
          nonCurrentAssets: {
            // Gross cost by category
            equipment: Math.round(equipmentValue * 100) / 100,
            furniture: Math.round(furnitureValue * 100) / 100,
            vehicles:  Math.round(vehiclesValue  * 100) / 100,
            computers: Math.round(computersValue * 100) / 100,
            buildings: Math.round(buildingsValue * 100) / 100,
            machinery: Math.round(machineryValue * 100) / 100,
            other:     Math.round(otherAssetsValue * 100) / 100,
            // Accumulated depreciation (grows every year until fully depreciated)
            lessAccumulatedDepreciation: -Math.round(totalDepreciation * 100) / 100,
            // Legacy field kept for frontend compatibility
            lessDepreciation: -Math.round(totalDepreciation * 100) / 100,
            // Net Book Value = Gross Cost − Accumulated Depreciation
            totalNonCurrentAssets: Math.round(totalNonCurrentAssets * 100) / 100
          },
          totalAssets: Math.round(totalAssets * 100) / 100
        },
        liabilities: {
          currentLiabilities: {
            accountsPayable: Math.round(accountsPayable * 100) / 100,
            vatPayable: Math.round(vatPayable * 100) / 100,
            shortTermLoans: shortTermLoans,
            incomeTaxPayable: Math.round(incomeTaxPayable * 100) / 100,
            accruedExpenses: Math.round(accruedExpenses * 100) / 100,
            accruedInterest: Math.round(accruedInterest * 100) / 100,
            customLiabilities: customCurrentLiabilitiesList,
            totalCurrentLiabilities: Math.round(totalCurrentLiabilities * 100) / 100
          },
          nonCurrentLiabilities: {
            longTermLoans: longTermLoans,
            otherLongTermLiabilities: Math.round(otherLongTermLiabilities * 100) / 100,
            customLiabilities: customNonCurrentLiabilitiesList,
            totalNonCurrentLiabilities: Math.round(totalNonCurrentLiabilities * 100) / 100
          },
          totalLiabilities: Math.round(totalLiabilities * 100) / 100
        },
        equity: {
          shareCapital: shareCapital,
          retainedEarnings: retainedEarnings,
          currentPeriodProfit: Math.round(netProfit * 100) / 100,
          totalEquity: Math.round(totalEquity * 100) / 100
        },
        totalLiabilitiesAndEquity: Math.round(totalLiabilitiesAndEquity * 100) / 100,
        isBalanced,
        plPeriod: {
          startDate: periodStart.toISOString(),
          endDate: periodEnd.toISOString(),
          formatted: `${periodStart.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} – ${periodEnd.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`
        },
        details: { totalInflows, totalOutflows, outputVAT, inputVAT, inputVATReturn, netInputVAT, incomeTaxPayable, totalCreditNoteAmount, pl: pl_debug }
      }
    });
  } catch (error) {
    next(error);
  }
};
