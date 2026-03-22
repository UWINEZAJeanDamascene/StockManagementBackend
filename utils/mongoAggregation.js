/**
 * MongoDB aggregation helpers — maxTimeMS from QUERY_TIMEOUT_MS (and dashboard defaults).
 */

/**
 * @param {'report'|'dashboard'} kind — report/financial: default 10000ms; dashboards: default 5000ms
 * @returns {number}
 */
function getMaxTimeMS(kind = 'report') {
  const raw = process.env.QUERY_TIMEOUT_MS;
  if (raw !== undefined && raw !== '') {
    const v = parseInt(raw, 10);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return kind === 'dashboard' ? 5000 : 10000;
}

/**
 * @param {import('mongoose').Model} model
 * @param {object[]} pipeline
 * @param {'report'|'dashboard'} kind
 * @returns {Promise|import('mongoose').Aggregate} Mongoose Aggregate or thenable — never chain `.option()` here so tests can mock `aggregate(pipeline, opts) => Promise`.
 */
function aggregateWithTimeout(model, pipeline, kind = 'report') {
  const maxTimeMS = getMaxTimeMS(kind);
  return model.aggregate(pipeline, { maxTimeMS });
}

module.exports = {
  getMaxTimeMS,
  aggregateWithTimeout,
};
