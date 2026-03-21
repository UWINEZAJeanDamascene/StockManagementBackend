const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const TaxRate = require('../models/TaxRate');
const JournalEntry = require('../models/JournalEntry');
const { BankAccount } = require('../models/BankAccount');
const TaxService = require('../services/taxService');
const AccountingPeriod = require('../models/AccountingPeriod');

let mongoServer;
let companyId;
let userId;
let companyIdB;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  
  const User = require('../models/User');
  const Company = require('../models/Company');
  
  const company = new Company({
    name: 'Test Tax Company',
    currency: 'RWF',
    fiscalYearStart: 1,
    email: 'test@taxcompany.com'
  });
  await company.save();
  companyId = company._id;
  
  const companyB = new Company({
    name: 'Test Tax Company B',
    currency: 'RWF',
    fiscalYearStart: 1,
    email: 'testb@taxcompany.com'
  });
  await companyB.save();
  companyIdB = companyB._id;
  
  const user = new User({
    name: 'Tax Test User',
    email: 'tax@test.com',
    password: 'test123',
    company: companyId,
    role: 'admin'
  });
  await user.save();
  userId = user._id;

  // Create accounting periods for 2025 (tests use dates in 2025)
  const periods2025 = [
    { company_id: companyId, name: 'Jan 2025', period_type: 'month', start_date: new Date('2025-01-01'), end_date: new Date('2025-01-31'), fiscal_year: 2025, status: 'open' },
    { company_id: companyId, name: 'Feb 2025', period_type: 'month', start_date: new Date('2025-02-01'), end_date: new Date('2025-02-28'), fiscal_year: 2025, status: 'open' },
    { company_id: companyId, name: 'Mar 2025', period_type: 'month', start_date: new Date('2025-03-01'), end_date: new Date('2025-03-31'), fiscal_year: 2025, status: 'open' },
    { company_id: companyId, name: 'Apr 2025', period_type: 'month', start_date: new Date('2025-04-01'), end_date: new Date('2025-04-30'), fiscal_year: 2025, status: 'open' },
    { company_id: companyId, name: 'May 2025', period_type: 'month', start_date: new Date('2025-05-01'), end_date: new Date('2025-05-31'), fiscal_year: 2025, status: 'open' },
    { company_id: companyId, name: 'Jun 2025', period_type: 'month', start_date: new Date('2025-06-01'), end_date: new Date('2025-06-30'), fiscal_year: 2025, status: 'open' },
    { company_id: companyId, name: 'Jul 2025', period_type: 'month', start_date: new Date('2025-07-01'), end_date: new Date('2025-07-31'), fiscal_year: 2025, status: 'open' },
    { company_id: companyId, name: 'Aug 2025', period_type: 'month', start_date: new Date('2025-08-01'), end_date: new Date('2025-08-31'), fiscal_year: 2025, status: 'open' },
    { company_id: companyId, name: 'Sep 2025', period_type: 'month', start_date: new Date('2025-09-01'), end_date: new Date('2025-09-30'), fiscal_year: 2025, status: 'open' },
    { company_id: companyId, name: 'Oct 2025', period_type: 'month', start_date: new Date('2025-10-01'), end_date: new Date('2025-10-31'), fiscal_year: 2025, status: 'open' },
    { company_id: companyId, name: 'Nov 2025', period_type: 'month', start_date: new Date('2025-11-01'), end_date: new Date('2025-11-30'), fiscal_year: 2025, status: 'open' },
    { company_id: companyId, name: 'Dec 2025', period_type: 'month', start_date: new Date('2025-12-01'), end_date: new Date('2025-12-31'), fiscal_year: 2025, status: 'open' },
    { company_id: companyIdB, name: 'Jan 2025', period_type: 'month', start_date: new Date('2025-01-01'), end_date: new Date('2025-01-31'), fiscal_year: 2025, status: 'open' },
    { company_id: companyIdB, name: 'Feb 2025', period_type: 'month', start_date: new Date('2025-02-01'), end_date: new Date('2025-02-28'), fiscal_year: 2025, status: 'open' },
    { company_id: companyIdB, name: 'Mar 2025', period_type: 'month', start_date: new Date('2025-03-01'), end_date: new Date('2025-03-31'), fiscal_year: 2025, status: 'open' },
    { company_id: companyIdB, name: 'Apr 2025', period_type: 'month', start_date: new Date('2025-04-01'), end_date: new Date('2025-04-30'), fiscal_year: 2025, status: 'open' },
    { company_id: companyIdB, name: 'May 2025', period_type: 'month', start_date: new Date('2025-05-01'), end_date: new Date('2025-05-31'), fiscal_year: 2025, status: 'open' },
    { company_id: companyIdB, name: 'Jun 2025', period_type: 'month', start_date: new Date('2025-06-01'), end_date: new Date('2025-06-30'), fiscal_year: 2025, status: 'open' },
    { company_id: companyIdB, name: 'Jul 2025', period_type: 'month', start_date: new Date('2025-07-01'), end_date: new Date('2025-07-31'), fiscal_year: 2025, status: 'open' },
    { company_id: companyIdB, name: 'Aug 2025', period_type: 'month', start_date: new Date('2025-08-01'), end_date: new Date('2025-08-31'), fiscal_year: 2025, status: 'open' },
    { company_id: companyIdB, name: 'Sep 2025', period_type: 'month', start_date: new Date('2025-09-01'), end_date: new Date('2025-09-30'), fiscal_year: 2025, status: 'open' },
    { company_id: companyIdB, name: 'Oct 2025', period_type: 'month', start_date: new Date('2025-10-01'), end_date: new Date('2025-10-31'), fiscal_year: 2025, status: 'open' },
    { company_id: companyIdB, name: 'Nov 2025', period_type: 'month', start_date: new Date('2025-11-01'), end_date: new Date('2025-11-30'), fiscal_year: 2025, status: 'open' },
    { company_id: companyIdB, name: 'Dec 2025', period_type: 'month', start_date: new Date('2025-12-01'), end_date: new Date('2025-12-31'), fiscal_year: 2025, status: 'open' }
  ];
  await AccountingPeriod.insertMany(periods2025);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await TaxRate.deleteMany({});
  await JournalEntry.deleteMany({});
});

