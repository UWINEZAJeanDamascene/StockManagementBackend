/**
 * Permission-based Authorization Middleware
 * 
 * This middleware checks if the user's role has the required permission
 * to perform a specific action on a specific resource.
 * 
 * Usage:
 * router.post('/invoices', authenticate, authorize('sales_invoices', 'create'), handler)
 */

const Role = require('../models/Role');

/**
 * PermissionService - Checks if a role has a specific permission
 */
class PermissionService {
  /**
   * Check if a role has permission to perform an action on a resource
   * @param {Object} role - The role object with permissions array
   * @param {string} resource - The resource to check (e.g., 'products', 'invoices')
   * @param {string} action - The action to perform (e.g., 'read', 'create', 'update', 'delete')
   * @returns {boolean} - True if permission is granted, false otherwise
   */
  static check(role, resource, action) {
    if (!role || !role.permissions || !Array.isArray(role.permissions)) {
      return false;
    }

    for (const permission of role.permissions) {
      // Wildcard resource matches everything
      if (permission.resource === '*') {
        if (permission.actions.includes(action) || permission.actions.includes('*')) {
          return true;
        }
      }
      
      // Exact resource match
      if (permission.resource === resource) {
        if (permission.actions.includes(action) || permission.actions.includes('*')) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Check if role has ANY of the specified permissions
   * @param {Object} role - The role object
   * @param {Array} permissions - Array of {resource, action} objects
   * @returns {boolean} - True if at least one permission is granted
   */
  static hasAny(role, permissions) {
    for (const perm of permissions) {
      if (this.check(role, perm.resource, perm.action)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if role has ALL of the specified permissions
   * @param {Object} role - The role object
   * @param {Array} permissions - Array of {resource, action} objects
   * @returns {boolean} - True if all permissions are granted
   */
  static hasAll(role, permissions) {
    for (const perm of permissions) {
      if (!this.check(role, perm.resource, perm.action)) {
        return false;
      }
    }
    return true;
  }
}

/**
 * Create authorization middleware for a specific resource and action
 * @param {string} resource - The resource to check (e.g., 'products', 'invoices')
 * @param {string} action - The action to perform (e.g., 'read', 'create', 'update', 'delete')
 * @returns {Function} - Express middleware function
 */
const authorize = (resource, action) => {
  return async (req, res, next) => {
    try {
      // Get user from request (set by authenticate middleware)
      const user = req.user;
      
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'UNAUTHORIZED',
          message: 'Authentication required'
        });
      }

      // Get role - could be from user.role (string) or user.roles (array)
      let role = null;
      
      // First check if we have a populated role object
      if (user.role && typeof user.role === 'object' && user.role.permissions) {
        role = user.role;
      } else if (user.roles && Array.isArray(user.roles) && user.roles.length > 0) {
        // Check first role in array
        const firstRole = user.roles[0];
        if (typeof firstRole === 'object' && firstRole.permissions) {
          role = firstRole;
        } else {
          // Need to fetch role from DB
          role = await Role.findById(firstRole).lean();
        }
      } else if (user.role) {
        // Legacy: role is a string name
        role = await Role.findOne({ name: user.role }).lean();
      }

      if (!role) {
        return res.status(403).json({
          success: false,
          error: 'ROLE_NOT_FOUND',
          message: 'User role not found'
        });
      }

      // Check permission
      const hasPermission = PermissionService.check(role, resource, action);
      
      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN',
          message: `Role '${role.name}' does not have '${action}' permission on '${resource}'`
        });
      }

      // Attach role to request for downstream use
      req.userRole = role;
      
      next();
    } catch (err) {
      console.error('Authorization error:', err);
      res.status(500).json({
        success: false,
        error: 'AUTHORIZATION_ERROR',
        message: err.message
      });
    }
  };
};

/**
 * Create middleware that checks for ANY of the specified permissions
 * @param {Array} permissions - Array of {resource, action} objects
 * @returns {Function} - Express middleware function
 */
const authorizeAny = (permissions) => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'UNAUTHORIZED',
          message: 'Authentication required'
        });
      }

      let role = null;
      
      if (user.role && typeof user.role === 'object' && user.role.permissions) {
        role = user.role;
      } else if (user.roles && Array.isArray(user.roles) && user.roles.length > 0) {
        const firstRole = user.roles[0];
        if (typeof firstRole === 'object' && firstRole.permissions) {
          role = firstRole;
        } else {
          role = await Role.findById(firstRole).lean();
        }
      } else if (user.role) {
        role = await Role.findOne({ name: user.role }).lean();
      }

      if (!role) {
        return res.status(403).json({
          success: false,
          error: 'ROLE_NOT_FOUND',
          message: 'User role not found'
        });
      }

      const hasPermission = PermissionService.hasAny(role, permissions);
      
      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN',
          message: `Role '${role.name}' does not have any of the required permissions`
        });
      }

      req.userRole = role;
      next();
    } catch (err) {
      console.error('Authorization error:', err);
      res.status(500).json({
        success: false,
        error: 'AUTHORIZATION_ERROR',
        message: err.message
      });
    }
  };
};

/**
 * Create middleware that checks for ALL of the specified permissions
 * @param {Array} permissions - Array of {resource, action} objects
 * @returns {Function} - Express middleware function
 */
const authorizeAll = (permissions) => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'UNAUTHORIZED',
          message: 'Authentication required'
        });
      }

      let role = null;
      
      if (user.role && typeof user.role === 'object' && user.role.permissions) {
        role = user.role;
      } else if (user.roles && Array.isArray(user.roles) && user.roles.length > 0) {
        const firstRole = user.roles[0];
        if (typeof firstRole === 'object' && firstRole.permissions) {
          role = firstRole;
        } else {
          role = await Role.findById(firstRole).lean();
        }
      } else if (user.role) {
        role = await Role.findOne({ name: user.role }).lean();
      }

      if (!role) {
        return res.status(403).json({
          success: false,
          error: 'ROLE_NOT_FOUND',
          message: 'User role not found'
        });
      }

      const hasPermission = PermissionService.hasAll(role, permissions);
      
      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN',
          message: `Role '${role.name}' does not have all required permissions`
        });
      }

      req.userRole = role;
      next();
    } catch (err) {
      console.error('Authorization error:', err);
      res.status(500).json({
        success: false,
        error: 'AUTHORIZATION_ERROR',
        message: err.message
      });
    }
  };
};

module.exports = { 
  authorize, 
  authorizeAny, 
  authorizeAll, 
  PermissionService 
};
