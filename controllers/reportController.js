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

// @desc    Get stock valuation report
// @route   GET /api/reports/stock-valuation
// @access  Private
exports.getStockValuationReport = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { categoryId } = req.query;
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

    res.json({
      success: true,
      data: {
        items: report,
        summary: {
          totalProducts: report.length,
          totalValue
        }
      }
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

    res.json({
      success: true,
      data: {
        invoices,
        summary,
        productSales: Object.values(productSales)
      }
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

    res.json({
      success: true,
      count: clientSales.length,
      data: clientSales
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
    const salesReturns = creditNotes.reduce((sum, cn) => sum + (cn.grandTotal || 0), 0);
    
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
    
    // Closing Stock Value (current inventory)
    const closingStockValue = products.reduce((sum, product) => {
      return sum + (product.currentStock * product.averageCost);
    }, 0);
    
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
    
    // COGS: Direct method — sum of (averageCost × qty) for every item sold on paid invoices.
    // This is the most accurate approach for a perpetual inventory system.
    let totalCOGS = 0;
    paidInvoices.forEach(inv => {
      inv.items.forEach(item => {
        const costPrice = item.product?.averageCost || 0;
        totalCOGS += (costPrice * (item.quantity || 0));
      });
    });

    // Opening Stock: back-calculated so the standard inventory breakdown always reconciles:
    //   Opening Stock + Purchases − Closing Stock = Total COGS
    //   ⟹  Opening Stock = Total COGS − Purchases + Closing Stock
    // This ensures the three displayed line items are mathematically consistent with TOTAL COGS.
    const openingStockValue = totalCOGS - purchasesExVAT + closingStockValue;
    
    // =============================================
    // GROSS PROFIT
    // =============================================
    const grossProfit = netRevenue - totalCOGS;
    const grossMarginPercent = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
    
    // =============================================
    // OPERATING EXPENSES
    // =============================================
    
    // 1. Depreciation (from Fixed Assets)
    const fixedAssets = await FixedAsset.find({ company: companyId, status: 'active' });
    let totalDepreciation = 0;
    fixedAssets.forEach(asset => {
      totalDepreciation += (asset.annualDepreciation || 0);
    });
    // Prorate depreciation for the period
    const periodMonths = ((periodEnd.getFullYear() - periodStart.getFullYear()) * 12 + 
                          periodEnd.getMonth() - periodStart.getMonth()) + 1;
    const depreciationExpense = (totalDepreciation / 12) * periodMonths;
    
    // 2. Interest Expense (from Loans)
    const loanMatch = {
      company: companyId,
      status: 'active',
      startDate: { $lte: periodEnd }
    };
    const activeLoans = await Loan.find(loanMatch);
    
    // Calculate interest expense for the period
    let interestExpense = 0;
    activeLoans.forEach(loan => {
      // Simplified interest calculation: (principal * rate * period months) / 12
      const monthlyInterest = (loan.originalAmount * (loan.interestRate || 0) / 100) / 12;
      interestExpense += monthlyInterest * periodMonths;
    });
    
    // 3. Transport & Delivery (from invoice shipping/transport if tracked)
    // Note: Not currently in invoice model, set to 0
    const transportDelivery = 0;
    
    // 4. VAT Expense (Output VAT - Input VAT) for the period
    // Output VAT from sales
    const outputVAT = paidInvoices.reduce((sum, inv) => sum + (inv.totalTax || 0), 0);
    // Input VAT from purchases
    const inputVAT = purchases.reduce((sum, p) => sum + (p.totalTax || 0), 0);
    const vatLiability = Math.max(0, outputVAT - inputVAT); // If positive, we owe VAT
    
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
    
    // VAT Liability (already calculated above)
    const vatExpense = vatLiability;
    
    // Corporate Income Tax (30% of Profit Before Tax)
    const corporateTaxRate = 0.30;
    const corporateIncomeTax = Math.max(0, profitBeforeTax * corporateTaxRate);
    
    const totalTax = vatExpense + corporateIncomeTax;
    
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
    const now = new Date();

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

      res.json({ success: true, count: invoices.length, buckets });
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

      res.json({ success: true, count: purchases.length, buckets });
    }
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
    const { startDate, endDate } = req.query;
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
        _id: '$items.taxCode',
        taxableBase: { $sum: { $multiply: [ '$items.quantity', '$items.unitPrice' ] } },
        taxAmount: { $sum: '$items.taxAmount' }
      } }
    ]);

    const summary = {};
    agg.forEach(a => {
      summary[a._id || 'None'] = { taxableBase: a.taxableBase, taxAmount: a.taxAmount };
    });

    res.json({ success: true, summary });
  } catch (error) {
    next(error);
  }
};

