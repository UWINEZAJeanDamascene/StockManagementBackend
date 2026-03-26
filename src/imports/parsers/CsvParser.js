/**
 * CsvParser - Shared CSV reader used by all imports
 * Worker Layer: Parses CSV files with BOM handling, whitespace trimming, and empty row filtering
 * 
 * Features:
 * - Detect and handle BOM characters (common in Excel-exported CSVs)
 * - Trim whitespace from all field names and values
 * - Skip completely empty rows
 * - Return both parsed rows and detected headers
 * - Support configurable delimiter (comma vs semicolon)
 */

const { parse } = require('csv-parse/sync');
const { createReadStream } = require('fs');

class CsvParser {
  /**
   * Parse CSV buffer with full feature support
   * @param {Buffer} buffer - CSV file buffer
   * @param {Object} options - Parser options
   * @returns {Object} Parsed result with rows and headers
   */
  static parse(buffer, options = {}) {
    const {
      delimiter = ',',
      skipEmptyRows = true,
      trimFields = true
    } = options;

    // Detect and handle BOM (Byte Order Mark)
    let csvString = buffer.toString('utf-8');
    
    // Check for UTF-8 BOM (EF BB BF) or UTF-16 BOMs
    if (csvString.charCodeAt(0) === 0xFEFF) {
      csvString = csvString.substring(1);
    } else if (csvString.charCodeAt(0) === 0xFFFE) {
      // UTF-16 LE - convert or skip
      csvString = csvString.substring(1);
    }

    // Parse CSV
    const records = parse(csvString, {
      columns: true,
      skip_empty_lines: skipEmptyRows,
      trim: trimFields,
      delimiter,
      relax_column_count: true,
      relax: true
    });

    // Extract headers from first record if available
    const headers = records.length > 0 ? Object.keys(records[0]) : [];

    return {
      rows: records,
      headers,
      count: records.length
    };
  }

  /**
   * Parse CSV file from file path (streaming - for large files)
   * @param {string} filePath - Path to CSV file
   * @param {Object} options - Parser options
   * @returns {AsyncGenerator} Row generator
   */
  static async *parseFileStream(filePath, options = {}) {
    const {
      delimiter = ',',
      skipEmptyRows = true,
      trimFields = true
    } = options;

    const parser = createReadStream(filePath).pipe(
      parse({
        columns: true,
        skip_empty_lines: skipEmptyRows,
        trim: trimFields,
        delimiter,
        relax_column_count: true,
        relax: true
      })
    );

    for await (const record of parser) {
      yield record;
    }
  }

  /**
   * Parse CSV from buffer/string (synchronous)
   * @param {Buffer|string} data - CSV data
   * @param {Object} options - Parser options
   * @returns {Promise<Array>} Parsed records
   */
  static async parseBuffer(data, options = {}) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const result = this.parse(buffer, options);
    return result.rows;
  }

  /**
   * Parse CSV from uploaded file (multer)
   * @param {Object} file - Multer file object
   * @param {Object} options - Parser options
   * @returns {Promise<Object>} Parsed result with rows and headers
   */
  static parseMulterFile(file, options = {}) {
    const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer);
    return this.parse(buffer, options);
  }

  /**
   * Validate required columns in CSV header
   * @param {Array} headers - CSV headers
   * @param {Array} required - Required column names
   * @returns {Object} Validation result
   */
  static validateHeaders(headers, required) {
    const normalizedHeaders = headers.map(h => h.toLowerCase().trim());
    const missing = required.filter(col => 
      !normalizedHeaders.some(h => h === col.toLowerCase())
    );
    return {
      valid: missing.length === 0,
      missing,
      headers: normalizedHeaders
    };
  }

  /**
   * Transform column names to expected format
   * @param {Object} record - Raw CSV record
   * @param {Object} mapping - Column name mapping
   * @returns {Object} Mapped record
   */
  static mapColumns(record, mapping) {
    const mapped = {};
    for (const [key, value] of Object.entries(record)) {
      const normalizedKey = key.toLowerCase().trim();
      const mappedKey = mapping[normalizedKey] || key;
      mapped[mappedKey] = typeof value === 'string' ? value.trim() : value;
    }
    return mapped;
  }

  /**
   * Detect delimiter from sample content
   * @param {string} sample - Sample CSV content
   * @returns {string} Detected delimiter
   */
  static detectDelimiter(sample) {
    const firstLine = sample.split('\n')[0];
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    const tabCount = (firstLine.match(/\t/g) || []).length;

    if (tabCount > commaCount && tabCount > semicolonCount) return '\t';
    if (semicolonCount > commaCount) return ';';
    return ',';
  }
}

module.exports = CsvParser;