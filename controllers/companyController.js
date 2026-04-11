const CompanyService = require('../services/CompanyService');

/**
 * Company Controller
 * Handles company profile CRUD operations
 */

// Create company (super-admin only)
exports.createCompany = async (req, res) => {
  try {
    const { user } = req;
    
    // Only platform admin can create companies
    if (user.role !== 'platform_admin') {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN: Only platform admin can create companies'
      });
    }

    const company = await CompanyService.create(req.body, user._id);

    res.status(201).json({
      success: true,
      data: company
    });
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    res.status(400).json({
      success: false,
      error: errorMessage
    });
  }
};

// Get company by ID
exports.getCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const company = await CompanyService.getById(id);

    res.json({
      success: true,
      data: company
    });
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    const statusCode = errorMessage.includes('NOT_FOUND') ? 404 : 400;
    res.status(statusCode).json({
      success: false,
      error: errorMessage
    });
  }
};

// Get all companies (platform admin)
exports.getAllCompanies = async (req, res) => {
  try {
    const { user } = req;
    
    // Only platform admin can list all companies
    if (user.role !== 'platform_admin') {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN: Only platform admin can list all companies'
      });
    }

    const { page, limit, isActive } = req.query;
    const result = await CompanyService.getAll({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      isActive: isActive !== undefined ? isActive === 'true' : undefined
    });

    res.json({
      success: true,
      data: result.companies,
      pagination: result.pagination
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: errorMessage
    });
  }
};

// Update current user's company
exports.updateMyCompany = async (req, res) => {
  try {
    const companyRef = req.user.company;
    const companyId = req.companyId || (companyRef ? (companyRef._id ? companyRef._id.toString() : companyRef.toString()) : null);

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'NO_COMPANY',
        message: 'User is not associated with a company'
      });
    }

    const company = await CompanyService.update(companyId, req.body, req.user._id);;

    res.json({
      success: true,
      data: company
    });
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    const statusCode = errorMessage.includes('NOT_FOUND') ? 404 : 400;
    res.status(statusCode).json({
      success: false,
      error: errorMessage
    });
  }
};

// Update company
exports.updateCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const { user } = req;

    // Users can only update their own company
    if (user.company && user.company.toString() !== id) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN: You can only update your own company'
      });
    }

    const company = await CompanyService.update(id, req.body, user._id);

    res.json({
      success: true,
      data: company
    });
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    const statusCode = errorMessage.includes('NOT_FOUND') ? 404 : 400;
    res.status(statusCode).json({
      success: false,
      error: errorMessage
    });
  }
};

// Upload logo
exports.uploadLogo = async (req, res) => {
  try {
    const { id } = req.params;
    const { user } = req;

    // Users can only update their own company logo
    if (user.company && user.company.toString() !== id) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN: You can only update your own company logo'
      });
    }

    // Accept either a provided `logo_url` or an uploaded file (multipart/form-data)
    let logo_url = req.body.logo_url;
    if (!logo_url && req.file) {
      // Build a relative URL to the uploaded file
      const urlPath = `/uploads/companies/${req.file.filename}`;
      logo_url = urlPath;
    }

    if (!logo_url) {
      return res.status(400).json({
        success: false,
        error: 'LOGO_URL_REQUIRED'
      });
    }

    const company = await CompanyService.uploadLogo(id, logo_url, user._id);

    res.json({
      success: true,
      data: company
    });
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    res.status(400).json({
      success: false,
      error: errorMessage
    });
  }
};

// Get setup status
exports.getSetupStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const status = await CompanyService.getSetupStatus(id);

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    res.status(400).json({
      success: false,
      error: errorMessage
    });
  }
};

// Mark setup step complete
exports.markSetupStepComplete = async (req, res) => {
  try {
    const { id, step } = req.params;
    const { user } = req;

    // Users can only update their own company
    if (user.company && user.company.toString() !== id) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN: You can only update your own company'
      });
    }

    const company = await CompanyService.markSetupStepComplete(id, step);

    res.json({
      success: true,
      data: company
    });
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    res.status(400).json({
      success: false,
      error: errorMessage
    });
  }
};

