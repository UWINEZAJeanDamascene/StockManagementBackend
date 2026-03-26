const { redisClient } = require('../config/redis');
const jwt = require('jsonwebtoken');

// Import centralized configuration
const env = require('../src/config/environment');
const config = env.getConfig();

// Session configuration (SESSION_TTL = Redis session + token mapping TTL in seconds)
const SESSION_TTL = config.session.ttl; // 24 hours default
// Max concurrent access tokens per user (Redis FIFO eviction of oldest). Default 5 devices.
// Set SESSION_MAX_CONCURRENT=0 for unlimited (not recommended in production).
const SESSION_MAX_CONCURRENT = config.session.maxConcurrent;
const SESSION_PREFIX = 'session:';
const TOKEN_BLACKLIST_PREFIX = 'blacklist:';
const TOKENS_LIST_SUFFIX = 'tokens:';

function tokenBlacklistTtlSeconds(token) {
  try {
    const dec = jwt.decode(token);
    if (dec && typeof dec.exp === 'number') {
      const left = dec.exp - Math.floor(Date.now() / 1000);
      return Math.max(1, left);
    }
  } catch (_) {
    /* ignore */
  }
  return SESSION_TTL;
}

// Session data structure
class SessionService {
  _tokensListKey(userId) {
    return `${SESSION_PREFIX}${TOKENS_LIST_SUFFIX}${userId}`;
  }

  /**
   * Enforce max concurrent access tokens per user (FIFO eviction of oldest).
   */
  async _registerAccessTokenForConcurrency(userId, token) {
    if (!SESSION_MAX_CONCURRENT || SESSION_MAX_CONCURRENT < 1) {
      return;
    }
    const listKey = this._tokensListKey(userId);
    await redisClient.rpush(listKey, token);
    await redisClient.expire(listKey, SESSION_TTL);

    let len = await redisClient.llen(listKey);
    while (len > SESSION_MAX_CONCURRENT) {
      const oldToken = await redisClient.lpop(listKey);
      if (oldToken) {
        await redisClient.del(`${SESSION_PREFIX}token:${oldToken}`);
        await this.blacklistToken(oldToken, tokenBlacklistTtlSeconds(oldToken));
      }
      len = await redisClient.llen(listKey);
    }
  }

  /**
   * Map an access token to userId in Redis and apply concurrent-session rules.
   * Use after refresh when the session blob already exists.
   */
  async registerAccessToken(userId, token) {
    const tokenKey = `${SESSION_PREFIX}token:${token}`;
    try {
      await redisClient.setex(tokenKey, SESSION_TTL, userId);
      await this._registerAccessTokenForConcurrency(userId, token);
    } catch (error) {
      console.error('Error registering access token:', error);
      throw error;
    }
  }

  /**
   * Create a new session for a user
   * @param {string} userId - User ID
   * @param {string} companyId - Company ID
   * @param {string} role - User role
   * @param {string} token - JWT token
   * @param {Object} additionalData - Additional session data
   */
  async createSession(userId, companyId, role, token, additionalData = {}) {
    const sessionKey = `${SESSION_PREFIX}${userId}`;
    const sessionData = {
      userId,
      companyId,
      role,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      ...additionalData,
    };

    try {
      // Store session data
      await redisClient.setex(sessionKey, SESSION_TTL, JSON.stringify(sessionData));

      // Store token-to-user mapping for quick lookup
      const tokenKey = `${SESSION_PREFIX}token:${token}`;
      await redisClient.setex(tokenKey, SESSION_TTL, userId);
      await this._registerAccessTokenForConcurrency(userId, token);

      console.log(`Session created for user: ${userId}`);
      return sessionData;
    } catch (error) {
      console.error('Error creating session:', error);
      throw error;
    }
  }

  /**
   * Get session data by user ID
   * @param {string} userId - User ID
   */
  async getSession(userId) {
    const sessionKey = `${SESSION_PREFIX}${userId}`;

    try {
      const sessionData = await redisClient.get(sessionKey);
      if (!sessionData) {
        return null;
      }

      const parsed = JSON.parse(sessionData);
      // Update last activity
      parsed.lastActivity = new Date().toISOString();
      await redisClient.setex(sessionKey, SESSION_TTL, JSON.stringify(parsed));

      return parsed;
    } catch (error) {
      console.error('Error getting session:', error);
      return null;
    }
  }

