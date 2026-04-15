/**
 * Weekly Reports Service
 * Provides aggregated weekly data with performance optimizations
 */

const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const SalesOrder = require('../models/SalesOrder');
const Product = require('../models/Product');
const Supplier = require('../models/Supplier');
const PurchaseOrder = require('../models/PurchaseOrder');
const GoodsReceivedNote = require('../models/GoodsReceivedNote');
const ARReceipt = require('../models/ARReceipt');
const APPayment = require('../models/APPayment');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');

class WeeklyReportsService {
  /**
   * Get week range (Monday to Sunday)
   * @param {string} weekStart - Week start date (Monday) in YYYY-MM-DD format
   * @returns {Object} start and end dates
   */
  static getWeekRange(weekStart) {
    // Parse date string as local date to avoid timezone issues
    const [year, month, day] = weekStart.split('-').map(Number);
    const start = new Date(year, month - 1, day, 0, 0, 0, 0);
    
    const end = new Date(year, month - 1, day + 6, 23, 59, 59, 999);
    
    const prevStart = new Date(year, month - 1, day - 7, 0, 0, 0, 0);
    
    const prevEnd = new Date(year, month - 1, day - 1, 23, 59, 59, 999);
    
    return { start, end, prevStart, prevEnd };
  }

  /**
   * Get default week (most recently completed Monday-to-Sunday)
   */
  static getDefaultWeek() {
    const today = new Date();
    const day = today.getDay(); // 0 = Sunday, 1 = Monday
    // Days from last Monday (if today is Monday, daysFromMonday = 0)
    const daysFromMonday = day === 0 ? 6 : day - 1;
    const lastMonday = new Date(today);
    lastMonday.setDate(today.getDate() - daysFromMonday);
    return lastMonday.toISOString().split('T')[0];
  }

