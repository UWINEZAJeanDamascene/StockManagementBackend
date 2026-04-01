/**
 * Seed Payroll Data Script
 * Creates test company, user, chart of accounts, bank account, and payroll records.
 * Usage: node scripts/seedPayrollData.js
 */
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');

dotenv.config();

const Company = require('../models/Company');
const User = require('../models/User');
const ChartOfAccount = require('../models/ChartOfAccount');
const { BankAccount } = require('../models/BankAccount');
const Payroll = require('../models/Payroll');
const PayrollRun = require('../models/PayrollRun');
const AccountingPeriod = require('../models/AccountingPeriod');
const { calculatePayroll } = require('../models/Payroll');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/stock-management';

async function seed() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB:', MONGODB_URI);

  // 1. Company
  const company = await Company.findOneAndUpdate(
    { name: 'Payroll Test Corp' },
    {
      name: 'Payroll Test Corp',
      code: 'PTC',
      email: 'admin@payrolltest.com',
      phone: '+250788000000',
      base_currency: 'RWF',
      isActive: true,
      approvalStatus: 'approved',
      is_vat_registered: false,
    },
    { upsert: true, new: true }
  );
  console.log('Company:', company._id.toString(), company.name);

  // 2. User (admin)
  const hashedPassword = await bcrypt.hash('password123', 10);
  const user = await User.findOneAndUpdate(
    { email: 'admin@payrolltest.com' },
    {
      name: 'Admin User',
      email: 'admin@payrolltest.com',
      password: hashedPassword,
      company: company._id,
      role: 'admin',
      isActive: true,
    },
    { upsert: true, new: true }
  );
  console.log('User:', user._id.toString(), user.name);

  // 3. Chart of Accounts
  const accountsData = [
    { code: '5400', name: 'Salaries & Wages', type: 'expense', subtype: 'operating' },
    { code: '6100', name: 'Salaries & Wages (Posting)', type: 'expense', subtype: 'operating' },
    { code: '2200', name: 'PAYE Payable (legacy)', type: 'liability', subtype: 'paye_payable' },
    { code: '2230', name: 'PAYE Tax Payable', type: 'liability', subtype: 'paye_payable' },
    { code: '2300', name: 'RSSB Payable (legacy)', type: 'liability', subtype: 'rssb_payable' },
    { code: '2240', name: 'RSSB Payable', type: 'liability', subtype: 'rssb_payable' },
    { code: '2310', name: 'Employer Contribution Payable', type: 'liability', subtype: 'rssb_payable' },
    { code: '1100', name: 'Cash at Bank', type: 'asset', subtype: 'current' },
    { code: '1000', name: 'Cash in Hand', type: 'asset', subtype: 'current' },
    { code: '6200', name: 'Employer Contributions Expense', type: 'expense', subtype: 'operating' },
  ];

  const accounts = {};
  for (const acct of accountsData) {
    const doc = await ChartOfAccount.findOneAndUpdate(
      { company: company._id, code: acct.code },
      { ...acct, company: company._id, isActive: true },
      { upsert: true, new: true }
    );
    accounts[acct.code] = doc;
  }
  console.log('Chart of Accounts:', Object.keys(accounts).length, 'accounts created');

  // 4. Bank Account
  const bankAccount = await BankAccount.findOneAndUpdate(
    { company: company._id, name: 'Test Bank Account' },
    {
      company: company._id,
      name: 'Test Bank Account',
      accountNumber: '1234567890',
      accountType: 'bk_bank',
      bankName: 'Bank of Kigali',
      balance: 0,
      openingBalanceDate: new Date(),
      isActive: true,
      currencyCode: 'RWF',
      createdBy: user._id,
      accountCode: '1100',
      currentBalance: 5000000,
    },
    { upsert: true, new: true }
  );
  console.log('Bank Account:', bankAccount._id.toString(), bankAccount.name);

  // 5. Accounting Periods (March 2026)
  await AccountingPeriod.findOneAndUpdate(
    { company_id: company._id, name: 'Mar 2026' },
    {
      company_id: company._id,
      name: 'Mar 2026',
      period_type: 'month',
      start_date: new Date(2026, 2, 1),
      end_date: new Date(2026, 2, 31),
      fiscal_year: 2026,
      status: 'open',
    },
    { upsert: true, new: true }
  );
  console.log('Accounting Period: Mar 2026 (open)');

  // 6. Employee Payroll Records (5 employees, March 2026)
  const employees = [
    { employeeId: 'EMP001', firstName: 'Jean', lastName: 'Uwimana', department: 'Engineering', position: 'Senior Developer', basicSalary: 500000, transportAllowance: 50000, housingAllowance: 100000 },
    { employeeId: 'EMP002', firstName: 'Marie', lastName: 'Mukamana', department: 'Finance', position: 'Accountant', basicSalary: 350000, transportAllowance: 40000, housingAllowance: 60000 },
    { employeeId: 'EMP003', firstName: 'Patrick', lastName: 'Habimana', department: 'Sales', position: 'Sales Manager', basicSalary: 400000, transportAllowance: 50000, housingAllowance: 80000 },
    { employeeId: 'EMP004', firstName: 'Grace', lastName: 'Nyirahabimana', department: 'HR', position: 'HR Officer', basicSalary: 250000, transportAllowance: 30000, housingAllowance: 40000 },
    { employeeId: 'EMP005', firstName: 'Eric', lastName: 'Kabera', department: 'Engineering', position: 'Junior Developer', basicSalary: 150000, transportAllowance: 30000, housingAllowance: 30000 },
  ];

  const createdPayrolls = [];
  let totalGross = 0;
  let totalTax = 0;
  let totalRssbEmployee = 0;
  let totalRssbEmployer = 0;
  let totalNet = 0;

  for (const emp of employees) {
    // Clear any existing for this employee+period
    await Payroll.deleteMany({ company: company._id, 'employee.employeeId': emp.employeeId, 'period.month': 3, 'period.year': 2026 });

    const salary = {
      basicSalary: emp.basicSalary,
      transportAllowance: emp.transportAllowance,
      housingAllowance: emp.housingAllowance,
      otherAllowances: 0,
    };

    const calculated = Payroll.calculatePayroll(salary);

    const payroll = await Payroll.create({
      company: company._id,
      employee: {
        employeeId: emp.employeeId,
        firstName: emp.firstName,
        lastName: emp.lastName,
        department: emp.department,
        position: emp.position,
        email: `${emp.firstName.toLowerCase()}.${emp.lastName.toLowerCase()}@payrolltest.com`,
        phone: '+250788' + String(Math.floor(1000000 + Math.random() * 9000000)),
        employmentType: 'full-time',
        startDate: new Date(2025, 0, 1),
        isActive: true,
      },
      salary: {
        basicSalary: salary.basicSalary,
        transportAllowance: salary.transportAllowance,
        housingAllowance: salary.housingAllowance,
        otherAllowances: salary.otherAllowances,
        grossSalary: calculated.grossSalary,
      },
      deductions: {
        paye: calculated.deductions.paye,
        rssbEmployeePension: calculated.deductions.rssbEmployeePension,
        rssbEmployeeMaternity: calculated.deductions.rssbEmployeeMaternity,
        totalDeductions: calculated.deductions.totalDeductions,
      },
      netPay: calculated.netPay,
      contributions: {
        rssbEmployerPension: calculated.contributions.rssbEmployerPension,
        rssbEmployerMaternity: calculated.contributions.rssbEmployerMaternity,
        occupationalHazard: calculated.contributions.occupationalHazard,
      },
      period: {
        month: 3,
        year: 2026,
        monthName: 'March',
      },
      pay_period_start: new Date(2026, 2, 1),
      pay_period_end: new Date(2026, 2, 31),
      record_status: 'draft',
      payment: { status: 'pending' },
      createdBy: user._id,
    });

    createdPayrolls.push(payroll);
    totalGross += calculated.grossSalary;
    totalTax += calculated.deductions.paye;
    totalRssbEmployee += calculated.deductions.rssbEmployeePension + calculated.deductions.rssbEmployeeMaternity;
    totalRssbEmployer += calculated.contributions.rssbEmployerPension + calculated.contributions.rssbEmployerMaternity + calculated.contributions.occupationalHazard;
    totalNet += calculated.netPay;

    console.log(`  ${emp.firstName} ${emp.lastName}: Gross=${calculated.grossSalary}, PAYE=${calculated.deductions.paye}, RSSB=${calculated.deductions.rssbEmployeePension}, Net=${calculated.netPay}`);
  }

  console.log(`\nCreated ${createdPayrolls.length} payroll records`);
  console.log(`Totals: Gross=${totalGross}, PAYE=${totalTax}, RSSB Employee=${totalRssbEmployee}, RSSB Employer=${totalRssbEmployer}, Net=${totalNet}`);

  // 7. Finalise all records
  for (const p of createdPayrolls) {
    p.record_status = 'finalised';
    await p.save();
  }
  console.log('All records finalised');

  // 8. Create PayrollRun from finalised records
  const rssbTotal = totalRssbEmployee;
  const totalOtherDed = rssbTotal;
  const expectedNet = totalGross - totalTax - totalOtherDed;
  if (Math.abs(expectedNet - totalNet) > 0.01) {
    console.error(`TOTALS MISMATCH: expected net ${expectedNet}, got ${totalNet}`);
  }

  const lines = createdPayrolls.map((p) => ({
    employee_name: `${p.employee.firstName} ${p.employee.lastName}`,
    employee_id: p.employee.employeeId,
    gross_salary: p.salary.grossSalary,
    tax_deduction: p.deductions.paye,
    other_deductions: p.deductions.rssbEmployeePension + p.deductions.rssbEmployeeMaternity,
    rssb_employer: p.contributions.rssbEmployerPension + p.contributions.rssbEmployerMaternity + p.contributions.occupationalHazard,
    net_pay: p.netPay,
    payroll_id: p._id,
  }));

  // Delete existing run for this period
  await PayrollRun.deleteMany({ company: company._id, pay_period_start: new Date(2026, 2, 1) });

  const payrollRun = await PayrollRun.create({
    company: company._id,
    reference_no: 'PYRL-00001',
    pay_period_start: new Date(2026, 2, 1),
    pay_period_end: new Date(2026, 2, 31),
    payment_date: new Date(2026, 3, 5),
    status: 'draft',
    total_gross: totalGross,
    total_tax: totalTax,
    total_other_deductions: totalOtherDed,
    total_net: totalNet,
    bank_account_id: bankAccount._id,
    salary_account_id: accounts['6100']._id,
    tax_payable_account_id: accounts['2200']._id,
    other_deductions_account_id: accounts['2300']._id,
    lines,
    employee_count: lines.length,
    notes: 'March 2026 payroll - seeded',
    posted_by: null,
  });

  // Link payroll records to run
  await Payroll.updateMany(
    { _id: { $in: createdPayrolls.map((p) => p._id) } },
    { payroll_run_id: payrollRun._id }
  );

  console.log(`\nPayrollRun created: ${payrollRun.reference_no} (status: ${payrollRun.status})`);
  console.log(`  Period: ${payrollRun.pay_period_start.toISOString().split('T')[0]} to ${payrollRun.pay_period_end.toISOString().split('T')[0]}`);
  console.log(`  Payment Date: ${payrollRun.payment_date.toISOString().split('T')[0]}`);
  console.log(`  Total Gross: ${payrollRun.total_gross}`);
  console.log(`  Total Tax (PAYE): ${payrollRun.total_tax}`);
  console.log(`  Total RSSB: ${payrollRun.total_other_deductions}`);
  console.log(`  Total Net: ${payrollRun.total_net}`);
  console.log(`  Employees: ${payrollRun.employee_count}`);

  // 9. Also create some paid records from previous month for summary data
  const prevMonthPayrolls = [];
  for (const emp of employees.slice(0, 3)) {
    const salary = {
      basicSalary: emp.basicSalary,
      transportAllowance: emp.transportAllowance,
      housingAllowance: emp.housingAllowance,
      otherAllowances: 0,
    };
    const calculated = Payroll.calculatePayroll(salary);

    const payroll = await Payroll.create({
      company: company._id,
      employee: {
        employeeId: emp.employeeId,
        firstName: emp.firstName,
        lastName: emp.lastName,
        department: emp.department,
        position: emp.position,
        employmentType: 'full-time',
        isActive: true,
      },
      salary: {
        basicSalary: salary.basicSalary,
        transportAllowance: salary.transportAllowance,
        housingAllowance: salary.housingAllowance,
        otherAllowances: salary.otherAllowances,
        grossSalary: calculated.grossSalary,
      },
      deductions: {
        paye: calculated.deductions.paye,
        rssbEmployeePension: calculated.deductions.rssbEmployeePension,
        rssbEmployeeMaternity: calculated.deductions.rssbEmployeeMaternity,
        totalDeductions: calculated.deductions.totalDeductions,
      },
      netPay: calculated.netPay,
      contributions: {
        rssbEmployerPension: calculated.contributions.rssbEmployerPension,
        rssbEmployerMaternity: calculated.contributions.rssbEmployerMaternity,
        occupationalHazard: calculated.contributions.occupationalHazard,
      },
      period: { month: 2, year: 2026, monthName: 'February' },
      pay_period_start: new Date(2026, 1, 1),
      pay_period_end: new Date(2026, 1, 28),
      record_status: 'paid',
      payment: {
        status: 'paid',
        paymentDate: new Date(2026, 2, 5),
        paymentMethod: 'bank_transfer',
        reference: 'PAY-FEB-001',
      },
      createdBy: user._id,
    });
    prevMonthPayrolls.push(payroll);
  }
  console.log(`\nCreated ${prevMonthPayrolls.length} paid records for February 2026 (for summary)`);

  // Print JWT token for testing
  const jwt = require('jsonwebtoken');
  const token = jwt.sign(
    { id: user._id, companyId: company._id, role: user.role },
    process.env.JWT_SECRET || 'dev-secret-key-not-for-production-use-only',
    { expiresIn: '24h' }
  );

  console.log('\n========================================');
  console.log('SEED COMPLETE - Test Credentials:');
  console.log('========================================');
  console.log('Email: admin@payrolltest.com');
  console.log('Password: password123');
  console.log('Company ID:', company._id.toString());
  console.log('User ID:', user._id.toString());
  console.log('JWT Token:', token);
  console.log('========================================');
  console.log('\nAPI Endpoints to test:');
  console.log('  GET    /api/payroll                  - List all payroll records');
  console.log('  GET    /api/payroll?month=3&year=2026 - Filter by period');
  console.log('  GET    /api/payroll/summary           - Get payroll summary');
  console.log('  POST   /api/payroll/calculate         - Calculate payroll preview');
  console.log('  POST   /api/payroll                   - Create new record');
  console.log('  POST   /api/payroll/:id/finalise      - Finalise record');
  console.log('  GET    /api/payroll-runs              - List payroll runs');
  console.log('  GET    /api/payroll-runs/:id          - View run detail');
  console.log('  GET    /api/payroll-runs/preview      - Preview journal entry');
  console.log('  POST   /api/payroll-runs/:id/post     - Post payroll run');
  console.log('  POST   /api/payroll-runs/:id/reverse  - Reverse payroll run');
  console.log('========================================');

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
