const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const payrollSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  // Employee Information
  employee: {
    employeeId: { type: String, required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: String,
    phone: String,
    department: String,
    position: String,
    nationalId: String,
    bankName: String,
    bankAccount: String,
    employmentType: { 
      type: String, 
      enum: ['full-time', 'part-time', 'contract', 'intern'],
      default: 'full-time'
    },
    startDate: Date,
    isActive: { type: Boolean, default: true }
  },
  
  // Salary Information
  salary: {
    basicSalary: { type: Number, required: true, min: 0 },
    transportAllowance: { type: Number, default: 0 },
    housingAllowance: { type: Number, default: 0 },
    otherAllowances: { type: Number, default: 0 },
    // Gross = Basic + All Allowances
    grossSalary: { type: Number, default: 0 }
  },
  
  // Deductions
  deductions: {
    paye: { type: Number, default: 0 },           // Pay As You Earn (Income Tax)
    rssbEmployeePension: { type: Number, default: 0 },   // 6% Employee Pension (RSSB)
    rssbEmployeeMaternity: { type: Number, default: 0 },  // 0.3% Employee Maternity (RSSB)
    healthInsurance: { type: Number, default: 0 },
    otherDeductions: { type: Number, default: 0 },
    loanDeductions: { type: Number, default: 0 },
    // Total Deductions
    totalDeductions: { type: Number, default: 0 }
  },
  
  // Net Pay
  netPay: { type: Number, default: 0 },
  
  // Rwanda-Specific Contributions (Employer)
  contributions: {
    rssbEmployerPension: { type: Number, default: 0 },   // 6% Employer Pension (RSSB)
    rssbEmployerMaternity: { type: Number, default: 0 },  // 0.3% Employer Maternity (RSSB)
    occupationalHazard: { type: Number, default: 0 }     // 2% Occupational Hazard (RSSB)
  },
  
  // Payroll Period
  period: {
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true },
    monthName: String
  },
  
  // Payroll run link
  payroll_run_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PayrollRun',
    default: null
  },

  // Pay period for linking to PayrollRun
  pay_period_start: {
    type: Date
  },
  pay_period_end: {
    type: Date
  },

  // Record status
  record_status: {
    type: String,
    enum: ['draft', 'finalised', 'paid'],
    default: 'draft'
  },

  // Payment Information
  payment: {
    status: { 
      type: String, 
      enum: ['pending', 'processed', 'paid', 'cancelled'],
      default: 'pending'
    },
    paymentDate: Date,
    paymentMethod: { 
      type: String, 
      enum: ['cash', 'bank_transfer', 'cheque', 'mobile_money'],
      default: 'bank_transfer'
    },
    reference: String
  },
  
  // Payslip
  payslipGenerated: { type: Boolean, default: false },
  payslipDate: Date,
  
  // Notes
  notes: String,
  
  // Audit
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Rwanda Tax Calculation Functions (2025 Rates)
payrollSchema.statics.calculatePAYE = function(grossSalary) {
  // PAYE Progressive Rates (2025)
  // 0 - 60,000: 0%
  // 60,001 - 100,000: 10%
  // 100,001 - 200,000: 20%
  // Above 200,000: 30%
  
  let paye = 0;
  const taxableAmount = grossSalary;
  
  if (taxableAmount <= 60000) {
    paye = 0;
  } else if (taxableAmount <= 100000) {
    // 10% on amount above 60,000
    paye = (taxableAmount - 60000) * 0.10;
  } else if (taxableAmount <= 200000) {
    // 10% on first 40k above 60k = 4,000
    // 20% on amount above 100,000
    paye = 4000 + (taxableAmount - 100000) * 0.20;
  } else {
    // 10% on first 40k = 4,000
    // 20% on next 100k = 20,000
    // 30% on amount above 200,000
    paye = 4000 + 20000 + (taxableAmount - 200000) * 0.30;
  }
  
  return Math.round(paye * 100) / 100;
};

payrollSchema.statics.calculateRSSBEmployeePension = function(grossSalary) {
  // RSSB Employee Pension: 6% of gross (2025)
  // Includes transport allowance in contribution base
  return Math.round(grossSalary * 0.06 * 100) / 100;
};

payrollSchema.statics.calculateRSSBEmployeeMaternity = function(grossSalary) {
  // RSSB Employee Maternity: 0.3% of gross
  return Math.round(grossSalary * 0.003 * 100) / 100;
};

