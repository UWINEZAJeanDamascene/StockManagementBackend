// Mock dependencies before import
jest.mock('../models/AccountingPeriod', () => ({
  findOne: jest.fn(),
  find: jest.fn(() => ({
    sort: jest.fn(() => ({
      limit: jest.fn(() => [])
    }))
  })),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  create: jest.fn(),
  countDocuments: jest.fn(),
  updateMany: jest.fn()
}));

jest.mock('../models/Company', () => ({
  findById: jest.fn()
}));

jest.mock('../models/JournalEntry', () => ({
  create: jest.fn()
}));

jest.mock('../services/AuditLogService', () => ({
  log: jest.fn().mockResolvedValue(true)
}));

jest.mock('../services/journalService', () => ({
  createEntry: jest.fn().mockResolvedValue({ _id: 'journal-entry-id' })
}));

jest.mock('../services/plStatementService', () => ({
  _buildPeriodData: jest.fn().mockResolvedValue({
    net_profit: 10000,
    revenue: { lines: [{ account_id: 'rev1', account_name: 'Revenue', amount: 50000 }] },
    cogs: { lines: [{ account_id: 'cogs1', account_name: 'COGS', amount: 20000 }] },
    expenses: { lines: [{ account_id: 'exp1', account_name: 'Expense', amount: 20000 }] }
  })
}));

jest.mock('../models/ChartOfAccount', () => ({
  findOne: jest.fn().mockResolvedValue({ _id: 'retained-earnings-id', sub_type: 'retained' })
}));

const PeriodService = require('../services/periodService');
const AccountingPeriod = require('../models/AccountingPeriod');
const Company = require('../models/Company');
const JournalEntry = require('../models/JournalEntry');

