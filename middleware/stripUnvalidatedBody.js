const { matchedData } = require('express-validator');

/**
 * Replace req.body with only fields that were declared in express-validator chains.
 * Run after validateRequest. Keeps optional fields that were sent and valid.
 */
function stripUnvalidatedBody(req, res, next) {
  if (!req.body || typeof req.body !== 'object') {
    return next();
  }
  const data = matchedData(req, { locations: ['body'], onlyValidData: true });
  req.body = { ...data };
  next();
}

module.exports = stripUnvalidatedBody;