  /**
   * 1. Weekly Sales Performance
   * Compare this week vs last week by value and volume
   */
  static async getWeeklySalesPerformance(companyId, weekStart) {
    const { start, end, prevStart, prevEnd } = this.getWeekRange(weekStart);
    
    const Invoice = mongoose.model('Invoice');
    const SalesOrder = mongoose.model('SalesOrder');
    
    // Run this week and last week queries in parallel
    const [
      thisWeekInvoices, lastWeekInvoices,
      thisWeekOrders, lastWeekOrders
    ] = await Promise.all([
      // This week invoices
      Invoice.aggregate([
        {
          $match: {
            company: new mongoose.Types.ObjectId(companyId),
            invoiceDate: { $gte: start, $lte: end },
            status: { $in: ['fully_paid', 'partially_paid', 'confirmed'] }
          }
        },
        {
          $group: {
            _id: null,
            totalSales: { $sum: { $toDouble: { $ifNull: ['$totalAmount', '$total'] } } },
            invoiceCount: { $sum: 1 }
          }
        }
      ]),
      // Last week invoices
      Invoice.aggregate([
        {
          $match: {
            company: new mongoose.Types.ObjectId(companyId),
            invoiceDate: { $gte: prevStart, $lte: prevEnd },
            status: { $in: ['fully_paid', 'partially_paid', 'confirmed'] }
          }
        },
        {
          $group: {
            _id: null,
            totalSales: { $sum: { $toDouble: { $ifNull: ['$totalAmount', '$total'] } } },
            invoiceCount: { $sum: 1 }
          }
        }
      ]),
      // This week orders for volume - count orders and sum quantities separately
      SalesOrder.aggregate([
        {
          $match: {
            company: new mongoose.Types.ObjectId(companyId),
            orderDate: { $gte: start, $lte: end },
            status: { $in: ['delivered', 'invoiced', 'closed'] }
          }
        },
        {
          $project: {
            _id: 1,
            // Sum quantities from lines array (not items)
            totalQty: {
              $sum: {
                $map: {
                  input: { $ifNull: ['$lines', []] },
                  as: 'line',
                  in: { $toDouble: { $ifNull: ['$$line.qty', 0] } }
                }
              }
            }
          }
        },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalItems: { $sum: '$totalQty' }
          }
        }
      ]),
      // Last week orders
      SalesOrder.aggregate([
        {
          $match: {
            company: new mongoose.Types.ObjectId(companyId),
            orderDate: { $gte: prevStart, $lte: prevEnd },
            status: { $in: ['delivered', 'invoiced', 'closed'] }
          }
        },
        {
          $project: {
            _id: 1,
            totalQty: {
              $sum: {
                $map: {
                  input: { $ifNull: ['$lines', []] },
                  as: 'line',
                  in: { $toDouble: { $ifNull: ['$$line.qty', 0] } }
                }
              }
            }
          }
        },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalItems: { $sum: '$totalQty' }
          }
        }
      ])
    ]);
    
    const thisWeek = {
      sales: thisWeekInvoices[0]?.totalSales || 0,
      invoices: thisWeekInvoices[0]?.invoiceCount || 0,
      orders: thisWeekOrders[0]?.totalOrders || 0,
      items: thisWeekOrders[0]?.totalItems || 0
    };
    
    const lastWeek = {
      sales: lastWeekInvoices[0]?.totalSales || 0,
      invoices: lastWeekInvoices[0]?.invoiceCount || 0,
      orders: lastWeekOrders[0]?.totalOrders || 0,
      items: lastWeekOrders[0]?.totalItems || 0
    };
    
    // Calculate percentage changes
    const calculateChange = (current, previous) => {
      if (!previous) return current > 0 ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };
    
    return {
      reportName: 'Weekly Sales Performance',
      weekStart: weekStart,
      weekEnd: end.toISOString().split('T')[0],
      thisWeek,
      lastWeek,
      changes: {
        salesPercent: calculateChange(thisWeek.sales, lastWeek.sales),
        invoicesPercent: calculateChange(thisWeek.invoices, lastWeek.invoices),
        ordersPercent: calculateChange(thisWeek.orders, lastWeek.orders),
        itemsPercent: calculateChange(thisWeek.items, lastWeek.items)
      }
    };
  }

  /**
   * 2. Weekly Inventory Reorder Report
   * Products below reorder point
   */
  static async getWeeklyInventoryReorder(companyId) {
    const Product = mongoose.model('Product');
    
    // Get all products and filter in JS to handle Decimal128 properly
    const allProducts = await Product.find({
      company: new mongoose.Types.ObjectId(companyId),
      status: { $ne: 'discontinued' }
    }, {
      name: 1,
      sku: 1,
      currentStock: 1,
      reorderPoint: 1,
      reorderQuantity: 1,
      unit: 1,
      preferredSupplier: 1
    })
    .populate('preferredSupplier', 'name')
    .lean();
    
    // Filter products where currentStock < reorderPoint
    const productsNeedingReorder = allProducts.filter(p => {
      const stock = p.currentStock ? parseFloat(p.currentStock.toString()) : 0;
      const reorderPoint = p.reorderPoint ? parseFloat(p.reorderPoint.toString()) : 0;
      return stock < reorderPoint;
    });

    // Group by urgency
    const critical = [];
    const warning = [];
    
    productsNeedingReorder.forEach(p => {
      const stock = p.currentStock ? parseFloat(p.currentStock.toString()) : 0;
      const reorderPoint = p.reorderPoint ? parseFloat(p.reorderPoint.toString()) : 0;
      const deficit = reorderPoint - stock;
      const item = {
        productId: p._id,
        name: p.name,
        sku: p.sku,
        currentStock: stock,
        reorderPoint: reorderPoint,
        deficit: deficit,
        suggestedOrder: p.reorderQuantity ? parseFloat(p.reorderQuantity.toString()) : deficit,
        unit: p.unit,
        supplier: p.preferredSupplier?.name || 'No preferred supplier'
      };
      
      if (stock === 0) {
        critical.push(item);
      } else {
        warning.push(item);
      }
    });
    
    return {
      reportName: 'Weekly Inventory Reorder Report',
      generatedAt: new Date().toISOString(),
      summary: {
        totalProducts: productsNeedingReorder.length,
        criticalCount: critical.length,
        warningCount: warning.length
      },
      critical: critical.sort((a, b) => b.deficit - a.deficit),
      warning: warning.sort((a, b) => b.deficit - a.deficit)
    };
  }

  static async getWeeklySupplierPerformance(companyId, weekStart) {
    const { start, end } = this.getWeekRange(weekStart);
    
    // Get all suppliers
    const suppliers = await Supplier.find({
      company: new mongoose.Types.ObjectId(companyId)
    }, { name: 1 }).lean();
    
    // Get POs raised this week
    const posRaised = await PurchaseOrder.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          orderDate: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: '$supplier',
          count: { $sum: 1 },
          totalValue: { $sum: { $toDouble: { $ifNull: ['$totalAmount', '$total'] } } }
        }
      }
    ]);
    
    // Get GRNs received this week
    const grnsReceived = await GoodsReceivedNote.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          receivedDate: { $gte: start, $lte: end },
          status: 'confirmed'
        }
      },
      {
        $group: {
          _id: '$supplier',
          count: { $sum: 1 },
          totalValue: { $sum: { $toDouble: '$totalAmount' } }
        }
      }
    ]);
    
    // Get pending orders (not yet fully received)
    const pendingOrders = await PurchaseOrder.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          status: { $in: ['sent', 'partial'] }
        }
      },
      {
        $group: {
          _id: '$supplier',
          count: { $sum: 1 },
          totalValue: { $sum: { $toDouble: { $ifNull: ['$totalAmount', '$total'] } } }
        }
      }
    ]);
    
    // Get overdue deliveries (expected delivery date passed)
    const today = new Date();
    const overdueOrders = await PurchaseOrder.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          expectedDeliveryDate: { $lt: today },
          status: { $in: ['sent', 'partial'] }
        }
      },
      {
        $group: {
          _id: '$supplier',
          count: { $sum: 1 },
          totalValue: { $sum: { $toDouble: { $ifNull: ['$totalAmount', '$total'] } } }
        }
      }
    ]);
    
    // Combine into supplier performance data
    const performanceMap = new Map();
    
    suppliers.forEach(s => {
      performanceMap.set(s._id.toString(), {
        supplierId: s._id,
        supplierName: s.name,
        posRaised: { count: 0, value: 0 },
        deliveriesReceived: { count: 0, value: 0 },
        pendingOrders: { count: 0, value: 0 },
        overdueDeliveries: { count: 0, value: 0 }
      });
    });
    
    posRaised.forEach(p => {
      if (p._id && performanceMap.has(p._id.toString())) {
        const s = performanceMap.get(p._id.toString());
        s.posRaised = { count: p.count, value: p.totalValue };
      }
    });
    
    grnsReceived.forEach(g => {
      if (g._id && performanceMap.has(g._id.toString())) {
        const s = performanceMap.get(g._id.toString());
        s.deliveriesReceived = { count: g.count, value: g.totalValue };
      }
    });
    
    pendingOrders.forEach(p => {
      if (p._id && performanceMap.has(p._id.toString())) {
        const s = performanceMap.get(p._id.toString());
        s.pendingOrders = { count: p.count, value: p.totalValue };
      }
    });
    
    overdueOrders.forEach(o => {
      if (o._id && performanceMap.has(o._id.toString())) {
        const s = performanceMap.get(o._id.toString());
        s.overdueDeliveries = { count: o.count, value: o.totalValue };
      }
    });
    
    const supplierData = Array.from(performanceMap.values())
      .filter(s => s.posRaised.count > 0 || s.deliveriesReceived.count > 0 || s.pendingOrders.count > 0)
      .sort((a, b) => b.posRaised.value - a.posRaised.value);
    
    const result = {
      reportName: 'Weekly Supplier Performance',
      weekStart: weekStart,
      weekEnd: end.toISOString().split('T')[0],
      summary: {
        totalSuppliers: supplierData.length,
        totalPosRaised: posRaised.reduce((sum, p) => sum + p.count, 0),
        totalDeliveries: grnsReceived.reduce((sum, g) => sum + g.count, 0),
        totalPending: pendingOrders.reduce((sum, p) => sum + p.count, 0),
        totalOverdue: overdueOrders.reduce((sum, o) => sum + o.count, 0)
      },
      suppliers: supplierData
    };
    
    console.log('Supplier Performance Debug:', JSON.stringify(result, null, 2));
    return result;
  }

  /**
   * 4. Weekly Receivables Aging
   * Outstanding invoices grouped by age buckets
   */
  static async getWeeklyReceivablesAging(companyId) {
    const Invoice = mongoose.model('Invoice');
    const today = new Date();
    
    // Get all outstanding invoices
    const outstandingInvoices = await Invoice.find({
      company: new mongoose.Types.ObjectId(companyId),
      status: { $in: ['partially_paid', 'confirmed', 'sent'] },
      balance: { $gt: 0 }
    }, {
      invoiceNumber: 1,
      invoiceDate: 1,
      dueDate: 1,
      client: 1,
      totalAmount: 1,
      total: 1,
      balance: 1,
      amountPaid: 1
    })
    .populate('client', 'name')
    .lean();
    
    // Age buckets
    const buckets = {
      '0-7': { label: '0-7 Days', invoices: [], total: 0 },
      '8-14': { label: '8-14 Days', invoices: [], total: 0 },
      '15-21': { label: '15-21 Days', invoices: [], total: 0 },
      'over21': { label: 'Over 21 Days', invoices: [], total: 0 }
    };
    
    let totalOutstanding = 0;
    
    outstandingInvoices.forEach(inv => {
      const dueDate = new Date(inv.dueDate || inv.invoiceDate);
      const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
      
      const balance = Number(inv.balance || 0);
      totalOutstanding += balance;
      
      const invoiceData = {
        invoiceId: inv._id,
        invoiceNumber: inv.invoiceNumber,
        clientName: inv.client?.name || 'Unknown',
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        daysOverdue: daysOverdue > 0 ? daysOverdue : 0,
        totalAmount: Number(inv.totalAmount || inv.total || 0),
        balance: balance
      };
      
      if (daysOverdue <= 7) {
        buckets['0-7'].invoices.push(invoiceData);
        buckets['0-7'].total += balance;
      } else if (daysOverdue <= 14) {
        buckets['8-14'].invoices.push(invoiceData);
        buckets['8-14'].total += balance;
      } else if (daysOverdue <= 21) {
        buckets['15-21'].invoices.push(invoiceData);
        buckets['15-21'].total += balance;
      } else {
        buckets['over21'].invoices.push(invoiceData);
        buckets['over21'].total += balance;
      }
    });
    
    return {
      reportName: 'Weekly Receivables Aging',
      generatedAt: today.toISOString(),
      summary: {
        totalOutstanding,
        totalInvoices: outstandingInvoices.length,
        bucketTotals: {
          '0-7': buckets['0-7'].total,
          '8-14': buckets['8-14'].total,
          '15-21': buckets['15-21'].total,
          'over21': buckets['over21'].total
        }
      },
      buckets
    };
  }

  /**
   * 5. Weekly Payables Aging
   * Amounts owed to suppliers grouped by age buckets
   */
  static async getWeeklyPayablesAging(companyId) {
    const Purchase = mongoose.model('Purchase');
    const today = new Date();
    
    // Get all unpaid purchases
    const unpaidPurchases = await Purchase.find({
      company: new mongoose.Types.ObjectId(companyId),
      status: { $in: ['partial', 'received'] },
      balance: { $gt: 0 }
    }, {
      purchaseNumber: 1,
      purchaseDate: 1,
      dueDate: 1,
      supplier: 1,
      grandTotal: 1,
      total: 1,
      balance: 1
    })
    .populate('supplier', 'name')
    .lean();
    
    // Age buckets
    const buckets = {
      '0-7': { label: '0-7 Days', purchases: [], total: 0 },
      '8-14': { label: '8-14 Days', purchases: [], total: 0 },
      '15-21': { label: '15-21 Days', purchases: [], total: 0 },
      'over21': { label: 'Over 21 Days', purchases: [], total: 0 }
    };
    
    let totalPayable = 0;
    
    unpaidPurchases.forEach(p => {
      const dueDate = new Date(p.dueDate || p.purchaseDate);
      const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
      
      const balance = Number(p.balance || 0);
      totalPayable += balance;
      
      const purchaseData = {
        purchaseId: p._id,
        purchaseNumber: p.purchaseNumber,
        supplierName: p.supplier?.name || 'Unknown',
        purchaseDate: p.purchaseDate,
        dueDate: p.dueDate,
        daysOverdue: daysOverdue > 0 ? daysOverdue : 0,
        totalAmount: Number(p.grandTotal || p.total || 0),
        balance: balance
      };
      
      if (daysOverdue <= 7) {
        buckets['0-7'].purchases.push(purchaseData);
        buckets['0-7'].total += balance;
      } else if (daysOverdue <= 14) {
        buckets['8-14'].purchases.push(purchaseData);
        buckets['8-14'].total += balance;
      } else if (daysOverdue <= 21) {
        buckets['15-21'].purchases.push(purchaseData);
        buckets['15-21'].total += balance;
      } else {
        buckets['over21'].purchases.push(purchaseData);
        buckets['over21'].total += balance;
      }
    });
    
    return {
      reportName: 'Weekly Payables Aging',
      generatedAt: today.toISOString(),
      summary: {
        totalPayable,
        totalPurchases: unpaidPurchases.length,
        bucketTotals: {
          '0-7': buckets['0-7'].total,
          '8-14': buckets['8-14'].total,
          '15-21': buckets['15-21'].total,
          'over21': buckets['over21'].total
        }
      },
      buckets
    };
  }

  /**
   * 6. Weekly Cash Flow Summary
   * Daily cash in and out across the week
   */
  static async getWeeklyCashFlow(companyId, weekStart) {
    const { start, end } = this.getWeekRange(weekStart);
    
    const ARReceipt = mongoose.model('ARReceipt');
    const APPayment = mongoose.model('APPayment');
    const Expense = mongoose.model('Expense');
    
    // Generate array of dates for the week
    const weekDates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      weekDates.push(d);
    }
    
    // Get daily cash in (receipts)
    // Source 1: ARReceipts (amountReceived)
    const cashInReceipts = await ARReceipt.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          receiptDate: { $gte: start, $lte: end },
          status: { $in: ['posted', 'completed'] }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$receiptDate' } },
          amount: { $sum: { $toDouble: '$amountReceived' } }
        }
      }
    ]);
    
    // Get Cash/Bank account codes
    const cashBankAccounts = await ChartOfAccount.find({
      company: new mongoose.Types.ObjectId(companyId),
      $or: [
        { subtype: { $in: ['Cash', 'Bank', 'cash', 'bank'] } },
        { name: { $regex: /cash|bank/i } }
      ]
    }, { code: 1, name: 1 }).lean();
    
    const cashBankCodes = cashBankAccounts.map(a => a.code);
    
    // Source 2: Journal Entries (cash/bank debits from customers)
    const cashInJournals = cashBankCodes.length > 0 ? await JournalEntry.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          date: { $gte: start, $lte: end },
          status: 'posted'
        }
      },
      { $unwind: '$lines' },
      {
        $match: {
          'lines.accountCode': { $in: cashBankCodes },
          'lines.debit': { $gt: 0 }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          amount: { $sum: { $toDouble: '$lines.debit' } }
        }
      }
    ]) : [];
    
    // Merge cash in sources
    const cashIn = [...cashInReceipts];
    cashInJournals.forEach(j => {
      const existing = cashIn.find(c => c._id === j._id);
      if (existing) {
        existing.amount += j.amount;
      } else {
        cashIn.push(j);
      }
    });
    
    // APPayment uses amountPaid (Decimal128)
    const cashOutPayments = await APPayment.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          paymentDate: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$paymentDate' } },
          amount: { $sum: { $toDouble: '$amountPaid' } }
        }
      }
    ]);
    
    // Cash Out from Journal Entries (credits to cash/bank accounts)
    const cashOutJournals = cashBankCodes.length > 0 ? await JournalEntry.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          date: { $gte: start, $lte: end },
          status: 'posted'
        }
      },
      { $unwind: '$lines' },
      {
        $match: {
          'lines.accountCode': { $in: cashBankCodes },
          'lines.credit': { $gt: 0 }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          amount: { $sum: { $toDouble: '$lines.credit' } }
        }
      }
    ]) : [];
    
    // Note: Expense model might need adjustment based on actual schema
    let cashOutExpenses = [];
    try {
      cashOutExpenses = await Expense.aggregate([
        {
          $match: {
            company: new mongoose.Types.ObjectId(companyId),
            expenseDate: { $gte: start, $lte: end },
            status: 'posted'
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$expenseDate' } },
            amount: { $sum: { $toDouble: '$amount' } }
          }
        }
      ]);
    } catch (e) {
      // Expense model might not exist
      cashOutExpenses = [];
    }
    
    // Build daily summary using local dates
    const dailyFlow = weekDates.map(date => {
      // Format date as YYYY-MM-DD using local timezone
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      
      const receipts = cashIn.find(c => c._id === dateStr)?.amount || 0;
      const payments = cashOutPayments.find(c => c._id === dateStr)?.amount || 0;
      const expenses = cashOutExpenses.find(c => c._id === dateStr)?.amount || 0;
      const journalOut = cashOutJournals.find(c => c._id === dateStr)?.amount || 0;
      
      const cashOut = payments + expenses + journalOut;
      
      return {
        date: dateStr,
        dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
        cashIn: receipts,
        cashOut: cashOut,
        netFlow: receipts - cashOut
      };
    });
    
    const weekTotalIn = dailyFlow.reduce((sum, d) => sum + d.cashIn, 0);
    const weekTotalOut = dailyFlow.reduce((sum, d) => sum + d.cashOut, 0);
    
    const result = {
      reportName: 'Weekly Cash Flow Summary',
      weekStart,
      weekEnd: end.toISOString().split('T')[0],
      summary: {
        weekTotalIn,
        weekTotalOut,
        weekNetFlow: weekTotalIn - weekTotalOut,
        dailyFlow
      }
    };
    
    return result;
  }

  /**
   * 7. Weekly Payroll Preview
   * Shows expected payroll if in progress
   */
  static async getWeeklyPayrollPreview(companyId) {
    const Payroll = mongoose.model('Payroll');
    const today = new Date();
    
    // Check if payroll is in progress for this period
    const currentPayroll = await Payroll.findOne({
      company: new mongoose.Types.ObjectId(companyId),
      status: { $in: ['draft', 'processing'] },
      periodStart: { $lte: today },
      periodEnd: { $gte: today }
    }).lean();
    
    if (!currentPayroll) {
      // No payroll in progress - check for any payroll records to get employee info
      const payrollRecords = await Payroll.find({
        company: new mongoose.Types.ObjectId(companyId)
      }).limit(1).lean();
      
      if (payrollRecords.length === 0 || !payrollRecords[0].employee) {
        return {
          reportName: 'Weekly Payroll Preview',
          payrollInProgress: false,
          message: 'No payroll data available',
          employeeCount: 0,
          estimatedGrossPay: 0
        };
      }
      
      return {
        reportName: 'Weekly Payroll Preview',
        payrollInProgress: false,
        message: 'No payroll currently in progress for this period',
        employeeCount: 0,
        estimatedGrossPay: 0
      };
    }
    
    // Payroll in progress - get all payroll records for this period
    const payrollRecords = await Payroll.find({
      company: new mongoose.Types.ObjectId(companyId),
      'period.year': currentPayroll.period.year,
      'period.month': currentPayroll.period.month
    }).lean();
    
    // Extract employee data from payroll records
    const employees = payrollRecords.map(p => ({
      name: `${p.employee.firstName} ${p.employee.lastName}`,
      employeeNumber: p.employee.employeeNumber,
      department: p.employee.department || 'N/A',
      grossPay: p.grossSalary,
      paye: p.deductions.paye,
      rssbEmployee: p.deductions.rssbEmployeePension + p.deductions.rssbEmployeeMaternity,
      rssbEmployer: p.contributions?.rssbEmployerPension + p.contributions?.rssbEmployerMaternity || 0,
      totalDeductions: p.deductions.totalDeductions,
      netPay: p.netPay
    }));
    
    return {
      reportName: 'Weekly Payroll Preview',
      payrollInProgress: true,
      weekStart: currentPayroll.periodStart.toISOString().split('T')[0],
      weekEnd: currentPayroll.periodEnd.toISOString().split('T')[0],
      summary: {
        employeeCount: employees.length,
        grossPay: employees.reduce((sum, e) => sum + e.grossPay, 0),
        paye: employees.reduce((sum, e) => sum + e.paye, 0),
        rssbEmployee: employees.reduce((sum, e) => sum + e.rssbEmployee, 0),
        rssbEmployer: employees.reduce((sum, e) => sum + e.rssbEmployer, 0),
        totalDeductions: employees.reduce((sum, e) => sum + e.totalDeductions, 0),
        netPay: employees.reduce((sum, e) => sum + e.netPay, 0)
      },
      employees
    };
  }
}

module.exports = WeeklyReportsService;
