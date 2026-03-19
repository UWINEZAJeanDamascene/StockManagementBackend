jest.mock('../models/BankAccount', () => ({
  BankTransaction: {
    aggregate: jest.fn().mockResolvedValue([
      { _id: 'deposit', total: 1000 },
      { _id: 'withdrawal', total: 200 }
    ])
  },
  BankAccount: jest.fn()
}));

jest.mock('../models/Invoice', () => ({
  aggregate: jest.fn().mockResolvedValue([{ _id: null, total: 800 }])
}));

jest.mock('../models/Purchase', () => ({
  aggregate: jest.fn().mockResolvedValue([{ _id: null, total: 300 }])
}));

jest.mock('../models/Expense', () => ({
  aggregate: jest.fn().mockResolvedValue([{ _id: null, total: 150 }])
}));

jest.mock('../models/FixedAsset', () => ({
  aggregate: jest.fn().mockResolvedValue([{ _id: null, total: 500 }])
}));

jest.mock('../models/Loan', () => ({
  aggregate: jest.fn().mockResolvedValue([{ _id: 'bank', totalReceived: 10000, totalBalance: 9000 }])
}));

jest.mock('../models/AccountBalance', () => ({
  find: jest.fn().mockResolvedValue([
    { accountCode: '1010', debit: 5000, credit: 1000 },
    { accountCode: '1020', debit: 2000, credit: 500 }
  ])
}));

jest.mock('../constants/chartOfAccounts', () => ({
  DEFAULT_ACCOUNTS: {
    cashAtBank: '1010',
    cashInHand: '1020',
    mtnMoMo: '1030'
  }
}));

async function getCashFlowImpl(companyId, startDate, endDate) {
  const start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), 0, 1);
  const end = endDate ? new Date(endDate) : new Date();

  const BankAccountModel = require('../models/BankAccount');
  const bankAgg = await BankAccountModel.BankTransaction.aggregate([
    { $match: { company: companyId, date: { $gte: start, $lte: end }, status: 'completed' } },
    { $group: { _id: '$type', total: { $sum: '$amount' } } }
  ]);
  const bankSummary = bankAgg.reduce((acc, row) => { acc[row._id] = row.total; return acc; }, {});

  const [invoicePayments, purchasePayments, expensePayments] = await Promise.all([
    require('../models/Invoice').aggregate([
      { $match: { company: companyId } },
      { $unwind: '$payments' },
      { $match: { 'payments.paidDate': { $gte: start, $lte: end } } },
      { $group: { _id: null, total: { $sum: '$payments.amount' } } }
    ]),
    require('../models/Purchase').aggregate([
      { $match: { company: companyId } },
      { $unwind: '$payments' },
      { $match: { 'payments.paidDate': { $gte: start, $lte: end } } },
      { $group: { _id: null, total: { $sum: '$payments.amount' } } }
    ]),
    require('../models/Expense').aggregate([
      { $match: { company: companyId } },
      { $unwind: '$payments' },
      { $match: { 'payments.paidDate': { $gte: start, $lte: end } } },
      { $group: { _id: null, total: { $sum: '$payments.amount' } } }
    ])
  ]);

  const operating = {
    bankSummary,
    invoicePayments: invoicePayments[0]?.total || 0,
    purchasePayments: purchasePayments[0]?.total || 0,
    expensePayments: expensePayments[0]?.total || 0
  };

  const fixedAssetPurchases = await require('../models/FixedAsset').aggregate([
    { $match: { company: companyId, purchaseDate: { $gte: start, $lte: end } } },
    { $group: { _id: null, total: { $sum: '$purchaseCost' } } }
  ]);
  const investing = { purchases: fixedAssetPurchases[0]?.total || 0 };

  const loansAgg = await require('../models/Loan').aggregate([
    { $match: { company: companyId } },
    { $group: { _id: '$loanType', totalReceived: { $sum: '$principalAmount' }, totalBalance: { $sum: { $subtract: ['$originalAmount', '$amountPaid'] } } } }
  ]);
  const financing = { loans: loansAgg };

  const balances = await require('../models/AccountBalance').find({ company: companyId, accountCode: { $in: [require('../constants/chartOfAccounts').DEFAULT_ACCOUNTS.cashAtBank, require('../constants/chartOfAccounts').DEFAULT_ACCOUNTS.cashInHand, require('../constants/chartOfAccounts').DEFAULT_ACCOUNTS.mtnMoMo] } });
  const cashPosition = balances.reduce((s, b) => s + ((b.debit || 0) - (b.credit || 0)), 0);

  return { operating, investing, financing, cashPosition };
}

describe('getCashFlowStatement', () => {
  it('returns operating, investing, financing and cashPosition', async () => {
    const data = await getCashFlowImpl('comp1');
    expect(data).toHaveProperty('operating');
    expect(data).toHaveProperty('investing');
    expect(data).toHaveProperty('financing');
    expect(data).toHaveProperty('cashPosition');

    expect(data.cashPosition).toBe((5000 - 1000) + (2000 - 500));
    expect(Object.keys(data.operating.bankSummary).length).toBeGreaterThan(0);
  });
});

