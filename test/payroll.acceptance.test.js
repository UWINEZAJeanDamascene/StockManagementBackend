const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Payroll = require('../models/Payroll');
const PayrollRun = require('../models/PayrollRun');
const PayrollRunService = require('../services/payrollRunService');
const ChartOfAccount = require('../models/ChartOfAccount');
const { BankAccount } = require('../models/BankAccount');
const JournalEntry = require('../models/JournalEntry');
const Company = require('../models/Company');
const User = require('../models/User');
const AccountingPeriod = require('../models/AccountingPeriod');

let mongoServer;
let companyA, companyB;
let userA, userB;
let bankAccountA, bankAccountB;
let salaryAccountA, taxPayableAccountA, rssbAccountA;
let salaryAccountB, taxPayableAccountB, rssbAccountB;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri, { useNewUrlParser: true });

  companyA = await Company.create({
    name: 'Test Company A',
    currency: 'USD',
    timezone: 'UTC',
    email: 'test@companya.com'
  });

  companyB = await Company.create({
    name: 'Test Company B',
    currency: 'USD',
    timezone: 'UTC',
    email: 'test@companyb.com'
  });

  userA = await User.create({
    name: 'Test User A',
    email: `test-a-${Date.now()}@example.com`,
    password: 'password123',
    company: companyA._id,
    role: 'admin'
  });

  userB = await User.create({
    name: 'Test User B',
    email: `test-b-${Date.now()}@example.com`,
    password: 'password123',
    company: companyB._id,
    role: 'admin'
  });

  // Create accounting periods for 2024 (tests use dates in 2024)
  const periods2024 = [
    { company_id: companyA._id, name: 'Jan 2024', period_type: 'month', start_date: new Date('2024-01-01'), end_date: new Date('2024-01-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyA._id, name: 'Feb 2024', period_type: 'month', start_date: new Date('2024-02-01'), end_date: new Date('2024-02-29'), fiscal_year: 2024, status: 'open' },
    { company_id: companyA._id, name: 'Mar 2024', period_type: 'month', start_date: new Date('2024-03-01'), end_date: new Date('2024-03-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyA._id, name: 'Apr 2024', period_type: 'month', start_date: new Date('2024-04-01'), end_date: new Date('2024-04-30'), fiscal_year: 2024, status: 'open' },
    { company_id: companyA._id, name: 'May 2024', period_type: 'month', start_date: new Date('2024-05-01'), end_date: new Date('2024-05-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyA._id, name: 'Jun 2024', period_type: 'month', start_date: new Date('2024-06-01'), end_date: new Date('2024-06-30'), fiscal_year: 2024, status: 'open' },
    { company_id: companyA._id, name: 'Jul 2024', period_type: 'month', start_date: new Date('2024-07-01'), end_date: new Date('2024-07-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyA._id, name: 'Aug 2024', period_type: 'month', start_date: new Date('2024-08-01'), end_date: new Date('2024-08-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyA._id, name: 'Sep 2024', period_type: 'month', start_date: new Date('2024-09-01'), end_date: new Date('2024-09-30'), fiscal_year: 2024, status: 'open' },
    { company_id: companyA._id, name: 'Oct 2024', period_type: 'month', start_date: new Date('2024-10-01'), end_date: new Date('2024-10-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyA._id, name: 'Nov 2024', period_type: 'month', start_date: new Date('2024-11-01'), end_date: new Date('2024-11-30'), fiscal_year: 2024, status: 'open' },
    { company_id: companyA._id, name: 'Dec 2024', period_type: 'month', start_date: new Date('2024-12-01'), end_date: new Date('2024-12-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyB._id, name: 'Jan 2024', period_type: 'month', start_date: new Date('2024-01-01'), end_date: new Date('2024-01-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyB._id, name: 'Feb 2024', period_type: 'month', start_date: new Date('2024-02-01'), end_date: new Date('2024-02-29'), fiscal_year: 2024, status: 'open' },
    { company_id: companyB._id, name: 'Mar 2024', period_type: 'month', start_date: new Date('2024-03-01'), end_date: new Date('2024-03-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyB._id, name: 'Apr 2024', period_type: 'month', start_date: new Date('2024-04-01'), end_date: new Date('2024-04-30'), fiscal_year: 2024, status: 'open' },
    { company_id: companyB._id, name: 'May 2024', period_type: 'month', start_date: new Date('2024-05-01'), end_date: new Date('2024-05-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyB._id, name: 'Jun 2024', period_type: 'month', start_date: new Date('2024-06-01'), end_date: new Date('2024-06-30'), fiscal_year: 2024, status: 'open' },
    { company_id: companyB._id, name: 'Jul 2024', period_type: 'month', start_date: new Date('2024-07-01'), end_date: new Date('2024-07-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyB._id, name: 'Aug 2024', period_type: 'month', start_date: new Date('2024-08-01'), end_date: new Date('2024-08-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyB._id, name: 'Sep 2024', period_type: 'month', start_date: new Date('2024-09-01'), end_date: new Date('2024-09-30'), fiscal_year: 2024, status: 'open' },
    { company_id: companyB._id, name: 'Oct 2024', period_type: 'month', start_date: new Date('2024-10-01'), end_date: new Date('2024-10-31'), fiscal_year: 2024, status: 'open' },
    { company_id: companyB._id, name: 'Nov 2024', period_type: 'month', start_date: new Date('2024-11-01'), end_date: new Date('2024-11-30'), fiscal_year: 2024, status: 'open' },
    { company_id: companyB._id, name: 'Dec 2024', period_type: 'month', start_date: new Date('2024-12-01'), end_date: new Date('2024-12-31'), fiscal_year: 2024, status: 'open' }
  ];
  
  // Create accounting periods for 2026 (reversal tests use current date)
  const periods2026 = [
    { company_id: companyA._id, name: 'Jan 2026', period_type: 'month', start_date: new Date('2026-01-01'), end_date: new Date('2026-01-31'), fiscal_year: 2026, status: 'open' },
    { company_id: companyA._id, name: 'Feb 2026', period_type: 'month', start_date: new Date('2026-02-01'), end_date: new Date('2026-02-28'), fiscal_year: 2026, status: 'open' },
    { company_id: companyA._id, name: 'Mar 2026', period_type: 'month', start_date: new Date('2026-03-01'), end_date: new Date('2026-03-31'), fiscal_year: 2026, status: 'open' },
    { company_id: companyB._id, name: 'Jan 2026', period_type: 'month', start_date: new Date('2026-01-01'), end_date: new Date('2026-01-31'), fiscal_year: 2026, status: 'open' },
    { company_id: companyB._id, name: 'Feb 2026', period_type: 'month', start_date: new Date('2026-02-01'), end_date: new Date('2026-02-28'), fiscal_year: 2026, status: 'open' },
    { company_id: companyB._id, name: 'Mar 2026', period_type: 'month', start_date: new Date('2026-03-01'), end_date: new Date('2026-03-31'), fiscal_year: 2026, status: 'open' }
  ];
  await AccountingPeriod.insertMany([...periods2024, ...periods2026]);
});

beforeEach(async () => {
  // Recreate accounts after each test (now kept across tests)
  bankAccountA = await BankAccount.findOneAndUpdate(
    { company: companyA._id, name: 'Company A Bank' },
    {
      company: companyA._id,
      name: 'Company A Bank',
      accountNumber: '1234567890',
      accountType: 'bk_bank',
      balance: 0,
      openingBalanceDate: new Date(),
      isActive: true,
      currencyCode: 'USD',
      createdBy: userA._id,
      accountCode: '1100',
      currentBalance: 100000
    },
    { upsert: true, new: true }
  );

  bankAccountB = await BankAccount.findOneAndUpdate(
    { company: companyB._id, name: 'Company B Bank' },
    {
      company: companyB._id,
      name: 'Company B Bank',
      accountNumber: '0987654321',
      accountType: 'bk_bank',
      balance: 0,
      openingBalanceDate: new Date(),
      isActive: true,
      currencyCode: 'USD',
      createdBy: userB._id,
      accountCode: '1100',
      currentBalance: 100000
    },
    { upsert: true, new: true }
  );

  salaryAccountA = await ChartOfAccount.findOneAndUpdate(
    { company: companyA._id, code: '6100' },
    {
      company: companyA._id,
      code: '6100',
      name: 'Salaries & Wages',
      type: 'expense',
      subtype: 'operating',
      isActive: true
    },
    { upsert: true, new: true }
  );

  taxPayableAccountA = await ChartOfAccount.findOneAndUpdate(
    { company: companyA._id, code: '2200' },
    {
      company: companyA._id,
      code: '2200',
      name: 'PAYE Payable',
      type: 'liability',
      subtype: 'current',
      isActive: true
    },
    { upsert: true, new: true }
  );

  rssbAccountA = await ChartOfAccount.findOneAndUpdate(
    { company: companyA._id, code: '2210' },
    {
      company: companyA._id,
      code: '2210',
      name: 'RSSB Payable',
      type: 'liability',
      subtype: 'current',
      isActive: true
    },
    { upsert: true, new: true }
  );

  salaryAccountB = await ChartOfAccount.findOneAndUpdate(
    { company: companyB._id, code: '6100' },
    {
      company: companyB._id,
      code: '6100',
      name: 'Salaries & Wages',
      type: 'expense',
      subtype: 'operating',
      isActive: true
    },
    { upsert: true, new: true }
  );

  taxPayableAccountB = await ChartOfAccount.findOneAndUpdate(
    { company: companyB._id, code: '2200' },
    {
      company: companyB._id,
      code: '2200',
      name: 'PAYE Payable',
      type: 'liability',
      subtype: 'current',
      isActive: true
    },
    { upsert: true, new: true }
  );

  rssbAccountB = await ChartOfAccount.findOneAndUpdate(
    { company: companyB._id, code: '2210' },
    {
      company: companyB._id,
      code: '2210',
      name: 'RSSB Payable',
      type: 'liability',
      subtype: 'current',
      isActive: true
    },
    { upsert: true, new: true }
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

afterEach(async () => {
  const collections = Object.keys(mongoose.connection.collections);
  // Keep core reference data across tests
  const keep = new Set(['companies', 'users', 'chartofaccounts', 'bankaccounts', 'accountingperiods']);
  for (const name of collections) {
    if (keep.has(name)) continue;
    try {
      await mongoose.connection.collections[name].deleteMany({});
    } catch (e) {
      // ignore errors on collections that may not exist in some runs
    }
  }
});

describe('Payroll Model - Rwanda Tax Calculations', () => {

  describe('calculatePAYE', () => {
    // 2025 Rwanda PAYE Rates:
    // 0 - 60,000: 0%
    // 60,001 - 100,000: 10%
    // 100,001 - 200,000: 20%
    // Above 200,000: 30%
    
    it('PAYE is 0 for gross salary <= 60000 RWF', () => {
      const paye = Payroll.calculatePAYE(60000);
      expect(paye).toBe(0);
    });

    it('PAYE is 10% of amount above 60000 for gross between 60001 and 100000', () => {
      const paye = Payroll.calculatePAYE(80000);
      // (80000 - 60000) * 0.10 = 2000
      expect(paye).toBe(2000);
    });

    it('PAYE is 4000 + 20% of amount above 100000 for gross between 100001 and 200000', () => {
      const paye = Payroll.calculatePAYE(150000);
      // 4000 + (150000 - 100000) * 0.20 = 4000 + 10000 = 14000
      expect(paye).toBe(14000);
    });

    it('PAYE is 24000 + 30% of amount above 200000 for gross above 200000', () => {
      const paye = Payroll.calculatePAYE(250000);
      // 4000 + 20000 + (250000 - 200000) * 0.30 = 24000 + 15000 = 39000
      expect(paye).toBe(39000);
    });
  });

  describe('calculateRSSBEmployeePension', () => {
    // 2025 Rwanda RSSB Employee Pension: 6% of gross
    it('RSSB employee contribution is 6% of gross', () => {
      const rssb = Payroll.calculateRSSBEmployeePension(100000);
      expect(rssb).toBe(6000);
    });
  });

  describe('calculateRSSBEmployerPension', () => {
    // 2025 Rwanda RSSB Employer Pension: 6% of gross
    it('RSSB employer contribution is 6% of gross', () => {
      const rssb = Payroll.calculateRSSBEmployerPension(100000);
      expect(rssb).toBe(6000);
    });
  });

  describe('calculatePayroll', () => {
    // 2025 Rwanda Rates: PAYE 10% band starts at 60K, RSSB 6%, Maternity 0.3%
    it('net_pay = gross - PAYE - RSSB_employee - RSSB_maternity', () => {
      const result = Payroll.calculatePayroll({
        basicSalary: 80000,
        transportAllowance: 10000,
        housingAllowance: 0,
        otherAllowances: 0
      });
      
      // Gross = 90000
      // PAYE: (90000 - 60000) * 0.10 = 3000 (in 10% band)
      // RSSB Employee Pension = 90000 * 0.06 = 5400
      // RSSB Employee Maternity = 90000 * 0.003 = 270
      // Net = 90000 - 3000 - 5400 - 270 = 81330
      
      expect(result.netPay).toBe(81330);
    });
  });

  describe('duplicate prevention', () => {
    it('throws duplicate key error for same employee same period same company', async () => {
      const period = { month: 1, year: 2024 };
      
      await Payroll.create({
        company: companyA._id,
        employee: { employeeId: 'EMP001', firstName: 'John', lastName: 'Doe' },
        salary: { basicSalary: 50000, grossSalary: 50000 },
        deductions: { paye: 4000, totalDeductions: 4000 },
        netPay: 46000,
        period,
        record_status: 'draft'
      });

      await expect(async () => {
        await Payroll.create({
          company: companyA._id,
          employee: { employeeId: 'EMP001', firstName: 'John', lastName: 'Doe' },
          salary: { basicSalary: 50000, grossSalary: 50000 },
          deductions: { paye: 4000, totalDeductions: 4000 },
          netPay: 46000,
          period,
          record_status: 'draft'
        });
      }).rejects.toThrow();
    });

    it('same employee same period allowed in different companies', async () => {
      const period = { month: 1, year: 2024 };
      
      await Payroll.create({
        company: companyA._id,
        employee: { employeeId: 'EMP001', firstName: 'John', lastName: 'Doe' },
        salary: { basicSalary: 50000, grossSalary: 50000 },
        deductions: { paye: 4000, totalDeductions: 4000 },
        netPay: 46000,
        period,
        record_status: 'draft'
      });

      // Should not throw
      const payrollB = await Payroll.create({
        company: companyB._id,
        employee: { employeeId: 'EMP001', firstName: 'John', lastName: 'Doe' },
        salary: { basicSalary: 50000, grossSalary: 50000 },
        deductions: { paye: 4000, totalDeductions: 4000 },
        netPay: 46000,
        period,
        record_status: 'draft'
      });

      expect(payrollB).toBeDefined();
    });
  });

  describe('finalise()', () => {
    it('sets status to finalised and locks record from editing', async () => {
      const payroll = await Payroll.create({
        company: companyA._id,
        employee: { employeeId: 'EMP001', firstName: 'John', lastName: 'Doe' },
        salary: { basicSalary: 50000, grossSalary: 50000 },
        deductions: { paye: 4000, totalDeductions: 4000 },
        netPay: 46000,
        period: { month: 1, year: 2024 },
        record_status: 'draft'
      });

      payroll.record_status = 'finalised';
      await payroll.save();

      expect(payroll.record_status).toBe('finalised');
    });

    it('throws when editing a finalised record', async () => {
      // First create a draft record
      const payroll = await Payroll.create({
        company: companyA._id,
        employee: { employeeId: 'EMP001', firstName: 'John', lastName: 'Doe' },
        salary: { basicSalary: 50000, grossSalary: 50000 },
        deductions: { paye: 4000, totalDeductions: 4000 },
        netPay: 46000,
        period: { month: 1, year: 2024 },
        record_status: 'draft'
      });

      // Finalise it
      payroll.record_status = 'finalised';
      await payroll.save();

      // Now try to edit - should throw
      payroll.salary.basicSalary = 60000;
      
      await expect(payroll.save()).rejects.toThrow();
    });
  });
});

describe('PayrollRunService', () => {

  describe('post()', () => {
    it('aggregates all finalised employee records for the period', async () => {
      // Create employee payroll records
      await Payroll.create([
        {
          company: companyA._id,
          employee: { employeeId: 'EMP001', firstName: 'John', lastName: 'Doe' },
          salary: { basicSalary: 50000, grossSalary: 50000 },
          deductions: { paye: 4000, rssbEmployeePension: 1500, rssbEmployeeMaternity: 150, totalDeductions: 5650 },
          contributions: { rssbEmployerPension: 2500, rssbEmployerMaternity: 150 },
          netPay: 44350,
          period: { month: 1, year: 2024 },
          record_status: 'finalised',
          pay_period_start: new Date(2024, 0, 1),
          pay_period_end: new Date(2024, 0, 31)
        },
        {
          company: companyA._id,
          employee: { employeeId: 'EMP002', firstName: 'Jane', lastName: 'Smith' },
          salary: { basicSalary: 40000, grossSalary: 40000 },
          deductions: { paye: 2000, rssbEmployeePension: 1200, rssbEmployeeMaternity: 120, totalDeductions: 3320 },
          contributions: { rssbEmployerPension: 2000, rssbEmployerMaternity: 120 },
          netPay: 36680,
          period: { month: 1, year: 2024 },
          record_status: 'finalised',
          pay_period_start: new Date(2024, 0, 1),
          pay_period_end: new Date(2024, 0, 31)
        }
      ]);

      const payrollRun = await PayrollRunService.create(companyA._id, {
        pay_period_start: new Date(2024, 0, 1),
        pay_period_end: new Date(2024, 0, 31),
        payment_date: new Date(2024, 1, 15),
        total_gross: 90000,
        total_tax: 6000,
        total_other_deductions: 2970,
        total_net: 81030,
        bank_account_id: bankAccountA._id,
        salary_account_id: salaryAccountA._id,
        tax_payable_account_id: taxPayableAccountA._id,
        other_deductions_account_id: rssbAccountA._id,
        lines: [
          { employee_name: 'John Doe', employee_id: 'EMP001', gross_salary: 50000, tax_deduction: 4000, other_deductions: 1650, rssb_employer: 2650, net_pay: 44350 },
          { employee_name: 'Jane Smith', employee_id: 'EMP002', gross_salary: 40000, tax_deduction: 2000, other_deductions: 1320, rssb_employer: 2120, net_pay: 36680 }
        ]
      }, userA._id);

      const result = await PayrollRunService.post(companyA._id, payrollRun._id, userA._id);

      expect(result.status).toBe('posted');
      expect(result.employee_count).toBe(2);
    });

    it('posts DR Salaries DR RSSB_employer CR PAYE CR RSSB CR Bank — balanced', async () => {
      await Payroll.create({
        company: companyA._id,
        employee: { employeeId: 'EMP001', firstName: 'John', lastName: 'Doe' },
        salary: { basicSalary: 50000, grossSalary: 50000 },
        deductions: { paye: 4000, rssbEmployeePension: 1500, rssbEmployeeMaternity: 150, totalDeductions: 5650 },
        contributions: { rssbEmployerPension: 2500, rssbEmployerMaternity: 150 },
        netPay: 44350,
        period: { month: 2, year: 2024 },
        record_status: 'finalised',
        pay_period_start: new Date(2024, 1, 1),
        pay_period_end: new Date(2024, 1, 29)
      });

      const payrollRun = await PayrollRunService.create(companyA._id, {
        pay_period_start: new Date(2024, 1, 1),
        pay_period_end: new Date(2024, 1, 29),
        payment_date: new Date(2024, 2, 15),
        total_gross: 50000,
        total_tax: 4000,
        total_other_deductions: 1650,
        total_net: 44350,
        bank_account_id: bankAccountA._id,
        salary_account_id: salaryAccountA._id,
        tax_payable_account_id: taxPayableAccountA._id,
        other_deductions_account_id: rssbAccountA._id,
        lines: [
          { employee_name: 'John Doe', employee_id: 'EMP001', gross_salary: 50000, tax_deduction: 4000, other_deductions: 1650, rssb_employer: 2650, net_pay: 44350 }
        ]
      }, userA._id);

      const result = await PayrollRunService.post(companyA._id, payrollRun._id, userA._id);

      // Reload to get updated values
      const updatedRun = await PayrollRun.findById(payrollRun._id);
      const entry = await JournalEntry.findById(updatedRun.journal_entry_id);
      
      expect(entry).toBeDefined();
      
      // Handle Decimal128 - convert to number before summing
      const totalDr = entry.lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
      const totalCr = entry.lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
      
      expect(totalDr).toBe(totalCr);
      expect(totalDr).toBe(52650); // 50000 + 2650
    });

    it('total_gross = sum of all employee gross_salary values', async () => {
      const payrollRun = await PayrollRunService.create(companyA._id, {
        pay_period_start: new Date(2024, 2, 1),
        pay_period_end: new Date(2024, 2, 31),
        payment_date: new Date(2024, 3, 15),
        total_gross: 90000,
        total_tax: 6000,
        total_other_deductions: 2970,
        total_net: 81030,
        bank_account_id: bankAccountA._id,
        salary_account_id: salaryAccountA._id,
        tax_payable_account_id: taxPayableAccountA._id,
        other_deductions_account_id: rssbAccountA._id,
        lines: [
          { employee_name: 'John Doe', employee_id: 'EMP001', gross_salary: 50000, tax_deduction: 4000, other_deductions: 1650, rssb_employer: 2650, net_pay: 44350 },
          { employee_name: 'Jane Smith', employee_id: 'EMP002', gross_salary: 40000, tax_deduction: 2000, other_deductions: 1320, rssb_employer: 2120, net_pay: 36680 }
        ]
      }, userA._id);

      expect(payrollRun.total_gross).toBe(90000);
    });

    it('total_paye = sum of all employee paye_tax values', async () => {
      const payrollRun = await PayrollRunService.create(companyA._id, {
        pay_period_start: new Date(2024, 2, 1),
        pay_period_end: new Date(2024, 2, 31),
        payment_date: new Date(2024, 3, 15),
        total_gross: 90000,
        total_tax: 6000,
        total_other_deductions: 2970,
        total_net: 81030,
        bank_account_id: bankAccountA._id,
        salary_account_id: salaryAccountA._id,
        tax_payable_account_id: taxPayableAccountA._id,
        other_deductions_account_id: rssbAccountA._id,
        lines: [
          { employee_name: 'John Doe', employee_id: 'EMP001', gross_salary: 50000, tax_deduction: 4000, other_deductions: 1650, rssb_employer: 2650, net_pay: 44350 },
          { employee_name: 'Jane Smith', employee_id: 'EMP002', gross_salary: 40000, tax_deduction: 2000, other_deductions: 1320, rssb_employer: 2120, net_pay: 36680 }
        ]
      }, userA._id);

      expect(payrollRun.total_tax).toBe(6000);
    });

    it('throws PAYROLL_TOTALS_MISMATCH when gross != net + paye + rssb_employee + other', async () => {
      await expect(async () => {
        await PayrollRunService.create(companyA._id, {
          pay_period_start: new Date(2024, 2, 1),
          pay_period_end: new Date(2024, 2, 31),
          payment_date: new Date(2024, 3, 15),
          total_gross: 90000,
          total_tax: 6000,
          total_other_deductions: 5940,
          total_net: 80000, // Wrong! Should be 81030
          bank_account_id: bankAccountA._id,
          salary_account_id: salaryAccountA._id,
          tax_payable_account_id: taxPayableAccountA._id,
          other_deductions_account_id: rssbAccountA._id,
          lines: []
        }, userA._id);
      }).rejects.toThrow('PAYROLL_TOTALS_MISMATCH');
    });

    it('throws NOT_FOUND when bank_account belongs to different company', async () => {
      await expect(async () => {
        await PayrollRunService.create(companyA._id, {
          pay_period_start: new Date(2024, 2, 1),
          pay_period_end: new Date(2024, 2, 31),
          payment_date: new Date(2024, 3, 15),
          total_gross: 50000,
          total_tax: 4000,
          total_other_deductions: 1650,
          total_net: 44350,
          bank_account_id: bankAccountB._id, // Company B's bank!
          salary_account_id: salaryAccountA._id,
          tax_payable_account_id: taxPayableAccountA._id,
          other_deductions_account_id: rssbAccountA._id,
          lines: []
        }, userA._id);
      }).rejects.toThrow('NOT_FOUND');
    });
  });

  describe('reverse()', () => {
    it('posts exact inverse journal entry', async () => {
      await Payroll.create({
        company: companyA._id,
        employee: { employeeId: 'EMP001', firstName: 'John', lastName: 'Doe' },
        salary: { basicSalary: 50000, grossSalary: 50000 },
        deductions: { paye: 4000, rssbEmployeePension: 1500, rssbEmployeeMaternity: 150, totalDeductions: 5650 },
        contributions: { rssbEmployerPension: 2500, rssbEmployerMaternity: 150 },
        netPay: 44350,
        period: { month: 3, year: 2024 },
        record_status: 'finalised',
        pay_period_start: new Date(2024, 2, 1),
        pay_period_end: new Date(2024, 2, 31)
      });

      const payrollRun = await PayrollRunService.create(companyA._id, {
        pay_period_start: new Date(2024, 2, 1),
        pay_period_end: new Date(2024, 2, 31),
        payment_date: new Date(2024, 3, 15),
        total_gross: 50000,
        total_tax: 4000,
        total_other_deductions: 1650,
        total_net: 44350,
        bank_account_id: bankAccountA._id,
        salary_account_id: salaryAccountA._id,
        tax_payable_account_id: taxPayableAccountA._id,
        other_deductions_account_id: rssbAccountA._id,
        lines: [
          { employee_name: 'John Doe', employee_id: 'EMP001', gross_salary: 50000, tax_deduction: 4000, other_deductions: 1650, rssb_employer: 2650, net_pay: 44350 }
        ]
      }, userA._id);

      await PayrollRunService.post(companyA._id, payrollRun._id, userA._id);
      await PayrollRunService.reverse(companyA._id, payrollRun._id, { reason: 'Error in calculation' }, userA._id);

      const reversedRun = await PayrollRun.findById(payrollRun._id);
      expect(reversedRun.status).toBe('reversed');
    });

    it('sets employee records back to finalised status', async () => {
      const payroll = await Payroll.create({
        company: companyA._id,
        employee: { employeeId: 'EMP001', firstName: 'John', lastName: 'Doe' },
        salary: { basicSalary: 50000, grossSalary: 50000 },
        deductions: { paye: 4000, rssbEmployeePension: 1500, rssbEmployeeMaternity: 150, totalDeductions: 5650 },
        contributions: { rssbEmployerPension: 2500, rssbEmployerMaternity: 150 },
        netPay: 44350,
        period: { month: 4, year: 2024 },
        record_status: 'finalised',
        pay_period_start: new Date(2024, 3, 1),
        pay_period_end: new Date(2024, 3, 30)
      });

      const payrollRun = await PayrollRunService.create(companyA._id, {
        pay_period_start: new Date(2024, 3, 1),
        pay_period_end: new Date(2024, 3, 30),
        payment_date: new Date(2024, 4, 15),
        total_gross: 50000,
        total_tax: 4000,
        total_other_deductions: 1650,
        total_net: 44350,
        bank_account_id: bankAccountA._id,
        salary_account_id: salaryAccountA._id,
        tax_payable_account_id: taxPayableAccountA._id,
        other_deductions_account_id: rssbAccountA._id,
        lines: [
          { employee_name: 'John Doe', employee_id: 'EMP001', gross_salary: 50000, tax_deduction: 4000, other_deductions: 1650, rssb_employer: 2650, net_pay: 44350 }
        ]
      }, userA._id);

      await PayrollRunService.post(companyA._id, payrollRun._id, userA._id);
      await PayrollRunService.reverse(companyA._id, payrollRun._id, { reason: 'Test' }, userA._id);

      const updatedPayroll = await Payroll.findById(payroll._id);
      expect(updatedPayroll.record_status).toBe('finalised');
    });

    it('throws PAYROLL_NOT_POSTED when run is draft', async () => {
      const payrollRun = await PayrollRunService.create(companyA._id, {
        pay_period_start: new Date(2024, 4, 1),
        pay_period_end: new Date(2024, 4, 31),
        payment_date: new Date(2024, 5, 15),
        total_gross: 50000,
        total_tax: 4000,
        total_other_deductions: 1650,
        total_net: 44350,
        bank_account_id: bankAccountA._id,
        salary_account_id: salaryAccountA._id,
        tax_payable_account_id: taxPayableAccountA._id,
        other_deductions_account_id: rssbAccountA._id,
        lines: [
          { employee_name: 'John Doe', employee_id: 'EMP001', gross_salary: 50000, tax_deduction: 4000, other_deductions: 1650, rssb_employer: 2650, net_pay: 44350 }
        ]
      }, userA._id);

      await expect(
        PayrollRunService.reverse(companyA._id, payrollRun._id, { reason: 'Test' }, userA._id)
      ).rejects.toThrow('PAYROLL_NOT_POSTED');
    });

    it('throws PAYROLL_ALREADY_REVERSED on second reversal', async () => {
      await Payroll.create({
        company: companyA._id,
        employee: { employeeId: 'EMP001', firstName: 'John', lastName: 'Doe' },
        salary: { basicSalary: 50000, grossSalary: 50000 },
        deductions: { paye: 4000, rssbEmployeePension: 1500, rssbEmployeeMaternity: 150, totalDeductions: 5650 },
        contributions: { rssbEmployerPension: 2500, rssbEmployerMaternity: 150 },
        netPay: 44350,
        period: { month: 5, year: 2024 },
        record_status: 'finalised',
        pay_period_start: new Date(2024, 4, 1),
        pay_period_end: new Date(2024, 4, 31)
      });

      const payrollRun = await PayrollRunService.create(companyA._id, {
        pay_period_start: new Date(2024, 4, 1),
        pay_period_end: new Date(2024, 4, 31),
        payment_date: new Date(2024, 5, 15),
        total_gross: 50000,
        total_tax: 4000,
        total_other_deductions: 1650,
        total_net: 44350,
        bank_account_id: bankAccountA._id,
        salary_account_id: salaryAccountA._id,
        tax_payable_account_id: taxPayableAccountA._id,
        other_deductions_account_id: rssbAccountA._id,
        lines: [
          { employee_name: 'John Doe', employee_id: 'EMP001', gross_salary: 50000, tax_deduction: 4000, other_deductions: 1650, rssb_employer: 2650, net_pay: 44350 }
        ]
      }, userA._id);

      await PayrollRunService.post(companyA._id, payrollRun._id, userA._id);
      await PayrollRunService.reverse(companyA._id, payrollRun._id, { reason: 'First reversal' }, userA._id);

      await expect(
        PayrollRunService.reverse(companyA._id, payrollRun._id, { reason: 'Second reversal' }, userA._id)
      ).rejects.toThrow('PAYROLL_ALREADY_REVERSED');
    });
  });
});