  /**
   * Get user by token (quick lookup)
   * @param {string} token - JWT token
   */
  async getUserByToken(token) {
    const tokenKey = `${SESSION_PREFIX}token:${token}`;

    try {
      const userId = await redisClient.get(tokenKey);
      if (!userId) {
        return null;
      }

      return await this.getSession(userId);
    } catch (error) {
      console.error('Error getting user by token:', error);
      return null;
    }
  }

  /**
   * Update session data
   * @param {string} userId - User ID
   * @param {Object} data - Data to update
   */
  async updateSession(userId, data) {
    const sessionKey = `${SESSION_PREFIX}${userId}`;

    try {
      const currentSession = await this.getSession(userId);
      if (!currentSession) {
        return null;
      }

      const updatedSession = {
        ...currentSession,
        ...data,
        lastActivity: new Date().toISOString(),
      };

      await redisClient.setex(sessionKey, SESSION_TTL, JSON.stringify(updatedSession));
      return updatedSession;
    } catch (error) {
      console.error('Error updating session:', error);
      throw error;
    }
  }

  /**
   * Delete a session (logout)
   * @param {string} userId - User ID
   * @param {string} token - JWT token
   */
  async deleteSession(userId, token = null) {
    const sessionKey = `${SESSION_PREFIX}${userId}`;
    const listKey = this._tokensListKey(userId);

    try {
      // Delete main session
      await redisClient.del(sessionKey);

      // Delete token mapping if provided
      if (token) {
        const tokenKey = `${SESSION_PREFIX}token:${token}`;
        await redisClient.del(tokenKey);
        await redisClient.lrem(listKey, 1, token);
      }

      console.log(`Session deleted for user: ${userId}`);
      return true;
    } catch (error) {
      console.error('Error deleting session:', error);
      return false;
    }
  }

  /**
   * Delete all sessions for a user (force logout from all devices)
   * @param {string} userId - User ID
   */
  async deleteAllSessions(userId) {
    const listKey = this._tokensListKey(userId);
    const sessionKey = `${SESSION_PREFIX}${userId}`;

    try {
      const tokens = await redisClient.lrange(listKey, 0, -1);
      if (tokens && tokens.length) {
        for (const t of tokens) {
          await redisClient.del(`${SESSION_PREFIX}token:${t}`);
        }
      }
      await redisClient.del(listKey);
      await redisClient.del(sessionKey);

      console.log(`All sessions deleted for user: ${userId}`);
      return true;
    } catch (error) {
      console.error('Error deleting all sessions:', error);
      return false;
    }
  }

  /**
   * Check if session exists
   * @param {string} userId - User ID
   */
  async hasSession(userId) {
    const sessionKey = `${SESSION_PREFIX}${userId}`;
    try {
      const exists = await redisClient.exists(sessionKey);
      return exists === 1;
    } catch (error) {
      console.error('Error checking session:', error);
      return false;
    }
  }

  /**
   * Get session TTL remaining
   * @param {string} userId - User ID
   */
  async getSessionTTL(userId) {
    const sessionKey = `${SESSION_PREFIX}${userId}`;
    try {
      return await redisClient.ttl(sessionKey);
    } catch (error) {
      console.error('Error getting session TTL:', error);
      return 0;
    }
  }

  /**
   * Extend session TTL
   * @param {string} userId - User ID
   * @param {number} additionalTime - Additional time in seconds
   */
  async extendSession(userId, additionalTime = SESSION_TTL) {
    const sessionKey = `${SESSION_PREFIX}${userId}`;
    try {
      await redisClient.expire(sessionKey, additionalTime);
      return true;
    } catch (error) {
      console.error('Error extending session:', error);
      return false;
    }
  }

