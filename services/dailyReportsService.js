/**
 * Daily Reports Service
 * 
 * Generates daily operational reports for the Reports Hub.
 * All reports are read-only and scoped by company_id.
 * 
 * Reports:
 * 1. Daily Sales Summary
 * 2. Daily Purchases Summary
 * 3. Daily Cash Position
 * 4. Daily Stock Movement
 * 5. Daily AR Activity
 * 6. Daily AP Activity
 * 7. Daily Journal Entries Log
 * 8. Daily Tax Collected
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

// Format number with thousands separator
const formatNumber = (num) => {
  if (num === null || num === undefined) return '-';
  return num.toLocaleString('en-RW');
};

// Get date range for a specific day
const getDateRange = (dateStr) => {
  const date = new Date(dateStr);
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

class DailyReportsService {
  /**
   * 1. Daily Sales Summary
   * Shows total sales, invoices, cash vs credit, top products, discounts
   */
  static async getDailySalesSummary(companyId, dateStr) {
    const { start, end } = getDateRange(dateStr);
    
    const Invoice = mongoose.model('Invoice');
    const SalesOrder = mongoose.model('SalesOrder');
    
    // Aggregate sales data
    const salesData = await Invoice.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          invoiceDate: { $gte: new Date(start), $lte: new Date(end) },
          status: { $in: ['fully_paid', 'partially_paid', 'confirmed', 'sent'] }
        }
      },
      {
        $group: {
          _id: null,
          totalSales: { $sum: { $toDouble: '$total' } },
          totalInvoices: { $sum: 1 },
          cashSales: {
            $sum: { $cond: [{ $eq: ['$paymentMethod', 'cash'] }, { $toDouble: '$total' }, 0] }
          },
          creditSales: {
            $sum: { $cond: [{ $in: ['$paymentMethod', ['credit', 'on_account']] }, { $toDouble: '$total' }, 0] }
          },
          mobileMoneySales: {
            $sum: { $cond: [{ $eq: ['$paymentMethod', 'mobile_money'] }, { $toDouble: '$total' }, 0] }
          },
          bankTransferSales: {
            $sum: { $cond: [{ $eq: ['$paymentMethod', 'bank_transfer'] }, { $toDouble: '$total' }, 0] }
          },
          totalDiscount: { $sum: { $toDouble: { $ifNull: ['$discount', 0] } } },
          totalTax: { $sum: { $toDouble: { $ifNull: ['$taxAmount', 0] } } }
        }
      }
    ]);

    // Get top 5 selling products
    const topProducts = await SalesOrder.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          orderDate: { $gte: new Date(start), $lte: new Date(end) },
          status: { $in: ['delivered', 'invoiced', 'closed'] }
        }
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          productName: { $first: '$items.name' },
          totalQuantity: { $sum: { $toDouble: '$items.qty' } },
          totalRevenue: { $sum: { $multiply: [{ $toDouble: '$items.qty' }, { $toDouble: '$items.unitPrice' }] } }
        }
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } }
    ]);

    const data = salesData[0] || {
      totalSales: 0,
      totalInvoices: 0,
      cashSales: 0,
      creditSales: 0,
      mobileMoneySales: 0,
      bankTransferSales: 0,
      totalDiscount: 0,
      totalTax: 0
    };

    return {
      reportName: 'Daily Sales Summary',
      date: dateStr,
      companyId,
      summary: {
        totalSales: data.totalSales,
        totalInvoices: data.totalInvoices,
        cashSales: data.cashSales,
        creditSales: data.creditSales,
        mobileMoneySales: data.mobileMoneySales,
        bankTransferSales: data.bankTransferSales,
        totalDiscount: data.totalDiscount,
        totalTax: data.totalTax,
        averageInvoiceValue: data.totalInvoices > 0 ? data.totalSales / data.totalInvoices : 0
      },
      topProducts: topProducts.map(p => ({
        productId: p._id,
        name: p.productName || p.product?.name || 'Unknown',
        quantity: p.totalQuantity,
        revenue: p.totalRevenue
      })),
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 2. Daily Purchases Summary
   * Shows goods received, supplier invoices, purchase values
   */
  static async getDailyPurchasesSummary(companyId, dateStr) {
    const { start, end } = getDateRange(dateStr);
    
    const Purchase = mongoose.model('Purchase');
    const GoodsReceivedNote = mongoose.model('GoodsReceivedNote');
    const Supplier = mongoose.model('Supplier');
    
    // Get both direct purchases (by receivedDate) and GRN-based purchases
    const [purchaseData, grnData] = await Promise.all([
      // Direct purchases received on this date
      Purchase.aggregate([
        {
          $match: {
            company: new mongoose.Types.ObjectId(companyId),
            $or: [
              { receivedDate: { $gte: new Date(start), $lte: new Date(end) } },
              { purchaseDate: { $gte: new Date(start), $lte: new Date(end) }, status: { $in: ['received', 'partial', 'completed', 'paid'] } }
            ]
          }
        },
        {
          $group: {
            _id: null,
            totalPurchases: { $sum: { $toDouble: '$grandTotal' } },
            totalOrders: { $sum: 1 },
            totalTax: { $sum: { $toDouble: { $ifNull: ['$totalTax', 0] } } },
            totalDiscount: { $sum: { $toDouble: { $ifNull: ['$totalDiscount', 0] } } }
          }
        }
      ]),
      // GRN data - goods received on this date (only confirmed, not drafts)
      GoodsReceivedNote.aggregate([
        {
          $match: {
            company: new mongoose.Types.ObjectId(companyId),
            receivedDate: { $gte: new Date(start), $lte: new Date(end) },
            status: 'confirmed'
          }
        },
        {
          $group: {
            _id: null,
            totalGRNs: { $sum: 1 },
            totalGRNAmount: { $sum: { $toDouble: '$totalAmount' } },
            totalItemsReceived: { $sum: { $size: { $ifNull: ['$lines', []] } } }
          }
        }
      ])
    ]);

    // Get suppliers from GRN data (only confirmed)
    const grnSupplierData = await GoodsReceivedNote.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          receivedDate: { $gte: new Date(start), $lte: new Date(end) },
          status: 'confirmed'
        }
      },
      {
        $group: {
          _id: '$supplier',
          totalAmount: { $sum: { $toDouble: '$totalAmount' } },
          orderCount: { $sum: 1 }
        }
      }
    ]);

    // Get suppliers from direct purchases
    const purchaseSupplierData = await Purchase.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          $or: [
            { receivedDate: { $gte: new Date(start), $lte: new Date(end) } },
            { purchaseDate: { $gte: new Date(start), $lte: new Date(end) }, status: { $in: ['received', 'partial', 'completed', 'paid'] } }
          ]
        }
      },
      {
        $group: {
          _id: '$supplier',
          totalAmount: { $sum: { $toDouble: '$grandTotal' } },
          orderCount: { $sum: 1 }
        }
      }
    ]);

    // Combine supplier data from both sources
    const supplierTotals = new Map();
    
    // Add GRN supplier data
    grnSupplierData.forEach(s => {
      if (s._id) {
        const key = s._id.toString();
        const existing = supplierTotals.get(key);
        if (existing) {
          existing.totalAmount += s.totalAmount;
          existing.orderCount += s.orderCount;
        } else {
          supplierTotals.set(key, {
            supplierId: s._id.toString(), // Store as string for consistency
            totalAmount: s.totalAmount,
            orderCount: s.orderCount
          });
        }
      }
    });
    
    // Add purchase supplier data
    purchaseSupplierData.forEach(s => {
      if (s._id) {
        const key = s._id.toString();
        const existing = supplierTotals.get(key);
        if (existing) {
          existing.totalAmount += s.totalAmount;
          existing.orderCount += s.orderCount;
        } else {
          supplierTotals.set(key, {
            supplierId: s._id.toString(), // Store as string for consistency
            totalAmount: s.totalAmount,
            orderCount: s.orderCount
          });
        }
      }
    });

    // Get supplier names
    const supplierIds = Array.from(supplierTotals.keys()).map(id => new mongoose.Types.ObjectId(id));
    const suppliers = await Supplier.find({ _id: { $in: supplierIds } }, 'name');
    const supplierMap = new Map(suppliers.map(s => [s._id.toString(), s.name]));

    // Convert to array, sort by amount, and take top 5
    const topSuppliers = Array.from(supplierTotals.values())
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 5);

    // Combine purchase and GRN data
    const pData = purchaseData[0] || {
      totalPurchases: 0,
      totalOrders: 0,
      totalTax: 0,
      totalDiscount: 0
    };

    const gData = grnData[0] || {
      totalGRNs: 0,
      totalGRNAmount: 0,
      totalItemsReceived: 0
    };

    // Add both direct purchases AND GRN amounts together
    const totalPurchases = pData.totalPurchases + gData.totalGRNAmount;
    const totalOrders = pData.totalOrders + gData.totalGRNs;

    return {
      reportName: 'Daily Purchases Summary',
      date: dateStr,
      companyId,
      summary: {
        totalPurchases,
        totalOrders,
        totalTax: pData.totalTax,
        totalDiscount: pData.totalDiscount,
        totalGRNs: gData.totalGRNs,
        totalItemsReceived: gData.totalItemsReceived,
        averageOrderValue: totalOrders > 0 ? totalPurchases / totalOrders : 0
      },
      topSuppliers: topSuppliers.map(s => ({
        supplierId: s.supplierId,
        name: supplierMap.get(s.supplierId) || 'Unknown',
        amount: s.totalAmount,
        orders: s.orderCount
      })),
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 3. Daily Cash Position
   * Shows opening balance, receipts, payments, closing balance per account
   */
  static async getDailyCashPosition(companyId, dateStr) {
    const { start, end } = getDateRange(dateStr);
    
    const BankAccount = mongoose.model('BankAccount');
    const BankTransaction = mongoose.model('BankTransaction');
    const JournalEntry = mongoose.model('JournalEntry');
    
    // Get all bank accounts for the company
    const accounts = await BankAccount.find({ company: companyId, isActive: true });
    
    const accountPositions = await Promise.all(
      accounts.map(async (account) => {
        // Get opening balance (balance at start of day)
        const lastTransactionBefore = await BankTransaction.findOne({
          company: new mongoose.Types.ObjectId(companyId),
          account: new mongoose.Types.ObjectId(account._id),
          date: { $lt: new Date(start) }
        }).sort({ date: -1 });
        
        // Convert Decimal128 to number if needed
        let openingBalance = 0;
        if (lastTransactionBefore?.balanceAfter) {
          openingBalance = typeof lastTransactionBefore.balanceAfter === 'object' && lastTransactionBefore.balanceAfter.$numberDecimal 
            ? parseFloat(lastTransactionBefore.balanceAfter.$numberDecimal)
            : Number(lastTransactionBefore.balanceAfter);
        } else if (account.openingBalance) {
          openingBalance = typeof account.openingBalance === 'object' && account.openingBalance.$numberDecimal
            ? parseFloat(account.openingBalance.$numberDecimal)
            : Number(account.openingBalance);
        }
        
        // Get today's transactions
        const transactions = await BankTransaction.aggregate([
          {
            $match: {
              company: new mongoose.Types.ObjectId(companyId),
              account: new mongoose.Types.ObjectId(account._id),
              date: { $gte: new Date(start), $lte: new Date(end) }
            }
          },
          {
            $group: {
              _id: '$type',
              total: { $sum: '$amount' },
              count: { $sum: 1 }
            }
          }
        ]);
        
        const receipts = transactions.find(t => t._id === 'deposit')?.total || 0;
        const payments = transactions.find(t => t._id === 'withdrawal')?.total || 0;
        
        // Get journal entries affecting cash/bank
        const journalEntries = await JournalEntry.aggregate([
          {
            $match: {
              company: new mongoose.Types.ObjectId(companyId),
              date: { $gte: new Date(start), $lte: new Date(end) },
              'lines.account': account.chartAccount
            }
          },
          { $unwind: '$lines' },
          {
            $match: {
              'lines.account': account.chartAccount
            }
          },
          {
            $group: {
              _id: null,
              totalDebit: { $sum: '$lines.debit' },
              totalCredit: { $sum: '$lines.credit' }
            }
          }
        ]);
        
        const journalNet = (journalEntries[0]?.totalDebit || 0) - (journalEntries[0]?.totalCredit || 0);
        
        return {
          accountId: account._id,
          accountName: account.name,
          accountNumber: account.accountNumber,
          bankName: account.bankName,
          accountType: account.accountType,
          currency: account.currency,
          openingBalance,
          receipts,
          payments,
          journalNet,
          closingBalance: openingBalance + receipts - payments + journalNet
        };
      })
    );
    
    const totals = accountPositions.reduce((acc, pos) => ({
      openingBalance: acc.openingBalance + pos.openingBalance,
      receipts: acc.receipts + pos.receipts,
      payments: acc.payments + pos.payments,
      closingBalance: acc.closingBalance + pos.closingBalance
    }), { openingBalance: 0, receipts: 0, payments: 0, closingBalance: 0 });

    return {
      reportName: 'Daily Cash Position',
      date: dateStr,
      companyId,
      summary: totals,
      accounts: accountPositions,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 4. Daily Stock Movement
   * Shows all stock-in and stock-out transactions
   */
  static async getDailyStockMovement(companyId, dateStr) {
    const { start, end } = getDateRange(dateStr);
    
    const StockMovement = mongoose.model('StockMovement');
    
    // Get all movements for the day
    const movements = await StockMovement.find({
      company: new mongoose.Types.ObjectId(companyId),
      movementDate: { $gte: new Date(start), $lte: new Date(end) }
    })
    .populate('product', 'name sku')
    .populate('warehouse', 'name')
    .sort({ movementDate: 1 });
    
    // Group by type (type field is 'in'/'out', reason field has the specific reason)
    const stockIn = movements.filter(m => m.type === 'in' || ['purchase', 'return', 'transfer_in', 'initial_stock', 'audit_surplus'].includes(m.reason));
    const stockOut = movements.filter(m => m.type === 'out' || ['sale', 'damage', 'loss', 'theft', 'expired', 'transfer_out', 'audit_shortage', 'dispatch'].includes(m.reason));
    
    // Calculate totals
    const totalIn = stockIn.reduce((sum, m) => sum + (Number(m.quantity) * Number(m.unitCost || 0)), 0);
    const totalOut = stockOut.reduce((sum, m) => sum + (Number(m.quantity) * Number(m.unitCost || 0)), 0);
    
    // Get product running balances
    const productMovements = await StockMovement.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          movementDate: { $lte: new Date(end) }
        }
      },
      {
        $group: {
          _id: '$product',
          runningBalance: {
            $sum: {
              $cond: [
                { $eq: ['$type', 'in'] },
                { $toDouble: { $ifNull: ['$quantity', 0] } },
                { $multiply: [{ $toDouble: { $ifNull: ['$quantity', 0] } }, -1] }
              ]
            }
          }
        }
      }
    ]);
    
    const balanceMap = new Map(productMovements.map(p => [p._id?.toString(), p.runningBalance]));
    
    return {
      reportName: 'Daily Stock Movement',
      date: dateStr,
      companyId,
      summary: {
        totalMovements: movements.length,
        stockInCount: stockIn.length,
        stockOutCount: stockOut.length,
        totalInValue: totalIn,
        totalOutValue: totalOut,
        netMovement: totalIn - totalOut
      },
      movements: movements.map(m => ({
        movementId: m._id,
        productId: m.product?._id,
        productName: m.product?.name || 'Unknown',
        sku: m.product?.sku,
        warehouse: m.warehouse?.name || 'Unknown',
        type: m.type,
        reason: m.reason,
        quantity: Number(m.quantity),
        unitCost: Number(m.unitCost || 0),
        totalValue: Number(m.quantity) * Number(m.unitCost || 0),
        reference: m.reference,
        notes: m.notes,
        runningBalance: balanceMap.get(m.product?._id?.toString()) || 0,
        date: m.movementDate
      })),
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 5. Daily Accounts Receivable Activity
   * Shows new invoices, payments received, credit notes
   */
  static async getDailyARActivity(companyId, dateStr) {
    const { start, end } = getDateRange(dateStr);
    
    const Invoice = mongoose.model('Invoice');
    const ARReceipt = mongoose.model('ARReceipt');
    const CreditNote = mongoose.model('CreditNote');
    
    // Fetch all data in parallel with optimized projections and lean()
    const [newInvoices, paymentsReceived, creditNotes, invoiceTotals] = await Promise.all([
      // New invoices - only fetch needed fields
      Invoice.find({
        company: new mongoose.Types.ObjectId(companyId),
        invoiceDate: { $gte: new Date(start), $lte: new Date(end) }
      }, { 
        invoiceNumber: 1, invoiceDate: 1, totalAmount: 1, total: 1,
        status: 1, client: 1 
      })
      .populate('client', 'name')
      .lean(),
      
      // Payments received
      ARReceipt.find({
        company: new mongoose.Types.ObjectId(companyId),
        receiptDate: { $gte: new Date(start), $lte: new Date(end) }
      }, {
        receiptNumber: 1, receiptDate: 1, amount: 1,
        paymentMethod: 1, client: 1, invoice: 1
      })
      .populate('client', 'name')
      .populate('invoice', 'invoiceNumber')
      .lean(),
      
      // Credit notes
      CreditNote.find({
        company: new mongoose.Types.ObjectId(companyId),
        creditDate: { $gte: new Date(start), $lte: new Date(end) }
      }, {
        creditNoteNumber: 1, creditDate: 1, totalAmount: 1, total: 1,
        reason: 1, status: 1, client: 1, invoice: 1
      })
      .populate('client', 'name')
      .populate('invoice', 'invoiceNumber')
      .lean(),
      
      // Use aggregation for totals (runs on DB server, much faster)
      Invoice.aggregate([
        { 
          $match: { 
            company: new mongoose.Types.ObjectId(companyId),
            invoiceDate: { $gte: new Date(start), $lte: new Date(end) }
          } 
        },
        { 
          $group: { 
            _id: null, 
            total: { $sum: { $toDouble: { $ifNull: ['$totalAmount', '$total'] } } } 
          } 
        }
      ])
    ]);
    
    // Calculate totals using aggregation results + fallback to reduce for other models
    const newInvoicesTotal = invoiceTotals[0]?.total || 0;
    const paymentsTotal = paymentsReceived.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const creditNotesTotal = creditNotes.reduce((sum, cn) => sum + (Number(cn.totalAmount) || Number(cn.total) || 0), 0);
    
    return {
      reportName: 'Daily Accounts Receivable Activity',
      date: dateStr,
      companyId,
      summary: {
        newInvoicesCount: newInvoices.length,
        newInvoicesTotal,
        paymentsCount: paymentsReceived.length,
        paymentsTotal,
        creditNotesCount: creditNotes.length,
        creditNotesTotal,
        netARChange: newInvoicesTotal - paymentsTotal - creditNotesTotal
      },
      newInvoices: newInvoices.map(inv => ({
        invoiceId: inv._id,
        invoiceNumber: inv.invoiceNumber,
        clientName: inv.client?.name || 'Unknown',
        date: inv.invoiceDate,
        total: Number(inv.totalAmount || inv.total || 0),
        status: inv.status
      })),
      paymentsReceived: paymentsReceived.map(p => ({
        receiptId: p._id,
        receiptNumber: p.receiptNumber,
        clientName: p.client?.name || 'Unknown',
        invoiceNumber: p.invoice?.invoiceNumber,
        date: p.receiptDate,
        amount: Number(p.amount || 0),
        paymentMethod: p.paymentMethod
      })),
      creditNotes: creditNotes.map(cn => ({
        creditNoteId: cn._id,
        creditNoteNumber: cn.creditNoteNumber,
        clientName: cn.client?.name || 'Unknown',
        invoiceNumber: cn.invoice?.invoiceNumber,
        date: cn.creditDate,
        total: Number(cn.totalAmount || cn.total || 0),
        reason: cn.reason
      })),
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 6. Daily Accounts Payable Activity
   * Shows new bills, payments made, debit notes
   */
  static async getDailyAPActivity(companyId, dateStr) {
    const { start, end } = getDateRange(dateStr);
    
    const Purchase = mongoose.model('Purchase');
    const APPayment = mongoose.model('APPayment');
    const PurchaseReturn = mongoose.model('PurchaseReturn');
    
    // Fetch all data in parallel with optimized projections and lean()
    const [newBills, paymentsMade, purchaseReturns, purchaseTotals] = await Promise.all([
      // New bills (purchases) - only fetch needed fields
      Purchase.find({
        company: new mongoose.Types.ObjectId(companyId),
        purchaseDate: { $gte: new Date(start), $lte: new Date(end) },
        status: { $in: ['received', 'partial', 'completed'] }
      }, {
        purchaseNumber: 1, purchaseDate: 1, grandTotal: 1, total: 1,
        status: 1, supplier: 1
      })
      .populate('supplier', 'name')
      .lean(),
      
      // Payments made
      APPayment.find({
        company: new mongoose.Types.ObjectId(companyId),
        paymentDate: { $gte: new Date(start), $lte: new Date(end) }
      }, {
        paymentNumber: 1, paymentDate: 1, amount: 1,
        paymentMethod: 1, supplier: 1, purchase: 1
      })
      .populate('supplier', 'name')
      .populate('purchase', 'purchaseNumber')
      .lean(),
      
      // Purchase returns (debit notes)
      PurchaseReturn.find({
        company: new mongoose.Types.ObjectId(companyId),
        returnDate: { $gte: new Date(start), $lte: new Date(end) }
      }, {
        returnNumber: 1, returnDate: 1, totalAmount: 1, total: 1,
        reason: 1, supplier: 1, purchase: 1
      })
      .populate('supplier', 'name')
      .populate('purchase', 'purchaseNumber')
      .lean(),
      
      // Use aggregation for purchase totals (runs on DB server)
      Purchase.aggregate([
        {
          $match: {
            company: new mongoose.Types.ObjectId(companyId),
            purchaseDate: { $gte: new Date(start), $lte: new Date(end) },
            status: { $in: ['received', 'partial', 'completed'] }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: { $toDouble: { $ifNull: ['$grandTotal', '$total'] } } }
          }
        }
      ])
    ]);
    
    // Calculate totals using aggregation results + simple reduce for others
    const newBillsTotal = purchaseTotals[0]?.total || 0;
    const paymentsTotal = paymentsMade.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const returnsTotal = purchaseReturns.reduce((sum, pr) => sum + (Number(pr.totalAmount) || Number(pr.total) || 0), 0);
    
    return {
      reportName: 'Daily Accounts Payable Activity',
      date: dateStr,
      companyId,
      summary: {
        newBillsCount: newBills.length,
        newBillsTotal,
        paymentsCount: paymentsMade.length,
        paymentsTotal,
        returnsCount: purchaseReturns.length,
        returnsTotal,
        netAPChange: newBillsTotal - paymentsTotal - returnsTotal
      },
      newBills: newBills.map(bill => ({
        purchaseId: bill._id,
        purchaseNumber: bill.purchaseNumber,
        supplierName: bill.supplier?.name || 'Unknown',
        date: bill.purchaseDate,
        total: Number(bill.grandTotal || bill.total || 0),
        status: bill.status
      })),
      paymentsMade: paymentsMade.map(p => ({
        paymentId: p._id,
        paymentNumber: p.paymentNumber,
        supplierName: p.supplier?.name || 'Unknown',
        purchaseNumber: p.purchase?.purchaseNumber,
        date: p.paymentDate,
        amount: Number(p.amount || 0),
        paymentMethod: p.paymentMethod
      })),
      purchaseReturns: purchaseReturns.map(pr => ({
        returnId: pr._id,
        returnNumber: pr.returnNumber,
        supplierName: pr.supplier?.name || 'Unknown',
        purchaseNumber: pr.purchase?.purchaseNumber,
        date: pr.returnDate,
        total: Number(pr.totalAmount || pr.total || 0),
        reason: pr.reason
      })),
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 7. Daily Journal Entries Log
   * Shows every journal entry posted that day
   */
  static async getDailyJournalEntries(companyId, dateStr) {
    const { start, end } = getDateRange(dateStr);
    
    const JournalEntry = mongoose.model('JournalEntry');
    
    const entries = await JournalEntry.find({
      company: new mongoose.Types.ObjectId(companyId),
      date: { $gte: new Date(start), $lte: new Date(end) }
    })
    .populate('createdBy', 'firstName lastName')
    .sort({ createdAt: 1 });
    
    return {
      reportName: 'Daily Journal Entries Log',
      date: dateStr,
      companyId,
      summary: {
        totalEntries: entries.length,
        totalDebits: entries.reduce((sum, e) => sum + e.lines.reduce((ls, l) => {
          const debitVal = l.debit ? (typeof l.debit === 'object' && l.debit.$numberDecimal ? parseFloat(l.debit.$numberDecimal) : Number(l.debit)) : 0;
          return ls + debitVal;
        }, 0), 0),
        totalCredits: entries.reduce((sum, e) => sum + e.lines.reduce((ls, l) => {
          const creditVal = l.credit ? (typeof l.credit === 'object' && l.credit.$numberDecimal ? parseFloat(l.credit.$numberDecimal) : Number(l.credit)) : 0;
          return ls + creditVal;
        }, 0), 0)
      },
      entries: entries.map(entry => ({
        entryId: entry._id,
        entryNumber: entry.entryNumber,
        date: entry.date,
        description: entry.description,
        reference: entry.reference,
        postedBy: entry.createdBy ? `${entry.createdBy.firstName} ${entry.createdBy.lastName}` : 'System',
        totalDebit: entry.totalDebit ? (typeof entry.totalDebit === 'object' && entry.totalDebit.$numberDecimal ? parseFloat(entry.totalDebit.$numberDecimal) : Number(entry.totalDebit)) : entry.lines.reduce((sum, l) => {
          const debitVal = l.debit ? (typeof l.debit === 'object' && l.debit.$numberDecimal ? parseFloat(l.debit.$numberDecimal) : Number(l.debit)) : 0;
          return sum + debitVal;
        }, 0),
        totalCredit: entry.totalCredit ? (typeof entry.totalCredit === 'object' && entry.totalCredit.$numberDecimal ? parseFloat(entry.totalCredit.$numberDecimal) : Number(entry.totalCredit)) : entry.lines.reduce((sum, l) => {
          const creditVal = l.credit ? (typeof l.credit === 'object' && l.credit.$numberDecimal ? parseFloat(l.credit.$numberDecimal) : Number(l.credit)) : 0;
          return sum + creditVal;
        }, 0),
        lines: entry.lines.map(line => ({
          accountCode: line.accountCode,
          accountName: line.accountName,
          debit: line.debit ? (typeof line.debit === 'object' && line.debit.$numberDecimal ? parseFloat(line.debit.$numberDecimal) : Number(line.debit)) : 0,
          credit: line.credit ? (typeof line.credit === 'object' && line.credit.$numberDecimal ? parseFloat(line.credit.$numberDecimal) : Number(line.credit)) : 0,
          description: line.description
        }))
      })),
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 8. Daily Tax Collected
   * Shows output VAT from sales and withholding tax
   */
  static async getDailyTaxCollected(companyId, dateStr) {
    const { start, end } = getDateRange(dateStr);
    
    const Invoice = mongoose.model('Invoice');
    const JournalEntry = mongoose.model('JournalEntry');
    
    // Get tax data from invoices - use taxAmount (actual field), not taxTotal (alias)
    const invoiceTax = await Invoice.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          invoiceDate: { $gte: new Date(start), $lte: new Date(end) },
          status: { $in: ['fully_paid', 'partially_paid', 'confirmed', 'sent'] }
        }
      },
      {
        $group: {
          _id: null,
          totalTax: { $sum: { $toDouble: { $ifNull: ['$taxAmount', 0] } } },
          subtotal: { $sum: { $toDouble: { $ifNull: ['$subtotal', 0] } } },
          total: { $sum: { $toDouble: '$total' } }
        }
      }
    ]);
    
    // Get tax breakdown by tax code from invoice lines
    const taxBreakdown = await Invoice.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          invoiceDate: { $gte: new Date(start), $lte: new Date(end) },
          status: { $in: ['fully_paid', 'partially_paid', 'confirmed', 'sent'] }
        }
      },
      { $unwind: { path: '$lines', preserveNullAndEmptyArrays: true } },
      {
        $match: {
          'lines.taxCode': { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$lines.taxCode',
          taxCode: { $first: '$lines.taxCode' },
          taxRate: { $first: '$lines.taxRate' },
          taxableAmount: { $sum: { $toDouble: { $ifNull: ['$lines.lineSubtotal', 0] } } },
          taxAmount: {
            $sum: { $toDouble: { $ifNull: ['$lines.lineTax', 0] } }
          }
        }
      },
      { $sort: { taxRate: 1 } }
    ]);
    
    const taxData = invoiceTax[0] || { totalTax: 0, subtotal: 0, total: 0 };
    
    return {
      reportName: 'Daily Tax Collected',
      date: dateStr,
      companyId,
      summary: {
        totalOutputVAT: taxData.totalTax,
        taxableSales: taxData.subtotal,
        totalSales: taxData.total,
        exemptSales: taxData.total - taxData.subtotal - taxData.totalTax
      },
      taxBreakdown: taxBreakdown.map(t => ({
        taxCode: t.taxCode || 'EXEMPT',
        taxRate: t.taxRate || 0,
        taxableAmount: t.taxableAmount,
        taxAmount: t.taxAmount
      })),
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = DailyReportsService;