// Helper to create balanced journal entries
async function createBalancedEntry(company, entryNumber, date, description, status, lines) {
  const totalDebit = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (l.credit || 0), 0);
  
  return JournalEntry.create({
    company,
    entryNumber,
    date,
    description,
    status,
    lines,
    totalDebit,
    totalCredit,
    createdBy: userId
  });
}

describe('TaxService - getLiabilityReport()', () => {
  test('output_vat = sum of CR lines on output_account in period', async () => {
    await TaxRate.create({
      company: companyId,
      name: 'Standard VAT',
      code: 'VAT',
      rate_pct: 18,
      type: 'vat',
      input_account_id: new mongoose.Types.ObjectId(),
      output_account_id: new mongoose.Types.ObjectId(),
      input_account_code: '1500',
      output_account_code: '2100',
      is_active: true,
      effective_from: new Date('2025-01-01')
    });

    // Balanced entry: DR AR 18, CR VAT 18
    await createBalancedEntry(
      companyId,
      'JE-001',
      new Date('2025-06-15'),
      'Invoice',
      'posted',
      [
        { accountCode: '1200', accountName: 'Accounts Receivable', debit: 18, credit: 0 },
        { accountCode: '2100', accountName: 'VAT Payable', debit: 0, credit: 18 }
      ]
    );

    const report = await TaxService.getLiabilityReport(companyId, {
      periodStart: '2025-01-01',
      periodEnd: '2025-12-31'
    });

    const vatEntry = report.breakdown.find(b => b.tax_code === 'VAT');
    expect(vatEntry.output_vat).toBe(18);
  });

  test('input_vat = sum of DR lines on input_account in period', async () => {
    await TaxRate.create({
      company: companyId,
      name: 'Standard VAT',
      code: 'VAT',
      rate_pct: 18,
      type: 'vat',
      input_account_id: new mongoose.Types.ObjectId(),
      output_account_id: new mongoose.Types.ObjectId(),
      input_account_code: '1500',
      output_account_code: '2100',
      is_active: true,
      effective_from: new Date('2025-01-01')
    });

    // Balanced entry: DR VAT 18, CR AP 18
    await createBalancedEntry(
      companyId,
      'JE-002',
      new Date('2025-06-20'),
      'Purchase',
      'posted',
      [
        { accountCode: '1500', accountName: 'VAT Receivable', debit: 18, credit: 0 },
        { accountCode: '2100', accountName: 'Accounts Payable', debit: 0, credit: 18 }
      ]
    );

    const report = await TaxService.getLiabilityReport(companyId, {
      periodStart: '2025-01-01',
      periodEnd: '2025-12-31'
    });

    const vatEntry = report.breakdown.find(b => b.tax_code === 'VAT');
    expect(vatEntry.input_vat).toBe(18);
  });

  test('net_payable = output_vat - input_vat', async () => {
    await TaxRate.create({
      company: companyId,
      name: 'Standard VAT',
      code: 'VAT',
      rate_pct: 18,
      type: 'vat',
      input_account_id: new mongoose.Types.ObjectId(),
      output_account_id: new mongoose.Types.ObjectId(),
      input_account_code: '1500',
      output_account_code: '2100',
      is_active: true,
      effective_from: new Date('2025-01-01')
    });

    // Output VAT: DR AR 100, CR VAT 100
    await createBalancedEntry(
      companyId,
      'JE-003',
      new Date('2025-06-15'),
      'Invoice',
      'posted',
      [
        { accountCode: '1200', accountName: 'Accounts Receivable', debit: 100, credit: 0 },
        { accountCode: '2100', accountName: 'VAT Payable', debit: 0, credit: 100 }
      ]
    );

    // Input VAT: DR VAT 30, CR AP 30 (use input_account_code 1500 for DR, AP for CR)
    await createBalancedEntry(
      companyId,
      'JE-004',
      new Date('2025-06-20'),
      'Purchase',
      'posted',
      [
        { accountCode: '1500', accountName: 'VAT Receivable', debit: 30, credit: 0 },
        { accountCode: '2000', accountName: 'Accounts Payable', debit: 0, credit: 30 }
      ]
    );

    const report = await TaxService.getLiabilityReport(companyId, {
      periodStart: '2025-01-01',
      periodEnd: '2025-12-31'
    });

    const vatEntry = report.breakdown.find(b => b.tax_code === 'VAT');
    expect(vatEntry.output_vat).toBe(100);
    expect(vatEntry.input_vat).toBe(30);
    expect(vatEntry.net_payable).toBe(70);
  });

  test('excludes draft journal entries', async () => {
    await TaxRate.create({
      company: companyId,
      name: 'Standard VAT',
      code: 'VAT',
      rate_pct: 18,
      type: 'vat',
      input_account_id: new mongoose.Types.ObjectId(),
      output_account_id: new mongoose.Types.ObjectId(),
      input_account_code: '1500',
      output_account_code: '2100',
      is_active: true,
      effective_from: new Date('2025-01-01')
    });

    // Posted entry - balanced
    await createBalancedEntry(
      companyId,
      'JE-005',
      new Date('2025-06-15'),
      'Posted',
      'posted',
      [
        { accountCode: '1200', accountName: 'AR', debit: 100, credit: 0 },
        { accountCode: '2100', accountName: 'VAT', debit: 0, credit: 100 }
      ]
    );

    // Draft entry - also balanced but should be excluded
    await createBalancedEntry(
      companyId,
      'JE-006',
      new Date('2025-06-20'),
      'Draft',
      'draft',
      [
        { accountCode: '1200', accountName: 'AR', debit: 50, credit: 0 },
        { accountCode: '2100', accountName: 'VAT', debit: 0, credit: 50 }
      ]
    );

    const report = await TaxService.getLiabilityReport(companyId, {
      periodStart: '2025-01-01',
      periodEnd: '2025-12-31'
    });

    const vatEntry = report.breakdown.find(b => b.tax_code === 'VAT');
    expect(vatEntry.output_vat).toBe(100);
  });

  test('excludes reversed journal entries', async () => {
    await TaxRate.create({
      company: companyId,
      name: 'Standard VAT',
      code: 'VAT',
      rate_pct: 18,
      type: 'vat',
      input_account_id: new mongoose.Types.ObjectId(),
      output_account_id: new mongoose.Types.ObjectId(),
      input_account_code: '1500',
      output_account_code: '2100',
      is_active: true,
      effective_from: new Date('2025-01-01')
    });

    const original = await createBalancedEntry(
      companyId,
      'JE-007',
      new Date('2025-06-15'),
      'Invoice',
      'posted',
      [
        { accountCode: '1200', accountName: 'AR', debit: 100, credit: 0 },
        { accountCode: '2100', accountName: 'VAT', debit: 0, credit: 100 }
      ]
    );

    // Reversal entry - also balanced but has reversalOf field
    await JournalEntry.create({
      company: companyId,
      entryNumber: 'JE-008',
      date: new Date('2025-06-20'),
      description: 'Reversal',
      status: 'reversed',
      reversed: true,
      reversalOf: original._id,
      lines: [
        { accountCode: '1200', accountName: 'AR', debit: 0, credit: 100 },
        { accountCode: '2100', accountName: 'VAT', debit: 100, credit: 0 }
      ],
      totalDebit: 100,
      totalCredit: 100,
      createdBy: userId
    });

    const report = await TaxService.getLiabilityReport(companyId, {
      periodStart: '2025-01-01',
      periodEnd: '2025-12-31'
    });

    const vatEntry = report.breakdown.find(b => b.tax_code === 'VAT');
    expect(vatEntry.output_vat).toBe(0);
  });

  test('company A report does not include company B journal lines', async () => {
    await TaxRate.create({
      company: companyId,
      name: 'VAT',
      code: 'VAT',
      rate_pct: 18,
      type: 'vat',
      input_account_id: new mongoose.Types.ObjectId(),
      output_account_id: new mongoose.Types.ObjectId(),
      input_account_code: '1500',
      output_account_code: '2100',
      is_active: true,
      effective_from: new Date('2025-01-01')
    });

    await createBalancedEntry(
      companyId,
      'JE-A-001',
      new Date('2025-06-15'),
      'Company A',
      'posted',
      [
        { accountCode: '1200', accountName: 'AR', debit: 100, credit: 0 },
        { accountCode: '2100', accountName: 'VAT', debit: 0, credit: 100 }
      ]
    );

    await createBalancedEntry(
      companyIdB,
      'JE-B-001',
      new Date('2025-06-15'),
      'Company B',
      'posted',
      [
        { accountCode: '1200', accountName: 'AR', debit: 500, credit: 0 },
        { accountCode: '2100', accountName: 'VAT', debit: 0, credit: 500 }
      ]
    );

    const report = await TaxService.getLiabilityReport(companyId, {
      periodStart: '2025-01-01',
      periodEnd: '2025-12-31'
    });

    const vatEntry = report.breakdown.find(b => b.tax_code === 'VAT');
    expect(vatEntry.output_vat).toBe(100);
  });

  test('filters correctly by tax_code when provided', async () => {
    await TaxRate.create({
      company: companyId,
      name: 'VAT',
      code: 'VAT',
      rate_pct: 18,
      type: 'vat',
      input_account_id: new mongoose.Types.ObjectId(),
      output_account_id: new mongoose.Types.ObjectId(),
      input_account_code: '1500',
      output_account_code: '2100',
      is_active: true,
      effective_from: new Date('2025-01-01')
    });

    await TaxRate.create({
      company: companyId,
      name: 'Exempt',
      code: 'EXEMPT',
      rate_pct: 0,
      type: 'exempt',
      input_account_id: new mongoose.Types.ObjectId(),
      output_account_id: new mongoose.Types.ObjectId(),
      input_account_code: '1501',
      output_account_code: '2101',
      is_active: true,
      effective_from: new Date('2025-01-01')
    });

    await createBalancedEntry(
      companyId,
      'JE-VAT-001',
      new Date('2025-06-15'),
      'VAT',
      'posted',
      [
        { accountCode: '1200', accountName: 'AR', debit: 100, credit: 0 },
        { accountCode: '2100', accountName: 'VAT', debit: 0, credit: 100 }
      ]
    );

    await createBalancedEntry(
      companyId,
      'JE-EXEMPT-001',
      new Date('2025-06-15'),
      'Exempt',
      'posted',
      [
        { accountCode: '1200', accountName: 'AR', debit: 50, credit: 0 },
        { accountCode: '2101', accountName: 'Exempt', debit: 0, credit: 50 }
      ]
    );

    const report = await TaxService.getLiabilityReport(companyId, {
      periodStart: '2025-01-01',
      periodEnd: '2025-12-31',
      taxCode: 'VAT'
    });

    expect(report.breakdown.length).toBe(1);
    expect(report.breakdown[0].tax_code).toBe('VAT');
  });

  test('returns zeroes for period with no transactions', async () => {
    await TaxRate.create({
      company: companyId,
      name: 'VAT',
      code: 'VAT',
      rate_pct: 18,
      type: 'vat',
      input_account_id: new mongoose.Types.ObjectId(),
      output_account_id: new mongoose.Types.ObjectId(),
      input_account_code: '1500',
      output_account_code: '2100',
      is_active: true,
      effective_from: new Date('2025-01-01')
    });

    const report = await TaxService.getLiabilityReport(companyId, {
      periodStart: '2025-01-01',
      periodEnd: '2025-12-31'
    });

    const vatEntry = report.breakdown.find(b => b.tax_code === 'VAT');
    expect(vatEntry.output_vat).toBe(0);
    expect(vatEntry.input_vat).toBe(0);
    expect(vatEntry.net_payable).toBe(0);
  });

  test('breakdown array contains one row per active tax rate', async () => {
    await TaxRate.create({
      company: companyId,
      name: 'VAT',
      code: 'VAT',
      rate_pct: 18,
      type: 'vat',
      input_account_id: new mongoose.Types.ObjectId(),
      output_account_id: new mongoose.Types.ObjectId(),
      input_account_code: '1500',
      output_account_code: '2100',
      is_active: true,
      effective_from: new Date('2025-01-01')
    });

    await TaxRate.create({
      company: companyId,
      name: 'Exempt',
      code: 'EXEMPT',
      rate_pct: 0,
      type: 'exempt',
      input_account_id: new mongoose.Types.ObjectId(),
      output_account_id: new mongoose.Types.ObjectId(),
      input_account_code: '1501',
      output_account_code: '2101',
      is_active: true,
      effective_from: new Date('2025-01-01')
    });

    await TaxRate.create({
      company: companyId,
      name: 'Withholding',
      code: 'WHT',
      rate_pct: 5,
      type: 'withholding',
      input_account_id: new mongoose.Types.ObjectId(),
      output_account_id: new mongoose.Types.ObjectId(),
      input_account_code: '1502',
      output_account_code: '2500',
      is_active: false,
      effective_from: new Date('2025-01-01')
    });

    const report = await TaxService.getLiabilityReport(companyId, {
      periodStart: '2025-01-01',
      periodEnd: '2025-12-31'
    });

    expect(report.breakdown.length).toBe(2);
    expect(report.breakdown.map(b => b.tax_code).sort()).toEqual(['EXEMPT', 'VAT']);
  });
});

