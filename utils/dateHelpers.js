/**
 * Date Helpers for Dashboard Services
 * 
 * These helpers are used by every dashboard service.
 * All dates handled as UTC to prevent timezone bugs.
 */

const dateHelpers = {

  // Current month: first day to today
  currentMonth() {
    const now   = new Date()
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const end   = new Date()
    return { start, end }
  },

  // Previous month: first day to last day
  previousMonth() {
    const now   = new Date()
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999))
    return { start, end }
  },

  // Same month last year
  sameMonthLastYear() {
    const now   = new Date()
    const start = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1))
    const end   = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth() + 1, 0, 23, 59, 59, 999))
    return { start, end }
  },

  // Current fiscal year from company settings
  currentFiscalYear(fiscalYearStartMonth) {
    const now        = new Date()
    const month      = now.getUTCMonth() + 1  // 1-indexed
    const year       = now.getUTCFullYear()
    const startYear  = month >= fiscalYearStartMonth ? year : year - 1
    const start      = new Date(Date.UTC(startYear, fiscalYearStartMonth - 1, 1))
    const end        = new Date()
    return { start, end }
  },

  // Last N days from today
  lastNDays(n) {
    const end   = new Date()
    const start = new Date()
    start.setUTCDate(start.getUTCDate() - n)
    start.setUTCHours(0, 0, 0, 0)
    return { start, end }
  },

  // Start of today
  today() {
    const start = new Date()
    start.setUTCHours(0, 0, 0, 0)
    return { start, end: new Date() }
  },

  // Round a number to 2 decimal places — use on EVERY number before returning
  round2(n) {
    if (n === null || n === undefined || isNaN(n)) return 0
    return Math.round(n * 100) / 100
  },

  // Safe division — returns 0 instead of Infinity or NaN
  safeDivide(numerator, denominator) {
    if (!denominator || denominator === 0) return 0
    return numerator / denominator
  },

  // Percentage change between two values
  percentageChange(current, previous) {
    if (!previous || previous === 0) return null
    return Math.round(((current - previous) / Math.abs(previous)) * 100 * 100) / 100
  }
}

module.exports = dateHelpers
