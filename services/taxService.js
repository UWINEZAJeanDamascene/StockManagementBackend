const mongoose = require('mongoose');
const TaxRate = require('../models/TaxRate');
const JournalEntry = require('../models/JournalEntry');
const JournalService = require('./journalService');
const SequenceService = require('./sequenceService');
const PeriodService = require('./periodService');
const { BankAccount } = require('../models/BankAccount');
const { aggregateWithTimeout } = require('../utils/mongoAggregation');

class TaxService {

  // ── TAX RATE MANAGEMENT ─────────────────────────────────────────────

  /**
   * Create a new tax rate
   */
  static async createTaxRate(companyId, data) {
    const taxRate = new TaxRate({
      company: companyId,
      name: data.name,
      code: data.code,
      rate_pct: data.rate_pct,
      type: data.type,
      input_account_id: data.input_account_id,
      output_account_id: data.output_account_id,
      input_account_code: data.input_account_code,
      output_account_code: data.output_account_code,
      is_active: data.is_active !== undefined ? data.is_active : true,
      effective_from: data.effective_from,
      effective_to: data.effective_to || null
    });

    return taxRate.save();
  }

  /**
   * Get all tax rates for a company
   */
  static async getTaxRates(companyId, filters = {}) {
    const query = { company: companyId };
    
    if (filters.is_active !== undefined) {
      query.is_active = filters.is_active;
    }
    if (filters.type) {
      query.type = filters.type;
    }
    if (filters.code) {
      query.code = filters.code;
    }

    return TaxRate.find(query).sort({ code: 1 });
  }

  /**
   * Get a single tax rate by ID
   */
  static async getTaxRateById(companyId, taxRateId) {
    return TaxRate.findOne({ _id: taxRateId, company: companyId });
  }

  /**
   * Get a single tax rate by code
   */
  static async getTaxRateByCode(companyId, code) {
    return TaxRate.findOne({ company: companyId, code: code.toUpperCase() });
  }

  /**
   * Update a tax rate
   */
  static async updateTaxRate(companyId, taxRateId, data) {
    const updateData = {};
    
    if (data.name) updateData.name = data.name;
    if (data.rate_pct !== undefined) updateData.rate_pct = data.rate_pct;
    if (data.type) updateData.type = data.type;
    if (data.input_account_id) updateData.input_account_id = data.input_account_id;
    if (data.output_account_id) updateData.output_account_id = data.output_account_id;
    if (data.input_account_code) updateData.input_account_code = data.input_account_code;
    if (data.output_account_code) updateData.output_account_code = data.output_account_code;
    if (data.is_active !== undefined) updateData.is_active = data.is_active;
    if (data.effective_from) updateData.effective_from = data.effective_from;
    if (data.effective_to !== undefined) updateData.effective_to = data.effective_to;

    return TaxRate.findOneAndUpdate(
      { _id: taxRateId, company: companyId },
      updateData,
      { new: true }
    );
  }

  /**
   * Delete (deactivate) a tax rate
   */
  static async deleteTaxRate(companyId, taxRateId) {
    return TaxRate.findOneAndUpdate(
      { _id: taxRateId, company: companyId },
      { is_active: false },
      { new: true }
    );
  }

  // ── TAX LIABILITY REPORT ─────────────────────────────────────────────
  /**
   * Computed entirely from posted journal lines — no separate tax table
   * Uses account codes to identify VAT input/output positions
   */
  static async getLiabilityReport(companyId, { periodStart, periodEnd, taxCode }) {
    const query = { company: companyId, is_active: true };
    if (taxCode) {
      query.code = taxCode.toUpperCase();
    }

    const taxRates = await TaxRate.find(query);

    const results = [];

    for (const tax of taxRates) {
      // Output VAT — sum of credit lines on output_account_code in period
      // Excludes: draft, voided, reversed entries, and original entries that have been reversed
      // First, find all entry IDs that have been reversed (appear in reversalOf field)
      const reversedEntryIds = await JournalEntry.distinct('reversalOf', {
        company: new mongoose.Types.ObjectId(companyId),
        reversalOf: { $exists: true, $ne: null }
      });
      
      const outputResult = await aggregateWithTimeout(JournalEntry, [
        {
          $match: {
            company: new mongoose.Types.ObjectId(companyId),
            status: { $nin: ['draft', 'voided', 'reversed'] },
            _id: { $nin: reversedEntryIds },
            date: {
              $gte: new Date(periodStart),
              $lte: new Date(periodEnd)
            }
          }
        },
        { $unwind: '$lines' },
        {
          $match: {
            'lines.accountCode': tax.output_account_code,
            'lines.credit': { $gt: 0 }
          }
        },
        {
          $group: {
            _id: null,
            output_vat: { $sum: '$lines.credit' }
          }
        }
      ]);

      // Input VAT — sum of debit lines on input_account_code in period
      // Excludes draft, reversed, and cancelled entries
      const inputResult = await aggregateWithTimeout(JournalEntry, [
        {
          $match: {
            company: new mongoose.Types.ObjectId(companyId),
            status: 'posted',
            reversed: { $ne: true },
            date: {
              $gte: new Date(periodStart),
              $lte: new Date(periodEnd)
            }
          }
        },
        { $unwind: '$lines' },
        {
          $match: {
            'lines.accountCode': tax.input_account_code,
            'lines.debit': { $gt: 0 }
          }
        },
        {
          $group: {
            _id: null,
            input_vat: { $sum: '$lines.debit' }
          }
        }
      ]);

      // Convert Decimal128 to numbers
      const outputVat = outputResult[0]?.output_vat ? Number(outputResult[0].output_vat.toString()) : 0;
      const inputVat = inputResult[0]?.input_vat ? Number(inputResult[0].input_vat.toString()) : 0;
      const netPayable = outputVat - inputVat;

      results.push({
        tax_code: tax.code,
        tax_name: tax.name,
        rate_pct: tax.rate_pct,
        tax_type: tax.type,
        output_vat: outputVat,
        input_vat: inputVat,
        net_payable: netPayable
      });
    }

    const totalOutputVat = results.reduce((s, r) => s + r.output_vat, 0);
    const totalInputVat = results.reduce((s, r) => s + r.input_vat, 0);
    const totalNetPayable = results.reduce((s, r) => s + r.net_payable, 0);

    return {
      company_id: companyId,
      period_start: periodStart,
      period_end: periodEnd,
      total_output_vat: totalOutputVat,
      total_input_vat: totalInputVat,
      net_vat_payable: totalNetPayable,
      breakdown: results,
      computed_at: new Date()
    };
  }

