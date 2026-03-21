const { BankAccount, BankTransaction, BankStatementLine, BankReconciliationMatch } = require('../models/BankAccount');
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Purchase = require('../models/Purchase');
const Expense = require('../models/Expense');
const JournalEntry = require('../models/JournalEntry');
const JournalService = require('../services/journalService');

// RETAINED EARNINGS account code for opening balance entry
const RETAINED_EARNINGS_CODE = '3200';

// @desc    Get all bank accounts for a company
// @route   GET /api/bank-accounts
// @access  Private
exports.getBankAccounts = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { accountType, isActive, page = 1, limit = 50 } = req.query;
    
    const query = { company: companyId };
    
    if (accountType) {
      query.accountType = accountType;
    }
    
    // Default to only active accounts - can be overridden by passing isActive=false
    if (isActive === undefined) {
      query.isActive = true;
    } else {
      query.isActive = isActive === 'true';
    }
    
    const accounts = await BankAccount.find(query)
      .populate('createdBy', 'name email')
      .sort({ isPrimary: -1, name: 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await BankAccount.countDocuments(query);
    
    // Get totals by type
    const totals = await BankAccount.getTotalCashPosition(companyId);
    
    res.json({
      success: true,
      count: accounts.length,
      total,
      pages: Math.ceil(total / limit),
      totals,
      data: accounts
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single bank account
// @route   GET /api/bank-accounts/:id
// @access  Private
exports.getBankAccount = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    const account = await BankAccount.findOne({
      _id: req.params.id,
      company: companyId
    }).populate('createdBy', 'name email');
    
    if (!account) {
      return res.status(404).json({ success: false, message: 'Bank account not found' });
    }
    
    res.json({
      success: true,
      data: account
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new bank account
// @route   POST /api/bank-accounts
// @access  Private
exports.createBankAccount = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    // Check if account number already exists for this company
    if (req.body.accountNumber) {
      const existing = await BankAccount.findOne({
        company: companyId,
        accountNumber: req.body.accountNumber,
        isActive: true
      });
      
      if (existing) {
        return res.status(400).json({ 
          success: false, 
          message: 'An account with this number already exists' 
        });
      }
    }
    
    const account = new BankAccount({
      ...req.body,
      company: companyId,
      createdBy: req.user._id
    });
    
    await account.save();
    
    // Note: Opening balance is already set as currentBalance by the model's pre-save middleware
    // No need to create an opening transaction - the currentBalance represents the starting position
    
    res.status(201).json({
      success: true,
      data: account
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update bank account
// @route   PUT /api/bank-accounts/:id
// @access  Private
exports.updateBankAccount = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    let account = await BankAccount.findOne({
      _id: req.params.id,
      company: companyId
    });
    
    if (!account) {
      return res.status(404).json({ success: false, message: 'Bank account not found' });
    }
    
    // Don't allow changing company or createdBy
    const { company, createdBy, currentBalance, ...updateData } = req.body;
    
    // If trying to update opening balance, require special permission or create adjustment
    if (updateData.openingBalance !== undefined && updateData.openingBalance !== account.openingBalance) {
      return res.status(400).json({
        success: false,
        message: 'Cannot directly modify opening balance. Use adjustment transaction instead.'
      });
    }
    
    Object.assign(account, updateData);
    await account.save();
    
    res.json({
      success: true,
      data: account
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete (deactivate) bank account
// @route   DELETE /api/bank-accounts/:id
// @access  Private
exports.deleteBankAccount = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    const account = await BankAccount.findOne({
      _id: req.params.id,
      company: companyId
    });
    
    if (!account) {
      return res.status(404).json({ success: false, message: 'Bank account not found' });
    }
    
    // Check if account has transactions
    const transactionCount = await BankTransaction.countDocuments({ account: account._id });
    
    if (transactionCount > 0 && !req.body.force) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete account with transactions. Use deactivate instead.',
        hasTransactions: true
      });
    }
    
    // Soft delete - deactivate
    account.isActive = false;
    await account.save();
    
    res.json({
      success: true,
      message: 'Bank account deactivated'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get transactions for a bank account
// @route   GET /api/bank-accounts/:id/transactions
// @access  Private
exports.getAccountTransactions = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate, type, page = 1, limit = 50 } = req.query;
    
    // Verify account belongs to company
    const account = await BankAccount.findOne({
      _id: req.params.id,
      company: companyId
    });
    
    if (!account) {
      return res.status(404).json({ success: false, message: 'Bank account not found' });
    }
    
    const query = { account: req.params.id };
    
    if (type) {
      query.type = type;
    }
    
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    
    const transactions = await BankTransaction.find(query)
      .populate('createdBy', 'name email')
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await BankTransaction.countDocuments(query);
    
    // Calculate totals
    const totals = await BankTransaction.aggregate([
      { $match: { account: new mongoose.Types.ObjectId(req.params.id) } },
      {
        $group: {
          _id: '$type',
          total: { $sum: '$amount' }
        }
      }
    ]);
    
    res.json({
      success: true,
      count: transactions.length,
      total,
      pages: Math.ceil(total / limit),
      totals,
      data: transactions
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Add transaction to bank account
// @route   POST /api/bank-accounts/:id/transactions
// @access  Private
exports.addTransaction = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    const account = await BankAccount.findOne({
      _id: req.params.id,
      company: companyId,
      isActive: true
    });
    
    if (!account) {
      return res.status(404).json({ success: false, message: 'Bank account not found or inactive' });
    }
    
    const transaction = await account.addTransaction({
      ...req.body,
      createdBy: req.user._id,
      status: 'completed'
    });
    
    res.status(201).json({
      success: true,
      data: transaction
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Transfer between accounts
// @route   POST /api/bank-accounts/transfer
// @access  Private
exports.transfer = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { fromAccount, toAccount, amount, description, referenceNumber, notes } = req.body;
    
    if (!fromAccount || !toAccount || !amount) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide fromAccount, toAccount, and amount' 
      });
    }
    
    if (amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Amount must be greater than 0' 
      });
    }
    
    // Verify both accounts exist and belong to company
    const from = await BankAccount.findOne({
      _id: fromAccount,
      company: companyId,
      isActive: true
    });
    
    const to = await BankAccount.findOne({
      _id: toAccount,
      company: companyId,
      isActive: true
    });
    
    if (!from) {
      return res.status(404).json({ success: false, message: 'Source account not found' });
    }
    
    if (!to) {
      return res.status(404).json({ success: false, message: 'Destination account not found' });
    }
    
    if (from.currentBalance < amount) {
      return res.status(400).json({ 
        success: false, 
        message: 'Insufficient funds in source account' 
      });
    }
    
    // Create withdrawal from source
    const withdrawal = await from.addTransaction({
      type: 'transfer_out',
      amount,
      description: description || `Transfer to ${to.name}`,
      referenceNumber,
      notes,
      reference: toAccount,
      referenceType: 'BankAccount',
      createdBy: req.user._id,
      status: 'completed'
    });
    
    // Create deposit to destination
    const deposit = await to.addTransaction({
      type: 'transfer_in',
      amount,
      description: description || `Transfer from ${from.name}`,
      referenceNumber,
      notes,
      reference: fromAccount,
      referenceType: 'BankAccount',
      createdBy: req.user._id,
      status: 'completed'
    });
    
    // Create journal entry for bank transfer
    try {
      await JournalService.createBankTransferEntry({
        companyId,
        fromAccountCode: from.accountCode || '1010', // Default to cash if not set
        toAccountCode: to.accountCode || '1010',
        fromAccountName: from.name,
        toAccountName: to.name,
        amount,
        description: description || `Transfer from ${from.name} to ${to.name}`,
        referenceNumber,
        date: new Date()
      });
    } catch (journalError) {
      console.error('Journal entry creation failed for bank transfer:', journalError);
    }
    
    res.status(201).json({
      success: true,
      data: {
        withdrawal,
        deposit
      },
      message: `Successfully transferred ${amount} from ${from.name} to ${to.name}`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get total cash position
// @route   GET /api/bank-accounts/summary/position
// @access  Private
exports.getCashPosition = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    const position = await BankAccount.getTotalCashPosition(companyId);
    
    res.json({
      success: true,
      data: position
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reconcile account
// @route   POST /api/bank-accounts/:id/reconcile
// @access  Private
exports.reconcile = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { statementBalance, statementDate, notes } = req.body;
    
    const account = await BankAccount.findOne({
      _id: req.params.id,
      company: companyId
    });
    
    if (!account) {
      return res.status(404).json({ success: false, message: 'Bank account not found' });
    }
    
    const difference = statementBalance - account.currentBalance;
    
    // Update reconciliation info
    account.lastReconciledAt = statementDate || new Date();
    account.lastReconciledBalance = statementBalance;
    await account.save();
    
    // If there's a difference, create an adjustment transaction
    let adjustment = null;
    if (difference !== 0) {
      adjustment = await account.addTransaction({
        type: 'adjustment',
        amount: Math.abs(difference),
        balanceAfter: statementBalance,
        description: `Reconciliation adjustment: ${difference > 0 ? 'Found' : 'Missing'} ${Math.abs(difference)}`,
        notes: notes || `Reconciled with statement balance ${statementBalance}. Difference: ${difference}`,
        createdBy: req.user._id,
        status: 'completed'
      });
    }
    
    res.json({
      success: true,
      data: {
        account,
        statementBalance,
        systemBalance: account.currentBalance,
        difference,
        adjustment
      },
      message: difference === 0 
        ? 'Account reconciled successfully - no adjustments needed'
        : `Account reconciled with ${Math.abs(difference)} adjustment`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all transactions across all accounts
// @route   GET /api/bank-accounts/transactions
// @access  Private
exports.getAllTransactions = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate, accountId, type, page = 1, limit = 50 } = req.query;
    
    const query = { company: companyId };
    
    if (accountId) {
      query.account = accountId;
    }
    
    if (type) {
      query.type = type;
    }
    
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    
    // Only get transactions from active accounts
    const activeAccounts = await BankAccount.find({ company: companyId, isActive: true }).select('_id');
    const activeAccountIds = activeAccounts.map(a => a._id);
    query.account = { $in: activeAccountIds };
    
    const transactions = await BankTransaction.find(query)
      .populate('account', 'name accountType _id')
      .populate('createdBy', 'name email')
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await BankTransaction.countDocuments(query);
    
    res.json({
      success: true,
      count: transactions.length,
      total,
      pages: Math.ceil(total / limit),
      data: transactions
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Adjust account balance
// @route   POST /api/bank-accounts/:id/adjust
// @access  Private
exports.adjustBalance = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { newBalance, reason } = req.body;
    
    if (newBalance === undefined || newBalance === null) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide newBalance' 
      });
    }
    
    const account = await BankAccount.findOne({
      _id: req.params.id,
      company: companyId,
      isActive: true
    });
    
    if (!account) {
      return res.status(404).json({ success: false, message: 'Bank account not found' });
    }
    
    const difference = newBalance - account.currentBalance;
    
    const transaction = await account.addTransaction({
      type: 'adjustment',
      amount: Math.abs(difference),
      balanceAfter: newBalance,
      description: `Balance adjustment: ${difference > 0 ? '+' : ''}${difference}`,
      notes: reason || `Manual adjustment to ${newBalance}`,
      createdBy: req.user._id,
      status: 'completed'
    });
    
    res.status(201).json({
      success: true,
      data: {
        transaction,
        previousBalance: account.currentBalance - difference,
        newBalance: account.currentBalance,
        difference
      },
      message: `Account balance adjusted by ${difference > 0 ? '+' : ''}${difference}`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get account statistics
// @route   GET /api/bank-accounts/:id/stats
// @access  Private
exports.getAccountStats = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { period = 'month' } = req.query; // day, week, month, year
    
    const account = await BankAccount.findOne({
      _id: req.params.id,
      company: companyId
    });
    
    if (!account) {
      return res.status(404).json({ success: false, message: 'Bank account not found' });
    }
    
    // Calculate date range
    const now = new Date();
    let startDate;
    let groupBy;
    
    switch (period) {
      case 'day':
        startDate = new Date(now.setDate(now.getDate() - 30));
        groupBy = { $dateToString: { format: '%Y-%m-%d', date: '$date' } };
        break;
      case 'week':
        startDate = new Date(now.setDate(now.getDate() - 90));
        groupBy = { $dateToString: { format: '%Y-%W', date: '$date' } };
        break;
      case 'month':
        startDate = new Date(now.setMonth(now.getMonth() - 12));
        groupBy = { $dateToString: { format: '%Y-%m', date: '$date' } };
        break;
      case 'year':
        startDate = new Date(now.setFullYear(now.getFullYear() - 5));
        groupBy = { $dateToString: { format: '%Y', date: '$date' } };
        break;
      default:
        startDate = new Date(now.setMonth(now.getMonth() - 12));
        groupBy = { $dateToString: { format: '%Y-%m', date: '$date' } };
    }
    
    // Get transaction totals by type
    const stats = await BankTransaction.aggregate([
      {
        $match: {
          account: account._id,
          date: { $gte: startDate }
        }
      },
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
      deposits: 0,
      withdrawals: 0,
      transfersIn: 0,
      transfersOut: 0,
      adjustments: 0,
      totalTransactions: 0
    };
    
    stats.forEach(item => {
      switch (item._id) {
        case 'deposit':
          result.deposits = item.total;
          break;
        case 'withdrawal':
          result.withdrawals = item.total;
          break;
        case 'transfer_in':
          result.transfersIn = item.total;
          break;
        case 'transfer_out':
          result.transfersOut = item.total;
          break;
        case 'adjustment':
        case 'opening':
        case 'closing':
          result.adjustments += item.total;
          break;
      }
      result.totalTransactions += item.count;
    });
    
    // Get daily/weekly/monthly trend
    const trend = await BankTransaction.aggregate([
      {
        $match: {
          account: account._id,
          date: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: groupBy,
          deposits: {
            $sum: {
              $cond: [{ $in: ['$type', ['deposit', 'transfer_in', 'opening']] }, '$amount', 0]
            }
          },
          withdrawals: {
            $sum: {
              $cond: [{ $in: ['$type', ['withdrawal', 'transfer_out', 'closing']] }, '$amount', 0]
            }
          },
          net: {
            $sum: {
              $cond: [
                { $in: ['$type', ['deposit', 'transfer_in', 'opening']] },
                '$amount',
                { $multiply: ['$amount', -1] }
              ]
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    res.json({
      success: true,
      data: {
        currentBalance: account.currentBalance,
        openingBalance: account.openingBalance,
        ...result,
        netChange: result.deposits + result.transfersIn - result.withdrawals - result.transfersOut,
        trend
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get bank statement
// @route   GET /api/bank-accounts/:id/statement
// @access  Private
exports.getBankStatement = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate, format = 'json' } = req.query;
    
    const account = await BankAccount.findOne({
      _id: req.params.id,
      company: companyId
    });
    
    if (!account) {
      return res.status(404).json({ success: false, message: 'Bank account not found' });
    }
    
    const query = { account: req.params.id };
    
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    
    const transactions = await BankTransaction.find(query)
      .populate('createdBy', 'name')
      .sort({ date: 1 });
    
    // Calculate running balance
    let runningBalance = account.openingBalance;
    const statement = transactions.map(t => {
      if (t.type === 'deposit' || t.type === 'transfer_in' || t.type === 'opening') {
        runningBalance += t.amount;
      } else {
        runningBalance -= t.amount;
      }
      return {
        ...t.toObject(),
        runningBalance
      };
    });
    
    res.json({
      success: true,
      data: {
        account: {
          name: account.name,
          accountType: account.accountType,
          accountNumber: account.accountNumber,
          bankName: account.bankName
        },
        period: {
          start: startDate,
          end: endDate
        },
        openingBalance: account.openingBalance,
        closingBalance: runningBalance,
        transactions: statement
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Import transactions from CSV
// @route   POST /api/bank-accounts/:id/import-csv
// @access  Private
exports.importCSV = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { transactions: csvTransactions, autoMatch = false, bankFormat, dateFrom, dateTo, skipReordering = false } = req.body;
    
    const account = await BankAccount.findOne({
      _id: req.params.id,
      company: companyId,
      isActive: true
    });
    
    if (!account) {
      return res.status(404).json({ success: false, message: 'Bank account not found' });
    }
    
    if (!csvTransactions || !Array.isArray(csvTransactions) || csvTransactions.length === 0) {
      return res.status(400).json({ success: false, message: 'No transactions provided' });
    }
    
    // Per spec: Check for sequential import - warn if earliest line has date earlier than latest existing statement
    const latestExistingStatement = await BankStatementLine.findOne({
      bankAccount: account._id
    }).sort({ transactionDate: -1 });
    
    let sequentialWarning = null;
    if (latestExistingStatement && !skipReordering) {
      // Find earliest date in new import
      const earliestImportDate = csvTransactions
        .map(tx => tx.date ? new Date(tx.date) : null)
        .filter(d => d && !isNaN(d.getTime()))
        .sort((a, b) => a - b)[0];
      
      if (earliestImportDate && earliestImportDate < latestExistingStatement.transactionDate) {
        sequentialWarning = `Warning: Earliest imported date (${earliestImportDate.toISOString().split('T')[0]}) is earlier than latest existing statement (${latestExistingStatement.transactionDate.toISOString().split('T')[0]}). Computed running balance may be incorrect. Set skipReordering=true to ignore.`;
      }
    }
    
    // Filter by date range if provided
    let filteredTransactions = csvTransactions;
    if (dateFrom || dateTo) {
      filteredTransactions = csvTransactions.filter(tx => {
        if (!tx.date) return true;
        const txDate = new Date(tx.date);
        if (isNaN(txDate.getTime())) return true;
        
        let include = true;
        if (dateFrom) {
          const fromDate = new Date(dateFrom);
          include = include && txDate >= fromDate;
        }
        if (dateTo) {
          const toDate = new Date(dateTo);
          toDate.setHours(23, 59, 59, 999);
          include = include && txDate <= toDate;
        }
        return include;
      });
    }
    
    // Per spec: Sort by transaction_date ASC, then by row order
    filteredTransactions = filteredTransactions
      .map((tx, index) => ({ ...tx, _importOrder: index }))
      .sort((a, b) => {
        const dateA = a.date ? new Date(a.date) : new Date(0);
        const dateB = b.date ? new Date(b.date) : new Date(0);
        if (dateA.getTime() === dateB.getTime()) {
          return a._importOrder - b._importOrder;
        }
        return dateA - dateB;
      });
    
    const importedStatementLines = [];
    
    // Per spec: Compute running balance from opening_balance if balance not in CSV
    // First, get the anchor: bank_accounts.opening_balance
    const openingBalance = parseFloat(account.openingBalance?.toString() || '0');
    
    // Get existing statement lines to compute starting balance
    const existingStatements = await BankStatementLine.find({ bankAccount: account._id })
      .sort({ transactionDate: 1, _id: 1 })
      .lean();
    
    // Compute the balance at the end of existing statements
    let runningBalance = openingBalance;
    for (const stmt of existingStatements) {
      const debit = parseFloat(stmt.debitAmount?.toString() || '0');
      const credit = parseFloat(stmt.creditAmount?.toString() || '0');
      runningBalance = runningBalance + credit - debit;
    }
    
    // Now process new statements, computing balance if not provided
    for (const tx of filteredTransactions) {
      // Parse debit/credit amounts
      const debitAmount = tx.debitAmount !== undefined 
        ? parseFloat(String(tx.debitAmount).replace(/[^0-9.-]/g, '')) || 0
        : (tx.debit ? parseFloat(String(tx.debit).replace(/[^0-9.-]/g, '')) || 0 : 0);
      
      const creditAmount = tx.creditAmount !== undefined 
        ? parseFloat(String(tx.creditAmount).replace(/[^0-9.-]/g, '')) || 0
        : (tx.credit ? parseFloat(String(tx.credit).replace(/[^0-9.-]/g, '')) || 0 : 0);
      
      // If balance is provided in CSV, use it; otherwise compute
      let balance = null;
      if (tx.balance !== undefined) {
        balance = parseFloat(String(tx.balance).replace(/[^0-9.-]/g, '')) || null;
      }
      
      // Compute running balance: running_balance = running_balance + credit - debit
      runningBalance = runningBalance + creditAmount - debitAmount;
      
      // Parse date
      let transactionDate = new Date();
      if (tx.date) {
        const parsed = new Date(tx.date);
        if (!isNaN(parsed.getTime())) {
          transactionDate = parsed;
        }
      }
      
      // Determine transaction type
      let transactionType = 'deposit';
      if (debitAmount > 0 && creditAmount === 0) {
        transactionType = 'withdrawal';
      } else if (creditAmount > 0 && debitAmount === 0) {
        transactionType = 'deposit';
      }
      
      // Create bank statement line (not BankTransaction)
      const statementLine = new BankStatementLine({
        company: companyId,
        bankAccount: account._id,
        transactionDate,
        description: tx.description || tx.narration || tx.details || 'Imported from CSV',
        debitAmount: mongoose.Types.Decimal128.fromString(String(debitAmount)),
        creditAmount: mongoose.Types.Decimal128.fromString(String(creditAmount)),
        balance: balance !== null ? mongoose.Types.Decimal128.fromString(String(balance)) : mongoose.Types.Decimal128.fromString(String(runningBalance)),
        reference: tx.reference || tx.ref || tx.transactionId || '',
        isReconciled: false,
        importedAt: new Date()
      });
      
      await statementLine.save();
      importedStatementLines.push(statementLine);
    }
    
    // Also create BankTransaction entries for backwards compatibility
    const importedTransactions = [];
    for (const line of importedStatementLines) {
      const debitAmount = parseFloat(line.debitAmount?.toString() || '0');
      const creditAmount = parseFloat(line.creditAmount?.toString() || '0');
      const amount = Math.max(debitAmount, creditAmount);
      
      const transaction = new BankTransaction({
        company: companyId,
        account: account._id,
        type: debitAmount > 0 ? 'withdrawal' : 'deposit',
        amount,
        balanceAfter: parseFloat(line.balance?.toString() || '0'),
        description: line.description,
        date: line.transactionDate,
        referenceNumber: line.reference,
        paymentMethod: 'bank_transfer',
        status: 'completed',
        createdBy: req.user._id,
        notes: `Imported from CSV: ${line.transactionDate.toISOString().split('T')[0]} | ${line.reference || ''}`
      });
      
      await transaction.save();
      importedTransactions.push(transaction);
    }
    
    // Update account cache - invalidate since journal entries may have changed
    account.cacheValid = false;
    await account.save();
    
    let matchResults = null;
    let matched = 0;
    let unmatched = importedTransactions.length;
    
    // Auto-match if enabled
    if (autoMatch && importedTransactions.length > 0) {
      matchResults = await autoMatchTransactions(companyId, account._id, importedTransactions);
      matched = matchResults.matched;
      unmatched = matchResults.unmatched;
    }
    
    res.status(201).json({
      success: true,
      data: {
        imported: importedStatementLines.length,
        matched,
        unmatched,
        computedEndingBalance: runningBalance,
        statementLines: importedStatementLines,
        transactions: importedTransactions,
        matchResults,
        sequentialWarning
      },
      message: sequentialWarning 
        ? `Imported ${importedStatementLines.length} transactions. ${sequentialWarning}`
        : `Successfully imported ${importedStatementLines.length} transactions`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Auto-match transactions with invoices, purchases, expenses
// @route   POST /api/bank-accounts/:id/auto-match
// @access  Private
exports.autoMatchTransactions = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const accountId = req.params.id;
    
    const account = await BankAccount.findOne({
      _id: accountId,
      company: companyId
    });
    
    if (!account) {
      return res.status(404).json({ success: false, message: 'Bank account not found' });
    }
    
    const results = await autoMatchTransactions(companyId, accountId);
    
    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get reconciliation report
// @route   GET /api/bank-accounts/:id/reconciliation-report
// @access  Private
exports.getReconciliationReport = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate } = req.query;
    
    const account = await BankAccount.findOne({
      _id: req.params.id,
      company: companyId
    });
    
    if (!account) {
      return res.status(404).json({ success: false, message: 'Bank account not found' });
    }
    
    // Get all transactions in date range
    const query = { account: account._id };
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    
    const transactions = await BankTransaction.find(query)
      .sort({ date: 1 });
    
    // Get all paid invoices
    const invoices = await Invoice.find({
      company: companyId,
      status: 'paid',
      paymentMethod: 'bank_transfer'
    }).populate('client', 'name');
    
    // Get all paid purchases
    const purchases = await Purchase.find({
      company: companyId,
      status: 'received',
      paymentMethod: 'bank_transfer'
    }).populate('supplier', 'name');
    
    // Get all paid expenses
    const expenses = await Expense.find({
      company: companyId,
      paid: true,
      paymentMethod: 'bank_transfer'
    });
    
    // Categorize transactions
    const matched = [];
    const unmatched = [];
    
    for (const tx of transactions) {
      const matchResult = findMatch(tx, invoices, purchases, expenses);
      
      if (matchResult) {
        matched.push({
          transaction: tx,
          matchedTo: matchResult
        });
      } else {
        unmatched.push(tx);
      }
    }
    
    // Calculate totals
    const matchedAmount = matched.reduce((sum, m) => sum + m.transaction.amount, 0);
    const unmatchedAmount = unmatched.reduce((sum, m) => sum + m.transaction.amount, 0);
    
    res.json({
      success: true,
      data: {
        account: {
          name: account.name,
          accountType: account.accountType,
          currentBalance: account.currentBalance
        },
        period: { startDate, endDate },
        summary: {
          totalTransactions: transactions.length,
          matched: matched.length,
          unmatched: unmatched.length,
          matchedAmount,
          unmatchedAmount
        },
        matched,
        unmatched
      }
    });
  } catch (error) {
    next(error);
  }
};

// Helper function to auto-match transactions
async function autoMatchTransactions(companyId, accountId, transactions = null) {
  const txList = transactions || await BankTransaction.find({
    company: companyId,
    account: accountId,
    status: 'completed'
  });
  
  // Get all pending payments from invoices, purchases, expenses
  const invoices = await Invoice.find({
    company: companyId,
    status: { $in: ['confirmed', 'partial'] },
    paymentMethod: 'bank_transfer'
  }).populate('client', 'name');
  
  const purchases = await Purchase.find({
    company: companyId,
    status: { $in: ['pending', 'partial'] },
    paymentMethod: 'bank_transfer'
  }).populate('supplier', 'name');
  
  const expenses = await Expense.find({
    company: companyId,
    paid: false,
    paymentMethod: 'bank_transfer'
  });
  
  let matched = 0;
  let unmatched = 0;
  
  for (const tx of txList) {
    const matchResult = findMatch(tx, invoices, purchases, expenses);
    
    if (matchResult) {
      // Update the transaction with match info
      tx.reference = matchResult.id;
      tx.referenceType = matchResult.type;
      tx.notes = (tx.notes || '') + ` | Matched to ${matchResult.type} #${matchResult.number}`;
      await tx.save();
      
      // Mark the invoice/purchase/expense as paid
      if (matchResult.type === 'Invoice') {
        await Invoice.findByIdAndUpdate(matchResult.id, {
          status: 'paid',
          paidDate: tx.date
        });
      } else if (matchResult.type === 'Purchase') {
        await Purchase.findByIdAndUpdate(matchResult.id, {
          status: 'received'
        });
      } else if (matchResult.type === 'Expense') {
        await Expense.findByIdAndUpdate(matchResult.id, {
          paid: true,
          paidDate: tx.date
        });
      }
      
      matched++;
    } else {
      unmatched++;
    }
  }
  
  return { matched, unmatched };
}

// Helper function to find match for a transaction
function findMatch(tx, invoices, purchases, expenses) {
  const txAmount = tx.amount;
  const txRef = (tx.referenceNumber || '').toLowerCase();
  const txDesc = (tx.description || '').toLowerCase();
  
  // Try to match with invoices (payments received)
  for (const invoice of invoices) {
    const invoiceTotal = invoice.total || 0;
    const invoiceNumber = (invoice.invoiceNumber || '').toLowerCase();
    const clientName = (invoice.client?.name || '').toLowerCase();
    
    // Check amount match (within 1% tolerance)
    const amountDiff = Math.abs(txAmount - invoiceTotal) / invoiceTotal;
    
    if (amountDiff < 0.01 || txAmount === invoiceTotal) {
      // Check reference/number match
      if (txRef.includes(invoiceNumber) || txDesc.includes(invoiceNumber) || txDesc.includes(clientName)) {
        return {
          type: 'Invoice',
          id: invoice._id,
          number: invoice.invoiceNumber,
          amount: invoiceTotal
        };
      }
    }
  }
  
  // Try to match with purchases (payments made)
  for (const purchase of purchases) {
    const purchaseTotal = purchase.total || 0;
    const purchaseNumber = (purchase.orderNumber || '').toLowerCase();
    const supplierName = (purchase.supplier?.name || '').toLowerCase();
    
    const amountDiff = Math.abs(txAmount - purchaseTotal) / purchaseTotal;
    
    if (amountDiff < 0.01 || txAmount === purchaseTotal) {
      if (txRef.includes(purchaseNumber) || txDesc.includes(purchaseNumber) || txDesc.includes(supplierName)) {
        return {
          type: 'Purchase',
          id: purchase._id,
          number: purchase.orderNumber,
          amount: purchaseTotal
        };
      }
    }
  }
  
  // Try to match with expenses
  for (const expense of expenses) {
    const expenseAmount = expense.amount || 0;
    const expenseDesc = (expense.description || '').toLowerCase();
    
    const amountDiff = Math.abs(txAmount - expenseAmount) / expenseAmount;
    
    if (amountDiff < 0.01 || txAmount === expenseAmount) {
      if (txRef.includes(expenseDesc) || txDesc.includes(expenseDesc)) {
        return {
          type: 'Expense',
          id: expense._id,
          number: expense.expenseNumber || expense.description,
          amount: expenseAmount
        };
      }
    }
  }
  
  return null;
}

// @desc    Get computed bank balance from journal entries (Section 3.3)
// @route   GET /api/bank-accounts/:id/balance
// @access  Private
exports.getComputedBalance = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { asOfDate, forceRecompute } = req.query;
    
    const account = await BankAccount.findOne({
      _id: req.params.id,
      company: companyId
    });
    
    if (!account) {
      return res.status(404).json({ success: false, message: 'Bank account not found' });
    }
    
    // Per spec 3.3: Use dirty flag caching pattern
    // If cache is valid and forceRecompute is not true, return cached balance
    if (!forceRecompute && account.cacheValid) {
      return res.json({
        success: true,
        data: {
          accountId: account._id,
          accountName: account.name,
          ledgerAccountId: account.ledgerAccountId || '1100',
          balance: parseFloat(account.cachedBalance?.toString() || '0'),
          openingBalance: parseFloat(account.openingBalance?.toString() || '0'),
          openingBalanceDate: account.openingBalanceDate,
          cached: true,
          computedAt: account.cacheLastComputed,
          cacheValid: true
        }
      });
    }
    
    // Cache invalid - must recompute from journal
    // Use the model's getBalance method which handles caching
    const result = await account.getBalance(JournalEntry, asOfDate);
    
    res.json({
      success: true,
      data: {
        accountId: account._id,
        accountName: account.name,
        ledgerAccountId: account.ledgerAccountId || '1100',
        openingBalance: result.details.openingBalance,
        openingBalanceDate: account.openingBalanceDate,
        totalDebits: result.details.totalDebits,
        totalCredits: result.details.totalCredits,
        balance: Math.round(result.balance * 100) / 100,
        asOfDate: asOfDate ? new Date(asOfDate) : new Date(),
        journalEntryCount: result.details.journalEntryCount,
        cached: result.cached,
        computedAt: result.computedAt,
        cacheValid: true  // After computation, cache is valid
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get journal entry lines for bank account (for reconciliation)
// @route   GET /api/bank-accounts/:id/transactions
// @access  Private
exports.getJournalTransactions = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate, reconciled } = req.query;
    
    const account = await BankAccount.findOne({
      _id: req.params.id,
      company: companyId
    });
    
    if (!account) {
      return res.status(404).json({ success: false, message: 'Bank account not found' });
    }
    
    const ledgerAccountId = account.ledgerAccountId || account.accountCode || '1100';
    
    // Build date query
    const dateQuery = {};
    if (startDate) dateQuery.$gte = new Date(startDate);
    if (endDate) dateQuery.$lte = new Date(endDate);
    
    // Build query for journal entries
    const query = {
      company: companyId,
      status: 'posted',
      lines: { $elemMatch: { accountCode: ledgerAccountId } }
    };
    
    if (startDate || endDate) {
      query.date = dateQuery;
    }
    
    const entries = await JournalEntry.find(query)
      .populate('createdBy', 'name')
      .sort({ date: -1 })
      .lean();
    
    // Extract and flatten lines for this account
    const transactions = [];
    for (const entry of entries) {
      for (const line of entry.lines) {
        if (line.accountCode === ledgerAccountId) {
          const amount = parseFloat(line.debit?.toString() || '0') || -parseFloat(line.credit?.toString() || '0');
          transactions.push({
            journalEntryId: entry._id,
            entryNumber: entry.entryNumber,
            date: entry.date,
            description: line.description || entry.description,
            debit: parseFloat(line.debit?.toString() || '0'),
            credit: parseFloat(line.credit?.toString() || '0'),
            amount: amount,
            reference: line.reference,
            reconciled: line.reconciled || false,
            matchedStatementLineId: line.matchedStatementLineId || null
          });
        }
      }
    }
    
    // Filter by reconciled status if specified
    let filteredTransactions = transactions;
    if (reconciled !== undefined) {
      filteredTransactions = transactions.filter(t => t.reconciled === (reconciled === 'true'));
    }
    
    // Calculate totals
    const totals = {
      totalDebits: filteredTransactions.reduce((sum, t) => sum + t.debit, 0),
      totalCredits: filteredTransactions.reduce((sum, t) => sum + t.credit, 0),
      reconciledCount: filteredTransactions.filter(t => t.reconciled).length,
      unreconciledCount: filteredTransactions.filter(t => !t.reconciled).length
    };
    
    res.json({
      success: true,
      data: filteredTransactions,
      totals,
      account: {
        name: account.name,
        ledgerAccountId
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Add bank statement line manually
// @route   POST /api/bank-accounts/:id/statement
// @access  Private
exports.addStatementLine = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { transactionDate, description, debitAmount, creditAmount, balance, reference } = req.body;
    
    const account = await BankAccount.findOne({
      _id: req.params.id,
      company: companyId,
      isActive: true
    });
    
    if (!account) {
      return res.status(404).json({ success: false, message: 'Bank account not found' });
    }
    
    if (!transactionDate || !description) {
      return res.status(400).json({ success: false, message: 'transactionDate and description are required' });
    }
    
    const statementLine = new BankStatementLine({
      company: companyId,
      bankAccount: account._id,
      transactionDate,
      description,
      debitAmount: mongoose.Types.Decimal128.fromString(String(debitAmount || 0)),
      creditAmount: mongoose.Types.Decimal128.fromString(String(creditAmount || 0)),
      balance: mongoose.Types.Decimal128.fromString(String(balance || 0)),
      reference,
      isReconciled: false,
      importedAt: new Date()
    });
    
    await statementLine.save();
    
    res.status(201).json({
      success: true,
      data: statementLine
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get bank statement lines
// @route   GET /api/bank-accounts/:id/statement
// @access  Private
exports.getStatementLines = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate, reconciled } = req.query;
    
    const account = await BankAccount.findOne({
      _id: req.params.id,
      company: companyId
    });
    
    if (!account) {
      return res.status(404).json({ success: false, message: 'Bank account not found' });
    }
    
    const query = { bankAccount: account._id };
    
    if (startDate || endDate) {
      query.transactionDate = {};
      if (startDate) query.transactionDate.$gte = new Date(startDate);
      if (endDate) query.transactionDate.$lte = new Date(endDate);
    }
    
    if (reconciled !== undefined) {
      query.isReconciled = reconciled === 'true';
    }
    
    const lines = await BankStatementLine.find(query)
      .sort({ transactionDate: -1 })
      .lean();
    
    // Calculate totals
    const totals = {
      totalDebits: lines.reduce((sum, l) => sum + parseFloat(l.debitAmount?.toString() || '0'), 0),
      totalCredits: lines.reduce((sum, l) => sum + parseFloat(l.creditAmount?.toString() || '0'), 0),
      reconciledCount: lines.filter(l => l.isReconciled).length,
      unreconciledCount: lines.filter(l => !l.isReconciled).length
    };
    
    res.json({
      success: true,
      data: lines,
      totals
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get reconciliation - unmatched items on both sides (Section 3.4)
// @route   GET /api/bank-accounts/:id/reconciliation
// @access  Private
exports.getReconciliation = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { startDate, endDate } = req.query;
    
    const account = await BankAccount.findOne({
      _id: req.params.id,
      company: companyId
    });
    
    if (!account) {
      return res.status(404).json({ success: false, message: 'Bank account not found' });
    }
    
    const ledgerAccountId = account.ledgerAccountId || account.accountCode || '1100';
    
    // Date filter
    const dateQuery = {};
    if (startDate) dateQuery.$gte = new Date(startDate);
    if (endDate) dateQuery.$lte = new Date(endDate);
    
    // Get ALL journal entries in period (for computing book balance)
    const allJournalEntries = await JournalEntry.find({
      company: companyId,
      status: 'posted',
      date: dateQuery,
      lines: { $elemMatch: { accountCode: ledgerAccountId } }
    }).lean();
    
    // Get all matches for this bank account (to determine reconciled status)
    const allMatches = await BankReconciliationMatch.find({
      company: companyId,
      bankAccount: account._id
    }).lean();
    
    // Create set of reconciled line IDs
    const reconciledLineIds = new Set(allMatches.map(m => m.journalEntryLineId.toString()));
    
    // Calculate book balance from all journal entries
    let bookDebits = 0;
    let bookCredits = 0;
    const journalLines = [];
    
    for (const entry of allJournalEntries) {
      for (const line of entry.lines) {
        if (line.accountCode === ledgerAccountId) {
          const lineIdStr = line._id ? line._id.toString() : null;
          const isReconciled = lineIdStr ? reconciledLineIds.has(lineIdStr) : line.reconciled;
          
          const debit = parseFloat(line.debit?.toString() || '0');
          const credit = parseFloat(line.credit?.toString() || '0');
          bookDebits += debit;
          bookCredits += credit;
          
          // Only include unreconciled in the list
          if (!isReconciled) {
            const amount = debit || -credit;
            journalLines.push({
              type: 'journal',
              id: entry._id,
              lineId: line._id,
              date: entry.date,
              description: line.description || entry.description,
              amount: Math.abs(amount),
              isDebit: amount > 0,
              reconciled: false
            });
          }
        }
      }
    }
    
    // Book balance = opening_balance + DR - CR
    const openingBalance = parseFloat(account.openingBalance?.toString() || '0');
    const bookBalance = openingBalance + bookDebits - bookCredits;
    
    // Get ALL bank statement lines in period (for computing bank balance)
    const statementQuery = { bankAccount: account._id };
    if (startDate || endDate) {
      statementQuery.transactionDate = {};
      if (startDate) statementQuery.transactionDate.$gte = new Date(startDate);
      if (endDate) statementQuery.transactionDate.$lte = new Date(endDate);
    }
    
    const allStatementLines = await BankStatementLine.find(statementQuery).lean();
    
    // Get statement line IDs that have matches
    const matchedStatementIds = new Set(allMatches.map(m => m.bankStatementLine.toString()));
    
    // Calculate bank balance from statement lines (per spec 3.3: bank's reported balance)
    let bankBalance = 0;
    const bankLines = [];
    
    for (const line of allStatementLines) {
      const lineIdStr = line._id.toString();
      const matchesForLine = allMatches.filter(m => m.bankStatementLine.toString() === lineIdStr);
      const hasMatches = matchesForLine.length > 0;
      
      // Per spec: isReconciled = TRUE only when SUM(matched amounts) = statement line amount
      const statementAmount = Math.abs(parseFloat(line.creditAmount?.toString() || line.debitAmount?.toString() || '0'));
      
      // Calculate total matched amount for this line
      let totalMatchedAmount = 0;
      for (const m of matchesForLine) {
        const je = allJournalEntries.find(e => e._id.toString() === m.journalEntry?.toString());
        if (je) {
          const jLine = je.lines.find(l => l._id && l._id.toString() === m.journalEntryLineId.toString());
          if (jLine) {
            const debit = parseFloat(jLine.debit?.toString() || '0');
            const credit = parseFloat(jLine.credit?.toString() || '0');
            totalMatchedAmount += Math.abs(debit || credit);
          }
        }
      }
      
      // Per spec: reconciled only when exact amount match
      const isReconciled = hasMatches && Math.abs(totalMatchedAmount - statementAmount) < 0.01;
      
      const debit = parseFloat(line.debitAmount?.toString() || '0');
      const credit = parseFloat(line.creditAmount?.toString() || '0');
      const amount = credit - debit;  // Credit increases bank balance
      
      bankLines.push({
        type: 'bank',
        id: line._id,
        date: line.transactionDate,
        description: line.description,
        amount: Math.abs(amount),
        isDebit: amount < 0,  // Debit decreases bank balance
        reconciled: isReconciled,
        balance: line.balance,  // Bank's reported running balance
        matchCount: matchesForLine.length,
        matchedAmount: totalMatchedAmount,
        difference: statementAmount - totalMatchedAmount
      });
    }
    
    // Get the ending balance from the last statement line
    let lastStatementBalance = 0;
    if (allStatementLines.length > 0) {
      const lastLine = allStatementLines[allStatementLines.length - 1];
      bankBalance = parseFloat(lastLine.balance?.toString() || '0');
      lastStatementBalance = bankBalance;
    }
    
    // Per spec: Compute adjusted balances using unreconciled items
    // Unreconciled journal items: DR = deposits in transit, CR = outstanding payments
    const unreconciledJournalDR = journalLines
      .filter(l => l.isDebit === true)
      .reduce((sum, l) => sum + l.amount, 0);
    
    const unreconciledJournalCR = journalLines
      .filter(l => l.isDebit === false)
      .reduce((sum, l) => sum + l.amount, 0);
    
    // Unreconciled statement lines: credits = bank credits not in books, debits = bank charges not in books
    const unreconciledStatementCredits = bankLines
      .filter(l => !l.reconciled && l.amount > 0)
      .reduce((sum, l) => sum + l.amount, 0);
    
    const unreconciledStatementDebits = bankLines
      .filter(l => !l.reconciled && l.isDebit)
      .reduce((sum, l) => sum + l.amount, 0);
    
    // Adjusted bank balance = lastStatementBalance + deposits in transit - outstanding payments
    const adjustedBankBalance = lastStatementBalance + unreconciledJournalDR - unreconciledJournalCR;
    
    // Adjusted book balance = bookBalance + bank credits not in books - bank charges not in books
    const adjustedBookBalance = bookBalance + unreconciledStatementCredits - unreconciledStatementDebits;
    
    // Per spec: difference = adjustedBankBalance - adjustedBookBalance (target: 0.00)
    const difference = adjustedBankBalance - adjustedBookBalance;
    
    res.json({
      success: true,
      data: {
        journalLines,  // Unreconciled book items
        bankLines,    // All bank items (reconciled and unreconciled)
        summary: {
          // Raw balances
          bookBalance,    // System's computed balance (opening + ΣDR - ΣCR)
          bankBalance,   // Bank's reported balance (last statement line balance)
          // Adjusted balances (per spec bank reconciliation format)
          lastStatementBalance,
          adjustedBankBalance,
          adjustedBookBalance,
          // Components
          depositsInTransit: unreconciledJournalDR,
          outstandingPayments: unreconciledJournalCR,
          bankCreditsNotInBooks: unreconciledStatementCredits,
          bankChargesNotInBooks: unreconciledStatementDebits,
          // The key health check number
          difference,    // Per spec: must reach zero on fully reconciled period
          // Counts
          journalCount: journalLines.length,
          bankCount: bankLines.length,
          reconciledBankCount: bankLines.filter(l => l.reconciled).length,
          unreconciledBankCount: bankLines.filter(l => !l.reconciled).length
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Match a journal line to a bank statement line (Section 3.4 - Many-to-One)
// @route   POST /api/bank-accounts/:id/reconciliation/match
// @access  Private
exports.matchReconciliation = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { journalEntryId, journalLineId, statementLineId } = req.body;
    
    if (!journalEntryId || !statementLineId) {
      return res.status(400).json({ success: false, message: 'journalEntryId and statementLineId are required' });
    }
    
    const account = await BankAccount.findOne({
      _id: req.params.id,
      company: companyId
    });
    
    if (!account) {
      return res.status(404).json({ success: false, message: 'Bank account not found' });
    }
    
    // Verify journal entry belongs to this bank account
    const ledgerAccountId = account.ledgerAccountId || account.accountCode || '1100';
    const journalEntry = await JournalEntry.findOne({
      _id: journalEntryId,
      company: companyId,
      status: 'posted'
    });
    
    if (!journalEntry) {
      return res.status(404).json({ success: false, message: 'Journal entry not found' });
    }
    
    // Find the specific line (by ID if provided, or by account code)
    let targetLine = null;
    let targetLineIndex = -1;
    let targetLineId = null;
    
    if (journalLineId) {
      // Find by line ID
      for (let i = 0; i < journalEntry.lines.length; i++) {
        const lineId = journalEntry.lines[i]._id;
        if (lineId && lineId.toString() === journalLineId) {
          targetLine = journalEntry.lines[i];
          targetLineIndex = i;
          targetLineId = lineId;
          break;
        }
      }
    } else {
      // Fallback: find first line for this bank account
      for (let i = 0; i < journalEntry.lines.length; i++) {
        if (journalEntry.lines[i].accountCode === ledgerAccountId) {
          targetLine = journalEntry.lines[i];
          targetLineIndex = i;
          targetLineId = journalEntry.lines[i]._id;
          break;
        }
      }
    }
    
    if (!targetLine || targetLineIndex === -1 || !targetLineId) {
      return res.status(400).json({ success: false, message: 'Journal entry line not found for this bank account' });
    }
    
    // Verify statement line exists
    const statementLine = await BankStatementLine.findOne({
      _id: statementLineId,
      bankAccount: account._id
    });
    
    if (!statementLine) {
      return res.status(404).json({ success: false, message: 'Bank statement line not found' });
    }
    
    // Check if match already exists (prevent duplicates)
    const existingMatch = await BankReconciliationMatch.findOne({
      bankStatementLine: statementLineId,
      journalEntryLineId: targetLineId
    });
    
    if (existingMatch) {
      return res.status(400).json({ success: false, message: 'This match already exists' });
    }
    
    // Get the amount from the statement line
    const statementAmount = Math.abs(parseFloat(statementLine.creditAmount?.toString() || statementLine.debitAmount?.toString() || '0'));
    const isDebit = !!statementLine.debitAmount;
    
    // Calculate total matched amount for this statement line
    const existingMatches = await BankReconciliationMatch.find({
      bankStatementLine: statementLineId
    }).lean();
    
    let totalMatchedAmount = 0;
    for (const m of existingMatches) {
      // We need to get the journal line amount
      const je = await JournalEntry.findById(m.journalEntry).lean();
      if (je) {
        const line = je.lines.find(l => l._id && l._id.toString() === m.journalEntryLineId.toString());
        if (line) {
          const debit = parseFloat(line.debit?.toString() || '0');
          const credit = parseFloat(line.credit?.toString() || '0');
          totalMatchedAmount += Math.abs(debit || credit);
        }
      }
    }
    
    // Add the new match amount
    const newMatchAmount = Math.abs(parseFloat(targetLine.debit?.toString() || targetLine.credit?.toString() || '0'));
    totalMatchedAmount += newMatchAmount;
    
    // Create match in junction table
    const match = new BankReconciliationMatch({
      bankStatementLine: statementLineId,
      journalEntryLineId: targetLineId,
      journalEntry: journalEntryId,
      bankAccount: account._id,
      company: companyId,
      matchedBy: req.user._id,
      matchedAmount: mongoose.Types.Decimal128.fromString(newMatchAmount.toString())
    });
    
    await match.save();
    
    // Update journal entry line: set reconciled = TRUE (per spec: appears in at least one match)
    journalEntry.lines[targetLineIndex].reconciled = true;
    journalEntry.lines[targetLineIndex].matchedStatementLineId = statementLineId;
    await journalEntry.save();
    
    // Per spec: isReconciled = TRUE only when SUM(matched amounts) = statement line amount (exact match)
    const isFullyReconciled = Math.abs(totalMatchedAmount - statementAmount) < 0.01; // Allow tiny floating point difference
    statementLine.isReconciled = isFullyReconciled;
    statementLine.matchedAmount = totalMatchedAmount > 0 
      ? mongoose.Types.Decimal128.fromString(totalMatchedAmount.toString()) 
      : null;
    await statementLine.save();
    
    res.json({
      success: true,
      message: isFullyReconciled 
        ? 'Successfully matched and fully reconciled bank statement line'
        : 'Match created. Statement line partially reconciled (amounts do not match exactly)',
      data: {
        matchId: match._id,
        journalEntryId: journalEntry._id,
        journalLineId: targetLineId,
        statementLineId: statementLine._id,
        isReconciled: statementLine.isReconciled,
        matchedAmount: totalMatchedAmount,
        statementAmount: statementAmount,
        difference: statementAmount - totalMatchedAmount
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Unmatch a reconciliation (remove a match)
// @route   DELETE /api/bank-accounts/:id/reconciliation/match
// @access  Private
exports.unmatchReconciliation = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { matchId } = req.params;
    
    if (!matchId) {
      return res.status(400).json({ success: false, message: 'matchId is required' });
    }
    
    // Find the match
    const match = await BankReconciliationMatch.findOne({
      _id: matchId,
      company: companyId
    });
    
    if (!match) {
      return res.status(404).json({ success: false, message: 'Match not found' });
    }
    
    // Get the statement line and journal entry for updating
    const statementLine = await BankStatementLine.findById(match.bankStatementLine);
    const journalEntry = await JournalEntry.findById(match.journalEntry);
    
    if (!statementLine || !journalEntry) {
      return res.status(404).json({ success: false, message: 'Related records not found' });
    }
    
    // Delete the match
    await BankReconciliationMatch.findByIdAndDelete(matchId);
    
    // Update journal entry line: check if other matches exist for this line
    const otherMatchesForLine = await BankReconciliationMatch.findOne({
      journalEntryLineId: match.journalEntryLineId
    });
    
    if (!otherMatchesForLine) {
      // No other matches - mark as unreconciled (per spec: reconciled when appears in at least one match)
      const lineIndex = journalEntry.lines.findIndex(
        l => l._id && l._id.toString() === match.journalEntryLineId.toString()
      );
      if (lineIndex !== -1) {
        journalEntry.lines[lineIndex].reconciled = false;
        journalEntry.lines[lineIndex].matchedStatementLineId = null;
        await journalEntry.save();
      }
    }
    
    // Update statement line: Per spec, isReconciled = TRUE only when SUM(matched amounts) = statement line amount
    const remainingMatches = await BankReconciliationMatch.find({
      bankStatementLine: statementLine._id
    }).lean();
    
    const statementAmount = Math.abs(parseFloat(statementLine.creditAmount?.toString() || statementLine.debitAmount?.toString() || '0'));
    
    let totalMatchedAmount = 0;
    for (const m of remainingMatches) {
      const je = await JournalEntry.findById(m.journalEntry).lean();
      if (je) {
        const line = je.lines.find(l => l._id && l._id.toString() === m.journalEntryLineId.toString());
        if (line) {
          const debit = parseFloat(line.debit?.toString() || '0');
          const credit = parseFloat(line.credit?.toString() || '0');
          totalMatchedAmount += Math.abs(debit || credit);
        }
      }
    }
    
    // Per spec: isReconciled = TRUE only when exact match
    const isFullyReconciled = Math.abs(totalMatchedAmount - statementAmount) < 0.01;
    statementLine.isReconciled = isFullyReconciled;
    statementLine.matchedAmount = totalMatchedAmount > 0 
      ? mongoose.Types.Decimal128.fromString(totalMatchedAmount.toString()) 
      : null;
    await statementLine.save();
    
    res.json({
      success: true,
      message: 'Match removed successfully',
      data: {
        remainingMatchesForStatementLine: remainingMatches
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create opening balance journal entry (Section 3.5)
// @route   POST /api/bank-accounts/:id/opening-balance
// @access  Private
exports.createOpeningBalance = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { openingBalance, openingBalanceDate } = req.body;
    
    const account = await BankAccount.findOne({
      _id: req.params.id,
      company: companyId
    });
    
    if (!account) {
      return res.status(404).json({ success: false, message: 'Bank account not found' });
    }
    
    // Check if opening balance already posted
    const existingOpeningEntry = await JournalEntry.findOne({
      company: companyId,
      sourceType: 'opening_balance',
      sourceId: account._id
    });
    
    if (existingOpeningEntry) {
      return res.status(400).json({ success: false, message: 'Opening balance entry already exists for this account' });
    }
    
    const openingBalNum = parseFloat(openingBalance);
    if (isNaN(openingBalNum) || openingBalNum === 0) {
      return res.status(400).json({ success: false, message: 'Valid opening balance is required' });
    }
    
    const ledgerAccountId = account.ledgerAccountId || account.accountCode || '1100';
    const entryDate = openingBalanceDate ? new Date(openingBalanceDate) : new Date();
    
    // Create opening balance journal entry (per spec 3.5):
    // DR bank_account.ledger_account_id  opening_balance
    // CR 3200 Retained Earnings          opening_balance
    const narration = `Opening Balance - ${account.name}`;
    
    const journalEntry = await JournalService.createEntry(companyId, req.user._id, {
      date: entryDate,
      description: narration,
      sourceType: 'opening_balance',
      sourceId: account._id,
      sourceReference: `OB-${account.name}`,
      lines: [
        JournalService.createDebitLine(
          ledgerAccountId,
          openingBalNum,
          narration
        ),
        JournalService.createCreditLine(
          RETAINED_EARNINGS_CODE,
          openingBalNum,
          narration
        )
      ],
      isAutoGenerated: false
    });
    
    // Update account with opening balance and initialize cache
    // Per spec 3.3: Store opening balance, cache it as valid
    account.openingBalance = mongoose.Types.Decimal128.fromString(String(openingBalNum));
    account.openingBalanceDate = entryDate;
    account.cachedBalance = mongoose.Types.Decimal128.fromString(String(openingBalNum));
    account.cacheValid = true;  // Opening balance is the anchor - cache is valid
    account.cacheLastComputed = new Date();
    await account.save();
    
    res.status(201).json({
      success: true,
      data: {
        journalEntry,
        openingBalance: openingBalNum,
        openingBalanceDate: entryDate,
        cachedBalance: openingBalNum,
        cacheValid: true
      }
    });
  } catch (error) {
    next(error);
  }
};
