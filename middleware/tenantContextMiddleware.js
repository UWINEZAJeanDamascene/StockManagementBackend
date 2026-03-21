const jwt = require('jsonwebtoken');
const tenantContext = require('../lib/tenantContext');

// Middleware to populate AsyncLocalStorage with companyId extracted from JWT
// This runs for every request; store may be empty if token missing or invalid.
module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;
  let companyId = null;

  if (authHeader && authHeader.startsWith('Bearer')) {
    const token = authHeader.split(' ')[1];
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload && payload.companyId) companyId = payload.companyId;
    } catch (err) {
      // ignore invalid token here; auth middleware will handle auth
    }
  }

  // Use AsyncLocalStorage run to set store for downstream Mongoose plugin
  tenantContext.run({ companyId }, () => next());
};
