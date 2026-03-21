const CompanyService = require('../services/CompanyService');
const Company = require('../models/Company');
const JournalEntry = require('../models/JournalEntry');

// Mock dependencies
jest.mock('../models/Company', () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  create: jest.fn(),
  countDocuments: jest.fn()
}));

jest.mock('../models/JournalEntry', () => ({
  countDocuments: jest.fn()
}));

jest.mock('../services/AuditLogService', () => ({
  log: jest.fn().mockResolvedValue(true),
  logFailure: jest.fn().mockResolvedValue(true)
}));

describe('CompanyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates company with valid code', async () => {
      const mockCompany = {
        _id: 'company-id-123',
        name: 'Test Company',
        code: 'TC001',
        base_currency: 'RWF',
        fiscal_year_start_month: 1,
        created_by: 'user-id-123',
        setup_completed: false,
        setup_steps_completed: {
          company_profile: false,
          chart_of_accounts: false,
          opening_balances: false,
          first_user: false,
          first_period: false
        }
      };

      Company.findOne.mockResolvedValue(null);
      Company.create.mockResolvedValue(mockCompany);

      const result = await CompanyService.create(
        { name: 'Test Company', code: 'tc001', base_currency: 'RWF' },
        'user-id-123'
      );

      expect(Company.findOne).toHaveBeenCalledWith({ code: 'TC001' });
      expect(Company.create).toHaveBeenCalledWith({
        name: 'Test Company',
        code: 'TC001',
        base_currency: 'RWF',
        created_by: 'user-id-123'
      });
      expect(result.code).toBe('TC001');
    });

    it('throws COMPANY_CODE_TAKEN when code already exists', async () => {
      Company.findOne.mockResolvedValue({ code: 'TC001', name: 'Existing Company' });

      await expect(
        CompanyService.create({ name: 'Test', code: 'TC001' }, 'user-id')
      ).rejects.toThrow('COMPANY_CODE_TAKEN');
    });

    it('throws INVALID_COMPANY_CODE when code has special characters', async () => {
      await expect(
        CompanyService.create({ name: 'Test', code: 'TC-001!' }, 'user-id')
      ).rejects.toThrow('INVALID_COMPANY_CODE');
    });

    it('throws INVALID_COMPANY_CODE when code is too short', async () => {
      await expect(
        CompanyService.create({ name: 'Test', code: 'A' }, 'user-id')
      ).rejects.toThrow('INVALID_COMPANY_CODE');
    });

    it('throws INVALID_COMPANY_CODE when code is too long', async () => {
      await expect(
        CompanyService.create({ name: 'Test', code: 'ABCDEFGHIJKLMNOP' }, 'user-id')
      ).rejects.toThrow('INVALID_COMPANY_CODE');
    });
  });

  describe('update', () => {
    it('throws BASE_CURRENCY_LOCKED when changing currency after transactions exist', async () => {
      JournalEntry.countDocuments.mockResolvedValue(10); // Has transactions

      await expect(
        CompanyService.update('company-id', { base_currency: 'USD' }, 'user-id')
      ).rejects.toThrow('BASE_CURRENCY_LOCKED');
    });

    it('allows currency change when no transactions exist', async () => {
      JournalEntry.countDocuments.mockResolvedValue(0);
      
      const mockCompany = {
        _id: 'company-id',
        name: 'Test',
        base_currency: 'USD'
      };

      Company.findById.mockResolvedValue(mockCompany);
      Company.findByIdAndUpdate.mockResolvedValue({ ...mockCompany, base_currency: 'USD' });

      const result = await CompanyService.update(
        'company-id',
        { base_currency: 'USD' },
        'user-id'
      );

      expect(result).toBeDefined();
    });

    it('allows fiscal year change when no periods exist', async () => {
      JournalEntry.countDocuments.mockResolvedValue(0);
      
      const mockCompany = {
        _id: 'company-id',
        name: 'Test',
        fiscal_year_start_month: 1
      };

      Company.findById.mockResolvedValue(mockCompany);
      Company.findByIdAndUpdate.mockResolvedValue({ ...mockCompany, fiscal_year_start_month: 7 });

      // Should succeed since AccountingPeriod model doesn't exist yet
      const result = await CompanyService.update(
        'company-id',
        { fiscal_year_start_month: 7 },
        'user-id'
      );

      expect(result).toBeDefined();
      expect(result.fiscal_year_start_month).toBe(7);
    });
  });

  describe('markSetupStepComplete', () => {
    it('markSetupStepComplete sets correct step to true', async () => {
      const mockCompany = {
        _id: 'company-id',
        setup_steps_completed: {
          company_profile: false,
          chart_of_accounts: false,
          opening_balances: false,
          first_user: false,
          first_period: false
        },
        setup_completed: false
      };

      Company.findByIdAndUpdate.mockResolvedValue({
        ...mockCompany,
        setup_steps_completed: {
          ...mockCompany.setup_steps_completed,
          company_profile: true
        }
      });

      const result = await CompanyService.markSetupStepComplete('company-id', 'company_profile');

      expect(Company.findByIdAndUpdate).toHaveBeenCalledWith(
        'company-id',
        { $set: { 'setup_steps_completed.company_profile': true } },
        { new: true }
      );
      expect(result.setup_steps_completed.company_profile).toBe(true);
    });

    it('setup_completed set to true when all steps are done', async () => {
      const mockCompany = {
        _id: 'company-id',
        setup_steps_completed: {
          company_profile: true,
          chart_of_accounts: true,
          opening_balances: true,
          first_user: true,
          first_period: true
        },
        setup_completed: false
      };

      // First call returns company with all steps complete
      // Second call returns company with setup_completed = true
      Company.findByIdAndUpdate
        .mockResolvedValueOnce({
          ...mockCompany,
          setup_steps_completed: {
            ...mockCompany.setup_steps_completed,
            first_period: true
          }
        })
        .mockResolvedValueOnce({
          ...mockCompany,
          setup_completed: true
        });

      const result = await CompanyService.markSetupStepComplete('company-id', 'first_period');

      // Should have called update twice: once for step, once for setup_completed
      expect(Company.findByIdAndUpdate).toHaveBeenCalledTimes(2);
      expect(result.setup_completed).toBe(true);
    });

    it('throws INVALID_SETUP_STEP for invalid step', async () => {
      await expect(
        CompanyService.markSetupStepComplete('company-id', 'invalid_step')
      ).rejects.toThrow('INVALID_SETUP_STEP');
    });
  });

  describe('getById', () => {
    it('throws COMPANY_NOT_FOUND when company does not exist', async () => {
      Company.findById.mockResolvedValue(null);

      await expect(CompanyService.getById('non-existent-id')).rejects.toThrow('COMPANY_NOT_FOUND');
    });

    it('returns company when found', async () => {
      const mockCompany = { _id: 'company-id', name: 'Test' };
      Company.findById.mockResolvedValue(mockCompany);

      const result = await CompanyService.getById('company-id');
      expect(result.name).toBe('Test');
    });
  });

  describe('update logs to audit trail', () => {
    it('logs update action to audit trail', async () => {
      const AuditLogService = require('../services/AuditLogService');
      
      JournalEntry.countDocuments.mockResolvedValue(0);
      
      const mockCompany = {
        _id: 'company-id',
        name: 'Test Updated'
      };

      Company.findById.mockResolvedValue(mockCompany);
      Company.findByIdAndUpdate.mockResolvedValue({ ...mockCompany, name: 'Test Updated' });

      await CompanyService.update('company-id', { name: 'Test Updated' }, 'user-id');

      expect(AuditLogService.log).toHaveBeenCalledWith({
        companyId: 'company-id',
        userId: 'user-id',
        action: 'company.update',
        entity_type: 'company',
        entity_id: 'company-id',
        changes: { name: 'Test Updated' }
      });
    });
  });
});
