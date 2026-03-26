/**
 * CsvFormatter - Converts data to CSV format using csv-stringify
 * Worker Layer: Formats data for CSV export
 * 
 * Features:
 * - UTF-8 BOM prepended (\uFEFF) for Excel compatibility
 * - Configurable delimiter (default: comma)
 * - Streaming support for large datasets
 */

const { stringify } = require('csv-stringify/sync');

// UTF-8 BOM for Excel compatibility
const UTF8_BOM = '\uFEFF';

class CsvFormatter {
  /**
   * Convert data to CSV string
   * @param {Array} data - Data to export
   * @param {Object} options - Formatting options
   * @returns {string} CSV string with BOM
   */
  static format(data, options = {}) {
    const {
      header = true,
      columns = null,
      delimiter = ',',
      includeBom = true
    } = options;

    if (!data || data.length === 0) {
      return includeBom ? UTF8_BOM : '';
    }

    // Build columns from data keys if not provided
    let columnDefs = columns;
    if (!columnDefs) {
      const firstRow = data[0];
      columnDefs = Object.keys(firstRow).map(key => ({
        key,
        name: key
      }));
    }

    // Map data to column keys
    const mappedData = data.map(row => {
      const mapped = {};
      columnDefs.forEach(col => {
        mapped[col.key] = this.formatCellValue(row[col.key]);
      });
      return mapped;
    });

    // Convert to CSV
    const csv = stringify(mappedData, {
      header,
      columns: columnDefs.map(col => col.key),
      delimiter
    });

    // Prepend BOM for Excel compatibility
    return includeBom ? UTF8_BOM + csv : csv;
  }

  /**
   * Format cell value for CSV
   * @param {*} value - Cell value
   * @returns {string} Formatted value
   */
  static formatCellValue(value) {
    if (value === null || value === undefined) return '';
    
    if (value instanceof Date) {
      return value.toISOString().split('T')[0];
    }

    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    if (typeof value === 'number') {
      return value.toString();
    }

    // Handle objects (like nested contact info)
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    // Escape quotes and wrap in quotes if contains special chars
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }

    return str;
  }

  /**
   * Stream CSV to response (for large datasets)
   * @param {Object} res - Express response object
   * @param {AsyncIterator} dataStream - Async generator of data rows
   * @param {Array} columns - Column definitions
   */
  static async streamToResponse(res, dataStream, columns) {
    // Set headers with BOM
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    
    // Write BOM first
    res.write(UTF8_BOM);

    // Write header
    const headerRow = columns.map(col => col.name || col.key).join(',');
    res.write(headerRow + '\n');

    // Stream data rows
    for await (const row of dataStream) {
      const rowData = columns.map(col => this.formatCellValue(row[col.key]));
      res.write(rowData.join(',') + '\n');
    }

    res.end();
  }

  /**
   * Generate multiple CSV files for ZIP bundle
   * @param {Object} sheets - Object with sheet name -> data mapping
   * @returns {Object} Object with filename -> CSV content
   */
  static formatMultiple(sheets) {
    const result = {};
    
    for (const [sheetName, sheetData] of Object.entries(sheets)) {
      const columns = sheetData.columns || null;
      const data = sheetData.data || [];
      result[`${sheetName}.csv`] = this.format(data, { columns, includeBom: true });
    }
    
    return result;
  }
}

module.exports = CsvFormatter;