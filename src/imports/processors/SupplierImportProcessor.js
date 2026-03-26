/**
 * SupplierImportProcessor - Processes supplier imports
 * Worker Layer: Creates suppliers in database via service layer
 */

const Supplier = require('../../../models/Supplier');

class SupplierImportProcessor {
  /**
   * Process supplier import
   * @param {Array} records - Validated supplier records
   * @param {string} companyId - Company ID
   * @param {Object} options - Processing options
   * @returns {Object} Import result
   */
  static async process(records, companyId, options = {}) {
    let created = 0;
    let skipped = 0;
    const errors = [];

    for (const record of records) {
      try {
        const supplierData = {
          name: record.name ? record.name.trim() : null,
          code: record.code ? record.code.trim() : undefined,
          type: record.type || 'local',
          contact: {
            phone: record.phone || '',
            email: record.email ? record.email.toLowerCase().trim() : '',
            address: record.address || '',
            city: record.city || '',
            state: record.state || '',
            country: record.country || ''
          },
          bankDetails: record.bankAccountNumber ? {
            accountName: record.bankAccountName || '',
            accountNumber: record.bankAccountNumber,
            bankName: record.bankName || ''
          } : undefined,
          paymentTerms: record.paymentTermsDays ? `net${record.paymentTermsDays}` : 'net30',
          isActive: true,
          company: companyId
        };

        await Supplier.create(supplierData);
        created++;

      } catch (err) {
        errors.push({
          row: records.indexOf(record) + 1,
          field: 'supplier',
          message: err.message,
          value: record.name
        });
      }
    }

    return {
      created,
      updated: 0,
      skipped,
      errors
    };
  }
}

module.exports = SupplierImportProcessor;