  // ── TAX SETTLEMENT ─────────────────────────────────────────────────
  /**
   * Post tax settlement - pays tax liability to authorities
   * Dr: VAT Payable (output)
   * Cr: Bank/Cash
   */
  static async postSettlement(companyId, data, userId) {
    const taxRate = await TaxRate.findOne({ 
      company: companyId, 
      code: data.tax_code.toUpperCase() 
    });

    if (!taxRate) {
      throw new Error('TAX_RATE_NOT_FOUND');
    }

    // Get bank account
    let bankAccount;
    if (data.bank_account_id) {
      bankAccount = await BankAccount.findOne({ 
        _id: data.bank_account_id, 
        company: companyId 
      });
      if (!bankAccount) {
        throw new Error('BANK_ACCOUNT_NOT_FOUND');
      }
    }

    const refNo = await SequenceService.nextSequence(companyId, 'TXST');
    const periodId = await PeriodService.getOpenPeriodId(companyId, data.settlement_date);

    // Determine cash account based on payment method
    let cashAccountCode;
    if (bankAccount && bankAccount.ledgerAccountId) {
      cashAccountCode = bankAccount.ledgerAccountId;
    } else if (data.payment_method === 'bank' || data.bank_account_id) {
      cashAccountCode = '1100'; // Cash at Bank default
    } else {
      cashAccountCode = '1000'; // Cash in Hand default
    }

    // Journal Entry:
    // Debit: Output VAT (clear the liability)
    // Credit: Bank/Cash (payment)
    const lines = [
      {
        accountCode: taxRate.output_account_code,
        accountName: 'VAT Payable',
        description: 'VAT output cleared on settlement',
        debit: data.amount,
        credit: 0,
        reference: ''
      },
      {
        accountCode: cashAccountCode,
        accountName: 'Bank/Cash',
        description: 'Bank payment to tax authority',
        debit: 0,
        credit: data.amount,
        reference: ''
      }
    ];

    const narration = `VAT Settlement - ${data.period_description || 'Tax Period'} - TXST#${refNo}`;

    const journalEntry = await JournalService.createEntry(companyId, userId, {
      date: data.settlement_date,
      description: narration,
      sourceType: 'tax_settlement',
      sourceId: `taxsettlement_${companyId}_${refNo}`,
      sourceReference: `TXST#${refNo}`,
      lines,
      isAutoGenerated: true,
      periodId
    });

    return {
      settlement_reference: refNo,
      journal_entry_id: journalEntry._id,
      amount: data.amount,
      tax_code: taxRate.code,
      settlement_date: data.settlement_date,
      journal_entry: journalEntry
    };
  }

  // ── TAX CALCULATION HELPERS ─────────────────────────────────────────

  /**
   * Calculate VAT amount from a base amount
   */
  static calculateVat(baseAmount, taxCodeOrRate) {
    if (typeof taxCodeOrRate === 'number') {
      return baseAmount * (taxCodeOrRate / 100);
    }
    // If it's a string code, we'd need to look up the rate
    // For now, return 0 - caller should provide the rate
    return 0;
  }

  /**
   * Extract VAT from a gross amount
   */
  static extractVatFromGross(grossAmount, taxRatePct) {
    const vatRate = taxRatePct / 100;
    const vatAmount = grossAmount * (vatRate / (1 + vatRate));
    const netAmount = grossAmount - vatAmount;
    return {
      gross: grossAmount,
      net: netAmount,
      vat: vatAmount,
      rate_pct: taxRatePct
    };
  }
}

module.exports = TaxService;
