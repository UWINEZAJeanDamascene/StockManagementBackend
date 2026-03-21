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
      error: error.message || 'Unknown error'
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

    // Expect logo URL in body (in production, this would handle file upload)
    const { logo_url } = req.body;
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
