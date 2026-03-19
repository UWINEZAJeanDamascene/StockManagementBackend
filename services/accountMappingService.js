const AccountMapping = require('../models/AccountMapping');
const { DEFAULT_ACCOUNTS } = require('../constants/chartOfAccounts');

class AccountMappingService {
  /**
   * Resolve an account code for a given company and mapping key.
   * moduleName is an arbitrary grouping (e.g. 'sales', 'purchase', 'inventory').
   * key is the specific mapping name (e.g. 'salesRevenue', 'accountsReceivable').
   * Falls back to provided default or DEFAULT_ACCOUNTS when not found.
   */
  static async resolve(companyId, moduleName, key, fallback) {
    if (!companyId || !key) return fallback || DEFAULT_ACCOUNTS[key] || null;

    try {
      const m = await AccountMapping.findOne({ company: companyId, module: moduleName, key }).lean();
      if (m && m.accountCode) return m.accountCode;
    } catch (err) {
      // non-fatal - return fallback
    }

    // fallback to provided fallback, or to DEFAULT_ACCOUNTS by key name
    if (fallback) return fallback;
    return DEFAULT_ACCOUNTS[key] || null;
  }
}

module.exports = AccountMappingService;
