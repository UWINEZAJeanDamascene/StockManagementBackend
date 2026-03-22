/**
 * RoleController - API endpoints for role management
 * 
 * Endpoints:
 * GET    /api/roles              - List system roles + company custom roles
 * POST   /api/roles              - Create custom role for company (admin only)
 * PUT    /api/roles/:id          - Update custom role (cannot modify system roles)
 * DELETE /api/roles/:id          - Delete custom role (cannot delete system roles)
 * GET    /api/roles/:id/permissions - Get all permissions for a role
 */

const Role = require('../models/Role');
const { parsePagination, paginationMeta } = require('../utils/pagination');

/**
 * List all roles (system roles + company custom roles)
 * GET /api/roles
 */
exports.getRoles = async (req, res, next) => {
  try {
    const { company_id } = req.query;
    
    let query = {};
    
    if (company_id) {
      // Get system roles (company_id is null) + company's custom roles
      query = {
        $or: [
          { company_id: null },
          { company_id: company_id }
        ]
      };
    } else {
      // Just get system roles
      query = { company_id: null };
    }

    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const total = await Role.countDocuments(query);
    const roles = await Role.find(query)
      .select('-__v')
      .lean()
      .sort({ is_system_role: -1, name: 1 })
      .skip(skip)
      .limit(limit);

    res.json({
      success: true,
      data: roles,
      count: roles.length,
      pagination: paginationMeta(page, limit, total),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a single role by ID
 * GET /api/roles/:id
 */
exports.getRoleById = async (req, res, next) => {
  try {
    const role = await Role.findById(req.params.id).lean();

    if (!role) {
      return res.status(404).json({
        success: false,
        error: 'ROLE_NOT_FOUND',
        message: 'Role not found'
      });
    }

    res.json({
      success: true,
      data: role
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get permissions for a specific role
 * GET /api/roles/:id/permissions
 */
exports.getRolePermissions = async (req, res, next) => {
  try {
    const role = await Role.findById(req.params.id)
      .select('permissions name is_system_role')
      .lean();

    if (!role) {
      return res.status(404).json({
        success: false,
        error: 'ROLE_NOT_FOUND',
        message: 'Role not found'
      });
    }

    res.json({
      success: true,
      data: {
        role_id: role._id,
        role_name: role.name,
        is_system_role: role.is_system_role,
        permissions: role.permissions
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new custom role
 * POST /api/roles
 * 
 * Only admins can create custom roles for their company
 */
exports.createRole = async (req, res, next) => {
  try {
    const { name, description, permissions, company_id } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Role name is required'
      });
    }

    // Check if role already exists for this company
    const existingRole = await Role.findOne({
      name: name.trim(),
      $or: [
        { company_id: company_id || null },
        { company_id: null } // Can't create role with same name as system role
      ]
    });

    if (existingRole) {
      return res.status(409).json({
        success: false,
        error: 'ROLE_EXISTS',
        message: 'A role with this name already exists'
      });
    }

    // Create the role (custom roles cannot be system roles)
    const role = await Role.create({
      name: name.trim(),
      description: description || null,
      permissions: permissions || [],
      company_id: company_id || null,
      is_system_role: false
    });

    res.status(201).json({
      success: true,
      data: role,
      message: 'Role created successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update an existing role
 * PUT /api/roles/:id
 * 
 * Cannot modify system roles
 */
exports.updateRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, permissions } = req.body;

    // Find the role
    const role = await Role.findById(id);

    if (!role) {
      return res.status(404).json({
        success: false,
        error: 'ROLE_NOT_FOUND',
        message: 'Role not found'
      });
    }

    // Cannot modify system roles
    if (role.is_system_role) {
      return res.status(403).json({
        success: false,
        error: 'CANNOT_MODIFY_SYSTEM_ROLE',
        message: 'System roles cannot be modified'
      });
    }

    // Check if trying to change name to an existing role
    if (name && name.trim() !== role.name) {
      const existingRole = await Role.findOne({
        name: name.trim(),
        company_id: role.company_id,
        _id: { $ne: id }
      });

      if (existingRole) {
        return res.status(409).json({
          success: false,
          error: 'ROLE_EXISTS',
          message: 'A role with this name already exists'
        });
      }
    }

    // Update fields
    if (name) role.name = name.trim();
    if (description !== undefined) role.description = description;
    if (permissions) role.permissions = permissions;

    await role.save();

    res.json({
      success: true,
      data: role,
      message: 'Role updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a role
 * DELETE /api/roles/:id
 * 
 * Cannot delete system roles
 */
exports.deleteRole = async (req, res, next) => {
  try {
    const { id } = req.params;

    const role = await Role.findById(id);

    if (!role) {
      return res.status(404).json({
        success: false,
        error: 'ROLE_NOT_FOUND',
        message: 'Role not found'
      });
    }

    // Cannot delete system roles
    if (role.is_system_role) {
      return res.status(403).json({
        success: false,
        error: 'CANNOT_DELETE_SYSTEM_ROLE',
        message: 'System roles cannot be deleted'
      });
    }

    // TODO: Check if any users are assigned to this role before deleting
    // For now, just delete
    await role.deleteOne();

    res.json({
      success: true,
      message: 'Role deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};
