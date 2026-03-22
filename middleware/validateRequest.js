/**
 * Request validation middleware using express-validator.
 * Use with validationChain; on failure returns 400 with validation errors.
 */
const { validationResult } = require('express-validator');

function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const messages = errors.array().map((e) => e.msg || e.message).filter(Boolean);
  return res.status(422).json({
    success: false,
    message: messages[0] || 'Validation failed',
    code: 'VALIDATION_ERROR',
    errors: errors.array(),
  });
}

module.exports = validateRequest;
