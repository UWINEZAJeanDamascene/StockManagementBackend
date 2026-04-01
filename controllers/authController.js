const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Role = require('../models/Role');
const Company = require('../models/Company');
const { notifyPasswordChanged, notifyFailedLogin } = require('../services/notificationHelper');
const sessionService = require('../services/sessionService');
// Centralized config
const env = require('../src/config/environment');
const config = env.getConfig();

// Generate JWT Token with company and role info
const generateToken = (id, companyId, role) => {
  return jwt.sign(
    { id, companyId, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE }
  );
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Validate email & password
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide email and password' 
      });
    }

    // Check for user
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password').populate('company', 'name email isActive approvalStatus');

    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({ 
        success: false, 
        message: 'Account is inactive. Please contact administrator.' 
      });
    }

    // Check if user is platform admin - they don't have a company
    if (user.role === 'platform_admin') {
      // Generate token without companyId for platform admin
      const token = generateToken(user._id, null, user.role);
      
      const userWithoutPassword = user.toJSON();

      // Create Redis session
      await sessionService.createSession(
        user._id.toString(),
        null,
        user.role,
        token,
        { email: user.email, name: user.name }
      );
      // Set httpOnly cookie for token (server-side session)
      res.cookie('token', token, {
        httpOnly: true,
        secure: config.server.env === 'production',
        sameSite: 'lax',
        maxAge: (config.session && config.session.ttl ? config.session.ttl : 24 * 60 * 60) * 1000,
      });

      return res.json({
        success: true,
        data: userWithoutPassword,
        requirePasswordChange: user.mustChangePassword || false,
        isPlatformAdmin: true
      });
    }

    // Check if company is active
    if (!user.company || !user.company.isActive) {
      return res.status(401).json({ 
        success: false, 
        message: 'Company account is inactive. Please contact support.' 
      });
    }

    // Check if company is approved
    if (user.company.approvalStatus !== 'approved') {
      return res.status(401).json({ 
        success: false, 
        message: 'Company is pending approval. Please wait for platform administrator to approve your registration.',
        approvalStatus: user.company.approvalStatus
      });
    }

    // Check if password matches
    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      // Notify about failed login attempt
      try {
        await notifyFailedLogin(
          user.company?._id || user.company,
          user._id,
          email,
          req.ip || req.connection?.remoteAddress
        );
      } catch (notifyErr) {
        console.error('Failed to send login notification:', notifyErr);
      }
      
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    // Check if account requires password change (first login with temp password)
    const requirePasswordChange = user.mustChangePassword;

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token with companyId
    const token = generateToken(user._id, user.company._id, user.role);

    // Remove password from user object
    const userWithoutPassword = user.toJSON();

    // Create Redis session
    await sessionService.createSession(
      user._id.toString(),
      user.company._id.toString(),
      user.role,
      token,
      { email: user.email, name: user.name, companyName: user.company.name }
    );

    // Set httpOnly cookie for token
    res.cookie('token', token, {
      httpOnly: true,
      secure: config.server.env === 'production',
      sameSite: 'lax',
      maxAge: (config.session && config.session.ttl ? config.session.ttl : 24 * 60 * 60) * 1000,
    });

    res.json({
      success: true,
      data: userWithoutPassword,
      company: user.company,
      requirePasswordChange
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('company', 'name email')
      .populate('roles');

    const userObj = user.toJSON();

    // Compute flat permissions array from populated roles
    // Format: ["products:read", "products:create", "stock:read", ...]
    const permissionsSet = new Set();

    // Admin and platform_admin get wildcard permissions
    if (user.role === 'admin' || user.role === 'platform_admin') {
      permissionsSet.add('*');
    }

    if (user.roles && user.roles.length > 0) {
      for (const role of user.roles) {
        if (role.permissions && role.permissions.length > 0) {
          for (const perm of role.permissions) {
            if (perm.resource === '*') {
              // Wildcard resource - add all common actions
              const allActions = ['read', 'create', 'update', 'delete', 'approve', 'post'];
              for (const action of (perm.actions.includes('*') ? allActions : perm.actions)) {
                permissionsSet.add(`*:${action}`);
              }
              if (perm.actions.includes('*')) {
                permissionsSet.add('*');
              }
            } else {
              for (const action of perm.actions) {
                if (action === '*') {
                  // Wildcard action - add all actions for this resource
                  permissionsSet.add(`${perm.resource}:*`);
                  const allActions = ['read', 'create', 'update', 'delete', 'approve', 'post'];
                  for (const a of allActions) {
                    permissionsSet.add(`${perm.resource}:${a}`);
                  }
                } else {
                  permissionsSet.add(`${perm.resource}:${action}`);
                }
              }
            }
          }
        }
      }
    } else if (user.role && user.role !== 'admin' && user.role !== 'platform_admin') {
      // Fallback: look up the Role document by the legacy role string name
      const legacyRole = await Role.findOne({ name: user.role, is_system_role: true });
      if (legacyRole && legacyRole.permissions && legacyRole.permissions.length > 0) {
        for (const perm of legacyRole.permissions) {
          if (perm.resource === '*') {
            const allActions = ['read', 'create', 'update', 'delete', 'approve', 'post'];
            for (const action of (perm.actions.includes('*') ? allActions : perm.actions)) {
              permissionsSet.add(`*:${action}`);
            }
            if (perm.actions.includes('*')) {
              permissionsSet.add('*');
            }
          } else {
            for (const action of perm.actions) {
              if (action === '*') {
                permissionsSet.add(`${perm.resource}:*`);
                const allActions = ['read', 'create', 'update', 'delete', 'approve', 'post'];
                for (const a of allActions) {
                  permissionsSet.add(`${perm.resource}:${a}`);
                }
              } else {
                permissionsSet.add(`${perm.resource}:${action}`);
              }
            }
          }
        }
      }
    }

    userObj.permissions = Array.from(permissionsSet);

    res.json({
      success: true,
      data: userObj
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update password
// @route   PUT /api/auth/update-password
// @access  Private
exports.updatePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide current and new password' 
      });
    }

    const user = await User.findById(req.user.id).select('+password');

    // Check current password
    const isMatch = await user.comparePassword(currentPassword);

    if (!isMatch) {
      return res.status(401).json({ 
        success: false, 
        message: 'Current password is incorrect' 
      });
    }

    user.password = newPassword;
    user.passwordChangedAt = new Date();
    user.mustChangePassword = false;
    user.tempPassword = false;
    await user.save();

    // Notify about password change
    try {
      await notifyPasswordChanged(req.user.company._id, user._id);
    } catch (notifyErr) {
      console.error('Failed to send password change notification:', notifyErr);
    }

    const token = generateToken(user._id, req.user.company._id, user.role);

    res.json({
      success: true,
      message: 'Password updated successfully',
      token
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
exports.logout = async (req, res, next) => {
  try {
    // Get token from header or cookie
    const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;

    // Delete session from Redis
    if (req.user) {
      await sessionService.deleteSession(req.user._id.toString(), token);
    }

    // Blacklist the token
    if (token) {
      await sessionService.blacklistToken(token);
    }
    // Clear cookie on logout
    res.clearCookie('token');

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    next(error);
  }
};
