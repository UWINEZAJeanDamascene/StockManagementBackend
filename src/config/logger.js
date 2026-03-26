/**
 * Centralized Logging Service
 * Uses Winston and supports multiple transports:
 * - Console (development)
 * - File (local)
 * - Cloud (Datadog, Loggly, etc.)
 */

const winston = require('winston');
const path = require('path');

// Import environment config
const env = require('./environment');
const config = env.getConfig();
const loggingConfig = config.logging;
const nodeEnv = config.server.env;

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    if (stack) log += `\n${stack}`;
    // Add extra metadata
    if (Object.keys(meta).length > 0 && meta.constructor === Object) {
      log += ` ${JSON.stringify(meta)}`;
    }
    return log;
  })
);

// Define JSON format for cloud logging
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Build transports array
const transports = [];

// Console transport (all environments)
transports.push(
  new winston.transports.Console({
    format: nodeEnv === 'production' 
      ? winston.format.combine(winston.format.colorize(), logFormat)
      : logFormat,
    level: loggingConfig.level || 'debug',
  })
);

// File transport (development/staging)
if (nodeEnv !== 'production') {
  transports.push(
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'combined.log'),
      maxsize: 5242880,
      maxFiles: 5,
    })
  );
}

// Cloud logging transports
const addCloudTransports = async () => {
  // Datadog (using dd-trace or direct API)
  if (process.env.DATADOG_API_KEY) {
    try {
      const { DatadogTransport } = require('winston-datadog-transport');
      transports.push(
        new DatadogTransport({
          apiKey: process.env.DATADOG_API_KEY,
          serviceName: 'stock-management',
          level: loggingConfig.level,
        })
      );
    } catch (e) {
      console.warn('Datadog transport not available, skipping');
    }
  }

  // Loggly (alternative)
  if (process.env.LOGGLY_TOKEN) {
    transports.push(
      new winston.transports.Loggly({
        token: process.env.LOGGLY_TOKEN,
        subdomain: process.env.LOGGLY_SUBDOMAIN,
        tags: [nodeEnv, 'stock-management'],
        level: loggingConfig.level,
      })
    );
  }

  // HTTP (generic cloud logger)
  if (process.env.LOG_HTTP_ENDPOINT) {
    transports.push(
      new winston.transports.Http({
        endpoint: process.env.LOG_HTTP_ENDPOINT,
        level: loggingConfig.level,
        ssl: true,
      })
    );
  }
};

// Create logger
const logger = winston.createLogger({
  level: loggingConfig.level || 'debug',
  format: logFormat,
  transports,
  exitOnError: false,
});

// Add cloud transports after initialization
addCloudTransports().catch(err => {
  logger.warn('Failed to initialize cloud transports:', err.message);
});

// Stream for Morgan (HTTP logging)
logger.stream = {
  write: (message) => {
    logger.http(message.trim());
  },
};

/**
 * Log HTTP requests with details
 */
logger.logRequest = (req, res, responseTime) => {
  const logData = {
    method: req.method,
    url: req.url,
    status: res.statusCode,
    responseTime: `${responseTime}ms`,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  };
  
  if (res.statusCode >= 500) {
    logger.error('Request failed', logData);
  } else if (res.statusCode >= 400) {
    logger.warn('Request warning', logData);
  } else {
    logger.info('Request', logData);
  }
};

/**
 * Log database queries (when LOG_QUERIES is enabled)
 */
logger.logQuery = (operation, collection, duration) => {
  if (loggingConfig.logQueries) {
    logger.debug(`DB ${operation} on ${collection}`, { duration: `${duration}ms` });
  }
};

/**
 * Create child logger with additional context
 */
logger.child = (meta) => logger.child(meta);

module.exports = logger;
module.exports.stream = logger.stream;
module.exports.logRequest = logger.logRequest;
module.exports.logQuery = logger.logQuery;