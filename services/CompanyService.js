const mongoose = require('mongoose');
const Company = require('../models/Company');
const AuditLogService = require('./AuditLogService');

class CompanyService {

  /**
   * Create a new company
   * @param {object} data - Company data
   * @param {string} createdByUserId - ID of user creating the company
   */
  static async create(data, createdByUserId) {
    // code must be uppercase alphanumeric only
    if (!/^[A-Z0-9]{2,10}$/.test(data.code?.toUpperCase())) {
      throw new Error('INVALID_COMPANY_CODE: must be 2-10 uppercase alphanumeric characters');
    }

    const existing = await Company.findOne({ code: data.code.toUpperCase() });
    if (existing) throw new Error('COMPANY_CODE_TAKEN');

    const company = await Company.create({
      ...data,
      code: data.code.toUpperCase(),
      created_by: createdByUserId
    });

    // Log the creation
    await AuditLogService.log({
      companyId: company._id,
      userId: createdByUserId,
      action: 'company.create',
      entity_type: 'company',
      entity_id: company._id,
      changes: data
    });

    return company;
  }

  /**
   * Public self-service registration (pending platform approval)
   */
  static async registerPublicCompany({ company: c, admin: a }) {
    const User = require('../models/User');

    const emailCompany = (c.email || '').toLowerCase().trim();
    const emailAdmin = (a.email || '').toLowerCase().trim();

    if (!emailCompany || !c.name || !emailAdmin || !a.name || !a.password) {
      throw new Error('MISSING_REQUIRED_FIELDS');
    }
    if (a.password.length < 8) {
      const err = new Error('PASSWORD_TOO_SHORT');
      err.code = 'PASSWORD_TOO_SHORT';
      throw err;
    }

    const dupCompany = await Company.findOne({ email: emailCompany });
    if (dupCompany) {
      const err = new Error('COMPANY_EMAIL_ALREADY_REGISTERED');
      err.code = 'COMPANY_EMAIL_ALREADY_REGISTERED';
      throw err;
    }

    const platformAdminEmail = await User.findOne({ email: emailAdmin, role: 'platform_admin' });
    if (platformAdminEmail) {
      const err = new Error('EMAIL_NOT_AVAILABLE');
      err.code = 'EMAIL_NOT_AVAILABLE';
      throw err;
    }

    const company = await Company.create({
      name: c.name.trim(),
      email: emailCompany,
      phone: c.phone || null,
      tax_identification_number: c.tin || null,
      approvalStatus: 'pending',
      isActive: false,
      registration_rejection_reason: null
    });

    try {
      const user = await User.create({
        name: a.name.trim(),
        email: emailAdmin,
        password: a.password,
        company: company._id,
        role: 'admin',
        isActive: true
      });
      return { company, user };
    } catch (e) {
      await Company.deleteOne({ _id: company._id });
      if (e.code === 11000) {
        const err = new Error('DUPLICATE_USER_EMAIL_FOR_COMPANY');
        err.code = 'DUPLICATE_USER_EMAIL_FOR_COMPANY';
        throw err;
      }
      throw e;
    }
  }

  static async listCompaniesByApprovalStatus(status) {
    const list = await Company.find({ approvalStatus: status })
      .sort({ createdAt: -1 })
      .lean();
    return list.map((row) => ({
      _id: row._id,
      name: row.name,
      email: row.email,
      phone: row.phone || '',
      tin: row.tax_identification_number || '',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      registration_rejection_reason: row.registration_rejection_reason || null
    }));
  }

  static async approveCompanyById(companyId, reviewerUserId) {
    const company = await Company.findById(companyId);
    if (!company) throw new Error('COMPANY_NOT_FOUND');
    if (company.approvalStatus !== 'pending') {
      throw new Error('COMPANY_NOT_PENDING');
    }
    company.approvalStatus = 'approved';
    company.isActive = true;
    company.registration_rejection_reason = null;
    await company.save();

    await AuditLogService.log({
      companyId: company._id,
      userId: reviewerUserId,
      action: 'company.registration_approved',
      entityType: 'company',
      entityId: company._id,
      changes: { approvalStatus: 'approved' }
    });

    return company;
  }

  static async rejectCompanyById(companyId, reason, reviewerUserId) {
    const company = await Company.findById(companyId);
    if (!company) throw new Error('COMPANY_NOT_FOUND');
    if (company.approvalStatus !== 'pending') {
      throw new Error('COMPANY_NOT_PENDING');
    }
    company.approvalStatus = 'rejected';
    company.isActive = false;
    company.registration_rejection_reason = (reason || 'No reason provided').trim();
    await company.save();

    await AuditLogService.log({
      companyId: company._id,
      userId: reviewerUserId,
      action: 'company.registration_rejected',
      entityType: 'company',
      entityId: company._id,
      changes: { approvalStatus: 'rejected', reason: company.registration_rejection_reason }
    });

    return company;
  }

