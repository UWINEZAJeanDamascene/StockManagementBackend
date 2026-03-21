const Loan = require('../models/Loan');
const JournalService = require('../services/journalService');
const ChartOfAccount = require('../models/ChartOfAccount');
const BankAccount = require('../models/BankAccount');
const JournalEntry = require('../models/JournalEntry');
const SequenceService = require('../services/sequenceService');
const PeriodService = require('../services/periodService');

// @desc    Get all loans for a company
// @route   GET /api/loans
// @access  Private
exports.getLoans = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { status, loanType } = req.query;
    
    const query = { company: companyId };
    if (status) query.status = status;
    if (loanType) query.loanType = loanType;

    const loans = await Loan.find(query)
      .populate('createdBy', 'name email')
      .sort({ startDate: -1 });

    // Calculate totals
    const totalOriginal = loans.reduce((sum, loan) => sum + (loan.originalAmount || 0), 0);
    const totalPaid = loans.reduce((sum, loan) => sum + (loan.amountPaid || 0), 0);
    const totalOutstanding = loans.reduce((sum, loan) => sum + (loan.remainingBalance || 0), 0);

    res.json({
      success: true,
      count: loans.length,
      data: loans,
      summary: {
        totalOriginal,
        totalPaid,
        totalOutstanding
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single loan
// @route   GET /api/loans/:id
// @access  Private
exports.getLoan = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    const loan = await Loan.findOne({ _id: req.params.id, company: companyId })
      .populate('createdBy', 'name email')
      .populate('payments.recordedBy', 'name email');

    if (!loan) {
      return res.status(404).json({ success: false, message: 'Loan not found' });
    }

    res.json({ success: true, data: loan });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new loan
// @route   POST /api/loans
// @access  Private
exports.createLoan = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    const loan = await Loan.create({
      ...req.body,
      company: companyId,
      createdBy: req.user._id
    });

    // Create journal entry for loan received if loan is active
    if (loan.status === 'active' && loan.originalAmount > 0) {
      try {
        await JournalService.createLoanReceivedEntry(companyId, req.user.id, {
          _id: loan._id,
          loanNumber: loan.loanNumber,
          loanType: loan.loanType,
          principalAmount: loan.originalAmount,
          disbursementDate: loan.startDate,
          paymentMethod: loan.paymentMethod || 'bank'
        });
      } catch (journalError) {
        console.error('Error creating journal entry for loan:', journalError);
        // Don't fail the loan creation if journal entry fails
      }
    }

    res.status(201).json({ success: true, data: loan });
  } catch (error) {
    next(error);
  }
};

// @desc    Update loan
// @route   PUT /api/loans/:id
// @access  Private
exports.updateLoan = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    let loan = await Loan.findOne({ _id: req.params.id, company: companyId });

    if (!loan) {
      return res.status(404).json({ success: false, message: 'Loan not found' });
    }

    loan = await Loan.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    res.json({ success: true, data: loan });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete loan
// @route   DELETE /api/loans/:id
// @access  Private
exports.deleteLoan = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    const loan = await Loan.findOne({ _id: req.params.id, company: companyId });

    if (!loan) {
      return res.status(404).json({ success: false, message: 'Loan not found' });
    }

    await Loan.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'Loan deleted' });
  } catch (error) {
    next(error);
  }
};

// @desc    Record loan payment
// @route   POST /api/loans/:id/payment
// @access  Private
exports.recordPayment = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { amount, paymentMethod, reference, notes } = req.body;
    
    const loan = await Loan.findOne({ _id: req.params.id, company: companyId });

    if (!loan) {
      return res.status(404).json({ success: false, message: 'Loan not found' });
    }

    // Add payment
    loan.payments.push({
      amount,
      paymentMethod,
      reference,
      notes,
      recordedBy: req.user._id,
      paymentDate: new Date()
    });

    // Update amount paid
    loan.amountPaid += amount;

    // Check if fully paid
    if (loan.amountPaid >= loan.originalAmount) {
      loan.status = 'paid-off';
    }

    await loan.save();

    // Create journal entry for loan payment
    try {
      await JournalService.createLoanPaymentEntry(companyId, req.user.id, {
        loanNumber: loan.loanNumber,
        date: new Date(),
        principalAmount: amount,
        interestAmount: req.body.interestAmount || 0,
        paymentMethod: paymentMethod
      });
    } catch (journalError) {
      console.error('Error creating journal entry for loan payment:', journalError);
      // Don't fail the payment if journal entry fails
    }

    res.json({ success: true, data: loan });
  } catch (error) {
    next(error);
  }
};