describe('PeriodService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getOpenPeriodId()', () => {
    it('returns period id when open period covers the date', async () => {
      const mockPeriod = { _id: 'period-id', status: 'open' };
      AccountingPeriod.findOne.mockResolvedValue(mockPeriod);

      const result = await PeriodService.getOpenPeriodId('company-id', '2025-07-15');

      expect(result).toBe('period-id');
      expect(AccountingPeriod.findOne).toHaveBeenCalledWith({
        company_id: 'company-id',
        status: 'open',
        start_date: { $lte: expect.any(Date) },
        end_date: { $gte: expect.any(Date) }
      });
    });

    it('throws PERIOD_CLOSED when no open period covers the date', async () => {
      AccountingPeriod.findOne.mockResolvedValue(null);

      await expect(
        PeriodService.getOpenPeriodId('company-id', '2025-07-15')
      ).rejects.toThrow('PERIOD_CLOSED');
    });

    it('throws PERIOD_CLOSED when period exists but is closed', async () => {
      AccountingPeriod.findOne.mockResolvedValue(null);

      await expect(
        PeriodService.getOpenPeriodId('company-id', '2025-07-15')
      ).rejects.toThrow('PERIOD_CLOSED');
    });

    it('scoped to company — company B open period does not satisfy company A', async () => {
      AccountingPeriod.findOne.mockResolvedValue(null);

      await expect(
        PeriodService.getOpenPeriodId('company-a', '2025-07-15')
      ).rejects.toThrow('PERIOD_CLOSED');

      expect(AccountingPeriod.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ company_id: 'company-a' })
      );
    });
  });

  describe('generateFiscalYear()', () => {
    it('generates exactly 12 monthly periods', async () => {
      const mockCompany = { 
        _id: 'company-id', 
        fiscal_year_start_month: 7 
      };
      Company.findById.mockResolvedValue(mockCompany);
      AccountingPeriod.findOne.mockResolvedValue(null);
      AccountingPeriod.create.mockResolvedValue({});

      await PeriodService.generateFiscalYear('company-id', 2025, 'user-id');

      expect(AccountingPeriod.create).toHaveBeenCalledTimes(12);
    });

    it('periods cover full fiscal year with no gaps', async () => {
      const mockCompany = { 
        _id: 'company-id', 
        fiscal_year_start_month: 7 
      };
      Company.findById.mockResolvedValue(mockCompany);
      AccountingPeriod.findOne.mockResolvedValue(null);
      AccountingPeriod.create.mockImplementation(doc => Promise.resolve(doc));

      const periods = await PeriodService.generateFiscalYear('company-id', 2025, 'user-id');

      // Check that periods are consecutive (next period starts the day after current ends)
      for (let i = 0; i < periods.length - 1; i++) {
        const endDate = new Date(periods[i].end_date);
        const nextStartDate = new Date(periods[i + 1].start_date);
        
        // Normalize to midnight for comparison
        endDate.setHours(0, 0, 0, 0);
        nextStartDate.setHours(0, 0, 0, 0);
        
        // Add 1 day to end date and compare
        endDate.setDate(endDate.getDate() + 1);
        expect(nextStartDate.getTime()).toBe(endDate.getTime());
      }
    });

    it('last period has is_year_end = true', async () => {
      const mockCompany = { 
        _id: 'company-id', 
        fiscal_year_start_month: 7 
      };
      Company.findById.mockResolvedValue(mockCompany);
      AccountingPeriod.findOne.mockResolvedValue(null);
      
      const createdPeriods = [];
      AccountingPeriod.create.mockImplementation(doc => {
        createdPeriods.push(doc);
        return Promise.resolve({ ...doc, _id: `period-${createdPeriods.length}` });
      });

      await PeriodService.generateFiscalYear('company-id', 2025, 'user-id');

      const lastPeriod = createdPeriods[createdPeriods.length - 1];
      expect(lastPeriod.is_year_end).toBe(true);
    });

    it('respects fiscal_year_start_month from company profile', async () => {
      const mockCompany = { 
        _id: 'company-id', 
        fiscal_year_start_month: 1 // January
      };
      Company.findById.mockResolvedValue(mockCompany);
      AccountingPeriod.findOne.mockResolvedValue(null);
      AccountingPeriod.create.mockResolvedValue({});

      await PeriodService.generateFiscalYear('company-id', 2025, 'user-id');

      const firstCall = AccountingPeriod.create.mock.calls[0][0];
      expect(firstCall.name).toContain('2025');
    });

    it('is idempotent — running twice does not create duplicates', async () => {
      const mockCompany = { 
        _id: 'company-id', 
        fiscal_year_start_month: 7 
      };
      Company.findById.mockResolvedValue(mockCompany);
      
      // First period exists, rest don't
      AccountingPeriod.findOne
        .mockResolvedValueOnce({}) // First period exists
        .mockResolvedValue(null); // Others don't exist

      await PeriodService.generateFiscalYear('company-id', 2025, 'user-id');

      // Only 11 periods created (first one already exists)
      expect(AccountingPeriod.create).toHaveBeenCalledTimes(11);
    });

    it('all periods created with status open', async () => {
      const mockCompany = { 
        _id: 'company-id', 
        fiscal_year_start_month: 7 
      };
      Company.findById.mockResolvedValue(mockCompany);
      AccountingPeriod.findOne.mockResolvedValue(null);
      
      const createdPeriods = [];
      AccountingPeriod.create.mockImplementation(doc => {
        createdPeriods.push(doc);
        return Promise.resolve({ ...doc, _id: `period-${createdPeriods.length}` });
      });

      await PeriodService.generateFiscalYear('company-id', 2025, 'user-id');

      createdPeriods.forEach(period => {
        expect(period.status).toBe('open');
      });
    });
  });

  describe('closePeriod()', () => {
    it('sets status to closed', async () => {
      const mockPeriod = {
        _id: 'period-id',
        company_id: 'company-id',
        status: 'open',
        start_date: new Date('2025-07-01'),
        end_date: new Date('2025-07-31')
      };
      AccountingPeriod.findOne.mockResolvedValue(mockPeriod);
      AccountingPeriod.findByIdAndUpdate.mockResolvedValue({ ...mockPeriod, status: 'closed' });

      const result = await PeriodService.closePeriod('company-id', 'period-id', 'user-id');

      expect(result.success).toBe(true);
      expect(AccountingPeriod.findByIdAndUpdate).toHaveBeenCalledWith(
        'period-id',
        expect.objectContaining({ $set: expect.objectContaining({ status: 'closed' }) })
      );
    });

    it('records closed_by and closed_at', async () => {
      const mockPeriod = {
        _id: 'period-id',
        company_id: 'company-id',
        status: 'open',
        start_date: new Date('2025-07-01'),
        end_date: new Date('2025-07-31')
      };
      AccountingPeriod.findOne.mockResolvedValue(mockPeriod);
      AccountingPeriod.findByIdAndUpdate.mockResolvedValue({});

      await PeriodService.closePeriod('company-id', 'period-id', 'user-id');

      expect(AccountingPeriod.findByIdAndUpdate).toHaveBeenCalledWith(
        'period-id',
        expect.objectContaining({
          $set: expect.objectContaining({
            closed_by: 'user-id',
            closed_at: expect.any(Date)
          })
        })
      );
    });

    it('throws PERIOD_LOCKED when period is locked', async () => {
      const mockPeriod = {
        _id: 'period-id',
        company_id: 'company-id',
        status: 'locked',
        start_date: new Date(),
        end_date: new Date()
      };
      AccountingPeriod.findOne.mockResolvedValue(mockPeriod);

      await expect(
        PeriodService.closePeriod('company-id', 'period-id', 'user-id')
      ).rejects.toThrow('PERIOD_LOCKED');
    });

    it('throws PERIOD_ALREADY_CLOSED when already closed', async () => {
      const mockPeriod = {
        _id: 'period-id',
        company_id: 'company-id',
        status: 'closed',
        start_date: new Date(),
        end_date: new Date()
      };
      AccountingPeriod.findOne.mockResolvedValue(mockPeriod);

      await expect(
        PeriodService.closePeriod('company-id', 'period-id', 'user-id')
      ).rejects.toThrow('PERIOD_ALREADY_CLOSED');
    });

    it('logs to audit trail', async () => {
      const AuditLogService = require('../services/AuditLogService');
      
      const mockPeriod = {
        _id: 'period-id',
        company_id: 'company-id',
        status: 'open',
        start_date: new Date(),
        end_date: new Date()
      };
      AccountingPeriod.findOne.mockResolvedValue(mockPeriod);
      AccountingPeriod.findByIdAndUpdate.mockResolvedValue({});

      await PeriodService.closePeriod('company-id', 'period-id', 'user-id');

      expect(AuditLogService.log).toHaveBeenCalledWith({
        companyId: 'company-id',
        userId: 'user-id',
        action: 'period.close',
        entity_type: 'accounting_period',
        entity_id: 'period-id',
        changes: { status: 'closed' }
      });
    });
  });

  describe('reopenPeriod()', () => {
    it('sets status back to open', async () => {
      const mockPeriod = {
        _id: 'period-id',
        company_id: 'company-id',
        status: 'closed',
        start_date: new Date(),
        end_date: new Date()
      };
      AccountingPeriod.findOne.mockResolvedValue(mockPeriod);
      AccountingPeriod.findByIdAndUpdate.mockResolvedValue({ ...mockPeriod, status: 'open' });

      const result = await PeriodService.reopenPeriod('company-id', 'period-id', 'user-id');

      expect(result.success).toBe(true);
    });

    it('throws PERIOD_LOCKED when period is locked', async () => {
      const mockPeriod = {
        _id: 'period-id',
        company_id: 'company-id',
        status: 'locked',
        start_date: new Date(),
        end_date: new Date()
      };
      AccountingPeriod.findOne.mockResolvedValue(mockPeriod);

      await expect(
        PeriodService.reopenPeriod('company-id', 'period-id', 'user-id')
      ).rejects.toThrow('PERIOD_LOCKED');
    });

    it('logs to audit trail', async () => {
      const AuditLogService = require('../services/AuditLogService');
      
      const mockPeriod = {
        _id: 'period-id',
        company_id: 'company-id',
        status: 'closed',
        start_date: new Date(),
        end_date: new Date()
      };
      AccountingPeriod.findOne.mockResolvedValue(mockPeriod);
      AccountingPeriod.findByIdAndUpdate.mockResolvedValue({});

      await PeriodService.reopenPeriod('company-id', 'period-id', 'user-id');

      expect(AuditLogService.log).toHaveBeenCalledWith({
        companyId: 'company-id',
        userId: 'user-id',
        action: 'period.reopen',
        entity_type: 'accounting_period',
        entity_id: 'period-id',
        changes: { status: 'open' }
      });
    });
  });

  describe('performYearEndClose()', () => {
    it('throws YEAR_END_ALREADY_CLOSED on second attempt', async () => {
      const mockYearEndPeriod = {
        _id: 'period-id',
        company_id: 'company-id',
        fiscal_year: 2025,
        is_year_end: true,
        year_end_close_entry_id: 'existing-entry-id',
        start_date: new Date('2025-07-01'),
        end_date: new Date('2026-06-30')
      };
      AccountingPeriod.findOne.mockResolvedValue(mockYearEndPeriod);

      await expect(
        PeriodService.performYearEndClose('company-id', 2025, 'user-id')
      ).rejects.toThrow('YEAR_END_ALREADY_CLOSED');
    });

    it('logs to audit trail', async () => {
      const AuditLogService = require('../services/AuditLogService');
      const JournalService = require('../services/journalService');
      
      const mockYearEndPeriod = {
        _id: 'period-id',
        company_id: 'company-id',
        fiscal_year: 2025,
        is_year_end: true,
        year_end_close_entry_id: null,
        start_date: new Date('2025-07-01'),
        end_date: new Date('2026-06-30')
      };
      const mockFirstPeriod = {
        _id: 'first-period-id',
        start_date: new Date('2025-07-01')
      };
      
      // Mock findOne for year-end period lookup
      AccountingPeriod.findOne
        .mockResolvedValueOnce(mockYearEndPeriod) // year end period
        .mockResolvedValueOnce(mockFirstPeriod); // first period
      
      // Mock find().sort().limit() for first period query
      AccountingPeriod.find
        .mockReturnValueOnce({
          sort: jest.fn().mockReturnValueOnce({
            limit: jest.fn().mockResolvedValueOnce([mockFirstPeriod])
          })
        });
      
      JournalService.createEntry.mockResolvedValue({ _id: 'journal-entry-id' });
      AccountingPeriod.findByIdAndUpdate.mockResolvedValue({});
      AccountingPeriod.updateMany.mockResolvedValue({});

      await PeriodService.performYearEndClose('company-id', 2025, 'user-id');

      expect(AuditLogService.log).toHaveBeenCalledWith({
        companyId: 'company-id',
        userId: 'user-id',
        action: 'period.year_end_close',
        entity_type: 'accounting_period',
        entity_id: 'period-id',
        changes: { fiscal_year: 2025, net_profit: 10000 }
      });
    });
  });
});
