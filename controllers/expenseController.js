const Expense = require('../models/Expense');
const mongoose = require('mongoose');
const { BankAccount, BankTransaction } = require('../models/BankAccount');
const ChartOfAccount = require('../models/ChartOfAccount');
const JournalService = require('../services/journalService');
const JournalEntry = require('../models/JournalEntry');

// @desc    Get all expenses for a company
// @route   GET /api/expenses
// @access  Private
exports.getExpenses = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { 
      type, 
      startDate, 
      endDate, 
      expenseAccountId, 
      paymentMethod,
      page = 1, 
      limit = 50 
    } = req.query;
    
    const query = { company: companyId };
    
    if (type) {
      query.type = type;
    }
    
    // Filter by expense account
    if (expenseAccountId) {
      query.expense_account_id = expenseAccountId;
    }
    
    // Filter by payment method
    if (paymentMethod) {
      query.payment_method = paymentMethod;
    }
    
    if (startDate || endDate) {
      query.expenseDate = {};
      if (startDate) query.expenseDate.$gte = new Date(startDate);
      if (endDate) query.expenseDate.$lte = new Date(endDate);
    }
    
    const expenses = await Expense.find(query)
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('expense_account_id', 'code name')
      .populate('bank_account_id', 'accountCode accountName')
      .populate('petty_cash_fund_id', 'name')
      .sort({ expenseDate: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await Expense.countDocuments(query);
    
    // Transform to include populated Account and Method columns
    const transformedExpenses = expenses.map(exp => ({
      _id: exp._id,
      reference: exp.reference_no || exp.expenseNumber,
      date: exp.expenseDate || exp.expense_date,
      description: exp.description,
      account: exp.expense_account_id ? {
        _id: exp.expense_account_id._id,
        code: exp.expense_account_id.code,
        name: exp.expense_account_id.name
      } : null,
      method: exp.payment_method || exp.paymentMethod,
      amount: exp.amount,
      taxAmount: exp.tax_amount || exp.vatAmount,
      totalAmount: exp.total_amount || (exp.amount + (exp.tax_amount || 0)),
      status: exp.status,
      bankAccount: exp.bank_account_id ? {
        _id: exp.bank_account_id._id,
        code: exp.bank_account_id.accountCode,
        name: exp.bank_account_id.accountName
      } : null,
      pettyCashFund: exp.petty_cash_fund_id ? {
        _id: exp.petty_cash_fund_id._id,
        name: exp.petty_cash_fund_id.name
      } : null,
      receiptRef: exp.receipt_ref,
      createdAt: exp.createdAt,
      updatedAt: exp.updatedAt
    }));
    
    res.json({
      success: true,
      count: transformedExpenses.length,
      total,
      pages: Math.ceil(total / limit),
      data: transformedExpenses
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single expense
// @route   GET /api/expenses/:id
// @access  Private
exports.getExpense = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    const expense = await Expense.findOne({
      _id: req.params.id,
      company: companyId
    }).populate('createdBy', 'name email').populate('approvedBy', 'name email');
    
    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }
    
    // Transform expense to include account info
    const transformedExpense = {
      _id: expense._id,
      reference: expense.reference_no || expense.expenseNumber,
      date: expense.expenseDate || expense.expense_date,
      description: expense.description,
      account: expense.expense_account_id ? {
        _id: expense.expense_account_id._id,
        code: expense.expense_account_id.code,
        name: expense.expense_account_id.name
      } : null,
      method: expense.payment_method || expense.paymentMethod,
      amount: expense.amount,
      taxAmount: expense.tax_amount || expense.vatAmount,
      totalAmount: expense.total_amount || (expense.amount + (expense.tax_amount || 0)),
      status: expense.status,
      type: expense.type,
      category: expense.category,
      notes: expense.notes,
      bankAccount: expense.bank_account_id ? {
        _id: expense.bank_account_id._id,
        code: expense.bank_account_id.accountCode,
        name: expense.bank_account_id.accountName
      } : null,
      pettyCashFund: expense.petty_cash_fund_id ? {
        _id: expense.petty_cash_fund_id._id,
        name: expense.petty_cash_fund_id.name
      } : null,
      receiptRef: expense.receipt_ref,
      createdBy: expense.createdBy,
      approvedBy: expense.approvedBy,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt
    };
    
    res.json({
      success: true,
      data: transformedExpense
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new expense
// @route   POST /api/expenses
// @access  Private
exports.createExpense = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { 
      bankAccountId, 
      paid, 
      paymentMethod, 
      payment_method,
      expense_account_id,
      expenseAccountId,
      expense_date,
      expenseDate,
      total_amount,
      amount,
      tax_amount,
      taxAmount,
      type,
      description,
      reference,
      notes,
      status, // Allow setting status (e.g. if admin wants to create directly as 'posted')
      isRecurring,
      recurringFrequency
    } = req.body;
    
    // Normalize payment method - use payment_method if sent from frontend
    const normalizedPaymentMethod = payment_method || paymentMethod || 'bank';
    // Use snake_case for backend fields
    const normalizedExpenseAccountId = expense_account_id || expenseAccountId;
    const normalizedExpenseDate = expense_date || expenseDate || new Date();
    const normalizedTotalAmount = total_amount || (amount + (tax_amount || taxAmount || 0));
    const normalizedTaxAmount = tax_amount || taxAmount || 0;
    
    const expense = new Expense({
      company: companyId,
      createdBy: req.user._id,
      posted_by: req.user._id,
      // Use snake_case field names to match the schema
      payment_method: normalizedPaymentMethod,
      expense_account_id: normalizedExpenseAccountId,
      expense_date: normalizedExpenseDate,
      total_amount: normalizedTotalAmount,
      tax_amount: normalizedTaxAmount,
      // Other fields
      type,
      description,
      reference,
      notes,
      amount: amount,
      status: status || 'pending', // Default to pending
      isRecurring: isRecurring || false,
      recurringFrequency: recurringFrequency || 'monthly'
    });
    
    await expense.save();
    
    // If expense is paid immediately, create journal entry and bank transaction
    // Only do this if status is 'posted' or 'approved' (if auto-posting is allowed)
    // For now, let's only create journals if explicitly paid and status allows it
    if (paid && paymentMethod && (expense.status === 'posted' || expense.status === 'approved')) {
      const bankPaymentMethods = ['bank_transfer', 'cheque', 'mobile_money'];
      let bankAccountCode = null;
      let bankAccount = null;
      
      // Get bank account info if needed
      if (bankAccountId && bankPaymentMethods.includes(paymentMethod)) {
        try {
          bankAccount = await BankAccount.findOne({
            _id: bankAccountId,
            company: companyId,
            isActive: true
          });
          if (bankAccount) {
            bankAccountCode = bankAccount.accountCode;
          }
        } catch (err) {
          console.error('Error fetching bank account:', err);
        }
      }
      
      // Create journal entry for expense payment
      try {
        await JournalService.createExpenseEntry(companyId, req.user.id, {
          _id: expense._id,
          description: expense.description || expense.type,
          date: expense.expenseDate || new Date(),
          amount: expense.amount,
          vatAmount: expense.vatAmount || 0,
          category: expense.type,
          paymentMethod: paymentMethod,
          bankAccountCode: bankAccountCode
        });
      } catch (journalError) {
        console.error('Error creating journal entry for expense:', journalError);
      }
      
      // Create bank transaction if payment method requires it
      if (bankAccount && bankPaymentMethods.includes(paymentMethod)) {
        try {
          const currentBalance = bankAccount.currentBalance;
          
          const transaction = new BankTransaction({
            company: companyId,
            account: bankAccount._id,
            type: 'withdrawal',
            amount: expense.amount,
            balanceAfter: currentBalance - expense.amount,
            description: `Expense paid: ${expense.description || expense.type}`,
            date: new Date(),
            referenceNumber: expense.reference || '',
            paymentMethod: paymentMethod,
            status: 'completed',
            reference: expense._id,
            referenceType: 'Expense',
            createdBy: req.user._id,
            notes: `Payment for expense: ${expense.description || expense.type}`
          });
          
          await transaction.save();
          
          // Update bank account balance
          bankAccount.currentBalance = currentBalance - expense.amount;
          await bankAccount.save();
        } catch (bankError) {
          console.error('Error creating bank transaction:', bankError);
        }
      }
    }
    
    res.status(201).json({
      success: true,
      data: expense
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update expense
// @route   PUT /api/expenses/:id
// @access  Private
exports.updateExpense = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    let expense = await Expense.findOne({
      _id: req.params.id,
      company: companyId
    });
    
    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }
    
    // Don't allow changing company or createdBy
    const { company, createdBy, bankAccountId, ...updateData } = req.body;
    
    // Check if expense is being marked as paid with bank transfer
    const isBeingPaid = updateData.paid === true && !expense.paid;
    const paymentMethod = updateData.paymentMethod;
    const bankPaymentMethods = ['bank_transfer', 'cheque', 'mobile_money'];
    
    // Get bank account info if needed for journal entry and bank transaction
    let bankAccount = null;
    let bankAccountCode = null;
    if (bankAccountId && bankPaymentMethods.includes(paymentMethod)) {
      try {
        bankAccount = await BankAccount.findOne({
          _id: bankAccountId,
          company: companyId,
          isActive: true
        });
        if (bankAccount) {
          bankAccountCode = bankAccount.accountCode;
        }
      } catch (err) {
        console.error('Error fetching bank account:', err);
      }
    }
    
    Object.assign(expense, updateData);
    await expense.save();

    // Create journal entry for expense payment
    let journalEntry = null;
    if (isBeingPaid) {
      try {
        await JournalService.createExpenseEntry(companyId, req.user.id, {
          _id: expense._id,
          description: expense.description || expense.type,
          date: expense.expenseDate || new Date(),
          amount: expense.amount,
          vatAmount: expense.vatAmount || 0,
          category: expense.type,
          paymentMethod: expense.paymentMethod,
          bankAccountCode: bankAccountCode
        });
      } catch (journalError) {
        console.error('Error creating journal entry for expense:', journalError);
        // Don't fail the expense update if journal entry fails
      }
    }
    
    // Create bank transaction if expense is being marked as paid with bank transfer, cheque, or mobile money
    let bankTransaction = null;
    if (isBeingPaid && bankPaymentMethods.includes(paymentMethod) && bankAccount) {
      try {
        const currentBalance = bankAccount.currentBalance;
        
        // Create withdrawal transaction (debit) for expense payment
        const transaction = new BankTransaction({
          company: companyId,
          account: bankAccount._id,
          type: 'withdrawal',
          amount: expense.amount,
          balanceAfter: currentBalance - expense.amount,
          description: `Expense paid: ${expense.description || expense.type}`,
          date: new Date(),
          referenceNumber: expense.reference || '',
          paymentMethod: paymentMethod,
          status: 'completed',
          reference: expense._id,
          referenceType: 'Expense',
          createdBy: req.user._id,
          notes: `Payment for expense: ${expense.description || expense.type}`
        });
        
        await transaction.save();
        
        // Update bank account balance
        bankAccount.currentBalance = currentBalance - expense.amount;
        await bankAccount.save();
        
        bankTransaction = transaction;
      } catch (bankError) {
        console.error('Error creating bank transaction:', bankError);
      }
    }
    
    res.json({
      success: true,
      data: expense,
      bankTransaction: bankTransaction
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete expense
// @route   DELETE /api/expenses/:id
// @access  Private
exports.deleteExpense = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    const expense = await Expense.findOne({
      _id: req.params.id,
      company: companyId
    });
    
    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }
    
    // Soft delete - mark as cancelled
    expense.status = 'cancelled';
    await expense.save();
    
    res.json({
      success: true,
      message: 'Expense cancelled'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reverse an expense
// @route   POST /api/expenses/:id/reverse
// @access  Private
exports.reverseExpense = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { reason } = req.body;
    
    const expense = await Expense.findOne({
      _id: req.params.id,
      company: companyId
    }).populate('expense_account_id', 'code name');
    
    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }
    
    if (expense.status === 'reversed') {
      return res.status(400).json({ success: false, message: 'Expense already reversed' });
    }
    
    // Create reversal journal entry
    let reversalJournalEntry = null;
    if (expense.journal_entry_id) {
      try {
        // Get the original journal entry
        const originalEntry = await JournalEntry.findById(expense.journal_entry_id);
        
        if (originalEntry) {
          // Create reversal entry with opposite debits/credits
          reversalJournalEntry = new JournalEntry({
            company: companyId,
            date: new Date(),
            description: `REVERSAL: ${expense.description}`,
            reference: expense.reference_no,
            referenceType: 'Expense',
            referenceId: expense._id,
            entries: originalEntry.entries.map(entry => ({
              account: entry.account,
              accountCode: entry.accountCode,
              accountName: entry.accountName,
              debit: entry.credit,  // Swap debit/credit
              credit: entry.debit,
              description: entry.description
            })),
            status: 'posted',
            postedBy: req.user._id,
            notes: reason || `Reversal of expense ${expense.reference_no}`
          });
          
          await reversalJournalEntry.save();
        }
      } catch (journalError) {
        console.error('Error creating reversal journal entry:', journalError);
      }
    }
    
    // Update expense status to reversed
    expense.status = 'reversed';
    expense.reversal_journal_entry_id = reversalJournalEntry ? reversalJournalEntry._id : null;
    await expense.save();
    
    res.json({
      success: true,
      message: 'Expense reversed successfully',
      data: expense,
      reversalJournalEntry: reversalJournalEntry
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get expense summary by type for a period
// @route   GET /api/expenses/summary
// @access  Private
exports.getExpenseSummary = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate } = req.query;
    
    const match = {
      company: companyId,
      status: { $ne: 'cancelled' }
    };
    
    if (startDate || endDate) {
      match.expenseDate = {};
      if (startDate) match.expenseDate.$gte = new Date(startDate);
      if (endDate) match.expenseDate.$lte = new Date(endDate);
    }
    
    const summary = await Expense.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$type',
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Transform to object
    const result = {
      salariesWages: 0,
      rent: 0,
      utilities: 0,
      transportDelivery: 0,
      marketingAdvertising: 0,
      otherExpenses: 0,
      interestIncome: 0,
      otherIncome: 0,
      totalOperating: 0,
      totalOtherIncome: 0
    };
    
    summary.forEach(item => {
      const type = item._id;
      const total = item.total;
      
      switch (type) {
        case 'salaries_wages':
          result.salariesWages = total;
          result.totalOperating += total;
          break;
        case 'rent':
          result.rent = total;
          result.totalOperating += total;
          break;
        case 'utilities':
          result.utilities = total;
          result.totalOperating += total;
          break;
        case 'transport_delivery':
          result.transportDelivery = total;
          result.totalOperating += total;
          break;
        case 'marketing_advertising':
          result.marketingAdvertising = total;
          result.totalOperating += total;
          break;
        case 'other_expense':
          result.otherExpenses = total;
          result.totalOperating += total;
          break;
        case 'interest_income':
          result.interestIncome = total;
          result.totalOtherIncome += total;
          break;
        case 'other_income':
          result.otherIncome = total;
          result.totalOtherIncome += total;
          break;
      }
    });
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get expense accounts for dropdown
// @route   GET /api/expenses/accounts
// @access  Private
exports.getExpenseAccounts = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    // Debug: Log company ID
    console.log(`[ExpenseController] Fetching accounts for company: ${companyId}`);
    
    // Fetch ALL active accounts for debugging
    const allAccounts = await ChartOfAccount.find({
      company: companyId,
      isActive: true
    }).select('_id code name type').sort({ code: 1 });
    
    console.log(`[ExpenseController] Total active accounts: ${allAccounts.length}`);
    
    // Filter for expense accounts
    const accounts = allAccounts.filter(acc => acc.type === 'expense' || acc.type === 'cogs');

    // Debug: Log count
    console.log(`[ExpenseController] Found ${accounts.length} expense accounts`);

    res.json({
      success: true,
      data: accounts
    });
  } catch (error) {
    console.error('[ExpenseController] Error fetching expense accounts:', error);
    next(error);
  }
};

// @desc    Bulk create expenses
// @route   POST /api/expenses/bulk
// @access  Private
exports.bulkCreateExpenses = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { expenses } = req.body;
    
    if (!expenses || !Array.isArray(expenses) || expenses.length === 0) {
      return res.status(400).json({ success: false, message: 'No expenses provided' });
    }
    
    const createdExpenses = await Promise.all(
      expenses.map(async (expenseData) => {
        const expense = new Expense({
          ...expenseData,
          company: companyId,
          createdBy: req.user._id
        });
        await expense.save();
        return expense;
      })
    );
    
    res.status(201).json({
      success: true,
      count: createdExpenses.length,
      data: createdExpenses
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Approve an expense
// @route   PUT /api/expenses/:id/approve
// @access  Private
exports.approveExpense = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const expenseId = req.params.id;

    const expense = await Expense.findOne({ _id: expenseId, company: companyId });

    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }

    if (expense.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Expense is already ${expense.status}` });
    }

    expense.status = 'approved';
    expense.approvedBy = req.user._id;
    expense.approvedAt = new Date();

    // If the expense was paid on creation, we might want to post it now (create journal entries)
    // Or we might want to wait for a separate "Post" action. For now, let's just mark it approved.
    // If you want to auto-post upon approval:
    // await postExpenseInternal(expense, req.user.id); 

    await expense.save();

    res.json({
      success: true,
      data: expense,
      message: 'Expense approved successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reject an expense
// @route   PUT /api/expenses/:id/reject
// @access  Private
exports.rejectExpense = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const expenseId = req.params.id;
    const { reason } = req.body;

    const expense = await Expense.findOne({ _id: expenseId, company: companyId });

    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }

    if (expense.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Expense is already ${expense.status}` });
    }

    expense.status = 'rejected';
    expense.rejectedBy = req.user._id;
    expense.rejectedAt = new Date();
    expense.rejectionReason = reason || 'No reason provided';

    await expense.save();

    res.json({
      success: true,
      data: expense,
      message: 'Expense rejected successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Post an approved expense (create journal entries)
// @route   PUT /api/expenses/:id/post
// @access  Private
exports.postExpense = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const expenseId = req.params.id;
    const { bankAccountId } = req.body;

    const expense = await Expense.findOne({ _id: expenseId, company: companyId });

    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }

    if (expense.status !== 'approved' && expense.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Cannot post expense with status: ${expense.status}` });
    }

    // Create Journal Entry
    const bankPaymentMethods = ['bank_transfer', 'cheque', 'mobile_money'];
    let bankAccountCode = null;
    let bankAccount = null;

    if (bankAccountId && bankPaymentMethods.includes(expense.payment_method)) {
      try {
        bankAccount = await BankAccount.findOne({
          _id: bankAccountId,
          company: companyId,
          isActive: true
        });
        if (bankAccount) {
          bankAccountCode = bankAccount.accountCode;
        }
      } catch (err) {
        console.error('Error fetching bank account for posting:', err);
      }
    }

    try {
      await JournalService.createExpenseEntry(companyId, req.user.id, {
        _id: expense._id,
        description: expense.description || expense.type,
        date: expense.expenseDate || new Date(),
        amount: expense.amount,
        vatAmount: expense.tax_amount || 0,
        category: expense.type,
        paymentMethod: expense.payment_method,
        bankAccountCode: bankAccountCode
      });
    } catch (journalError) {
      console.error('Error creating journal entry for expense:', journalError);
      return res.status(500).json({ success: false, message: 'Failed to create journal entry' });
    }

    // Create Bank Transaction
    if (bankAccount && bankPaymentMethods.includes(expense.payment_method)) {
      try {
        const currentBalance = bankAccount.currentBalance;
        
        const transaction = new BankTransaction({
          company: companyId,
          account: bankAccount._id,
          type: 'withdrawal',
          amount: expense.amount,
          balanceAfter: currentBalance - expense.amount,
          description: `Expense paid: ${expense.description || expense.type}`,
          date: new Date(),
          referenceNumber: expense.reference || '',
          paymentMethod: expense.payment_method,
          status: 'completed',
          reference: expense._id,
          referenceType: 'Expense',
          createdBy: req.user._id,
          notes: `Payment for expense: ${expense.description || expense.type}`
        });
        
        await transaction.save();
        
        // Update bank account balance
        bankAccount.currentBalance = currentBalance - expense.amount;
        await bankAccount.save();
      } catch (bankError) {
        console.error('Error creating bank transaction for expense:', bankError);
        // We might want to rollback journal entry here, but for now just log
      }
    }

    expense.status = 'posted';
    await expense.save();

    res.json({
      success: true,
      data: expense,
      message: 'Expense posted successfully'
    });

  } catch (error) {
    next(error);
  }
};