// @desc    Get loans summary for Balance Sheet
// @route   GET /api/loans/summary
// @access  Private
exports.getLoansSummary = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    // Get active loans
    const loans = await Loan.find({ company: companyId, status: 'active' });

    // Separate by type
    const shortTermLoans = loans.filter(loan => loan.loanType === 'short-term');
    const longTermLoans = loans.filter(loan => loan.loanType === 'long-term');

    const shortTermTotal = shortTermLoans.reduce((sum, loan) => sum + (loan.remainingBalance || 0), 0);
    const longTermTotal = longTermLoans.reduce((sum, loan) => sum + (loan.remainingBalance || 0), 0);

    res.json({
      success: true,
      data: {
        shortTerm: {
          count: shortTermLoans.length,
          totalOutstanding: shortTermTotal
        },
        longTerm: {
          count: longTermLoans.length,
          totalOutstanding: longTermTotal
        },
        total: {
          count: loans.length,
          totalOutstanding: shortTermTotal + longTermTotal
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Record a drawdown (money received) for a liability
// @route   POST /api/loans/:id/drawdown
// @access  Private
exports.recordDrawdown = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { amount, bankAccountId, transactionDate, notes } = req.body;
    
    const loan = await Loan.findOne({ _id: req.params.id, company: companyId });

    if (!loan) {
      return res.status(404).json({ success: false, message: 'Liability not found' });
    }

    if (loan.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Liability is not active' });
    }

    // Validate bank account
    const bankAccount = await BankAccount.findOne({ _id: bankAccountId, company: companyId });
    if (!bankAccount) {
      return res.status(400).json({ success: false, message: 'Bank account not found' });
    }

    // Validate liability account exists
    const liabilityAccount = await ChartOfAccount.findOne({ _id: loan.liabilityAccountId, company: companyId });
    if (!liabilityAccount) {
      return res.status(400).json({ success: false, message: 'Liability account not found' });
    }

    // Create journal entry for drawdown
    // DR Bank / CR Liability Account
    const entryDate = transactionDate ? new Date(transactionDate) : new Date();
    const entryNumber = await SequenceService.next(companyId, 'JE');
    const period = await PeriodService.getOpenPeriodId(companyId, entryDate);

    const journalEntry = await JournalEntry.create({
      company: companyId,
      entryNumber,
      date: entryDate,
      description: `Liability Drawdown - ${loan.name} - ${loan.loanNumber}`,
      sourceType: 'liability_drawdown',
      sourceId: loan._id.toString(),
      reference: loan.loanNumber,
      status: 'posted',
      lines: [
        {
          accountCode: bankAccount.ledgerAccountId?.code || '1100',
          accountName: bankAccount.accountName,
          description: 'Drawdown proceeds received',
          debit: amount,
          credit: 0
        },
        {
          accountCode: liabilityAccount.code,
          accountName: liabilityAccount.name,
          description: 'Liability recognized',
          debit: 0,
          credit: amount
        }
      ],
      totalDebit: amount,
      totalCredit: amount,
      debitTotal: amount,
      creditTotal: amount,
      postedBy: req.user._id,
      period: period,
      isAutoGenerated: false
    });

    // Add transaction record
    loan.transactions.push({
      transactionDate: entryDate,
      type: 'drawdown',
      amount: amount,
      principalPortion: amount,
      interestPortion: 0,
      bankAccountId: bankAccount._id,
      journalEntryId: journalEntry._id,
      notes: notes
    });

    // Update outstanding balance
    loan.outstandingBalance = (loan.outstandingBalance || 0) + amount;
    await loan.save();

    res.json({ success: true, data: loan, journalEntry });
  } catch (error) {
    next(error);
  }
};

// @desc    Record a repayment for a liability
// @route   POST /api/loans/:id/repayment
// @access  Private
exports.recordRepayment = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { principalPortion, interestPortion, bankAccountId, transactionDate, notes } = req.body;
    
    const loan = await Loan.findOne({ _id: req.params.id, company: companyId });

    if (!loan) {
      return res.status(404).json({ success: false, message: 'Liability not found' });
    }

    if (loan.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Liability is not active' });
    }

    const totalPayment = principalPortion + (interestPortion || 0);

    if (principalPortion > loan.outstandingBalance) {
      return res.status(400).json({ success: false, message: 'Repayment exceeds outstanding balance' });
    }

    // Validate bank account
    const bankAccount = await BankAccount.findOne({ _id: bankAccountId, company: companyId });
    if (!bankAccount) {
      return res.status(400).json({ success: false, message: 'Bank account not found' });
    }

    // Validate liability account exists
    const liabilityAccount = await ChartOfAccount.findOne({ _id: loan.liabilityAccountId, company: companyId });
    if (!liabilityAccount) {
      return res.status(400).json({ success: false, message: 'Liability account not found' });
    }

    // Create journal entry for repayment
    const entryDate = transactionDate ? new Date(transactionDate) : new Date();
    const entryNumber = await SequenceService.next(companyId, 'JE');
    const period = await PeriodService.getOpenPeriodId(companyId, entryDate);

    const journalLines = [
      {
        accountCode: liabilityAccount.code,
        accountName: liabilityAccount.name,
        description: 'Principal repayment',
        debit: principalPortion,
        credit: 0
      }
    ];

    // Add interest expense if present
    if (interestPortion > 0) {
      if (!loan.interestExpenseAccountId) {
        return res.status(400).json({ success: false, message: 'Interest expense account not configured' });
      }
      const interestAccount = await ChartOfAccount.findOne({ _id: loan.interestExpenseAccountId, company: companyId });
      if (interestAccount) {
        journalLines.push({
          accountCode: interestAccount.code,
          accountName: interestAccount.name,
          description: 'Interest expense',
          debit: interestPortion,
          credit: 0
        });
      }
    }

    // Add bank account line
    journalLines.push({
      accountCode: bankAccount.ledgerAccountId?.code || '1100',
      accountName: bankAccount.accountName,
      description: 'Payment to lender',
      debit: 0,
      credit: totalPayment
    });

    const journalEntry = await JournalEntry.create({
      company: companyId,
      entryNumber,
      date: entryDate,
      description: `Liability Repayment - ${loan.name} - ${loan.loanNumber}`,
      sourceType: 'liability_repayment',
      sourceId: `${loan._id}_${entryDate.toISOString()}`,
      reference: loan.loanNumber,
      status: 'posted',
      lines: journalLines,
      totalDebit: totalPayment,
      totalCredit: totalPayment,
      debitTotal: totalPayment,
      creditTotal: totalPayment,
      postedBy: req.user._id,
      period: period,
      isAutoGenerated: false
    });

    // Add transaction record
    loan.transactions.push({
      transactionDate: entryDate,
      type: 'repayment',
      amount: totalPayment,
      principalPortion: principalPortion,
      interestPortion: interestPortion || 0,
      bankAccountId: bankAccount._id,
      journalEntryId: journalEntry._id,
      notes: notes
    });

    // Update outstanding balance and amount paid
    loan.outstandingBalance = (loan.outstandingBalance || 0) - principalPortion;
    loan.amountPaid = (loan.amountPaid || 0) + principalPortion;

    // Check if fully repaid
    if (loan.outstandingBalance <= 0.01) {
      loan.status = 'fully_repaid';
      loan.outstandingBalance = 0;
    }

    await loan.save();

    res.json({ success: true, data: loan, journalEntry });
  } catch (error) {
    next(error);
  }
};