// @desc    Product performance (sales, quantity, margin)
// @route   GET /api/reports/product-performance
// @access  Private
exports.getProductPerformanceReport = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate, limit = 50 } = req.query;
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

    res.json({ success: true, count: report.length, data: report });
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

    res.json({ success: true, count: agg.length, data: agg });
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
    const start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), 0, 1);
    const end = endDate ? new Date(endDate) : new Date();

    // Determine date format based on period
    let dateFormat;
    let groupByFormat;
    switch (period) {
      case 'weekly':
        dateFormat = '%Y-W%V';
        groupByFormat = { $dateToString: { format: '%Y-W%V', date: '$payments.paidDate' } };
        break;
      case 'yearly':
        dateFormat = '%Y';
        groupByFormat = { $dateToString: { format: '%Y', date: '$payments.paidDate' } };
        break;
      case 'monthly':
      default:
        dateFormat = '%Y-%m';
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

    res.json({ success: true, period: { start, end }, periodType: period, months });
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
      case 'stock-valuation':
        const productsExcel = await Product.find({ isArchived: false, company: companyId })
          .populate('category', 'name')
          .sort({ name: 1 });

        worksheet.columns = [
          { header: 'SKU', key: 'sku', width: 15 },
          { header: 'Product Name', key: 'name', width: 30 },
          { header: 'Category', key: 'category', width: 20 },
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
            unit: product.unit,
            stock: product.currentStock,
            cost: product.averageCost,
            value: product.currentStock * product.averageCost
          });
        });
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
      case 'stock-valuation':
        const productsPdf = await Product.find({ isArchived: false, company: companyId })
          .populate('category', 'name')
          .sort({ name: 1 });

        doc.fontSize(12).text('Stock Valuation Report', { underline: true });
        doc.moveDown();

        let totalValue = 0;
        productsPdf.forEach(product => {
          const value = product.currentStock * product.averageCost;
          totalValue += value;
          doc.fontSize(9).text(
            `${product.sku} - ${product.name} | Stock: ${product.currentStock} ${product.unit} | Value: $${value.toFixed(2)}`
          );
        });

        doc.moveDown();
        doc.fontSize(12).text(`Total Stock Value: $${totalValue.toFixed(2)}`, { bold: true });
        break;

      case 'sales-summary':
        const invoicesPdf = await Invoice.find({ status: { $in: ['paid', 'partial'] }, company: companyId })
          .populate('client', 'name')
          .sort({ invoiceDate: -1 })
          .limit(50);

        doc.fontSize(12).text('Sales Summary Report', { underline: true });
        doc.moveDown();

        let totalSales = 0;
        invoicesPdf.forEach(invoice => {
          totalSales += invoice.grandTotal;
          doc.fontSize(9).text(
            `${invoice.invoiceNumber} | ${invoice.invoiceDate.toLocaleDateString()} | ${invoice.client?.name} | $${invoice.grandTotal.toFixed(2)}`
          );
        });

        doc.moveDown();
        doc.fontSize(12).text(`Total Sales: $${totalSales.toFixed(2)}`, { bold: true });
        break;

      default:
        doc.text('Invalid report type');
    }

    doc.end();
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
    const startOfDay = new Date(reportDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(reportDate.setHours(23, 59, 59, 999));

    // Get company info
    const company = await Company.findById(companyId);

    // =============================================
    // ASSETS
    // =============================================

    // --- Current Assets ---
    
    // 1. Cash & Bank: Calculate from all invoice payments received - all purchase payments made
    // Get all payments received from invoices (inflows)
    const invoicePayments = await Invoice.aggregate([
      { $match: { company: companyId } },
      { $unwind: '$payments' },
      { $group: { _id: null, totalInflows: { $sum: '$payments.amount' } } }
    ]);
    const totalInflows = invoicePayments[0]?.totalInflows || 0;

    // Get all payments made for purchases (outflows)
    const purchasePayments = await Purchase.aggregate([
      { $match: { company: companyId } },
      { $unwind: '$payments' },
      { $group: { _id: null, totalOutflows: { $sum: '$payments.amount' } } }
    ]);
    const totalOutflows = purchasePayments[0]?.totalOutflows || 0;

    // Net Cash = Inflows - Outflows (this is simplified - in real accounting you'd track cash accounts)
    const cashAndBank = Math.max(0, totalInflows - totalOutflows);

    // 2. Accounts Receivable: Sum of unpaid invoice balances
    const accountsReceivableAgg = await Invoice.aggregate([
      { $match: { company: companyId, status: { $in: ['draft', 'confirmed', 'partial'] } } },
      { $group: { _id: null, totalReceivable: { $sum: '$balance' } } }
    ]);
    const accountsReceivable = accountsReceivableAgg[0]?.totalReceivable || 0;

    // 3. Inventory (Stock Value): Current stock × Average cost
    // This is the key change - purchases become assets (inventory) instead of expenses
    const products = await Product.find({ company: companyId, isArchived: false });
    const inventoryValue = products.reduce((sum, product) => {
      return sum + (product.currentStock * product.averageCost);
    }, 0);

    // 4. Prepaid Expenses (simplified - would need a separate tracking system)
    const prepaidExpenses = 0;

    const totalCurrentAssets = cashAndBank + accountsReceivable + inventoryValue + prepaidExpenses;

    // --- Non-Current Assets ---
    // Get Fixed Assets data
    const fixedAssets = await FixedAsset.find({ company: companyId, status: 'active' });
    
    // Group by category
    let equipmentValue = 0;
    let furnitureValue = 0;
    let vehiclesValue = 0;
    let totalDepreciation = 0;
    
    fixedAssets.forEach(asset => {
      totalDepreciation += asset.accumulatedDepreciation || 0;
      switch(asset.category) {
        case 'equipment':
          equipmentValue += asset.netBookValue || 0;
          break;
        case 'furniture':
          furnitureValue += asset.netBookValue || 0;
          break;
        case 'vehicles':
          vehiclesValue += asset.netBookValue || 0;
          break;
        default:
          // Add to equipment for other categories
          equipmentValue += asset.netBookValue || 0;
      }
    });
    
    const totalFixedAssets = equipmentValue + furnitureValue + vehiclesValue;
    const accumulatedDepreciation = totalDepreciation;
    
    const totalNonCurrentAssets = totalFixedAssets;
    const totalAssets = totalCurrentAssets + totalNonCurrentAssets;

    // =============================================
    // LIABILITIES
    // =============================================

    // --- Current Liabilities ---
    
    // 1. Accounts Payable: Sum of unpaid purchase balances
    const accountsPayableAgg = await Purchase.aggregate([
      { $match: { company: companyId, status: { $in: ['draft', 'ordered', 'received', 'partial'] } } },
      { $group: { _id: null, totalPayable: { $sum: '$balance' } } }
    ]);
    const accountsPayable = accountsPayableAgg[0]?.totalPayable || 0;

    // 2. VAT Payable: Output VAT (from invoices) - Input VAT (from purchases)
    // Output VAT: Tax collected on sales
    const outputVATAgg = await Invoice.aggregate([
      { $match: { company: companyId, status: { $in: ['paid', 'partial', 'confirmed'] } } },
      { $group: { _id: null, totalOutputVAT: { $sum: '$totalTax' } } }
    ]);
    const outputVAT = outputVATAgg[0]?.totalOutputVAT || 0;

    // Input VAT: Tax paid on purchases
    const inputVATAgg = await Purchase.aggregate([
      { $match: { company: companyId, status: { $in: ['received', 'partial', 'paid'] } } },
      { $group: { _id: null, totalInputVAT: { $sum: '$totalTax' } } }
    ]);
    const inputVAT = inputVATAgg[0]?.totalInputVAT || 0;

    // VAT Payable = Output VAT - Input VAT (if positive, you owe VAT; if negative, you have VAT credit)
    const vatPayable = Math.max(0, outputVAT - inputVAT);
    const vatReceivable = Math.max(0, inputVAT - outputVAT); // VAT credit asset

    // 3. Short-term Loans - Get from Loans module
    const activeLoans = await Loan.find({ company: companyId, status: 'active' });
    const shortTermLoansList = activeLoans.filter(loan => loan.loanType === 'short-term');
    const shortTermLoans = shortTermLoansList.reduce((sum, loan) => sum + (loan.remainingBalance || 0), 0);

    const totalCurrentLiabilities = accountsPayable + vatPayable + shortTermLoans;

    // --- Non-Current Liabilities ---
    const longTermLoansList = activeLoans.filter(loan => loan.loanType === 'long-term');
    const longTermLoans = longTermLoansList.reduce((sum, loan) => sum + (loan.remainingBalance || 0), 0);

    const totalNonCurrentLiabilities = longTermLoans;
    const totalLiabilities = totalCurrentLiabilities + totalNonCurrentLiabilities;

    // =============================================
    // EQUITY
    // =============================================

    // Calculate Current Period Profit from P&L
    // Revenue (all paid invoices) - COGS - Expenses
    
    // Revenue: Sum of all paid invoice amounts (INCLUDING tax)
    const revenueInvoices = await Invoice.find({ status: 'paid', company: companyId });
    const revenue = revenueInvoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);

    // COGS: Cost of goods sold (products sold at their average cost)
    let cogs = 0;
    for (const inv of revenueInvoices) {
      const populatedInv = await Invoice.findById(inv._id).populate('items.product', 'averageCost');
      populatedInv.items.forEach(item => {
        const costPrice = item.product?.averageCost || 0;
        cogs += (costPrice * (item.quantity || 0));
      });
    }

    // Purchase Expenses (already accounted for in inventory - only paid purchases affect cash)
    // In accrual accounting, purchases are assets (inventory), not expenses
    const paidPurchases = await Purchase.find({ status: 'paid', company: companyId });
    const purchaseExpenses = 0; // Purchases are now assets, not expenses

    // Gross Profit = Revenue - COGS
    const grossProfit = revenue - cogs;

    // Net Profit = Gross Profit - Taxes
    // Note: In accrual basis, purchases are not expenses - they're assets (inventory)
    // The cost is realized when goods are sold (COGS)
    const taxes = outputVAT - inputVAT; // Simplified
    const netProfit = grossProfit - taxes;

    // Share Capital - Get from Company settings
    const shareCapital = company?.equity?.shareCapital || 0;

    // Retained Earnings - Get from Company settings
    const retainedEarnings = company?.equity?.retainedEarnings || 0;

    const totalEquity = shareCapital + retainedEarnings + netProfit;
    const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;

    // Balance Sheet verification
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
            prepaidExpenses: prepaidExpenses,
            vatReceivable: Math.round(vatReceivable * 100) / 100,
            totalCurrentAssets: Math.round(totalCurrentAssets * 100) / 100
          },
          nonCurrentAssets: {
            equipment: equipmentValue,
            furniture: furnitureValue,
            vehicles: vehiclesValue,
            lessDepreciation: -accumulatedDepreciation,
            totalNonCurrentAssets: Math.round(totalNonCurrentAssets * 100) / 100
          },
          totalAssets: Math.round(totalAssets * 100) / 100
        },
        liabilities: {
          currentLiabilities: {
            accountsPayable: Math.round(accountsPayable * 100) / 100,
            vatPayable: Math.round(vatPayable * 100) / 100,
            shortTermLoans: shortTermLoans,
            totalCurrentLiabilities: Math.round(totalCurrentLiabilities * 100) / 100
          },
          nonCurrentLiabilities: {
            longTermLoans: longTermLoans,
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
        // Additional details for verification
        details: {
          totalInflows,
          totalOutflows,
          revenue,
          cogs,
          grossProfit,
          purchaseExpenses,
          outputVAT,
          inputVAT,
          taxes: Math.round(taxes * 100) / 100
        }
      }
    });
  } catch (error) {
    next(error);
  }
};