// Delete company (soft delete)
exports.deleteCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const { user } = req;

    // Only platform admin can delete companies
    if (user.role !== 'platform_admin') {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN: Only platform admin can delete companies'
      });
    }

    const company = await CompanyService.delete(id, user._id);

    res.json({
      success: true,
      data: company
    });
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    res.status(400).json({
      success: false,
      error: errorMessage
    });
  }
};

/** POST /api/companies/register — public */
exports.registerPublic = async (req, res) => {
  try {
    const { company, admin } = req.body;
    const result = await CompanyService.registerPublicCompany({ company, admin });
    res.status(201).json({
      success: true,
      message: 'Registration submitted. A platform administrator will review your application.',
      data: {
        company: {
          _id: result.company._id,
          name: result.company.name,
          email: result.company.email,
          status: result.company.approvalStatus
        },
        user: { _id: result.user._id, email: result.user.email }
      }
    });
  } catch (error) {
    const code = error.code || error.message;
    if (code === 'COMPANY_EMAIL_ALREADY_REGISTERED') {
      return res.status(409).json({
        success: false,
        message: 'A company with this business email is already registered',
        code
      });
    }
    if (code === 'EMAIL_NOT_AVAILABLE') {
      return res.status(409).json({
        success: false,
        message: 'This email cannot be used for registration',
        code
      });
    }
    if (code === 'DUPLICATE_USER_EMAIL_FOR_COMPANY' || code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists for this registration',
        code: 'DUPLICATE_USER_EMAIL_FOR_COMPANY'
      });
    }
    if (code === 'PASSWORD_TOO_SHORT') {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters', code });
    }
    if (error.message === 'MISSING_REQUIRED_FIELDS') {
      return res.status(400).json({ success: false, message: 'Please fill in all required fields' });
    }
    console.error('registerPublic:', error);
    res.status(500).json({ success: false, message: error.message || 'Registration failed' });
  }
};

/** GET /api/companies/pending — platform_admin */
exports.getPendingCompanies = async (req, res) => {
  try {
    const data = await CompanyService.listCompaniesByApprovalStatus('pending');
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to load pending companies' });
  }
};

/** GET /api/companies/rejected — platform_admin */
exports.getRejectedCompanies = async (req, res) => {
  try {
    const data = await CompanyService.listCompaniesByApprovalStatus('rejected');
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to load rejected companies' });
  }
};

/** PUT /api/companies/:id/approve — platform_admin */
exports.approveCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const company = await CompanyService.approveCompanyById(id, req.user._id);
    res.json({
      success: true,
      message: 'Company approved successfully',
      data: company
    });
  } catch (error) {
    if (error.message === 'COMPANY_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }
    if (error.message === 'COMPANY_NOT_PENDING') {
      return res.status(400).json({ success: false, message: 'Company is not awaiting approval' });
    }
    res.status(500).json({ success: false, message: error.message || 'Approval failed' });
  }
};

/** PUT /api/companies/:id/reject — platform_admin */
exports.rejectCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const reason = req.body && req.body.reason;
    const company = await CompanyService.rejectCompanyById(id, reason, req.user._id);
    res.json({
      success: true,
      message: 'Company registration rejected',
      data: company
    });
  } catch (error) {
    if (error.message === 'COMPANY_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }
    if (error.message === 'COMPANY_NOT_PENDING') {
      return res.status(400).json({ success: false, message: 'Company is not awaiting approval' });
    }
    res.status(500).json({ success: false, message: error.message || 'Rejection failed' });
  }
};

// Get current user's company
exports.getMyCompany = async (req, res) => {
  try {
    // Get company ID from user's company field (works for both regular and platform admin users)
    const companyRef = req.user.company;
    const companyId = req.companyId || (companyRef ? (companyRef._id ? companyRef._id.toString() : companyRef.toString()) : null);

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'NO_COMPANY',
        message: 'User is not associated with a company'
      });
    }

    const company = await CompanyService.getById(companyId);

    // Get system settings
    const SystemSettingsService = require('../services/systemSettingsService');
    let settings = null;
    try {
      settings = await SystemSettingsService.get(companyId);
    } catch {
      // Settings may not exist yet
    }

    res.json({
      success: true,
      data: company,
      settings: settings
    });
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    res.status(400).json({
      success: false,
      error: errorMessage
    });
  }
};
