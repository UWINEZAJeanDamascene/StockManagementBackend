/**
 * Sentry Error Monitoring Setup
 * Integrates with the centralized configuration system
 */

const Sentry = require('@sentry/node');
const env = require('./environment');

const config = env.getConfig();
const nodeEnv = config.server.env;

// Only initialize Sentry if DSN is provided
if (config.logging.sentryDsn) {
  Sentry.init({
    dsn: config.logging.sentryDsn,
    environment: nodeEnv,
    
    // Performance monitoring
    tracesSampleRate: nodeEnv === 'production' ? 0.1 : 1.0,
    
    // Release tracking (auto-detect from git or package.json)
    release: process.env.GIT_SHA || require('../../package.json').version,
    
    // Filter out common non-errors
    filters: [
      {
        type: 'transaction',
        mechanism: { type: 'middleware', handled: false },
      },
    ],
    
    // Additional options
    attachStacktrace: nodeEnv !== 'production',
    sendDefaultPii: false, // Don't send PII in production
    
    // Integration adjustments
    integrations: (integrations) => {
      // Remove default integrations that might cause noise
      return integrations.filter(integration => 
        ['OnUnhandledRejection', 'OnCaughtException'].includes(integration.name)
      );
    },
  });
  
  console.log(`📝 Sentry initialized for ${nodeEnv} environment`);
}

/**
 * Create a Sentry error handler middleware for Express
 */
const sentryErrorHandler = () => {
  return (err, req, res, next) => {
    // Only send to Sentry if it's an error
    if (err) {
      Sentry.captureException(err, {
        extra: {
          method: req.method,
          url: req.originalUrl,
          headers: req.headers,
          body: req.body,
          query: req.query,
        },
      });
    }
    next(err);
  };
};

/**
 * Create a Sentry request handler middleware for Express
 */
const sentryRequestHandler = () => {
  return (req, res, next) => {
    // Add transaction to scope for performance monitoring
    const transaction = Sentry.startTransaction({
      op: `${req.method} ${req.path}`,
      name: `${req.method} ${req.originalUrl}`,
    });
    
    // Store transaction in request for use in response handler
    req.sentryTransaction = transaction;
    
    // End transaction when response finishes
    res.on('finish', () => {
      transaction.setHttpStatus(res.statusCode);
      transaction.finish();
    });
    
    next();
  };
};

module.exports = {
  Sentry,
  sentryErrorHandler,
  sentryRequestHandler,
};

// Helper to capture errors from anywhere
const captureError = (error, context = {}) => {
  if (config.logging.sentryDsn) {
    Sentry.captureException(error, { extra: context });
  }
};

module.exports.captureError = captureError;