  /**
   * Get all active sessions count (for admin)
   */
  async getActiveSessionsCount() {
    try {
      // Use SCAN to avoid blocking Redis with KEYS
      const pattern = `${SESSION_PREFIX}*`;
      let cursor = '0';
      let count = 0;
      do {
        const reply = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
        if (Array.isArray(reply)) {
          cursor = reply[0];
          const keys = reply[1] || [];
          const sessionKeys = keys.filter(k => !k.includes('token:'));
          count += sessionKeys.length;
        } else if (reply && reply.cursor !== undefined) {
          cursor = reply.cursor;
          const keys = reply.keys || [];
          const sessionKeys = keys.filter(k => !k.includes('token:'));
          count += sessionKeys.length;
        } else {
          break;
        }
      } while (cursor !== '0');

      return count;
    } catch (error) {
      console.error('Error getting active sessions count:', error);
      return 0;
    }
  }

  /**
   * Get all active sessions for a specific user
   * @param {string} userId - User ID
   */
  async getUserSessions(userId) {
    const sessionKey = `${SESSION_PREFIX}${userId}`;
    const listKey = this._tokensListKey(userId);
    
    try {
      // Get main session data
      const sessionData = await redisClient.get(sessionKey);
      const tokens = await redisClient.lrange(listKey, 0, -1);
      
      const session = sessionData ? JSON.parse(sessionData) : null;
      
      // Get TTL for session
      const ttl = await redisClient.ttl(sessionKey);
      
      return {
        active: !!session,
        session: session,
        tokens: tokens || [],
        ttlSeconds: ttl > 0 ? ttl : 0,
        lastActivity: session?.lastActivity || null,
        createdAt: session?.createdAt || null
      };
    } catch (error) {
      console.error('Error getting user sessions:', error);
      return { active: false, session: null, tokens: [], ttlSeconds: 0 };
    }
  }

  /**
   * Get detailed list of all active sessions (for admin)
   */
  async getAllSessionsDetailed(limit = 100) {
    const pattern = `${SESSION_PREFIX}*`;
    let cursor = '0';
    const sessions = [];
    
    try {
      do {
        const reply = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
        if (Array.isArray(reply)) {
          cursor = reply[0];
          const keys = reply[1] || [];
          const sessionKeys = keys.filter(k => !k.includes('token:') && !k.includes('tokens:'));
          
          for (const key of sessionKeys) {
            if (sessions.length >= limit) break;
            
            const userId = key.replace(SESSION_PREFIX, '');
            const sessionData = await redisClient.get(key);
            const ttl = await redisClient.ttl(key);
            
            if (sessionData) {
              const parsed = JSON.parse(sessionData);
              sessions.push({
                userId,
                companyId: parsed.companyId,
                role: parsed.role,
                lastActivity: parsed.lastActivity,
                createdAt: parsed.createdAt,
                ttlSeconds: ttl > 0 ? ttl : 0
              });
            }
          }
        } else if (reply && reply.cursor !== undefined) {
          cursor = reply.cursor;
        } else {
          break;
        }
      } while (cursor !== '0' && sessions.length < limit);
      
      return sessions;
    } catch (error) {
      console.error('Error getting all sessions:', error);
      return [];
    }
  }

  /**
   * Blacklist a token (for immediate logout)
   * @param {string} token - JWT token to blacklist
   * @param {number} expiresIn - Token expiration time in seconds
   */
  async blacklistToken(token, expiresIn = 86400) {
    const blacklistKey = `${TOKEN_BLACKLIST_PREFIX}${token}`;
    try {
      await redisClient.setex(blacklistKey, expiresIn, '1');
      return true;
    } catch (error) {
      console.error('Error blacklisting token:', error);
      return false;
    }
  }

  /**
   * Check if token is blacklisted
   * @param {string} token - JWT token
   */
  async isTokenBlacklisted(token) {
    const blacklistKey = `${TOKEN_BLACKLIST_PREFIX}${token}`;
    try {
      const result = await redisClient.get(blacklistKey);
      return result === '1';
    } catch (error) {
      console.error('Error checking token blacklist:', error);
      return false;
    }
  }

  /**
   * Clean up expired sessions (run periodically)
   */
  async cleanupExpiredSessions() {
    try {
      // Redis handles TTL automatically, but we can log stats
      const info = await redisClient.info('stats');
      console.log('Redis stats:', info);
      return true;
    } catch (error) {
      console.error('Error cleaning up sessions:', error);
      return false;
    }
  }
}

module.exports = new SessionService();
