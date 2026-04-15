/**
 * Weekly Reports Routes
 * 
 * Provides endpoints for all weekly reports with JSON, PDF, and Excel export.
 * All endpoints are GET operations and respect multi-tenant architecture.
 */

const express = require('express');
const router = express.Router();
const WeeklyReportsService = require('../services/weeklyReportsService');
const { protect } = require('../middleware/auth');
const { attachCompanyId } = require('../middleware/companyContext');
const { authorize } = require('../middleware/authorize');

// PDF and Excel generation utilities
const PDFDocument = require('pdfkit');
const pdfRenderer = require('../utils/pdfRenderer');
const ExcelFormatter = require('../src/exports/formatters/ExcelFormatter');

// Helper to format RWF
const formatRWF = (amount) => {
  if (amount === null || amount === undefined) return '-';
  return 'RWF ' + Math.abs(amount).toLocaleString('en-RW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

// Apply authentication and company context to all routes
router.use(protect);
router.use(attachCompanyId);

// ============================================
// 1. WEEKLY SALES PERFORMANCE
// ============================================

// GET /api/reports/weekly/sales-performance?weekStart=2024-04-08
router.get('/sales-performance', authorize('reports', 'read'), async (req, res) => {
  try {
    let { weekStart } = req.query;
    
    // Default to most recently completed week if not provided
    if (!weekStart) {
      weekStart = WeeklyReportsService.getDefaultWeek();
    }
    
    const data = await WeeklyReportsService.getWeeklySalesPerformance(req.companyId, weekStart);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Weekly Sales Performance error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/reports/weekly/sales-performance/pdf?weekStart=2024-04-08
router.get('/sales-performance/pdf', authorize('reports', 'read'), async (req, res) => {
  try {
    let { weekStart } = req.query;
    if (!weekStart) {
      weekStart = WeeklyReportsService.getDefaultWeek();
    }
    
    const data = await WeeklyReportsService.getWeeklySalesPerformance(req.companyId, weekStart);
    const Company = require('../models/Company');
    const company = await Company.findById(req.companyId);
    
    // Generate PDF
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="weekly-sales-${weekStart}.pdf"`);
    doc.pipe(res);
    
    // Header
    pdfRenderer.renderReportHeader(doc, {
      companyName: company?.name || 'Company',
      companyTin: company?.tin || 'N/A',
      reportTitle: 'Weekly Sales Performance',
      period: `${data.weekStart} to ${data.weekEnd}`
    });
    
    // This Week Summary
    doc.fontSize(14).text('This Week', 50, doc.y + 20);
    doc.fontSize(10);
    doc.text(`Sales: ${formatRWF(data.thisWeek.sales)}`);
    doc.text(`Invoices: ${data.thisWeek.invoices}`);
    doc.text(`Orders: ${data.thisWeek.orders}`);
    doc.text(`Items: ${data.thisWeek.items}`);
    
    // Last Week Summary
    doc.fontSize(14).text('Last Week', 50, doc.y + 20);
    doc.fontSize(10);
    doc.text(`Sales: ${formatRWF(data.lastWeek.sales)}`);
    doc.text(`Invoices: ${data.lastWeek.invoices}`);
    doc.text(`Orders: ${data.lastWeek.orders}`);
    doc.text(`Items: ${data.lastWeek.items}`);
    
    // Changes
    doc.fontSize(14).text('Change vs Last Week', 50, doc.y + 20);
    doc.fontSize(10);
    doc.text(`Sales: ${data.changes.salesPercent.toFixed(1)}%`);
    doc.text(`Invoices: ${data.changes.invoicesPercent.toFixed(1)}%`);
    doc.text(`Orders: ${data.changes.ordersPercent.toFixed(1)}%`);
    doc.text(`Items: ${data.changes.itemsPercent.toFixed(1)}%`);
    
    doc.end();
  } catch (error) {
    console.error('Weekly Sales Performance PDF error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 2. WEEKLY INVENTORY REORDER REPORT
// ============================================

// GET /api/reports/weekly/inventory-reorder
router.get('/inventory-reorder', authorize('reports', 'read'), async (req, res) => {
  try {
    const data = await WeeklyReportsService.getWeeklyInventoryReorder(req.companyId);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Weekly Inventory Reorder error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/reports/weekly/inventory-reorder/pdf
router.get('/inventory-reorder/pdf', authorize('reports', 'read'), async (req, res) => {
  try {
    const data = await WeeklyReportsService.getWeeklyInventoryReorder(req.companyId);
    const Company = require('../models/Company');
    const company = await Company.findById(req.companyId);
    
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="weekly-inventory-reorder-${new Date().toISOString().split('T')[0]}.pdf"`);
    doc.pipe(res);
    
    pdfRenderer.renderReportHeader(doc, {
      companyName: company?.name || 'Company',
      companyTin: company?.tin || 'N/A',
      reportTitle: 'Weekly Inventory Reorder Report',
      period: 'Current Week'
    });
    
    // Summary
    doc.fontSize(12).text(`Products Needing Reorder: ${data.summary.totalProducts}`, 50, doc.y + 20);
    doc.text(`Critical (Out of Stock): ${data.summary.criticalCount}`);
    doc.text(`Warning (Low Stock): ${data.summary.warningCount}`);
    
    // Critical Items
    if (data.critical.length > 0) {
      doc.fontSize(14).text('Critical - Out of Stock', 50, doc.y + 20);
      data.critical.forEach((item, i) => {
        doc.fontSize(10).text(`${i + 1}. ${item.name} (${item.sku})`, 60, doc.y + 10);
        doc.text(`   Reorder: ${item.suggestedOrder} ${item.unit} | Supplier: ${item.supplier}`);
      });
    }
    
    // Warning Items
    if (data.warning.length > 0) {
      doc.fontSize(14).text('Warning - Low Stock', 50, doc.y + 20);
      data.warning.forEach((item, i) => {
        doc.fontSize(10).text(`${i + 1}. ${item.name} (${item.sku})`, 60, doc.y + 10);
        doc.text(`   Current: ${item.currentStock} | Reorder Point: ${item.reorderPoint}`);
        doc.text(`   Suggested: ${item.suggestedOrder} ${item.unit}`);
      });
    }
    
    doc.end();
  } catch (error) {
    console.error('Weekly Inventory Reorder PDF error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 3. WEEKLY SUPPLIER PERFORMANCE
// ============================================

// GET /api/reports/weekly/supplier-performance?weekStart=2024-04-08
router.get('/supplier-performance', authorize('reports', 'read'), async (req, res) => {
  try {
    let { weekStart } = req.query;
    if (!weekStart) {
      weekStart = WeeklyReportsService.getDefaultWeek();
    }
    
    const data = await WeeklyReportsService.getWeeklySupplierPerformance(req.companyId, weekStart);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Weekly Supplier Performance error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 4. WEEKLY RECEIVABLES AGING
// ============================================

// GET /api/reports/weekly/receivables-aging
router.get('/receivables-aging', authorize('reports', 'read'), async (req, res) => {
  try {
    const data = await WeeklyReportsService.getWeeklyReceivablesAging(req.companyId);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Weekly Receivables Aging error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 5. WEEKLY PAYABLES AGING
// ============================================

// GET /api/reports/weekly/payables-aging
router.get('/payables-aging', authorize('reports', 'read'), async (req, res) => {
  try {
    const data = await WeeklyReportsService.getWeeklyPayablesAging(req.companyId);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Weekly Payables Aging error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 6. WEEKLY CASH FLOW SUMMARY
// ============================================

// GET /api/reports/weekly/cash-flow?weekStart=2024-04-08
router.get('/cash-flow', authorize('reports', 'read'), async (req, res) => {
  try {
    let { weekStart } = req.query;
    if (!weekStart) {
      weekStart = WeeklyReportsService.getDefaultWeek();
    }
    
    const data = await WeeklyReportsService.getWeeklyCashFlow(req.companyId, weekStart);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Weekly Cash Flow error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 7. WEEKLY PAYROLL PREVIEW
// ============================================

// GET /api/reports/weekly/payroll-preview
router.get('/payroll-preview', authorize('reports', 'read'), async (req, res) => {
  try {
    const data = await WeeklyReportsService.getWeeklyPayrollPreview(req.companyId);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Weekly Payroll Preview error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// EXCEL EXPORTS
// ============================================

// GET /api/reports/weekly/sales-performance/excel
router.get('/sales-performance/excel', authorize('reports', 'read'), async (req, res) => {
  try {
    let { weekStart } = req.query;
    if (!weekStart) {
      weekStart = WeeklyReportsService.getDefaultWeek();
    }
    
    const data = await WeeklyReportsService.getWeeklySalesPerformance(req.companyId, weekStart);
    
    const buffer = await ExcelFormatter.createMultiSheet({
      'This Week': {
        columns: [{ header: 'Metric', key: 'metric' }, { header: 'Value', key: 'value' }],
        data: [
          { metric: 'Sales', value: data.thisWeek.sales },
          { metric: 'Invoices', value: data.thisWeek.invoices },
          { metric: 'Orders', value: data.thisWeek.orders },
          { metric: 'Items', value: data.thisWeek.items }
        ]
      },
      'Last Week': {
        columns: [{ header: 'Metric', key: 'metric' }, { header: 'Value', key: 'value' }],
        data: [
          { metric: 'Sales', value: data.lastWeek.sales },
          { metric: 'Invoices', value: data.lastWeek.invoices },
          { metric: 'Orders', value: data.lastWeek.orders },
          { metric: 'Items', value: data.lastWeek.items }
        ]
      },
      'Changes': {
        columns: [{ header: 'Metric', key: 'metric' }, { header: 'Value', key: 'value' }],
        data: [
          { metric: 'Sales Change', value: `${data.changes.salesPercent.toFixed(1)}%` },
          { metric: 'Invoices Change', value: `${data.changes.invoicesPercent.toFixed(1)}%` },
          { metric: 'Orders Change', value: `${data.changes.ordersPercent.toFixed(1)}%` },
          { metric: 'Items Change', value: `${data.changes.itemsPercent.toFixed(1)}%` }
        ]
      }
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="weekly-sales-${weekStart}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('Weekly Sales Excel error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/reports/weekly/inventory-reorder/excel
router.get('/inventory-reorder/excel', authorize('reports', 'read'), async (req, res) => {
  try {
    const data = await WeeklyReportsService.getWeeklyInventoryReorder(req.companyId);
    const buffer = await ExcelFormatter.createMultiSheet({
      'Summary': {
        columns: [{ header: 'Metric', key: 'metric' }, { header: 'Value', key: 'value' }],
        data: [
          { metric: 'Total Products', value: data.summary.totalProducts },
          { metric: 'Critical (Out of Stock)', value: data.summary.criticalCount },
          { metric: 'Warning (Low Stock)', value: data.summary.warningCount }
        ]
      },
      'Critical Items': {
        columns: [
          { header: 'Product', key: 'product' },
          { header: 'SKU', key: 'sku' },
          { header: 'Stock', key: 'stock' },
          { header: 'Reorder Point', key: 'reorderPoint' },
          { header: 'Suggested Order', key: 'suggestedOrder' },
          { header: 'Unit', key: 'unit' },
          { header: 'Supplier', key: 'supplier' }
        ],
        data: data.critical.map(item => ({
          product: item.name,
          sku: item.sku,
          stock: item.currentStock,
          reorderPoint: item.reorderPoint,
          suggestedOrder: item.suggestedOrder,
          unit: item.unit,
          supplier: item.supplier
        }))
      },
      'Warning Items': {
        columns: [
          { header: 'Product', key: 'product' },
          { header: 'SKU', key: 'sku' },
          { header: 'Stock', key: 'stock' },
          { header: 'Reorder Point', key: 'reorderPoint' },
          { header: 'Suggested Order', key: 'suggestedOrder' },
          { header: 'Unit', key: 'unit' },
          { header: 'Supplier', key: 'supplier' }
        ],
        data: data.warning.map(item => ({
          product: item.name,
          sku: item.sku,
          stock: item.currentStock,
          reorderPoint: item.reorderPoint,
          suggestedOrder: item.suggestedOrder,
          unit: item.unit,
          supplier: item.supplier
        }))
      }
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="weekly-inventory-reorder-${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('Weekly Inventory Reorder Excel error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/reports/weekly/supplier-performance/excel
router.get('/supplier-performance/excel', authorize('reports', 'read'), async (req, res) => {
  try {
    let { weekStart } = req.query;
    if (!weekStart) {
      weekStart = WeeklyReportsService.getDefaultWeek();
    }
    const data = await WeeklyReportsService.getWeeklySupplierPerformance(req.companyId, weekStart);
    const buffer = await ExcelFormatter.createMultiSheet({
      'Summary': {
        columns: [{ header: 'Metric', key: 'metric' }, { header: 'Value', key: 'value' }],
        data: [
          { metric: 'POs Raised', value: data.summary.totalPosRaised },
          { metric: 'Deliveries Received', value: data.summary.totalDeliveries },
          { metric: 'Pending Orders', value: data.summary.totalPending },
          { metric: 'Overdue Deliveries', value: data.summary.totalOverdue }
        ]
      },
      'Suppliers': {
        columns: [
          { header: 'Supplier', key: 'supplier' },
          { header: 'POs Raised', key: 'posRaised' },
          { header: 'POs Value', key: 'posValue' },
          { header: 'Deliveries', key: 'deliveries' },
          { header: 'Pending', key: 'pending' },
          { header: 'Overdue', key: 'overdue' }
        ],
        data: data.suppliers.map(supplier => ({
          supplier: supplier.supplierName,
          posRaised: supplier.posRaised.count,
          posValue: supplier.posRaised.value,
          deliveries: supplier.deliveriesReceived.count,
          pending: supplier.pendingOrders.count,
          overdue: supplier.overdueDeliveries.count
        }))
      }
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="weekly-supplier-${weekStart}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('Weekly Supplier Performance Excel error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/reports/weekly/receivables-aging/excel
router.get('/receivables-aging/excel', authorize('reports', 'read'), async (req, res) => {
  try {
    const data = await WeeklyReportsService.getWeeklyReceivablesAging(req.companyId);
    const buffer = await ExcelFormatter.createMultiSheet({
      'Summary': {
        columns: [{ header: 'Age Bucket', key: 'ageBucket' }, { header: 'Total Amount', key: 'totalAmount' }],
        data: [
          { ageBucket: '0-7 Days', totalAmount: data.summary.bucketTotals['0-7'] },
          { ageBucket: '8-14 Days', totalAmount: data.summary.bucketTotals['8-14'] },
          { ageBucket: '15-21 Days', totalAmount: data.summary.bucketTotals['15-21'] },
          { ageBucket: 'Over 21 Days', totalAmount: data.summary.bucketTotals['over21'] }
        ]
      },
      'Invoices 0-7 Days': {
        columns: [
          { header: 'Invoice', key: 'invoice' },
          { header: 'Customer', key: 'customer' },
          { header: 'Amount', key: 'amount' },
          { header: 'Days Overdue', key: 'daysOverdue' }
        ],
        data: data.buckets['0-7'].invoices.map(inv => ({
          invoice: inv.invoiceNumber,
          customer: inv.clientName,
          amount: inv.balance,
          daysOverdue: inv.daysOverdue
        }))
      },
      'Invoices 8-14 Days': {
        columns: [
          { header: 'Invoice', key: 'invoice' },
          { header: 'Customer', key: 'customer' },
          { header: 'Amount', key: 'amount' },
          { header: 'Days Overdue', key: 'daysOverdue' }
        ],
        data: data.buckets['8-14'].invoices.map(inv => ({
          invoice: inv.invoiceNumber,
          customer: inv.clientName,
          amount: inv.balance,
          daysOverdue: inv.daysOverdue
        }))
      },
      'Invoices 15-21 Days': {
        columns: [
          { header: 'Invoice', key: 'invoice' },
          { header: 'Customer', key: 'customer' },
          { header: 'Amount', key: 'amount' },
          { header: 'Days Overdue', key: 'daysOverdue' }
        ],
        data: data.buckets['15-21'].invoices.map(inv => ({
          invoice: inv.invoiceNumber,
          customer: inv.clientName,
          amount: inv.balance,
          daysOverdue: inv.daysOverdue
        }))
      },
      'Invoices Over 21 Days': {
        columns: [
          { header: 'Invoice', key: 'invoice' },
          { header: 'Customer', key: 'customer' },
          { header: 'Amount', key: 'amount' },
          { header: 'Days Overdue', key: 'daysOverdue' }
        ],
        data: data.buckets['over21'].invoices.map(inv => ({
          invoice: inv.invoiceNumber,
          customer: inv.clientName,
          amount: inv.balance,
          daysOverdue: inv.daysOverdue
        }))
      }
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="weekly-receivables-aging-${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('Weekly Receivables Aging Excel error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/reports/weekly/payables-aging/excel
router.get('/payables-aging/excel', authorize('reports', 'read'), async (req, res) => {
  try {
    const data = await WeeklyReportsService.getWeeklyPayablesAging(req.companyId);
    const buffer = await ExcelFormatter.createMultiSheet({
      'Summary': {
        columns: [{ header: 'Age Bucket', key: 'ageBucket' }, { header: 'Total Amount', key: 'totalAmount' }],
        data: [
          { ageBucket: '0-7 Days', totalAmount: data.summary.bucketTotals['0-7'] },
          { ageBucket: '8-14 Days', totalAmount: data.summary.bucketTotals['8-14'] },
          { ageBucket: '15-21 Days', totalAmount: data.summary.bucketTotals['15-21'] },
          { ageBucket: 'Over 21 Days', totalAmount: data.summary.bucketTotals['over21'] }
        ]
      },
      'Bills 0-7 Days': {
        columns: [
          { header: 'Bill', key: 'bill' },
          { header: 'Supplier', key: 'supplier' },
          { header: 'Amount', key: 'amount' },
          { header: 'Days Overdue', key: 'daysOverdue' }
        ],
        data: data.buckets['0-7'].purchases.map(p => ({
          bill: p.purchaseNumber,
          supplier: p.supplierName,
          amount: p.balance,
          daysOverdue: p.daysOverdue
        }))
      },
      'Bills 8-14 Days': {
        columns: [
          { header: 'Bill', key: 'bill' },
          { header: 'Supplier', key: 'supplier' },
          { header: 'Amount', key: 'amount' },
          { header: 'Days Overdue', key: 'daysOverdue' }
        ],
        data: data.buckets['8-14'].purchases.map(p => ({
          bill: p.purchaseNumber,
          supplier: p.supplierName,
          amount: p.balance,
          daysOverdue: p.daysOverdue
        }))
      },
      'Bills 15-21 Days': {
        columns: [
          { header: 'Bill', key: 'bill' },
          { header: 'Supplier', key: 'supplier' },
          { header: 'Amount', key: 'amount' },
          { header: 'Days Overdue', key: 'daysOverdue' }
        ],
        data: data.buckets['15-21'].purchases.map(p => ({
          bill: p.purchaseNumber,
          supplier: p.supplierName,
          amount: p.balance,
          daysOverdue: p.daysOverdue
        }))
      },
      'Bills Over 21 Days': {
        columns: [
          { header: 'Bill', key: 'bill' },
          { header: 'Supplier', key: 'supplier' },
          { header: 'Amount', key: 'amount' },
          { header: 'Days Overdue', key: 'daysOverdue' }
        ],
        data: data.buckets['over21'].purchases.map(p => ({
          bill: p.purchaseNumber,
          supplier: p.supplierName,
          amount: p.balance,
          daysOverdue: p.daysOverdue
        }))
      }
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="weekly-payables-aging-${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('Weekly Payables Aging Excel error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/reports/weekly/cash-flow/excel
router.get('/cash-flow/excel', authorize('reports', 'read'), async (req, res) => {
  try {
    let { weekStart } = req.query;
    if (!weekStart) {
      weekStart = WeeklyReportsService.getDefaultWeek();
    }
    const data = await WeeklyReportsService.getWeeklyCashFlow(req.companyId, weekStart);
    const buffer = await ExcelFormatter.createMultiSheet({
      'Summary': {
        columns: [{ header: 'Metric', key: 'metric' }, { header: 'Value', key: 'value' }],
        data: [
          { metric: 'Week Total In', value: data.summary.weekTotalIn },
          { metric: 'Week Total Out', value: data.summary.weekTotalOut },
          { metric: 'Net Flow', value: data.summary.weekNetFlow }
        ]
      },
      'Daily Flow': {
        columns: [
          { header: 'Day', key: 'day' },
          { header: 'Date', key: 'date' },
          { header: 'Cash In', key: 'cashIn' },
          { header: 'Cash Out', key: 'cashOut' },
          { header: 'Net Flow', key: 'netFlow' }
        ],
        data: data.summary.dailyFlow.map(day => ({
          day: day.dayName,
          date: day.date,
          cashIn: day.cashIn,
          cashOut: day.cashOut,
          netFlow: day.netFlow
        }))
      }
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="weekly-cashflow-${weekStart}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('Weekly Cash Flow Excel error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/reports/weekly/payroll-preview/excel
router.get('/payroll-preview/excel', authorize('reports', 'read'), async (req, res) => {
  try {
    const data = await WeeklyReportsService.getWeeklyPayrollPreview(req.companyId);
    let rows = [];
    if (data.payrollInProgress && data.employees) {
      rows = data.employees.map(emp => ({
        Employee: emp.name,
        EmployeeNumber: emp.employeeNumber,
        Department: emp.department,
        GrossPay: emp.grossPay,
        PAYE: emp.paye,
        RSSBEmployee: emp.rssbEmployee,
        RSSBEmployer: emp.rssbEmployer,
        TotalDeductions: emp.totalDeductions,
        NetPay: emp.netPay
      }));
    }
    const buffer = await ExcelFormatter.createMultiSheet({
      'Summary': {
        columns: [{ header: 'Metric', key: 'metric' }, { header: 'Value', key: 'value' }],
        data: data.payrollInProgress ? [
          { metric: 'Employee Count', value: data.summary.employeeCount },
          { metric: 'Gross Pay', value: data.summary.grossPay },
          { metric: 'PAYE', value: data.summary.paye },
          { metric: 'RSSB Employee (3%)', value: data.summary.rssbEmployee },
          { metric: 'RSSB Employer (5%)', value: data.summary.rssbEmployer },
          { metric: 'Total Deductions', value: data.summary.totalDeductions },
          { metric: 'Net Pay', value: data.summary.netPay }
        ] : [{ metric: 'Message', value: data.message || 'No payroll in progress' }]
      },
      'Employees': {
        columns: [
          { header: 'Employee', key: 'employee' },
          { header: 'Employee Number', key: 'employeeNumber' },
          { header: 'Department', key: 'department' },
          { header: 'Gross Pay', key: 'grossPay' },
          { header: 'PAYE', key: 'paye' },
          { header: 'RSSB Employee', key: 'rssbEmployee' },
          { header: 'RSSB Employer', key: 'rssbEmployer' },
          { header: 'Total Deductions', key: 'totalDeductions' },
          { header: 'Net Pay', key: 'netPay' }
        ],
        data: rows
      }
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="weekly-payroll-${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('Weekly Payroll Preview Excel error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
