/**
 * ExcelFormatter - Converts data to Excel format using exceljs
 * Worker Layer: Formats data for Excel export
 */

const ExcelJS = require('exceljs');

class ExcelFormatter {
  /**
   * Create Excel workbook with data
   * @param {Array} data - Data to export
   * @param {Object} options - Formatting options
   * @returns {Promise<Buffer>} Excel file buffer
   */
  static async format(data, options = {}) {
    const {
      sheetName = 'Data',
      title = '',
      columns = [],
      styles = {}
    } = options;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Stock Management System';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet(sheetName);

    // Add title if provided
    if (title) {
      worksheet.mergeCells(1, 1, 1, columns.length || 4);
      worksheet.getRow(1).getCell(1).value = title;
      worksheet.getRow(1).getCell(1).font = { 
        bold: true, 
        size: 14 
      };
    }

    // Add columns
    if (columns.length > 0) {
      worksheet.columns = columns.map(col => ({
        header: col.header,
        key: col.key,
        width: col.width || 15
      }));

      // Style header row
      worksheet.getRow(title ? 2 : 1).font = { bold: true };
      worksheet.getRow(title ? 2 : 1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };
    }

    // Add data rows
    if (data.length > 0) {
      data.forEach((row, index) => {
        const rowData = {};
        if (columns.length > 0) {
          columns.forEach(col => {
            rowData[col.key] = this.formatCellValue(row[col.key], col.type);
          });
        } else {
          // Auto-map keys
          Object.keys(row).forEach(key => {
            rowData[key] = this.formatCellValue(row[key], undefined);
          });
        }
        worksheet.addRow(rowData);
      });
    }

    // Apply auto-filter
    if (data.length > 0) {
      worksheet.autoFilter = {
        from: title ? 'A2' : 'A1',
        to: title ? `A${data.length + 1}` : `A${data.length}`
      };
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Format cell value based on type
   * @param {*} value - Cell value
   * @param {string} type - Value type
   * @returns {*} Formatted value
   */
  static formatCellValue(value, type) {
    if (value === null || value === undefined) return '';
    
    switch (type) {
      case 'currency':
        return parseFloat(value) || 0;
      case 'number':
        return parseFloat(value) || 0;
      case 'date':
        if (value instanceof Date) return value;
        if (typeof value === 'string') return new Date(value);
        return value;
      case 'boolean':
        return value === true || value === 'true';
      default:
        return value;
    }
  }

  /**
   * Create multi-sheet Excel workbook
   * @param {Object} sheets - Object with sheet name -> data mapping
   * @param {Object} options - Global options
   * @returns {Promise<Buffer>} Excel file buffer
   */
  static async createMultiSheet(sheets, options = {}) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Stock Management System';
    workbook.created = new Date();

    for (const [sheetName, sheetData] of Object.entries(sheets)) {
      const worksheet = workbook.addWorksheet(sheetName);
      
      if (!sheetData.columns || !sheetData.data) continue;

      worksheet.columns = sheetData.columns.map(col => ({
        header: col.header,
        key: col.key,
        width: col.width || 15
      }));

      // Header style
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      // Data rows
      sheetData.data.forEach(row => {
        const rowData = {};
        sheetData.columns.forEach(col => {
          rowData[col.key] = this.formatCellValue(row[col.key], col.type);
        });
        worksheet.addRow(rowData);
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}

module.exports = ExcelFormatter;