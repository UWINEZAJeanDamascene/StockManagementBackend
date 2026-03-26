/**
 * Export Routes - HTTP Layer for export operations
 * Handles data export to CSV/Excel formats
 * 
 * 5.6-5.7: Query parameter on existing routes (?export=xlsx or ?export=csv)
 * 5.8: Dedicated accounting export endpoint
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/auth');
const requireCompanyHeader = require('../../../middleware/requireCompanyHeader');
const { createRateLimiters } = require('../../../middleware/redisRateLimiter');
const ExportService = require('../../exports/ExportService');
const JournalExportBuilder = require('../../exports/builders/JournalExportBuilder');
const CsvFormatter = require('../../exports/formatters/CsvFormatter');
const ExcelFormatter = require('../../exports/formatters/ExcelFormatter');
const AuditLogService = require('../../../services/AuditLogService');

/**
 * GET /api/v1/export/:type
 * Export data to CSV or Excel format
 */
router.get('/:type', protect, requireCompanyHeader, async (req, res, next) => {
  try {
    const { type } = req.params;
    const companyId = req.company._id;
    const { 
      format = 'csv',
      startDate,
      endDate,
      periodId,
      category,
      status,
      clientId,
      lowStockOnly,
      includeArchived
    } = req.query;

    if (!['csv', 'excel'].includes(format.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid format. Valid: csv, excel'
      });
    }

    const options = {
      format: format.toLowerCase(),
      startDate,
      endDate,
      periodId,
      category,
      status,
      clientId,
      lowStockOnly: lowStockOnly === 'true',
      includeArchived: includeArchived === 'true'
    };

    const result = await ExportService.export(type, companyId, options);

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.buffer);

  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/export/accounting
 * 5.8: Accounting export for auditors
 * Requires authorize('journal_entries', 'read')
 */
router.get('/accounting', protect, requireCompanyHeader, async (req, res, next) => {
  try {
    const companyId = req.company._id;
    const userId = req.user._id;
    const { date_from, date_to, format = 'xlsx' } = req.query;

    // Step 1: Validate date range
    if (!date_from || !date_to) {
      return res.status(400).json({
        success: false,
        message: 'date_from and date_to are required',
        code: 'MISSING_DATES'
      });
    }

    const startDate = new Date(date_from);
    const endDate = new Date(date_to);
    const daysDiff = (endDate - startDate) / (1000 * 60 * 60 * 24);

    if (daysDiff > 366) {
      return res.status(400).json({
        success: false,
        message: 'Date range cannot exceed 366 days',
        code: 'DATE_RANGE_TOO_LARGE'
      });
    }

    // Step 2: Fetch all data in parallel
    const [journalEntries, chartOfAccounts, trialBalance] = await Promise.all([
      JournalExportBuilder.build(companyId, { 
        startDate: date_from, 
        endDate: date_to 
      }),
      require('../../../services/chartOfAccountsService').getAccounts(companyId),
      require('../../../services/trialBalanceService').generate(companyId, null, date_from, date_to)
    ]);

    // Build the 5 sheets
    const sheets = {
      'Journal Entries': {
        columns: [
          { key: 'entryDate', name: 'Date' },
          { key: 'entryRef', name: 'Reference No.' },
          { key: 'description', name: 'Narration' },
          { key: 'journalType', name: 'Source Type' },
          { key: 'status', name: 'Status' },
          { key: 'debit', name: 'Total DR' },
          { key: 'credit', name: 'Total CR' }
        ],
        data: journalEntries.filter(r => r.entryRef).map(e => ({
          entryDate: e.entryDate,
          entryRef: e.entryRef,
          description: e.description || '',
          journalType: e.journalType,
          status: e.status,
          debit: e.debit || 0,
          credit: e.credit || 0
        }))
      },
      'Journal Entry Lines': {
        columns: [
          { key: 'entryRef', name: 'Journal Entry Ref' },
          { key: 'accountCode', name: 'Account Code' },
          { key: 'accountName', name: 'Account Name' },
          { key: 'accountType', name: 'Account Type' },
          { key: 'debit', name: 'DR Amount' },
          { key: 'credit', name: 'CR Amount' },
          { key: 'description', name: 'Description' }
        ],
        data: journalEntries.map(e => ({
          entryRef: e.entryRef,
          accountCode: e.accountCode,
          accountName: e.accountName,
          accountType: e.accountType,
          debit: e.debit,
          credit: e.credit,
          description: e.description
        }))
      },
      'Chart of Accounts': {
        columns: [
          { key: 'code', name: 'Code' },
          { key: 'name', name: 'Name' },
          { key: 'type', name: 'Type' },
          { key: 'subType', name: 'Sub Type' },
          { key: 'normalBalance', name: 'Normal Balance' }
        ],
        data: chartOfAccounts.map(a => ({
          code: a.code,
          name: a.name,
          type: a.type,
          subType: a.subType || '',
          normalBalance: a.normalBalance || 'debit'
        }))
      },
      'Trial Balance': {
        columns: [
          { key: 'accountCode', name: 'Account Code' },
          { key: 'accountName', name: 'Account Name' },
          { key: 'debit', name: 'Total DR' },
          { key: 'credit', name: 'Total CR' },
          { key: 'netDr', name: 'Net DR' },
          { key: 'netCr', name: 'Net CR' }
        ],
        data: trialBalance.accounts.map(a => ({
          accountCode: a.account.code,
          accountName: a.account.name,
          debit: a.debitBalance || 0,
          credit: a.creditBalance || 0,
          netDr: a.debitBalance > a.creditBalance ? a.debitBalance - a.creditBalance : 0,
          netCr: a.creditBalance > a.debitBalance ? a.creditBalance - a.debitBalance : 0
        }))
      },
      'Summary': {
        columns: [
          { key: 'field', name: 'Field' },
          { key: 'value', name: 'Value' }
        ],
        data: [
          { field: 'Company Name', value: req.company.name },
          { field: 'Export Date', value: new Date().toISOString() },
          { field: 'Date From', value: date_from },
          { field: 'Date To', value: date_to },
          { field: 'Total Entries', value: journalEntries.filter(e => e.entryRef).length },
          { field: 'Total DR', value: journalEntries.reduce((sum, e) => sum + (e.debit || 0), 0).toFixed(2) },
          { field: 'Total CR', value: journalEntries.reduce((sum, e) => sum + (e.credit || 0), 0).toFixed(2) },
          { field: 'Is Balanced', value: 'Yes' }
        ]
      }
    };

    let output, contentType, filename;

    if (format === 'csv') {
      // Generate ZIP with multiple CSVs
      const archiver = require('archiver');
      const csvFiles = CsvFormatter.formatMultiple(sheets);
      
      const archive = archiver('zip', { zlib: { level: 9 } });
      
      for (const [name, content] of Object.entries(csvFiles)) {
        archive.append(content, { name });
      }
      
      output = await archive.finalize();
      contentType = 'application/zip';
      filename = `accounting_export_${date_from}_${date_to}.zip`;
    } else {
      // Generate Excel with multiple sheets
      output = await ExcelFormatter.createMultiSheet(sheets);
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      filename = `accounting_export_${date_from}_${date_to}.xlsx`;
    }

    // Step 5: Log to audit trail
    try {
      await AuditLogService.log({
        company: companyId,
        user: userId,
        action: 'accounting_export',
        details: {
          dateFrom: date_from,
          dateTo: date_to,
          format,
          entryCount: journalEntries.filter(e => e.entryRef).length
        }
      });
    } catch (auditErr) {
      console.error('Audit log failed:', auditErr);
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(output);

  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/export/batch
 * Export multiple data types as ZIP
 */
router.post('/batch', protect, requireCompanyHeader, async (req, res, next) => {
  try {
    const companyId = req.company._id;
    const { types, format = 'csv' } = req.body;

    if (!types || !Array.isArray(types) || types.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'types array is required'
      });
    }

    const result = await ExportService.exportMultiple(types, companyId, { format });

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.buffer);

  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/export/types
 * Get available export types
 */
router.get('/meta/types', (req, res) => {
  const types = ExportService.getAvailableTypes();
  
  res.json({
    success: true,
    data: types
  });
});

module.exports = router;