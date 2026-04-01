const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const CHART_OF_ACCOUNTS = {
  // ── ASSETS (1000-1999) ──────────
  '1000': { name: 'Cash in Hand', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1050': { name: 'Petty Cash', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1110': { name: 'Petty Cash (Module 4)', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1100': { name: 'Cash at Bank', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1200': { name: 'MTN MoMo', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1250': { name: 'Employee Advances', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1300': { name: 'Accounts Receivable', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1350': { name: 'Other Receivables', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1400': { name: 'Inventory', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1500': { name: 'VAT Receivable (legacy)', type: 'asset', subtype: 'vat_input', normalBalance: 'debit', allowDirectPosting: true },
  '1600': { name: 'Prepaid Expenses', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  
  // Fixed Assets
  '1700': { name: 'Equipment', type: 'asset', subtype: 'fixed', normalBalance: 'debit', allowDirectPosting: true },
  '1710': { name: 'Computers', type: 'asset', subtype: 'fixed', normalBalance: 'debit', allowDirectPosting: true },
  '1720': { name: 'Vehicles', type: 'asset', subtype: 'fixed', normalBalance: 'debit', allowDirectPosting: true },
  '1730': { name: 'Furniture', type: 'asset', subtype: 'fixed', normalBalance: 'debit', allowDirectPosting: true },
  '1740': { name: 'Buildings', type: 'asset', subtype: 'fixed', normalBalance: 'debit', allowDirectPosting: true },
  '1750': { name: 'Land', type: 'asset', subtype: 'fixed', normalBalance: 'debit', allowDirectPosting: true },
  '1760': { name: 'Machinery', type: 'asset', subtype: 'fixed', normalBalance: 'debit', allowDirectPosting: true },
  '1790': { name: 'Other Fixed Assets', type: 'asset', subtype: 'fixed', normalBalance: 'debit', allowDirectPosting: true },
  
  // Contra Assets - Accumulated Depreciation
  '1810': { name: 'Accumulated Depreciation - Equipment', type: 'asset', subtype: 'contra', normalBalance: 'credit', allowDirectPosting: true },
  '1820': { name: 'Accumulated Depreciation - Computers', type: 'asset', subtype: 'contra', normalBalance: 'credit', allowDirectPosting: true },
  '1830': { name: 'Accumulated Depreciation - Vehicles', type: 'asset', subtype: 'contra', normalBalance: 'credit', allowDirectPosting: true },
  '1840': { name: 'Accumulated Depreciation - Furniture', type: 'asset', subtype: 'contra', normalBalance: 'credit', allowDirectPosting: true },
  '1850': { name: 'Accumulated Depreciation - Buildings', type: 'asset', subtype: 'contra', normalBalance: 'credit', allowDirectPosting: true },
  '1860': { name: 'Accumulated Depreciation - Machinery', type: 'asset', subtype: 'contra', normalBalance: 'credit', allowDirectPosting: true },
  '1890': { name: 'Accumulated Depreciation - Other', type: 'asset', subtype: 'contra', normalBalance: 'credit', allowDirectPosting: true },

  // ── LIABILITIES (2000-2999) ───
  '2000': { name: 'Accounts Payable', type: 'liability', subtype: 'current', normalBalance: 'credit', allowDirectPosting: true },
  '2100': { name: 'VAT Payable (legacy)', type: 'liability', subtype: 'vat_output', normalBalance: 'credit', allowDirectPosting: true },
  '2200': { name: 'PAYE Payable (legacy)', type: 'liability', subtype: 'paye_payable', normalBalance: 'credit', allowDirectPosting: true },
  '2210': { name: 'VAT Input', type: 'liability', subtype: 'vat_input', normalBalance: 'debit', allowDirectPosting: true },
  '2220': { name: 'VAT Output', type: 'liability', subtype: 'vat_output', normalBalance: 'credit', allowDirectPosting: true },
  '2230': { name: 'PAYE Tax Payable', type: 'liability', subtype: 'paye_payable', normalBalance: 'credit', allowDirectPosting: true },
  '2240': { name: 'RSSB Payable', type: 'liability', subtype: 'rssb_payable', normalBalance: 'credit', allowDirectPosting: true },
  '2300': { name: 'RSSB Payable (legacy)', type: 'liability', subtype: 'rssb_payable', normalBalance: 'credit', allowDirectPosting: true },
  '2310': { name: 'Employer Contribution Payable', type: 'liability', subtype: 'rssb_payable', normalBalance: 'credit', allowDirectPosting: true },
  '2400': { name: 'Income Tax Payable', type: 'liability', subtype: 'income_tax_payable', normalBalance: 'credit', allowDirectPosting: true },
  '2500': { name: 'Withholding Tax Payable', type: 'liability', subtype: 'withholding_tax_payable', normalBalance: 'credit', allowDirectPosting: true },
  '2600': { name: 'Accrued Expenses', type: 'liability', subtype: 'current', normalBalance: 'credit', allowDirectPosting: true },
  '2700': { name: 'Short Term Loans', type: 'liability', subtype: 'current', normalBalance: 'credit', allowDirectPosting: true },
  '2800': { name: 'Accrued Interest', type: 'liability', subtype: 'current', normalBalance: 'credit', allowDirectPosting: true },
  '2900': { name: 'Long Term Loans', type: 'liability', subtype: 'non_current', normalBalance: 'credit', allowDirectPosting: true },

  // ── EQUITY (3000-3999) ─────────
  '3000': { name: 'Share Capital', type: 'equity', subtype: 'capital', normalBalance: 'credit', allowDirectPosting: true },
  '3100': { name: 'Retained Earnings', type: 'equity', subtype: 'retained', normalBalance: 'credit', allowDirectPosting: false },
  '3200': { name: 'Current Period Profit', type: 'equity', subtype: 'profit', normalBalance: 'credit', allowDirectPosting: false },
  '3300': { name: 'Dividends Paid', type: 'equity', subtype: 'dividends', normalBalance: 'debit', allowDirectPosting: true },

  // ── REVENUE (4000-4999) ────────
  '4000': { name: 'Sales Revenue', type: 'revenue', subtype: 'operating', normalBalance: 'credit', allowDirectPosting: true },
  '4100': { name: 'Sales Returns', type: 'revenue', subtype: 'contra', normalBalance: 'debit', allowDirectPosting: true },
  '4200': { name: 'Other Income', type: 'revenue', subtype: 'non_operating', normalBalance: 'credit', allowDirectPosting: true },
  '4300': { name: 'Interest Income', type: 'revenue', subtype: 'non_operating', normalBalance: 'credit', allowDirectPosting: true },
  '4250': { name: 'Gain on Asset Disposal', type: 'revenue', subtype: 'non_operating', normalBalance: 'credit', allowDirectPosting: true },
  '4400': { name: 'Gain on Asset Disposal (legacy)', type: 'revenue', subtype: 'non_operating', normalBalance: 'credit', allowDirectPosting: false },

  // ── COST OF GOODS SOLD (5000-5099) ────────
  '5000': { name: 'Cost of Goods Sold', type: 'cogs', subtype: 'cogs', normalBalance: 'debit', allowDirectPosting: true },
  '5100': { name: 'Purchases', type: 'cogs', subtype: 'cogs', normalBalance: 'debit', allowDirectPosting: true },
  '5110': { name: 'Freight In', type: 'cogs', subtype: 'cogs', normalBalance: 'debit', allowDirectPosting: true },
  '5150': { name: 'Stock Adjustment Loss', type: 'cogs', subtype: 'cogs', normalBalance: 'debit', allowDirectPosting: true },
  '5200': { name: 'Purchase Returns', type: 'cogs', subtype: 'contra', normalBalance: 'credit', allowDirectPosting: true },
  '5300': { name: 'Direct Labor', type: 'cogs', subtype: 'cogs', normalBalance: 'debit', allowDirectPosting: true },

  // ── EXPENSES (6000-6999) ────────
  '5400': { name: 'Salaries & Wages', type: 'expense', subtype: 'operating', normalBalance: 'debit', allowDirectPosting: true },
  '5410': { name: 'Payroll Expenses', type: 'expense', subtype: 'operating', normalBalance: 'debit', allowDirectPosting: true },
  '5500': { name: 'Rent', type: 'expense', subtype: 'operating', normalBalance: 'debit', allowDirectPosting: true },
  '5600': { name: 'Utilities', type: 'expense', subtype: 'operating', normalBalance: 'debit', allowDirectPosting: true },
  '5700': { name: 'Transport & Delivery', type: 'expense', subtype: 'operating', normalBalance: 'debit', allowDirectPosting: true },
  '5800': { name: 'Depreciation Expense', type: 'expense', subtype: 'operating', normalBalance: 'debit', allowDirectPosting: true },
  '5850': { name: 'Marketing & Advertising', type: 'expense', subtype: 'operating', normalBalance: 'debit', allowDirectPosting: true },
  '6000': { name: 'Interest Expense', type: 'expense', subtype: 'financial', normalBalance: 'debit', allowDirectPosting: true },
  '6100': { name: 'Other Expenses', type: 'expense', subtype: 'operating', normalBalance: 'debit', allowDirectPosting: true },
  '6200': { name: 'Bank Charges', type: 'expense', subtype: 'financial', normalBalance: 'debit', allowDirectPosting: true },
  '6300': { name: 'Bad Debt Expense (legacy)', type: 'expense', subtype: 'operating', normalBalance: 'debit', allowDirectPosting: false },
  '6400': { name: 'Corporate Tax', type: 'expense', subtype: 'tax', normalBalance: 'debit', allowDirectPosting: true },
  '6500': { name: 'Loss on Asset Disposal (legacy)', type: 'expense', subtype: 'non_operating', normalBalance: 'debit', allowDirectPosting: false },
  '5250': { name: 'Bad Debt Expense', type: 'expense', subtype: 'operating', normalBalance: 'debit', allowDirectPosting: true },
  '6050': { name: 'Loss on Asset Disposal', type: 'expense', subtype: 'non_operating', normalBalance: 'debit', allowDirectPosting: true },
  '6150': { name: 'RSSB Employer Cost', type: 'expense', subtype: 'rssb_employer_cost', normalBalance: 'debit', allowDirectPosting: true },
  
  // ── SPECIAL ACCOUNTS ──────────
  '7100': { name: 'Stock Adjustment', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '7200': { name: 'Asset Disposal', type: 'asset', subtype: 'fixed', normalBalance: 'debit', allowDirectPosting: true },
};

async function seedChartOfAccounts(companyId, userId = null, force = false) {
  try {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/stock_tenancy', {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log('MongoDB Connected...');
    }

    const ChartOfAccount = require('../models/ChartOfAccount');

    if (!companyId) {
      console.error('Error: companyId is required');
      console.log('Usage: node seedChartOfAccounts.js <companyId> [userId] [--force]');
      process.exit(1);
    }

    console.log(`\nSeeding chart of accounts for company: ${companyId}`);
    console.log(`Force mode: ${force}`);

    // Check existing accounts
    const existingCount = await ChartOfAccount.countDocuments({ company: companyId }).setOptions({ skipTenant: true });
    if (existingCount > 0 && !force) {
      console.log(`Company already has ${existingCount} accounts. Use --force to overwrite.`);
      console.log('Use --force flag to delete existing and re-seed');
      process.exit(0);
    }

    if (force && existingCount > 0) {
      await ChartOfAccount.deleteMany({ company: companyId }).setOptions({ skipTenant: true });
      console.log(`Deleted ${existingCount} existing accounts`);
    }

    // Transform and insert accounts
    const accounts = Object.entries(CHART_OF_ACCOUNTS).map(([code, account]) => ({
      company: companyId,
      code: code,
      name: account.name,
      type: account.type,
      subtype: account.subtype,
      normal_balance: account.normalBalance,
      allow_direct_posting: account.allowDirectPosting,
      isActive: true,
      createdBy: userId || null,
    }));

    const result = await ChartOfAccount.insertMany(accounts, { ordered: false }).catch(err => {
      // If some inserts fail due to duplicates, filter them out and retry
      if (err.code === 11000 && err.insertedDocs && err.insertedDocs.length > 0) {
        console.log(`Inserted ${err.insertedDocs.length} accounts (some duplicates skipped)`);
        return err.insertedDocs;
      }
      throw err;
    });

    // Summary by type
    const summary = {};
    result.forEach(acc => {
      summary[acc.type] = (summary[acc.type] || 0) + 1;
    });

    console.log('\n✅ Successfully seeded chart of accounts!');
    console.log('\n📊 Summary by category:');
    console.log(`   Assets: ${summary.asset || 0}`);
    console.log(`   Liabilities: ${summary.liability || 0}`);
    console.log(`   Equity: ${summary.equity || 0}`);
    console.log(`   Revenue: ${summary.revenue || 0}`);
    console.log(`   COGS: ${summary.cogs || 0}`);
    console.log(`   Expenses: ${summary.expense || 0}`);
    console.log(`   ─────────────`);
    console.log(`   Total: ${result.length}`);

    process.exit(0);
  } catch (error) {
    console.error('Error seeding chart of accounts:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const filteredArgs = args.filter(arg => arg !== '--force');
  
  const companyId = filteredArgs[0];
  const userId = filteredArgs[1];
  
  seedChartOfAccounts(companyId, userId, force);
}

module.exports = seedChartOfAccounts;