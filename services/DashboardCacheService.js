/**
 * Dashboard Cache Service
 * 
 * In-memory cache for dashboard data.
 * Invalidated when new journal entries are posted.
 * 
 * Do NOT use localStorage, Redis, or any external store in this phase.
 * Simple in-process Map with TTL is sufficient for MVP.
 */

class DashboardCacheService {

  constructor() {
    this.store = new Map()
    // TTL: 60 seconds for most dashboards
    // Shorter for financial data that changes frequently
    this.defaultTTL = 60 * 1000
  }

  _key(companyId, dashboardName, params = '') {
    return `${companyId}:${dashboardName}:${params}`
  }

  /**
   * Get cached dashboard data
   * @param {string} companyId - Company ID
   * @param {string} dashboardName - Name of the dashboard
   * @param {string} params - Optional params string for cache key
   * @returns {object|null} Cached data or null if not found/expired
   */
  get(companyId, dashboardName, params = '') {
    const key  = this._key(companyId, dashboardName, params)
    const item = this.store.get(key)
    if (!item) return null
    if (Date.now() > item.expiresAt) {
      this.store.delete(key)
      return null
    }
    return item.data
  }

  /**
   * Set cached dashboard data
   * @param {string} companyId - Company ID
   * @param {string} dashboardName - Name of the dashboard
   * @param {object} data - Data to cache
   * @param {string} params - Optional params string for cache key
   * @param {number} ttlMs - Optional custom TTL in milliseconds
   */
  set(companyId, dashboardName, data, params = '', ttlMs = null) {
    const key = this._key(companyId, dashboardName, params)
    this.store.set(key, {
      data,
      expiresAt: Date.now() + (ttlMs || this.defaultTTL)
    })
  }

  /**
   * Called by JournalService after every successful post
   * Invalidates all dashboard caches for the company
   * @param {string} companyId - Company ID
   */
  invalidate(companyId) {
    for (const key of this.store.keys()) {
      if (key.startsWith(`${companyId}:`)) {
        this.store.delete(key)
      }
    }
  }

  /**
   * Called when stock levels change
   * Invalidates specific dashboard caches
   * @param {string} companyId - Company ID
   * @param {string} dashboardName - Name of the dashboard to invalidate
   */
  invalidateDashboard(companyId, dashboardName) {
    for (const key of this.store.keys()) {
      if (key.startsWith(`${companyId}:${dashboardName}:`)) {
        this.store.delete(key)
      }
    }
  }

  /**
   * Clear all cached data (useful for testing)
   */
  clearAll() {
    this.store.clear()
  }

  /**
   * Get cache statistics (useful for debugging)
   */
  getStats() {
    return {
      size: this.store.size,
      keys: Array.from(this.store.keys())
    }
  }
}

// Singleton — shared across all requests in the process
const dashboardCache = new DashboardCacheService()
module.exports = dashboardCache
