/**
 * ClientImportProcessor - Processes client imports
 * Worker Layer: Creates clients in database via service layer
 * Uses Client.create() to ensure all business rules apply
 */

const Client = require('../../../models/Client');

class ClientImportProcessor {
  /**
   * Process client import
   * @param {Array} records - Validated client records
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
        // Build client data
        const clientData = {
          name: record.name ? record.name.trim() : null,
          code: record.code ? record.code.trim() : undefined,
          type: record.type || 'individual',
          contact: {
            phone: record.phone || '',
            email: record.email ? record.email.toLowerCase().trim() : '',
            address: record.address || '',
            city: record.city || '',
            state: record.state || '',
            country: record.country || ''
          },
          paymentTerms: record.paymentTermsDays ? `net${record.paymentTermsDays}` : 'cash',
          isActive: true,
          company: companyId
        };

        // Create via model (ensures hooks run)
        await Client.create(clientData);
        created++;

      } catch (err) {
        errors.push({
          row: records.indexOf(record) + 1,
          field: 'client',
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

module.exports = ClientImportProcessor;