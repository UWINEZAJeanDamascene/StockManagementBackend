const tenantContext = require('../lib/tenantContext');

// Mongoose plugin to automatically add { company: companyId } filter to queries
// when a companyId is available in AsyncLocalStorage and when the model schema
// contains a `company` path. Queries can opt-out by setting the query option
// `{ skipTenant: true }` or explicitly providing `{ company: ... }` in the filter.
module.exports = function tenantPlugin(schema) {
  // Helper to get current companyId from async context
  function getCompanyId() {
    try {
      const store = tenantContext.getStore();
      return store && store.companyId ? store.companyId : null;
    } catch (e) {
      return null;
    }
  }

  // Only apply plugin if schema has `company` path
  if (!schema.path('company')) return;

  // Pre hook for query operations
  const preQuery = function () {
    // `this` is the Query
    try {
      const opts = this.getOptions ? this.getOptions() : {};
      if (opts && opts.skipTenant) return;

      // If query already contains company in conditions, don't override
      const conds = this.getQuery ? this.getQuery() : {};
      if (conds && (conds.company || conds['company._id'])) return;

      const companyId = opts.companyId || getCompanyId();
      if (companyId) {
        this.where({ company: companyId });
      }
    } catch (e) {
      // No-op on errors to avoid breaking requests
    }
  };

  schema.pre('find', preQuery);
  schema.pre('findOne', preQuery);
  schema.pre('count', preQuery);
  schema.pre('countDocuments', preQuery);
  schema.pre('findOneAndUpdate', preQuery);
  schema.pre('updateOne', preQuery);
  schema.pre('updateMany', preQuery);
  schema.pre('deleteMany', preQuery);
  schema.pre('deleteOne', preQuery);

  // Aggregate: inject $match at pipeline start
  schema.pre('aggregate', function () {
    try {
      const opts = this.options || {};
      if (opts && opts.skipTenant) return;

      // If pipeline already filters by company, skip
      const pipeline = this.pipeline ? this.pipeline() : [];
      const hasCompanyMatch = pipeline.some(stage => {
        return stage && stage.$match && (stage.$match.company !== undefined || (stage.$match['company._id'] !== undefined));
      });
      if (hasCompanyMatch) return;

      const companyId = opts.companyId || getCompanyId();
      if (companyId) {
        this.pipeline().unshift({ $match: { company: companyId } });
      }
    } catch (e) {
      // ignore
    }
  });
};