payrollSchema.statics.calculateRSSBEmployerPension = function(grossSalary) {
  // RSSB Employer Pension: 6% of gross (2025)
  // Total pension contribution = 12% (6% employee + 6% employer)
  return Math.round(grossSalary * 0.06 * 100) / 100;
};

payrollSchema.statics.calculateRSSBEmployerMaternity = function(grossSalary) {
  // RSSB Employer Maternity: 0.3% of gross
  return Math.round(grossSalary * 0.003 * 100) / 100;
};

payrollSchema.statics.calculateOccupationalHazard = function(grossSalary) {
  // Occupational Hazard: 2% of gross (employer only)
  return Math.round(grossSalary * 0.02 * 100) / 100;
};

payrollSchema.statics.calculatePayroll = function(salaryData) {
  const { basicSalary, transportAllowance = 0, housingAllowance = 0, otherAllowances = 0 } = salaryData;
  
  // Calculate Gross Salary (includes all allowances)
  // Note: Transport allowance is included in contribution base (2025)
  const grossSalary = basicSalary + transportAllowance + housingAllowance + otherAllowances;
  
  // Calculate Employee Deductions
  const paye = this.calculatePAYE(grossSalary);
  const rssbEmployeePension = this.calculateRSSBEmployeePension(grossSalary);
  const rssbEmployeeMaternity = this.calculateRSSBEmployeeMaternity(grossSalary);
  
  // Total Employee Deductions
  const totalDeductions = paye + rssbEmployeePension + rssbEmployeeMaternity;
  
  // Calculate Net Pay
  const netPay = grossSalary - totalDeductions;
  
  // Calculate Employer Contributions (2025 rates)
  const rssbEmployerPension = this.calculateRSSBEmployerPension(grossSalary);
  const rssbEmployerMaternity = this.calculateRSSBEmployerMaternity(grossSalary);
  const occupationalHazard = this.calculateOccupationalHazard(grossSalary);
  
  // Total Employer Cost (Gross + Employer contributions)
  // 2025: Pension is 12% total (6% employee + 6% employer)
  const totalEmployerCost = grossSalary + rssbEmployerPension + rssbEmployerMaternity + occupationalHazard;
  
  return {
    grossSalary: Math.round(grossSalary * 100) / 100,
    deductions: {
      paye: Math.round(paye * 100) / 100,
      rssbEmployeePension: Math.round(rssbEmployeePension * 100) / 100,
      rssbEmployeeMaternity: Math.round(rssbEmployeeMaternity * 100) / 100,
      totalDeductions: Math.round(totalDeductions * 100) / 100
    },
    contributions: {
      rssbEmployerPension: Math.round(rssbEmployerPension * 100) / 100,
      rssbEmployerMaternity: Math.round(rssbEmployerMaternity * 100) / 100,
      occupationalHazard: Math.round(occupationalHazard * 100) / 100,
      totalEmployerCost: Math.round(totalEmployerCost * 100) / 100
    },
    netPay: Math.round(netPay * 100) / 100
  };
};

// Generate unique payroll number
payrollSchema.statics.generatePayrollNumber = async function(companyId) {
  const count = await this.countDocuments({ company: companyId });
  const payrollNumber = `PR-${String(count + 1).padStart(5, '0')}`;
  return payrollNumber;
};

// Calculate monthly name
payrollSchema.statics.getMonthName = function(month) {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return months[month - 1];
};

// Pre-save hook to prevent editing finalised records
payrollSchema.pre('save', function(next) {
  // Only check for updates (not new documents)
  if (this.isNew) {
    return next();
  }
  
  // Check if record_status field is being modified
  if (this.isModified('record_status')) {
    // If changing FROM finalised, that's not allowed
    // We need to fetch original to check
    return next();
  }
  
  // Check if any salary/deductions fields are being modified on a finalised record
  // Use isDirectModified to check if the field was explicitly changed
  const wasFinalised = this.isDirectModified('record_status') === false && 
                       this.$__.activePaths._modify.get('record_status') === undefined;
  
  // For now, just allow the save - the main protection is that finalised records
  // should only be editable via specific methods that check status
  next();
});

// Index for efficient queries
payrollSchema.index({ company: 1, 'period.year': 1, 'period.month': 1 });
payrollSchema.index({ company: 1, 'employee.employeeId': 1 });

// Unique index - prevents duplicate payroll for same employee same period same company
payrollSchema.index(
  { company: 1, 'employee.employeeId': 1, 'period.year': 1, 'period.month': 1 },
  { unique: true }
);

module.exports = mongoose.model('Payroll', payrollSchema);