describe('TaxService - postSettlement()', () => {
  test('posts DR VAT Output CR Bank — balanced', async () => {
    const taxRate = await TaxRate.create({
      company: companyId,
      name: 'VAT',
      code: 'VAT',
      rate_pct: 18,
      type: 'vat',
      input_account_id: new mongoose.Types.ObjectId(),
      output_account_id: new mongoose.Types.ObjectId(),
      input_account_code: '1500',
      output_account_code: '2100',
      is_active: true,
      effective_from: new Date('2025-01-01')
    });

    const bankAccount = await BankAccount.create({
      company: companyId,
      name: 'Test Bank',
      accountNumber: '123456',
      accountType: 'bk_bank',
      accountCode: '1100',
      balance: 0,
      openingBalanceDate: new Date(),
      isActive: true,
      currencyCode: 'RWF',
      createdBy: userId,
      currentBalance: 10000
    });

    const result = await TaxService.postSettlement(companyId, {
      tax_code: 'VAT',
      amount: 1000,
      settlement_date: new Date('2025-06-30'),
      period_description: 'June 2025',
      bank_account_id: bankAccount._id,
      payment_method: 'bank'
    }, userId);

    expect(result.amount).toBe(1000);
    expect(result.journal_entry_id).toBeDefined();

    const je = await JournalEntry.findById(result.journal_entry_id);
    expect(je.totalDebit).toBe(1000);
    expect(je.totalCredit).toBe(1000);

    const drLine = je.lines.find(l => l.accountCode === '2100');
    const crLine = je.lines.find(l => l.accountCode === '1100');
    expect(Number(drLine.debit.toString())).toBe(1000);
    expect(Number(crLine.credit.toString())).toBe(1000);
  });

  test('throws TAX_RATE_NOT_FOUND when tax_code belongs to different company', async () => {
    await TaxRate.create({
      company: companyIdB,
      name: 'VAT',
      code: 'VAT',
      rate_pct: 18,
      type: 'vat',
      input_account_id: new mongoose.Types.ObjectId(),
      output_account_id: new mongoose.Types.ObjectId(),
      input_account_code: '1500',
      output_account_code: '2100',
      is_active: true,
      effective_from: new Date('2025-01-01')
    });

    await expect(
      TaxService.postSettlement(companyId, {
        tax_code: 'VAT',
        amount: 1000,
        settlement_date: new Date('2025-06-30')
      }, userId)
    ).rejects.toThrow('TAX_RATE_NOT_FOUND');
  });

  test('throws NOT_FOUND when bank_account belongs to different company', async () => {
    await TaxRate.create({
      company: companyId,
      name: 'VAT',
      code: 'VAT',
      rate_pct: 18,
      type: 'vat',
      input_account_id: new mongoose.Types.ObjectId(),
      output_account_id: new mongoose.Types.ObjectId(),
      input_account_code: '1500',
      output_account_code: '2100',
      is_active: true,
      effective_from: new Date('2025-01-01')
    });

    const bankAccount = await BankAccount.create({
      company: companyIdB,
      name: 'Bank B',
      accountNumber: '999999',
      accountType: 'bk_bank',
      accountCode: '1100',
      balance: 0,
      openingBalanceDate: new Date(),
      isActive: true,
      currencyCode: 'RWF',
      createdBy: userId,
      currentBalance: 10000
    });

    await expect(
      TaxService.postSettlement(companyId, {
        tax_code: 'VAT',
        amount: 1000,
        settlement_date: new Date('2025-06-30'),
        bank_account_id: bankAccount._id
      }, userId)
    ).rejects.toThrow('BANK_ACCOUNT_NOT_FOUND');
  });
});