// @desc    Record an interest charge (accrual)
// @route   POST /api/loans/:id/interest
// @access  Private
exports.recordInterest = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { amount, chargeDate, notes } = req.body;
    
    const loan = await Loan.findOne({ _id: req.params.id, company: companyId });

    if (!loan) {
      return res.status(404).json({ success: false, message: 'Liability not found' });
    }

    if (loan.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Liability is not active' });
    }

    if (!loan.interestExpenseAccountId) {
      return res.status(400).json({ success: false, message: 'Interest expense account not configured' });
    }

    // Validate accounts exist
    const liabilityAccount = await ChartOfAccount.findOne({ _id: loan.liabilityAccountId, company: companyId });
    const interestAccount = await ChartOfAccount.findOne({ _id: loan.interestExpenseAccountId, company: companyId });

    if (!liabilityAccount || !interestAccount) {
      return res.status(400).json({ success: false, message: 'Account configuration error' });
    }

    // Create journal entry for interest accrual (no cash movement)
    const entryDate = chargeDate ? new Date(chargeDate) : new Date();
    const entryNumber = await SequenceService.next(companyId, 'JE');
    const period = await PeriodService.getOpenPeriodId(companyId, entryDate);

    const journalEntry = await JournalEntry.create({
      company: companyId,
      entryNumber,
      date: entryDate,
      description: `Interest Accrual - ${loan.name} - ${loan.loanNumber}`,
      sourceType: 'liability_interest',
      sourceId: `${loan._id}_interest_${entryDate.toISOString()}`,
      reference: loan.loanNumber,
      status: 'posted',
      lines: [
        {
          accountCode: interestAccount.code,
          accountName: interestAccount.name,
          description: 'Interest expense accrued',
          debit: amount,
          credit: 0
        },
        {
          accountCode: liabilityAccount.code,
          accountName: liabilityAccount.name,
          description: 'Interest added to liability',
          debit: 0,
          credit: amount
        }
      ],
      totalDebit: amount,
      totalCredit: amount,
      debitTotal: amount,
      creditTotal: amount,
      postedBy: req.user._id,
      period: period,
      isAutoGenerated: false
    });

    // Add transaction record
    loan.transactions.push({
      transactionDate: entryDate,
      type: 'interest_charge',
      amount: amount,
      principalPortion: 0,
      interestPortion: amount,
      journalEntryId: journalEntry._id,
      notes: notes
    });

    // Update outstanding balance (interest is added to liability)
    loan.outstandingBalance = (loan.outstandingBalance || 0) + amount;
    await loan.save();

    res.json({ success: true, data: loan, journalEntry });
  } catch (error) {
    next(error);
  }
};

// @desc    Get liability transactions
// @route   GET /api/loans/:id/transactions
// @access  Private
exports.getTransactions = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    const loan = await Loan.findOne({ _id: req.params.id, company: companyId })
      .populate('transactions.bankAccountId', 'accountName accountNumber')
      .populate('transactions.journalEntryId', 'entryNumber date description');

    if (!loan) {
      return res.status(404).json({ success: false, message: 'Liability not found' });
    }

    res.json({ success: true, data: loan.transactions || [] });
  } catch (error) {
    next(error);
  }
};
