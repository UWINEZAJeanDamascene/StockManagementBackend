/**
 * InvoiceExportBuilder - Builds invoice export data
 * Worker Layer: Transforms invoice data for export
 */

const Invoice = require('../../../models/Invoice');

class InvoiceExportBuilder {
  /**
   * Get invoices for export
   * @param {string} companyId - Company ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Invoice data
   */
  static async build(companyId, options = {}) {
    const { 
      startDate = null,
      endDate = null,
      status = null,
      clientId = null 
    } = options;

    const query = { company: companyId };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    if (status) {
      query.status = status;
    }

    if (clientId) {
      query.client = clientId;
    }

    const invoices = await Invoice.find(query)
      .populate('client', 'name code')
      .populate('lines.product', 'name sku')
      .lean();

    return this.transform(invoices);
  }

  /**
   * Transform invoice data for export
   * @param {Array} invoices - Raw invoice data
   * @returns {Array} Transformed data
   */
  static transform(invoices) {
    return invoices.map(inv => ({
      invoiceNumber: inv.invoiceNumber,
      date: inv.date,
      dueDate: inv.dueDate,
      clientName: inv.client?.name || '',
      clientCode: inv.client?.code || '',
      status: inv.status,
      subtotal: inv.subtotal,
      taxAmount: inv.taxAmount || 0,
      discount: inv.discount || 0,
      total: inv.total,
      paid: inv.paid || 0,
      balance: inv.balance || inv.total,
      notes: inv.notes || '',
      lines: inv.lines?.length || 0,
      createdAt: inv.createdAt
    }));
  }

  /**
   * Get column definitions for export
   * @returns {Array} Column definitions
   */
  static getColumns() {
    return [
      { key: 'invoiceNumber', name: 'Invoice #', width: 12 },
      { key: 'date', name: 'Date', type: 'date', width: 12 },
      { key: 'dueDate', name: 'Due Date', type: 'date', width: 12 },
      { key: 'clientName', name: 'Client', width: 20 },
      { key: 'status', name: 'Status', width: 10 },
      { key: 'subtotal', name: 'Subtotal', type: 'currency', width: 12 },
      { key: 'taxAmount', name: 'Tax', type: 'currency', width: 10 },
      { key: 'discount', name: 'Discount', type: 'currency', width: 10 },
      { key: 'total', name: 'Total', type: 'currency', width: 12 },
      { key: 'paid', name: 'Paid', type: 'currency', width: 12 },
      { key: 'balance', name: 'Balance', type: 'currency', width: 12 }
    ];
  }
}

module.exports = InvoiceExportBuilder;