  /**
   * Get company by ID
   */
  static async getById(companyId) {
    const company = await Company.findById(companyId);
    if (!company) throw new Error('COMPANY_NOT_FOUND');
    return company;
  }

  /**
   * Get all companies (for platform admin)
   */
  static async getAll(options = {}) {
    const { page = 1, limit = 20, isActive } = options;
    const query = {};
    
    if (isActive !== undefined) {
      query.is_active = isActive;
    }

    const skip = (page - 1) * limit;
    
    const [companies, total] = await Promise.all([
      Company.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Company.countDocuments(query)
    ]);

    return {
      companies,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Update company
   */
  static async update(companyId, data, userId) {
    // base_currency cannot be changed once any transaction exists
    if (data.base_currency) {
      const hasTransactions = await CompanyService._hasAnyTransactions(companyId);
      if (hasTransactions) {
        throw new Error('BASE_CURRENCY_LOCKED: cannot change currency after transactions exist');
      }
    }

    // fiscal_year_start_month cannot be changed once any period exists
    if (data.fiscal_year_start_month) {
      try {
        const AccountingPeriod = require('../models/AccountingPeriod');
        if (AccountingPeriod && AccountingPeriod.countDocuments) {
          const periodCount = await AccountingPeriod.countDocuments({ company: companyId });
          if (periodCount > 0) {
            throw new Error('FISCAL_YEAR_LOCKED: cannot change fiscal year after periods exist');
          }
        }
      } catch (e) {
        // AccountingPeriod may not exist yet, continue
      }
    }

    // Get old data for audit
    const oldCompany = await Company.findById(companyId);
    if (!oldCompany) throw new Error('COMPANY_NOT_FOUND');

    const company = await Company.findByIdAndUpdate(
      companyId,
      { $set: data },
      { new: true, runValidators: true }
    );

    if (!company) throw new Error('COMPANY_NOT_FOUND');

    // Log the update
    await AuditLogService.log({
      companyId,
      userId,
      action: 'company.update',
      entity_type: 'company',
      entity_id: companyId,
      changes: data
    });

    return company;
  }

  /**
   * Upload/update company logo
   */
  static async uploadLogo(companyId, logoUrl, userId) {
    const company = await Company.findByIdAndUpdate(
      companyId,
      { $set: { logo_url: logoUrl } },
      { new: true }
    ).lean();

    if (!company) throw new Error('COMPANY_NOT_FOUND');

    await AuditLogService.log({
      companyId,
      userId,
      action: 'company.logo_upload',
      entity_type: 'company',
      entity_id: companyId,
      changes: { logo_url: logoUrl }
    });

    return company;
  }

  /**
   * Get setup status
   */
  static async getSetupStatus(companyId) {
    const company = await Company.findById(companyId);
    if (!company) throw new Error('COMPANY_NOT_FOUND');

    return {
      setup_completed: company.setup_completed,
      setup_steps_completed: company.setup_steps_completed,
      subscription_plan: company.subscription_plan,
      trial_ends_at: company.trial_ends_at
    };
  }

  /**
   * Mark a setup step as complete
   */
  static async markSetupStepComplete(companyId, step) {
    const validSteps = [
      'company_profile',
      'chart_of_accounts',
      'opening_balances',
      'first_user',
      'first_period'
    ];

    if (!validSteps.includes(step)) {
      throw new Error('INVALID_SETUP_STEP');
    }

    const update = { [`setup_steps_completed.${step}`]: true };
    const company = await Company.findByIdAndUpdate(
      companyId,
      { $set: update },
      { new: true }
    );

    if (!company) throw new Error('COMPANY_NOT_FOUND');

    // Check if all steps done
    const allDone = Object.values(company.setup_steps_completed).every(v => v === true);
    if (allDone) {
      await Company.findByIdAndUpdate(companyId, { $set: { setup_completed: true } });
      company.setup_completed = true;
    }

    return company;
  }

  /**
   * Check if company has any transactions
   * @private
   */
  static async _hasAnyTransactions(companyId) {
    const JournalEntry = require('../models/JournalEntry');
    const count = await JournalEntry.countDocuments({ company: companyId });
    return count > 0;
  }

  /**
   * Delete company (soft delete)
   */
  static async delete(companyId, userId) {
    const company = await Company.findByIdAndUpdate(
      companyId,
      { $set: { is_active: false } },
      { new: true }
    ).lean();

    if (!company) throw new Error('COMPANY_NOT_FOUND');

    await AuditLogService.log({
      companyId,
      userId,
      action: 'company.delete',
      entity_type: 'company',
      entity_id: companyId
    });

    return company;
  }
}

module.exports = CompanyService;
