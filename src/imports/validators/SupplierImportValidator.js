/**
 * SupplierImportValidator - Validates supplier import data
 * Worker Layer: Field-level validation for supplier CSV imports
 * 
 * Expected CSV columns:
 * - name (required)
 * - email (optional, valid format, unique)
 * - phone (optional)
 * - address (optional)
 * - city (optional)
 * - country (optional)
 * - payment_terms_days (optional, positive integer)
 * - bank_account_name (optional)
 * - bank_account_number (optional)
 * - bank_name (optional)
 * 
 * If bank_account_number provided, bank_name must also be provided
 */

const Supplier = require('../../../models/Supplier');

class SupplierImportValidator {
  static COLUMN_MAPPING = {
    'name': 'name',
    'supplier_name': 'name',
    'vendor': 'name',
    'email': 'email',
    'email_address': 'email',
    'phone': 'phone',
    'telephone': 'phone',
    'mobile': 'phone',
    'address': 'address',
    'street': 'address',
    'city': 'city',
    'town': 'city',
    'state': 'state',
    'province': 'state',
    'country': 'country',
    'payment_terms_days': 'paymentTermsDays',
    'payment_terms': 'paymentTermsDays',
    'payment_days': 'paymentTermsDays',
    'bank_account_name': 'bankAccountName',
    'bank_name': 'bankAccountName',
    'bank_account_number': 'bankAccountNumber',
    'account_number': 'bankAccountNumber',
    'bank': 'bankName',
    'bank_code': 'bankName'
  };

  static REQUIRED = ['name'];

  /**
   * Validate a single supplier record
   * @param {Object} record - Raw CSV record
   * @param {number} rowNum - Row number
   * @param {string} companyId - Company ID
   * @returns {Object} Validation result
   */
  static async validate(record, rowNum, companyId) {
    const errors = [];
    const normalized = this.normalize(record);

    // 1. Check name is present
    if (!normalized.name || normalized.name.trim() === '') {
      errors.push({
        row: rowNum,
        field: 'name',
        message: 'Supplier name is required',
        value: record.name
      });
    }

    // 2. Validate email format if provided
    if (normalized.email && normalized.email.trim() !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(normalized.email)) {
        errors.push({
          row: rowNum,
          field: 'email',
          message: 'Invalid email format',
          value: record.email
        });
      } else {
        // Check uniqueness
        const existing = await Supplier.findOne({
          company: companyId,
          'contact.email': normalized.email.toLowerCase().trim()
        }).lean();

        if (existing) {
          errors.push({
            row: rowNum,
            field: 'email',
            message: 'Email already exists for this company',
            value: record.email
          });
        }
      }
    }

    // 3. Validate payment_terms_days
    if (normalized.paymentTermsDays !== undefined && normalized.paymentTermsDays !== '') {
      const days = parseInt(normalized.paymentTermsDays);
      if (isNaN(days) || days < 0) {
        errors.push({
          row: rowNum,
          field: 'payment_terms_days',
          message: 'Payment terms days must be a positive integer',
          value: record.payment_terms_days
        });
      } else {
        normalized.paymentTermsDays = days;
      }
    }

    // 4. If bank_account_number provided, bank_name must also be provided
    if (normalized.bankAccountNumber && normalized.bankAccountNumber.trim() !== '') {
      if (!normalized.bankName || normalized.bankName.trim() === '') {
        errors.push({
          row: rowNum,
          field: 'bank_name',
          message: 'Bank name is required when bank account number is provided',
          value: record.bank_name
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      data: normalized
    };
  }

  static normalize(record) {
    const normalized = {};
    for (const [key, value] of Object.entries(record)) {
      const normalizedKey = this.COLUMN_MAPPING[key.toLowerCase().trim()] || key;
      normalized[normalizedKey] = value;
    }
    return normalized;
  }

  static validateHeaders(headers) {
    const normalizedHeaders = headers.map(h => h.toLowerCase().trim());
    const hasRequired = this.REQUIRED.every(req => 
      normalizedHeaders.includes(req)
    );

    return {
      valid: hasRequired,
      message: hasRequired ? 'Valid' : `Missing required columns: ${this.REQUIRED.join(', ')}`,
      columns: normalizedHeaders
    };
  }
}

module.exports = SupplierImportValidator;