/**
 * Migration Script: Backfill Journal Entries
 * 
 * This script migrates all existing financial transactions (invoices, purchases, 
 * credit notes, expenses, fixed assets, loans) to journal entries so they appear
 * in the Trial Balance and General Ledger.
 * 
 * Run with: node scripts/migrateToJournalEntries.js
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const JournalEntry = require('../models/JournalEntry');
const Invoice = require('../models/Invoice');
const Purchase = require('../models/Purchase');
const CreditNote = require('../models/CreditNote');
const Expense = require('../models/Expense');
const FixedAsset = require('../models/FixedAsset');
const Loan = require('../models/Loan');
const PurchaseReturn = require('../models/PurchaseReturn');
const Company = require('../models/Company');

dotenv.config();

// Chart of accounts mapping
const DEFAULT_ACCOUNTS = {
  salesRevenue: '4000',
  salesReturns: '4100',
  accountsReceivable: '1300',
  purchases: '5100',
  purchaseReturns: '5200',
  accountsPayable: '2000',
  inventory: '1400',
  stockAdjustment: '7100',
  costOfGoodsSold: '5000',
  cashInHand: '1000',
  cashAtBank: '1100',
  mtnMoMo: '1200',
  vatReceivable: '1500',
  vatPayable: '2100',
  taxPayable: '2100',
  salaries: '5400',
  salariesWages: '5400',
  payrollExpenses: '5410',
  rent: '5500',
  utilities: '5600',
  transport: '5700',
  marketing: '5800',
  depreciation: '5900',
  interestExpense: '6000',
  otherExpenses: '6100',
  equipment: '1700',
  computers: '1710',
  vehicles: '1720',
  furniture: '1730',
  buildings: '1740',
  land: '1750',
  machinery: '1760',
  accumulatedDepreciation: '1800',
  shortTermLoans: '2700',
  longTermLoans: '2900',
  otherIncome: '4200',
  interestIncome: '4300',
  gainOnDisposal: '4400',
  lossOnDisposal: '6500',
};

const CHART_OF_ACCOUNTS = {
  '1000': { name: 'Cash in Hand', type: 'asset', normalBalance: 'debit' },
  '1100': { name: 'Cash at Bank', type: 'asset', normalBalance: 'debit' },
  '1200': { name: 'MTN MoMo', type: 'asset', normalBalance: 'debit' },
  '1300': { name: 'Accounts Receivable', type: 'asset', normalBalance: 'debit' },
  '1400': { name: 'Inventory', type: 'asset', normalBalance: 'debit' },
  '1500': { name: 'VAT Receivable', type: 'asset', normalBalance: 'debit' },
  '1700': { name: 'Equipment', type: 'asset', normalBalance: 'debit' },
  '1710': { name: 'Computers', type: 'asset', normalBalance: 'debit' },
  '1720': { name: 'Vehicles', type: 'asset', normalBalance: 'debit' },
  '1730': { name: 'Furniture', type: 'asset', normalBalance: 'debit' },
  '1740': { name: 'Buildings', type: 'asset', normalBalance: 'debit' },
  '1750': { name: 'Land', type: 'asset', normalBalance: 'debit' },
  '1760': { name: 'Machinery', type: 'asset', normalBalance: 'debit' },
  '1790': { name: 'Other Fixed Assets', type: 'asset', normalBalance: 'debit' },
  '1800': { name: 'Accumulated Depreciation', type: 'asset', normalBalance: 'credit' },
  '2000': { name: 'Accounts Payable', type: 'liability', normalBalance: 'credit' },
  '2100': { name: 'VAT Payable', type: 'liability', normalBalance: 'credit' },
  '2700': { name: 'Short Term Loans', type: 'liability', normalBalance: 'credit' },
  '2900': { name: 'Long Term Loans', type: 'liability', normalBalance: 'credit' },
  '4000': { name: 'Sales Revenue', type: 'revenue', normalBalance: 'credit' },
  '4100': { name: 'Sales Returns', type: 'revenue', normalBalance: 'debit' },
  '4200': { name: 'Other Income', type: 'revenue', normalBalance: 'credit' },
  '4300': { name: 'Interest Income', type: 'revenue', normalBalance: 'credit' },
  '4400': { name: 'Gain on Asset Disposal', type: 'revenue', normalBalance: 'credit' },
  '5000': { name: 'Cost of Goods Sold', type: 'expense', normalBalance: 'debit' },
  '5100': { name: 'Purchases', type: 'expense', normalBalance: 'debit' },
  '5400': { name: 'Salaries & Wages', type: 'expense', normalBalance: 'debit' },
  '5410': { name: 'Payroll Expenses', type: 'expense', normalBalance: 'debit' },
  '5500': { name: 'Rent', type: 'expense', normalBalance: 'debit' },
  '5600': { name: 'Utilities', type: 'expense', normalBalance: 'debit' },
  '5700': { name: 'Transport & Delivery', type: 'expense', normalBalance: 'debit' },
  '5800': { name: 'Marketing & Advertising', type: 'expense', normalBalance: 'debit' },
  '5900': { name: 'Depreciation Expense', type: 'expense', normalBalance: 'debit' },
  '6000': { name: 'Interest Expense', type: 'expense', normalBalance: 'debit' },
  '6100': { name: 'Other Expenses', type: 'expense', normalBalance: 'debit' },
  '6500': { name: 'Loss on Asset Disposal', type: 'expense', normalBalance: 'debit' },
};

function getAccount(code) {
  return CHART_OF_ACCOUNTS[code] || { name: 'Unknown Account', type: 'unknown', normalBalance: 'debit' };
}

function getExpenseAccountCode(type) {
  const typeMap = {
    'salaries_wages': '5400',
    'rent': '5500',
    'utilities': '5600',
    'transport_delivery': '5700',
    'marketing_advertising': '5800',
    'other_expense': '6100',
    'interest_income': '4300',
    'other_income': '4200',
    'other_expense_income': '6100'
  };
  return typeMap[type] || '6100';
}

function getAssetAccountCode(category) {
  const categoryMap = {
    'equipment': '1700',
    'computers': '1710',
    'vehicles': '1720',
    'furniture': '1730',
    'buildings': '1740',
    'land': '1750',
    'machinery': '1760',
    'other': '1790'
  };
  return categoryMap[category] || '1700';
}

// Helper to create a debit line
function createDebitLine(accountCode, amount, description = '', reference = '') {
  const account = getAccount(accountCode);
  return {
    accountCode,
    accountName: account.name,
    description,
    debit: amount || 0,
    credit: 0,
    reference
  };
}

// Helper to create a credit line
function createCreditLine(accountCode, amount, description = '', reference = '') {
  const account = getAccount(accountCode);
  return {
    accountCode,
    accountName: account.name,
    description,
    debit: 0,
    credit: amount || 0,
    reference
  };
}

// Generate entry number - unique across all companies
async function generateEntryNumber(companyId, prefix = 'MIG') {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  
  // Find the LAST entry for ANY company with the given prefix (global uniqueness)
  const lastEntry = await JournalEntry.findOne({
    entryNumber: new RegExp(`^${prefix}-${year}${month}`)
  }).sort({ entryNumber: -1 });
  
  let sequence = 1;
  if (lastEntry) {
    const lastSequence = parseInt(lastEntry.entryNumber.split('-').pop());
    sequence = lastSequence + 1;
  }
  
  return `${prefix}-${year}${month}-${String(sequence).padStart(4, '0')}`;
}

// Check if entry already exists for a source
async function entryExists(companyId, sourceType, sourceId) {
  const existing = await JournalEntry.findOne({
    company: companyId,
    sourceType,
    sourceId
  });
  return !!existing;
}

// Create a journal entry
async function createJournalEntry(companyId, userId, options) {
  const {
    date = new Date(),
    description,
    sourceType = 'manual',
    sourceId = null,
    sourceReference = null,
    lines = [],
    notes = ''
  } = options;

  if (lines.length < 2) return null;

  const totalDebit = lines.reduce((sum, line) => sum + (line.debit || 0), 0);
  const totalCredit = lines.reduce((sum, line) => sum + (line.credit || 0), 0);

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    console.log(`  ⚠️  Entry not balanced: Debits: ${totalDebit}, Credits: ${totalCredit}`);
    return null;
  }

  const entryNumber = await generateEntryNumber(companyId, 'MIG');

  const entry = await JournalEntry.create({
    company: companyId,
    entryNumber,
    date,
    description,
    sourceType,
    sourceId,
    sourceReference,
    lines,
    totalDebit,
    totalCredit,
    isAutoGenerated: true,
    createdBy: userId,
    postedBy: userId,
    status: 'posted',
    notes: notes || `Migrated from existing data on ${new Date().toISOString()}`
  });

  return entry;
}

// Migrate invoices
async function migrateInvoices(companyId, userId) {
  console.log('\n📄 Migrating Invoices...');
  
  const invoices = await Invoice.find({ 
    company: companyId,
    status: { $nin: ['draft', 'cancelled'] }
  }).populate('createdBy', '_id');
  
  console.log(`  Found ${invoices.length} invoices`);
  
  let migrated = 0;
  let skipped = 0;
  
  for (const invoice of invoices) {
    try {
      // Check if already migrated
      if (await entryExists(companyId, 'invoice', invoice._id)) {
        skipped++;
        continue;
      }
      
      const total = invoice.roundedAmount || invoice.grandTotal || invoice.total || 0;
      const vatAmount = invoice.totalTax || invoice.taxAmount || 0;
      const subtotal = total - vatAmount;
      const invoiceDate = invoice.invoiceDate || invoice.createdAt;
      
      const lines = [];
      
      // Debit: Accounts Receivable
      lines.push(createDebitLine(
        DEFAULT_ACCOUNTS.accountsReceivable,
        total,
        `Invoice ${invoice.invoiceNumber} - Receivable`
      ));
      
      // Credit: Sales Revenue
      if (subtotal > 0) {
        lines.push(createCreditLine(
          DEFAULT_ACCOUNTS.salesRevenue,
          subtotal,
          `Invoice ${invoice.invoiceNumber} - Revenue`
        ));
      }
      
      // Credit: VAT Payable
      if (vatAmount > 0) {
        lines.push(createCreditLine(
          DEFAULT_ACCOUNTS.vatPayable,
          vatAmount,
          `Invoice ${invoice.invoiceNumber} - VAT`
        ));
      }
      
      await createJournalEntry(companyId, userId, {
        date: invoiceDate,
        description: `Invoice ${invoice.invoiceNumber} created (migrated)`,
        sourceType: 'invoice',
        sourceId: invoice._id,
        sourceReference: invoice.invoiceNumber,
        lines
      });
      
      // Handle payments
      if (invoice.payments && invoice.payments.length > 0) {
        for (const payment of invoice.payments) {
          if (await entryExists(companyId, 'payment', payment._id || payment.paidDate)) {
            continue;
          }
          
          const cashAccount = payment.paymentMethod === 'bank' 
            ? DEFAULT_ACCOUNTS.cashAtBank 
            : DEFAULT_ACCOUNTS.cashInHand;
          
          const paymentLines = [];
          
          // Debit: Cash/Bank
          paymentLines.push(createDebitLine(
            cashAccount,
            payment.amount,
            `Payment for ${invoice.invoiceNumber}`
          ));
          
          // Credit: Accounts Receivable
          paymentLines.push(createCreditLine(
            DEFAULT_ACCOUNTS.accountsReceivable,
            payment.amount,
            `Payment for ${invoice.invoiceNumber}`
          ));
          
          await createJournalEntry(companyId, userId, {
            date: payment.paidDate || invoiceDate,
            description: `Payment received for invoice ${invoice.invoiceNumber} (migrated)`,
            sourceType: 'payment',
            sourceReference: invoice.invoiceNumber,
            lines: paymentLines
          });
        }
      }
      
      migrated++;
    } catch (error) {
      console.log(`  ❌ Error migrating invoice ${invoice.invoiceNumber}: ${error.message}`);
    }
  }
  
  console.log(`  ✅ Migrated: ${migrated}, Skipped: ${skipped}`);
  return { migrated, skipped };
}

// Migrate purchases
async function migratePurchases(companyId, userId) {
  console.log('\n📦 Migrating Purchases...');
  
  const purchases = await Purchase.find({ 
    company: companyId,
    status: { $nin: ['draft', 'cancelled'] }
  });
  
  console.log(`  Found ${purchases.length} purchases`);
  
  let migrated = 0;
  let skipped = 0;
  
  for (const purchase of purchases) {
    try {
      if (await entryExists(companyId, 'purchase', purchase._id)) {
        skipped++;
        continue;
      }
      
      const total = purchase.roundedAmount || purchase.grandTotal || purchase.total || 0;
      const vatAmount = purchase.totalTax || purchase.taxAmount || 0;
      const subtotal = total - vatAmount;
      const purchaseDate = purchase.purchaseDate || purchase.createdAt;
      
      const lines = [];
      
      // Debit: Inventory
      if (subtotal > 0) {
        lines.push(createDebitLine(
          DEFAULT_ACCOUNTS.inventory,
          subtotal,
          `Purchase ${purchase.purchaseNumber} - Inventory`
        ));
      }
      
      // Debit: VAT Receivable
      if (vatAmount > 0) {
        lines.push(createDebitLine(
          DEFAULT_ACCOUNTS.vatReceivable,
          vatAmount,
          `Purchase ${purchase.purchaseNumber} - VAT`
        ));
      }
      
      // Credit: Accounts Payable
      lines.push(createCreditLine(
        DEFAULT_ACCOUNTS.accountsPayable,
        total,
        `Purchase ${purchase.purchaseNumber}`
      ));
      
      await createJournalEntry(companyId, userId, {
        date: purchaseDate,
        description: `Purchase ${purchase.purchaseNumber} received (migrated)`,
        sourceType: 'purchase',
        sourceId: purchase._id,
        sourceReference: purchase.purchaseNumber,
        lines
      });
      
      // Handle payments
      if (purchase.payments && purchase.payments.length > 0) {
        for (const payment of purchase.payments) {
          if (payment.paymentMethod === 'credit') continue; // Skip credit payments
          
          if (await entryExists(companyId, 'payment', payment._id || payment.paidDate)) {
            continue;
          }
          
          const cashAccount = payment.paymentMethod === 'bank' 
            ? DEFAULT_ACCOUNTS.cashAtBank 
            : DEFAULT_ACCOUNTS.cashInHand;
          
          const paymentLines = [];
          
          // Debit: Accounts Payable
          paymentLines.push(createDebitLine(
            DEFAULT_ACCOUNTS.accountsPayable,
            payment.amount,
            `Payment for ${purchase.purchaseNumber}`
          ));
          
          // Credit: Cash/Bank
          paymentLines.push(createCreditLine(
            cashAccount,
            payment.amount,
            `Payment for ${purchase.purchaseNumber}`
          ));
          
          await createJournalEntry(companyId, userId, {
            date: payment.paidDate || purchaseDate,
            description: `Payment made for purchase ${purchase.purchaseNumber} (migrated)`,
            sourceType: 'payment',
            sourceReference: purchase.purchaseNumber,
            lines: paymentLines
          });
        }
      }
      
      migrated++;
    } catch (error) {
      console.log(`  ❌ Error migrating purchase ${purchase.purchaseNumber}: ${error.message}`);
    }
  }
  
  console.log(`  ✅ Migrated: ${migrated}, Skipped: ${skipped}`);
  return { migrated, skipped };
}

// Migrate credit notes
async function migrateCreditNotes(companyId, userId) {
  console.log('\n📝 Migrating Credit Notes...');
  
  const creditNotes = await CreditNote.find({ 
    company: companyId,
    status: { $nin: ['draft', 'cancelled'] }
  });
  
  console.log(`  Found ${creditNotes.length} credit notes`);
  
  let migrated = 0;
  let skipped = 0;
  
  for (const creditNote of creditNotes) {
    try {
      if (await entryExists(companyId, 'credit_note', creditNote._id)) {
        skipped++;
        continue;
      }
      
      const total = creditNote.grandTotal || 0;
      const vatAmount = creditNote.totalTax || 0;
      const subtotal = total - vatAmount;
      const issueDate = creditNote.issueDate || creditNote.createdAt;
      
      const lines = [];
      
      // Debit: Sales Returns
      if (subtotal > 0) {
        lines.push(createDebitLine(
          DEFAULT_ACCOUNTS.salesReturns,
          subtotal,
          `Credit Note ${creditNote.creditNoteNumber} - Returns`
        ));
      }
      
      // Debit: VAT Receivable
      if (vatAmount > 0) {
        lines.push(createDebitLine(
          DEFAULT_ACCOUNTS.vatReceivable,
          vatAmount,
          `Credit Note ${creditNote.creditNoteNumber} - VAT`
        ));
      }
      
      // Credit: Accounts Receivable
      lines.push(createCreditLine(
        DEFAULT_ACCOUNTS.accountsReceivable,
        total,
        `Credit Note ${creditNote.creditNoteNumber}`
      ));
      
      await createJournalEntry(companyId, userId, {
        date: issueDate,
        description: `Credit Note ${creditNote.creditNoteNumber} issued (migrated)`,
        sourceType: 'credit_note',
        sourceId: creditNote._id,
        sourceReference: creditNote.creditNoteNumber,
        lines
      });
      
      // Handle refunds
      if (creditNote.payments && creditNote.payments.length > 0) {
        for (const payment of creditNote.payments) {
          if (await entryExists(companyId, 'payment', payment._id)) {
            continue;
          }
          
          const cashAccount = payment.paymentMethod === 'bank' 
            ? DEFAULT_ACCOUNTS.cashAtBank 
            : DEFAULT_ACCOUNTS.cashInHand;
          
          const paymentLines = [];
          
          // Debit: Accounts Receivable
          paymentLines.push(createDebitLine(
            DEFAULT_ACCOUNTS.accountsReceivable,
            payment.amount,
            `Refund for ${creditNote.creditNoteNumber}`
          ));
          
          // Credit: Cash/Bank
          paymentLines.push(createCreditLine(
            cashAccount,
            payment.amount,
            `Refund for ${creditNote.creditNoteNumber}`
          ));
          
          await createJournalEntry(companyId, userId, {
            date: payment.refundedAt || issueDate,
            description: `Credit Note ${creditNote.creditNoteNumber} refund (migrated)`,
            sourceType: 'payment',
            sourceReference: creditNote.creditNoteNumber,
            lines: paymentLines
          });
        }
      }
      
      migrated++;
    } catch (error) {
      console.log(`  ❌ Error migrating credit note ${creditNote.creditNoteNumber}: ${error.message}`);
    }
  }
  
  console.log(`  ✅ Migrated: ${migrated}, Skipped: ${skipped}`);
  return { migrated, skipped };
}

// Migrate expenses
async function migrateExpenses(companyId, userId) {
  console.log('\n💰 Migrating Expenses...');
  
  const expenses = await Expense.find({ 
    company: companyId,
    status: { $nin: ['draft', 'cancelled'] }
  });
  
  console.log(`  Found ${expenses.length} expenses`);
  
  let migrated = 0;
  let skipped = 0;
  
  for (const expense of expenses) {
    try {
      if (await entryExists(companyId, 'expense', expense._id)) {
        skipped++;
        continue;
      }
      
      const amount = expense.amount || 0;
      const expenseDate = expense.expenseDate || expense.createdAt;
      
      const expenseAccount = getExpenseAccountCode(expense.type);
      const cashAccount = expense.paymentMethod === 'bank' 
        ? DEFAULT_ACCOUNTS.cashAtBank 
        : DEFAULT_ACCOUNTS.cashInHand;
      
      const lines = [];
      
      // Debit: Expense Account
      lines.push(createDebitLine(
        expenseAccount,
        amount,
        expense.description || 'Expense'
      ));
      
      // Credit: Cash/Bank
      lines.push(createCreditLine(
        cashAccount,
        amount,
        expense.description || 'Expense payment'
      ));
      
      await createJournalEntry(companyId, userId, {
        date: expenseDate,
        description: `Expense: ${expense.description || expense.type} (migrated)`,
        sourceType: 'expense',
        sourceId: expense._id,
        sourceReference: expense.expenseNumber,
        lines
      });
      
      migrated++;
    } catch (error) {
      console.log(`  ❌ Error migrating expense ${expense.expenseNumber}: ${error.message}`);
    }
  }
  
  console.log(`  ✅ Migrated: ${migrated}, Skipped: ${skipped}`);
  return { migrated, skipped };
}

// Migrate fixed assets
async function migrateFixedAssets(companyId, userId) {
  console.log('\n🏢 Migrating Fixed Assets...');
  
  const assets = await FixedAsset.find({ 
    company: companyId,
    status: { $ne: 'disposed' } // Skip disposed for now
  });
  
  console.log(`  Found ${assets.length} fixed assets`);
  
  let migrated = 0;
  let skipped = 0;
  
  for (const asset of assets) {
    try {
      if (await entryExists(companyId, 'asset', asset._id)) {
        skipped++;
        continue;
      }
      
      const assetAccount = getAssetAccountCode(asset.category);
      const cashAccount = asset.paymentMethod === 'bank' 
        ? DEFAULT_ACCOUNTS.cashAtBank 
        : DEFAULT_ACCOUNTS.cashInHand;
      
      const lines = [];
      
      // Debit: Fixed Asset
      lines.push(createDebitLine(
        assetAccount,
        asset.purchaseCost,
        `Asset: ${asset.name}`
      ));
      
      // Credit: Cash/Bank
      lines.push(createCreditLine(
        cashAccount,
        asset.purchaseCost,
        `Asset purchase: ${asset.name}`
      ));
      
      await createJournalEntry(companyId, userId, {
        date: asset.purchaseDate || asset.createdAt,
        description: `Asset purchased: ${asset.name} (migrated)`,
        sourceType: 'asset',
        sourceId: asset._id,
        sourceReference: asset.assetCode,
        lines
      });
      
      migrated++;
    } catch (error) {
      console.log(`  ❌ Error migrating asset ${asset.assetCode}: ${error.message}`);
    }
  }
  
  console.log(`  ✅ Migrated: ${migrated}, Skipped: ${skipped}`);
  return { migrated, skipped };
}

// Migrate loans
async function migrateLoans(companyId, userId) {
  console.log('\n🏦 Migrating Loans...');
  
  const loans = await Loan.find({ 
    company: companyId,
    status: { $ne: 'cancelled' }
  });
  
  console.log(`  Found ${loans.length} loans`);
  
  let migrated = 0;
  let skipped = 0;
  
  for (const loan of loans) {
    try {
      if (await entryExists(companyId, 'loan', loan._id)) {
        skipped++;
        continue;
      }
      
      const cashAccount = loan.paymentMethod === 'bank' 
        ? DEFAULT_ACCOUNTS.cashAtBank 
        : DEFAULT_ACCOUNTS.cashInHand;
      
      const loanAccount = loan.loanType === 'short-term'
        ? DEFAULT_ACCOUNTS.shortTermLoans
        : DEFAULT_ACCOUNTS.longTermLoans;
      
      // Entry for loan received
      const lines = [];
      
      // Debit: Cash/Bank
      lines.push(createDebitLine(
        cashAccount,
        loan.originalAmount,
        `Loan received: ${loan.loanNumber}`
      ));
      
      // Credit: Loan Liability
      lines.push(createCreditLine(
        loanAccount,
        loan.originalAmount,
        `Loan: ${loan.loanNumber}`
      ));
      
      await createJournalEntry(companyId, userId, {
        date: loan.startDate || loan.createdAt,
        description: `Loan received: ${loan.loanNumber} (migrated)`,
        sourceType: 'loan',
        sourceId: loan._id,
        sourceReference: loan.loanNumber,
        lines
      });
      
      // Handle payments
      if (loan.payments && loan.payments.length > 0) {
        for (const payment of loan.payments) {
          if (await entryExists(companyId, 'loan_payment', payment._id)) {
            continue;
          }
          
          const paymentLines = [];
          
          const principal = payment.amount * 0.8; // Estimate 80% principal
          const interest = payment.amount * 0.2; // Estimate 20% interest
          
          // Debit: Loan Liability (principal)
          paymentLines.push(createDebitLine(
            loanAccount,
            principal,
            `Loan payment: ${loan.loanNumber}`
          ));
          
          // Debit: Interest Expense
          paymentLines.push(createDebitLine(
            DEFAULT_ACCOUNTS.interestExpense,
            interest,
            `Interest payment: ${loan.loanNumber}`
          ));
          
          // Credit: Cash/Bank
          paymentLines.push(createCreditLine(
            cashAccount,
            payment.amount,
            `Loan payment: ${loan.loanNumber}`
          ));
          
          await createJournalEntry(companyId, userId, {
            date: payment.paymentDate || loan.startDate,
            description: `Loan payment: ${loan.loanNumber} (migrated)`,
            sourceType: 'loan',
            sourceReference: loan.loanNumber,
            lines: paymentLines
          });
        }
      }
      
      migrated++;
    } catch (error) {
      console.log(`  ❌ Error migrating loan ${loan.loanNumber}: ${error.message}`);
    }
  }
  
  console.log(`  ✅ Migrated: ${migrated}, Skipped: ${skipped}`);
  return { migrated, skipped };
}

// Migrate purchase returns
async function migratePurchaseReturns(companyId, userId) {
  console.log('\n🔄 Migrating Purchase Returns...');
  
  const purchaseReturns = await PurchaseReturn.find({ 
    company: companyId,
    status: { $nin: ['draft', 'rejected'] }
  });
  
  console.log(`  Found ${purchaseReturns.length} purchase returns`);
  
  let migrated = 0;
  let skipped = 0;
  
  for (const purchaseReturn of purchaseReturns) {
    try {
      if (await entryExists(companyId, 'purchase_return', purchaseReturn._id)) {
        skipped++;
        continue;
      }
      
      const total = purchaseReturn.total || 0;
      const vatAmount = purchaseReturn.vatAmount || 0;
      const subtotal = total - vatAmount;
      const returnDate = purchaseReturn.date || purchaseReturn.createdAt;
      
      const lines = [];
      
      // Debit: Accounts Payable
      lines.push(createDebitLine(
        DEFAULT_ACCOUNTS.accountsPayable,
        total,
        `Purchase Return ${purchaseReturn.returnNumber}`
      ));
      
      // Credit: Inventory
      if (subtotal > 0) {
        lines.push(createCreditLine(
          DEFAULT_ACCOUNTS.inventory,
          subtotal,
          `Purchase Return ${purchaseReturn.returnNumber} - Inventory`
        ));
      }
      
      // Credit: VAT Receivable
      if (vatAmount > 0) {
        lines.push(createCreditLine(
          DEFAULT_ACCOUNTS.vatReceivable,
          vatAmount,
          `Purchase Return ${purchaseReturn.returnNumber} - VAT`
        ));
      }
      
      await createJournalEntry(companyId, userId, {
        date: returnDate,
        description: `Purchase Return ${purchaseReturn.returnNumber} approved (migrated)`,
        sourceType: 'purchase_return',
        sourceId: purchaseReturn._id,
        sourceReference: purchaseReturn.returnNumber,
        lines
      });
      
      migrated++;
    } catch (error) {
      console.log(`  ❌ Error migrating purchase return ${purchaseReturn.returnNumber}: ${error.message}`);
    }
  }
  
  console.log(`  ✅ Migrated: ${migrated}, Skipped: ${skipped}`);
  return { migrated, skipped };
}

// Main migration function
async function runMigration() {
  try {
    console.log('🚀 Starting Journal Entries Migration...\n');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('✅ MongoDB Connected...');
    
    // Get all companies
    const companies = await Company.find({});
    console.log(`📊 Found ${companies.length} companies to process\n`);
    
    // Get a default user for createdBy (first admin user)
    const User = require('../models/User');
    const defaultUser = await User.findOne({ role: 'admin' });
    
    if (!defaultUser) {
      console.log('❌ No admin user found. Using system user.');
    }
    
    const userId = defaultUser?._id || '000000000000000000000000';
    
    let totalMigrated = 0;
    let totalSkipped = 0;
    
    for (const company of companies) {
      console.log(`\n🏢 Processing Company: ${company.name} (${company._id})`);
      console.log('='.repeat(50));
      
      // Run all migrations for this company
      const invoiceResults = await migrateInvoices(company._id, userId);
      const purchaseResults = await migratePurchases(company._id, userId);
      const creditNoteResults = await migrateCreditNotes(company._id, userId);
      const expenseResults = await migrateExpenses(company._id, userId);
      const assetResults = await migrateFixedAssets(company._id, userId);
      const loanResults = await migrateLoans(company._id, userId);
      const purchaseReturnResults = await migratePurchaseReturns(company._id, userId);
      
      totalMigrated += invoiceResults.migrated + purchaseResults.migrated + 
                       creditNoteResults.migrated + expenseResults.migrated + 
                       assetResults.migrated + loanResults.migrated + 
                       purchaseReturnResults.migrated;
      
      totalSkipped += invoiceResults.skipped + purchaseResults.skipped + 
                      creditNoteResults.skipped + expenseResults.skipped + 
                      assetResults.skipped + loanResults.skipped + 
                      purchaseReturnResults.skipped;
    }
    
    // Get final journal entry count
    const journalEntryCount = await JournalEntry.countDocuments({});
    
    console.log('\n' + '='.repeat(50));
    console.log('📈 MIGRATION SUMMARY');
    console.log('='.repeat(50));
    console.log(`Total entries migrated: ${totalMigrated}`);
    console.log(`Total entries skipped (already exist): ${totalSkipped}`);
    console.log(`Total journal entries in database: ${journalEntryCount}`);
    console.log('\n✅ Migration completed successfully!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
runMigration();
