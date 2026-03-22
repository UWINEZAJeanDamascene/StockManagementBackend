const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const SessionService = require('./sessionService');

if (!process.env.JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is required.');
}

const JWT_SECRET = process.env.JWT_SECRET;
const ACCESS_EXPIRE = process.env.JWT_ACCESS_EXPIRE || '15m';
const REFRESH_EXPIRE = process.env.REFRESH_TOKEN_EXPIRE || '7d';

/**
 * Refresh-token rotation (RFC 6819 style):
 * - Each successful POST /api/auth/refresh issues a NEW refresh_token and invalidates the previous
 *   one by replacing `user.refresh_token_hash` (see refreshWithRotation).
 * - Reusing an old refresh token fails validation and revokes all sessions for that user.
 */

function sha256(plain) {
  return crypto.createHash('sha256').update(plain, 'utf8').digest('hex');
}

function membershipsForUser(user) {
  return [
    {
      companyId: user.company?.toString(),
      role: user.role,
    },
  ];
}

class TokenService {
  /**
   * Build access + refresh JWTs; set refresh_token_hash on user (never store raw refresh).
   * Caller must save the user document.
   */
  static buildTokenPair(user, memberships) {
    const userId = user._id.toString();
    const access_token = jwt.sign(
      { id: userId, userId, memberships },
      JWT_SECRET,
      { expiresIn: ACCESS_EXPIRE },
    );
    const refresh_token = jwt.sign(
      { userId, type: 'refresh', jti: crypto.randomBytes(16).toString('hex') },
      JWT_SECRET,
      { expiresIn: REFRESH_EXPIRE },
    );
    user.refresh_token_hash = sha256(refresh_token);
    user.refresh_token = null;
    return { access_token, refresh_token };
  }

  /**
   * Persist hash and return pair (e.g. for tests or token re-issue without full login).
   */
  static async generateTokenPair(userId, memberships) {
    const user = await User.findById(userId).select('+refresh_token +refresh_token_hash');
    if (!user) {
      const err = new Error('User not found');
      err.code = 'USER_NOT_FOUND';
      throw err;
    }
    const pair = this.buildTokenPair(user, memberships);
    await user.save({ validateBeforeSave: false });
    return pair;
  }

  static _storedRefreshMatches(user, refreshPlain) {
    const presented = sha256(refreshPlain);
    if (user.refresh_token_hash) {
      return presented === user.refresh_token_hash;
    }
    if (user.refresh_token) {
      return user.refresh_token === refreshPlain;
    }
    return false;
  }

  static async refreshWithRotation(refreshPlain) {
    let decoded;
    try {
      decoded = jwt.verify(refreshPlain, JWT_SECRET);
    } catch (e) {
      if (e.name === 'TokenExpiredError') {
        const err = new Error('Refresh token expired');
        err.code = 'REFRESH_TOKEN_EXPIRED';
        throw err;
      }
      const err = new Error('Invalid refresh token');
      err.code = 'INVALID_REFRESH_TOKEN';
      throw err;
    }

    if (!decoded || decoded.type !== 'refresh' || !decoded.userId) {
      const err = new Error('Invalid refresh token');
      err.code = 'INVALID_REFRESH_TOKEN';
      throw err;
    }

    const user = await User.findById(decoded.userId).select('+refresh_token +refresh_token_hash');
    if (!user) {
      const err = new Error('Invalid refresh token');
      err.code = 'INVALID_REFRESH_TOKEN';
      throw err;
    }

    const matches = this._storedRefreshMatches(user, refreshPlain);
    if (!matches) {
      await this.revokeAllForUser(decoded.userId);
      const err = new Error('Invalid refresh token');
      err.code = 'INVALID_REFRESH_TOKEN';
      throw err;
    }

    const memberships = membershipsForUser(user);
    const { access_token, refresh_token } = this.buildTokenPair(user, memberships);
    await user.save({ validateBeforeSave: false });

    try {
      await SessionService.registerAccessToken(user._id.toString(), access_token);
    } catch (e) {
      console.error('Registering refreshed access token failed:', e);
    }

    return { access_token, refresh_token };
  }

  static async revokeAllForUser(userId) {
    const user = await User.findById(userId).select('+refresh_token +refresh_token_hash');
    if (!user) return;

    user.refresh_token = null;
    user.refresh_token_hash = null;
    await user.save({ validateBeforeSave: false });

    await SessionService.deleteAllSessions(userId.toString());
  }
}

TokenService.sha256Refresh = sha256;

module.exports = TokenService;
