// Chart of Accounts for the Stock Management System
// Based on standard accounting chart of accounts
// IMPORTANT: allowDirectPosting must be set for each account
// - true: actual posting accounts (leaf nodes)
// - false: header/summary accounts used only for grouping in reports

const CHART_OF_ACCOUNTS = {
  // ── ASSETS (1000-1999) ──────────
  // Current Assets
  '1000': { name: 'Cash in Hand', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1050': { name: 'Petty Cash', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1110': { name: 'Petty Cash (Module 4)', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1100': { name: 'Cash at Bank', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1200': { name: 'MTN MoMo', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1250': { name: 'Employee Advances', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1300': { name: 'Accounts Receivable', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1350': { name: 'Other Receivables', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1400': { name: 'Inventory', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1500': { name: 'VAT Receivable', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
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
  
  // Contra Assets - Accumulated Depreciation (Module 5)
  '1810': { name: 'Accumulated Depreciation - Equipment', type: 'asset', subtype: 'contra', normalBalance: 'credit', allowDirectPosting: true },
  '1820': { name: 'Accumulated Depreciation - Computers', type: 'asset', subtype: 'contra', normalBalance: 'credit', allowDirectPosting: true },
  '1830': { name: 'Accumulated Depreciation - Vehicles', type: 'asset', subtype: 'contra', normalBalance: 'credit', allowDirectPosting: true },
  '1840': { name: 'Accumulated Depreciation - Furniture', type: 'asset', subtype: 'contra', normalBalance: 'credit', allowDirectPosting: true },
  '1850': { name: 'Accumulated Depreciation - Buildings', type: 'asset', subtype: 'contra', normalBalance: 'credit', allowDirectPosting: true },
  '1860': { name: 'Accumulated Depreciation - Machinery', type: 'asset', subtype: 'contra', normalBalance: 'credit', allowDirectPosting: true },
  '1890': { name: 'Accumulated Depreciation - Other', type: 'asset', subtype: 'contra', normalBalance: 'credit', allowDirectPosting: true },

  // ── LIABILITIES (2000-2999) ───
  // Current Liabilities
  '2000': { name: 'Accounts Payable', type: 'liability', subtype: 'current', normalBalance: 'credit', allowDirectPosting: true },
  '2100': { name: 'VAT Payable', type: 'liability', subtype: 'current', normalBalance: 'credit', allowDirectPosting: true },
  '2200': { name: 'PAYE Payable', type: 'liability', subtype: 'current', normalBalance: 'credit', allowDirectPosting: true },
  '2300': { name: 'RSSB Payable', type: 'liability', subtype: 'current', normalBalance: 'credit', allowDirectPosting: true },
  '2310': { name: 'Employer Contribution Payable', type: 'liability', subtype: 'current', normalBalance: 'credit', allowDirectPosting: true },
  '2400': { name: 'Income Tax Payable', type: 'liability', subtype: 'current', normalBalance: 'credit', allowDirectPosting: true },
  '2500': { name: 'Withholding Tax Payable', type: 'liability', subtype: 'current', normalBalance: 'credit', allowDirectPosting: true },
  '2600': { name: 'Accrued Expenses', type: 'liability', subtype: 'current', normalBalance: 'credit', allowDirectPosting: true },
  '2700': { name: 'Short Term Loans', type: 'liability', subtype: 'current', normalBalance: 'credit', allowDirectPosting: true },
  '2800': { name: 'Accrued Interest', type: 'liability', subtype: 'current', normalBalance: 'credit', allowDirectPosting: true },
  
  // Long Term Liabilities
  '2900': { name: 'Long Term Loans', type: 'liability', subtype: 'non_current', normalBalance: 'credit', allowDirectPosting: true },

  // ── EQUITY (3000-3999) ─────────
  '3000': { name: 'Share Capital', type: 'equity', subtype: 'capital', normalBalance: 'credit', allowDirectPosting: true },
  '3100': { name: 'Retained Earnings', type: 'equity', subtype: 'retained', normalBalance: 'credit', allowDirectPosting: false }, // Only system posts via period close
  '3200': { name: 'Current Period Profit', type: 'equity', subtype: 'profit', normalBalance: 'credit', allowDirectPosting: false }, // Only system posts via period close
  '3300': { name: 'Dividends Paid', type: 'equity', subtype: 'dividends', normalBalance: 'debit', allowDirectPosting: true },

  // ── REVENUE (4000-4999) ────────
  '4000': { name: 'Sales Revenue', type: 'revenue', subtype: 'operating', normalBalance: 'credit', allowDirectPosting: true },
  '4100': { name: 'Sales Returns', type: 'revenue', subtype: 'contra', normalBalance: 'debit', allowDirectPosting: true },
  '4200': { name: 'Other Income', type: 'revenue', subtype: 'non_operating', normalBalance: 'credit', allowDirectPosting: true },
  '4300': { name: 'Interest Income', type: 'revenue', subtype: 'non_operating', normalBalance: 'credit', allowDirectPosting: true },
  '4250': { name: 'Gain on Asset Disposal', type: 'revenue', subtype: 'non_operating', normalBalance: 'credit', allowDirectPosting: true },
  '4400': { name: 'Gain on Asset Disposal (legacy)', type: 'revenue', subtype: 'non_operating', normalBalance: 'credit', allowDirectPosting: false },

  // ── COST OF GOODS SOLD (5000-5099) ────────
  '5000': { name: 'Cost of Goods Sold', type: 'expense', subtype: 'cogs', normalBalance: 'debit', allowDirectPosting: true },
  '5100': { name: 'Purchases', type: 'expense', subtype: 'cogs', normalBalance: 'debit', allowDirectPosting: true },
  '5110': { name: 'Freight In', type: 'expense', subtype: 'cogs', normalBalance: 'debit', allowDirectPosting: true },
  '5150': { name: 'Stock Adjustment Loss', type: 'expense', subtype: 'cogs', normalBalance: 'debit', allowDirectPosting: true },
  '5200': { name: 'Purchase Returns', type: 'expense', subtype: 'contra', normalBalance: 'credit', allowDirectPosting: true },
  '5300': { name: 'Salaries & Wages', type: 'expense', subtype: 'operating', normalBalance: 'debit', allowDirectPosting: true },

  // ── OPERATING EXPENSES (5100-6999) ────────
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
  
  // Additional operating expense codes requested
  '5250': { name: 'Bad Debt Expense', type: 'expense', subtype: 'operating', normalBalance: 'debit', allowDirectPosting: true },
  '6050': { name: 'Loss on Asset Disposal', type: 'expense', subtype: 'non_operating', normalBalance: 'debit', allowDirectPosting: true },
  '6150': { name: 'Withholding Tax Expense', type: 'expense', subtype: 'tax', normalBalance: 'debit', allowDirectPosting: true },
  
  // ── SPECIAL ACCOUNTS ──────────
  '7100': { name: 'Stock Adjustment', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '7200': { name: 'Asset Disposal', type: 'asset', subtype: 'fixed', normalBalance: 'debit', allowDirectPosting: true },
};

// Helper function to get account by code
const getAccount = (code) => CHART_OF_ACCOUNTS[code];

// Helper function to get accounts by type
const getAccountsByType = (type) => {
  return Object.entries(CHART_OF_ACCOUNTS)
    .filter(([_, account]) => account.type === type)
    .map(([code, account]) => ({ code, ...account }));
};

// Helper function to get accounts by subtype
const getAccountsBySubtype = (subtype) => {
  return Object.entries(CHART_OF_ACCOUNTS)
    .filter(([_, account]) => account.subtype === subtype)
    .map(([code, account]) => ({ code, ...account }));
};

// Helper function to check if account allows direct posting
const canPostToAccount = (code) => {
  const account = CHART_OF_ACCOUNTS[code];
  if (!account) return { valid: false, reason: 'ACCOUNT_NOT_FOUND' };
  if (!account.allowDirectPosting) return { valid: false, reason: 'ACCOUNT_NO_POSTING', accountName: account.name };
  return { valid: true, account };
};

// Default account mappings for transactions
const DEFAULT_ACCOUNTS = {
  // Sales
  salesRevenue: '4000',
  salesReturns: '4100',
  accountsReceivable: '1300',
  
  // Purchases
  purchases: '5100',
  purchaseReturns: '5200',
  accountsPayable: '2000',
  freightIn: '5110',
  
  // Inventory
  inventory: '1400',
  stockAdjustment: '7100',
  costOfGoodsSold: '5000',
  
  // Cash/Bank
  cashInHand: '1000',
  pettyCash: '1050',
  pettyCashModule4: '1110',
  cashAtBank: '1100',
  mtnMoMo: '1200',
  employeeAdvances: '1250',
  otherReceivables: '1350',
  
  // VAT
  vatReceivable: '1500',
  vatPayable: '2100',
  taxPayable: '2100',
  
  // Expenses
  salaries: '5300',
  salariesWages: '5300',
  payrollExpenses: '5410',
  rent: '5500',
  utilities: '5600',
  transport: '5700',
  marketing: '5850',
  depreciation: '5800',
  interestExpense: '6000',
  otherExpenses: '6100',
  bankCharges: '6200',
  badDebt: '5250',
  badDebtLegacy: '6300',
  
  // Assets (Module 5)
  equipment: '1700',
  computers: '1710',
  vehicles: '1720',
  furniture: '1730',
  buildings: '1740',
  land: '1750',
  machinery: '1760',
  otherFixedAssets: '1790',
  accumulatedDepreciation: '1800',
  accumulatedDepreciationEquipment: '1810',
  accumulatedDepreciationComputers: '1820',
  accumulatedDepreciationVehicles: '1830',
  accumulatedDepreciationFurniture: '1840',
  accumulatedDepreciationBuildings: '1850',
  accumulatedDepreciationMachinery: '1860',
  accumulatedDepreciationOther: '1890',
  assetDisposal: '7200',
  
  // Liabilities
  accruedExpenses: '2600',
  shortTermLoans: '2700',
  longTermLoans: '2900',
  accruedInterest: '2800',
  employerContributionPayable: '2310',
  
  // Tax
  incomeTaxPayable: '2400',
  payePayable: '2200',
  rssbPayable: '2300',
  withholdingTaxPayable: '2500',
  corporateTax: '6400',
  withholdingTaxExpense: '6150',
  
  // Equity
  shareCapital: '3000',
  retainedEarnings: '3100',
  currentProfit: '3200',
  ownerDrawings: '3300',
  dividendsPaid: '3300',
  
  // Other
  otherIncome: '4200',
  interestIncome: '4300',
  gainOnDisposal: '4250',
  lossOnDisposal: '6500',

  // COGS / adjustments
  stockAdjustmentLoss: '5150',
  
  // Prepaid
  prepaidExpenses: '1600',
};

module.exports = {
  CHART_OF_ACCOUNTS,
  getAccount,
  getAccountsByType,
  getAccountsBySubtype,
  canPostToAccount,
  DEFAULT_ACCOUNTS
};
