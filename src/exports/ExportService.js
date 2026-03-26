/**
 * ExportService - Orchestrates all export operations
 * Service Layer: Orchestrates export flow
 */

const ExcelFormatter = require('./formatters/ExcelFormatter');
const CsvFormatter = require('./formatters/CsvFormatter');
const ProductExportBuilder = require('./builders/ProductExportBuilder');
const InvoiceExportBuilder = require('./builders/InvoiceExportBuilder');
const JournalExportBuilder = require('./builders/JournalExportBuilder');
const ReportExportBuilder = require('./builders/ReportExportBuilder');

const BUILDERS = {
  'products': ProductExportBuilder,
  'invoices': InvoiceExportBuilder,
  'clients': null, // Use Client model directly
  'suppliers': null, // Use Supplier model directly
  'journal': JournalExportBuilder,
  'trial-balance': ReportExportBuilder,
  'profit-loss': ReportExportBuilder,
  'balance-sheet': ReportExportBuilder,
  'cash-flow': ReportExportBuilder
};

class ExportService {
  /**
   * Export data to specified format
   * @param {string} type - Export type
   * @param {string} companyId - Company ID
   * @param {Object} options - Export options
   * @returns {Object} Export result with buffer and metadata
   */
  static async export(type, companyId, options = {}) {
    const { 
      format = 'csv',  // csv, excel
      ...queryOptions 
    } = options;

    // Get builder for this export type
    const Builder = BUILDERS[type];
    if (!Builder) {
      throw new Error(`Unknown export type: ${type}`);
    }

    // Build data (async for reports, sync for simple exports)
    let data, columns;
    
    if (type === 'trial-balance' || type === 'profit-loss' || 
        type === 'balance-sheet' || type === 'cash-flow') {
      // Financial reports use ReportExportBuilder
      const result = await ReportExportBuilder.build(companyId, type, queryOptions);
      data = result.data;
      columns = result.columns;
    } else {
      // Regular exports
      data = await Builder.build(companyId, queryOptions);
      columns = Builder.getColumns();
    }

    // Format output
    let output, contentType, filename;
    
    if (format === 'excel') {
      output = await ExcelFormatter.format(data, { 
        sheetName: this.getSheetName(type),
        columns 
      });
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      filename = `${type}_${Date.now()}.xlsx`;
    } else {
      output = CsvFormatter.format(data, { columns });
      contentType = 'text/csv';
      filename = `${type}_${Date.now()}.csv`;
    }

    return {
      buffer: output,
      contentType,
      filename,
      recordCount: data.length,
      type,
      format
    };
  }

  /**
   * Export multiple types as ZIP
   * @param {Array} types - Export types to include
   * @param {string} companyId - Company ID
   * @param {Object} options - Export options
   * @returns {Object} Export result with ZIP buffer
   */
  static async exportMultiple(types, companyId, options = {}) {
    const archiver = require('archiver');
    
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    // Collect all exports
    const exports = [];
    for (const type of types) {
      const exp = await this.export(type, companyId, options);
      exports.push(exp);
      archive.append(exp.buffer, { name: exp.filename });
    }

    const finalBuffer = await archive.finalize();
    
    return {
      buffer: finalBuffer,
      contentType: 'application/zip',
      filename: `export_bundle_${Date.now()}.zip`,
      exports: exports.map(e => ({ type: e.type, filename: e.filename, records: e.recordCount }))
    };
  }

  /**
   * Get sheet name for Excel export
   * @param {string} type - Export type
   * @returns {string} Sheet name
   */
  static getSheetName(type) {
    const names = {
      'products': 'Products',
      'invoices': 'Invoices',
      'clients': 'Clients',
      'suppliers': 'Suppliers',
      'journal': 'Journal Entries',
      'trial-balance': 'Trial Balance',
      'profit-loss': 'Profit & Loss',
      'balance-sheet': 'Balance Sheet',
      'cash-flow': 'Cash Flow'
    };
    return names[type] || 'Data';
  }

  /**
   * Get available export types
   * @returns {Array} Available export types
   */
  static getAvailableTypes() {
    return [
      { type: 'products', name: 'Products', supports: ['csv', 'excel'] },
      { type: 'invoices', name: 'Invoices', supports: ['csv', 'excel'] },
      { type: 'clients', name: 'Clients', supports: ['csv', 'excel'] },
      { type: 'suppliers', name: 'Suppliers', supports: ['csv', 'excel'] },
      { type: 'journal', name: 'Journal Entries', supports: ['csv', 'excel'], description: 'Accounting export' },
      { type: 'trial-balance', name: 'Trial Balance', supports: ['csv', 'excel'] },
      { type: 'profit-loss', name: 'Profit & Loss', supports: ['csv', 'excel'] },
      { type: 'balance-sheet', name: 'Balance Sheet', supports: ['csv', 'excel'] },
      { type: 'cash-flow', name: 'Cash Flow Statement', supports: ['csv', 'excel'] }
    ];
  }
}

module.exports = ExportService;