const Company = require('../models/Company');
const ExchangeRate = require('../models/ExchangeRate');
const Currency = require('../models/Currency');
const AuditLogService = require('./AuditLogService');

class CurrencyService {

  /**
   * Get the most recent exchange rate for a currency pair on or before a date.
   * Only converts to company base currency.
   */
  static async getRate(companyId, fromCurrency, toCurrency, asOfDate) {
    const company = await Company.findById(companyId).lean();
    if (!company) {
      throw new Error('Company not found');
    }

    const base = (company.base_currency || company.baseCurrency || '').toUpperCase();
    const from = (fromCurrency || '').toUpperCase();
    const to = (toCurrency ? String(toCurrency).toUpperCase() : base);

    if (from === to) return 1;

    if (to !== base) {
      throw new Error('RATE_LOOKUP_ERROR: can only convert to base currency');
    }

    const rate = await ExchangeRate.findOne({
      company_id: companyId,
      from_currency: from,
      to_currency: to,
      effective_date: { $lte: new Date(asOfDate) }
    })
      .sort({ effective_date: -1 })
      .lean();

    if (!rate) {
      throw new Error(
        `EXCHANGE_RATE_NOT_FOUND: No rate for ${from}/${to} ` +
        `on or before ${asOfDate}. Add a rate in Settings > Exchange Rates.`
      );
    }

    return rate.rate;
  }

  /**
   * Convert an amount from foreign currency to base currency.
   */
  static async convert(companyId, amount, fromCurrency, asOfDate) {
    const company = await Company.findById(companyId).lean();
    if (!company) {
      throw new Error('Company not found');
    }
    const base = (company.base_currency || company.baseCurrency || '').toUpperCase();
    const from = (fromCurrency || '').toUpperCase();
    if (from === base) return amount;

    const rate = await CurrencyService.getRate(
      companyId,
      from,
      base,
      asOfDate
    );

    return Math.round(amount * rate * 100) / 100;
  }

  /**
   * Add a new exchange rate for a company (manual entry).
   */
  static async addRate(companyId, data, userId) {
    const company = await Company.findById(companyId).lean();
    if (!company) {
      throw new Error('Company not found');
    }
    const base = (company.base_currency || company.baseCurrency || '').toUpperCase();

    const rate = await ExchangeRate.create({
      company_id: companyId,
      from_currency: (data.from_currency || data.fromCurrency || '').toUpperCase(),
      to_currency: base,
      rate: data.rate,
      effective_date: data.effective_date || data.effectiveDate || new Date(),
      source: 'manual',
      created_by: userId
    });

    AuditLogService.log({
      companyId,
      userId,
      action: 'exchange_rate.add',
      entityType: 'exchange_rate',
      entityId: rate._id,
      changes: data
    });

    return rate;
  }

  /**
   * Seed standard currencies (run once at system setup).
   */
  static async seedCurrencies() {
    const currencies = [
      { code: 'RWF', name: 'Rwandan Franc', symbol: 'FRw', decimal_places: 0 },
      { code: 'USD', name: 'US Dollar', symbol: '$', decimal_places: 2 },
      { code: 'EUR', name: 'Euro', symbol: '€', decimal_places: 2 },
      { code: 'GBP', name: 'British Pound', symbol: '£', decimal_places: 2 },
      { code: 'KES', name: 'Kenyan Shilling', symbol: 'Ksh', decimal_places: 2 },
      { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', decimal_places: 0 },
      { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', decimal_places: 0 },
      { code: 'BIF', name: 'Burundian Franc', symbol: 'Fr', decimal_places: 0 },
      { code: 'CDF', name: 'Congolese Franc', symbol: 'FC', decimal_places: 2 },
      { code: 'ZAR', name: 'South African Rand', symbol: 'R', decimal_places: 2 },
      { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', decimal_places: 2 },
      { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimal_places: 2 },
      { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', decimal_places: 2 }
    ];

    for (const c of currencies) {
      await Currency.updateOne(
        { code: c.code },
        { $setOnInsert: c },
        { upsert: true }
      );
    }
  }
}

module.exports = CurrencyService;
