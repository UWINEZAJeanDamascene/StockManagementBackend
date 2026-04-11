const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const hpp = require('hpp');
const morgan = require('morgan');

// Load environment variables FIRST, before any other imports
dotenv.config();

const connectDB = require('./config/database');
const errorHandler = require('./middleware/errorHandler');

// Redis caching layer
const { redisClient } = require('./config/redis');
const { createRateLimiters } = require('./middleware/redisRateLimiter');
const { sessionMiddleware } = require('./middleware/cacheMiddleware');

// Import centralized configuration (now dotenv has been loaded)
const env = require('./src/config/environment');
const config = env.getConfig();

// Get commonly used config values
const NODE_ENV = config.server.env;
const PORT = config.server.port;
const CORS_ORIGINS = config.server.corsOrigins;

// Connect to MongoDB
connectDB();

// Register tenant plugin before models are loaded so all models inherit it
const mongoose = require('mongoose');
// Determine if running under tests (Jest sets JEST_WORKER_ID, and tests may set NODE_ENV='test')
const isTestEnv = (NODE_ENV === 'test') || !!process.env.JEST_WORKER_ID;
// During tests, disable automatic index creation to avoid long-running index builds
if (isTestEnv) {
  try {
    mongoose.set('autoIndex', false);
  } catch (e) {
    console.warn('Could not set mongoose autoIndex:', e && e.message ? e.message : e);
  }
}
try {
  const tenantPlugin = require('./plugins/tenantPlugin');
  mongoose.plugin(tenantPlugin);
} catch (e) {
  console.warn('Tenant plugin could not be registered:', e && e.message ? e.message : e);
}

// Load all models to ensure they're registered with mongoose
require('./models/IPWhitelist');
require('./models/Role');
require('./models/SystemSettings');
require('./models/Backup');
require('./models/FixedAsset');
require('./models/AuditLog');
require('./models/JournalEntryLine');
require('./models/RefreshToken');
require('./models/UserSession');
require('./models/AssetCategory');
require('./models/Loan');
require('./models/PrecomputedAggregation');
require('./models/Expense');
require('./models/PayrollRun');
require('./models/PurchaseReturn');
require('./models/Testimonial');
require('./models/DeliveryNote');
require('./models/PettyCash');
require('./models/BankAccount');
require('./models/Encumbrance');
require('./models/BudgetLine');
require('./models/StockTransfer');
require('./models/StockTransferLine');
require('./models/StockBatch');
require('./models/StockSerialNumber');
require('./models/SalesOrder');
require('./models/PickPack');
require('./models/ARTransactionLedger');
require('./src/models/ImportJob');

const app = express();

// Security middleware — XSS, clickjacking, MIME sniffing protection
app.use(helmet({
  contentSecurityPolicy: NODE_ENV === 'production',
  crossOriginEmbedderPolicy: false
}));

// Tenant context middleware (sets per-request companyId for tenant plugin)
const tenantContextMiddleware = require('./middleware/tenantContextMiddleware');
app.use(tenantContextMiddleware);

// Health checks — mounted before /api rate limits (must stay unthrottled)
const healthController = require('./controllers/healthController');
const { protect } = require('./middleware/auth');
const requireCompanyHeader = require('./middleware/requireCompanyHeader');
app.get('/api/health', healthController.systemHealth);
app.get('/health', healthController.systemHealth);
app.get('/api/health/accounting', protect, requireCompanyHeader, healthController.accountingHealth);

// Rate limiting with Redis (distributed)
const rateLimiters = createRateLimiters();
app.use('/api/auth', rateLimiters.auth);
app.use('/api/v1/auth', rateLimiters.auth);
app.use('/api/', rateLimiters.api);

// CORS - Production: use CORS_ORIGINS env (comma-separated). Dev: allow localhost/vercel/render.
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // Allow no-origin (server-to-server)

    const isDevelopment = NODE_ENV === 'development';
    const isTest = NODE_ENV === 'test';

    // In development/test mode, allow common dev origins
    if (isDevelopment || isTest || !NODE_ENV || NODE_ENV === 'undefined') {
      if (origin.includes('localhost')) return callback(null, true);
      if (origin.includes('vercel.app')) return callback(null, true);
      if (origin.includes('render.com')) return callback(null, true);
    }

    // Check environment variable whitelist (production only)
    const explicitOrigins = CORS_ORIGINS;

    if (explicitOrigins.length > 0 && explicitOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Hardcoded production whitelist (exact matches only in production)
    const hardcoded = [
      'https://stock-management-frontend.vercel.app',
      'https://your-frontend.vercel.app',
      'https://stock-frontend-topaz-alpha.vercel.app',
      'https://stock-management-v3rl.onrender.com',
      'https://stock-tenancy-bnd.vercel.app',
      'https://stock-tenancy-system.onrender.com'
    ];
    if (hardcoded.includes(origin)) return callback(null, true);

    // Block all other origins
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
};
app.use(cors(corsOptions));

// Response compression (gzip/deflate); skip tiny payloads and health checks
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.path === '/health' || req.path === '/api/health') return false;
    return compression.filter(req, res);
  }
}));

// Body parser - increased limit for CSV imports
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded files
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Cookie parser (needed for httpOnly cookie sessions)
app.use(cookieParser());

// HTTP Parameter Pollution — last duplicate query key wins (single scalar)
app.use(hpp());

// Input sanitisation — strip dangerous chars (after body parsed)
const sanitizeInput = require('./middleware/sanitizeInput');
app.use(sanitizeInput);

// Session management with Redis
app.use(sessionMiddleware);

// Logging
if (NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// API versioning — mount at /api/v1 (primary) and /api (backward compat)
const apiRouter = express.Router();

apiRouter.use('/auth', require('./routes/authRoutes'));
apiRouter.use('/companies', require('./routes/companyRoutes'));
apiRouter.use('/users', require('./routes/userRoutes'));
apiRouter.use('/products', require('./routes/productRoutes'));
apiRouter.use('/categories', require('./routes/categoryRoutes'));
apiRouter.use('/suppliers', require('./routes/supplierRoutes'));
apiRouter.use('/clients', require('./routes/clientRoutes'));
apiRouter.use('/stock', require('./routes/stockRoutes'));
apiRouter.use('/stock/warehouses', require('./routes/warehouseRoutes'));
apiRouter.use('/stock/advanced', require('./routes/advancedStockRoutes'));
apiRouter.use('/quotations', require('./routes/quotationRoutes'));
apiRouter.use('/sales-orders', require('./routes/salesOrderRoutes'));
apiRouter.use('/pick-packs', require('./routes/pickPackRoutes'));
apiRouter.use('/sales-invoices', require('./routes/invoiceRoutes'));
apiRouter.use('/purchases', require('./routes/purchaseRoutes'));
apiRouter.use('/pos', require('./routes/posRoutes'));
apiRouter.use('/sales-legacy', require('./routes/salesLegacyRoutes'));
apiRouter.use('/reports', require('./routes/reportRoutes'));
apiRouter.use('/dashboard', require('./routes/dashboard.routes'));
apiRouter.use('/dashboard', require('./routes/dashboardRoutes'));
apiRouter.use('/currencies', require('./routes/currencyRoutes'));
apiRouter.use('/exchange-rates', require('./routes/exchangeRateRoutes'));
apiRouter.use('/access', require('./routes/advancedAccessRoutes'));
apiRouter.use('/recurring-templates', require('./routes/recurringInvoiceRoutes'));
apiRouter.use('/recurring-invoices', require('./routes/recurringInvoiceRoutes'));
apiRouter.use('/subscriptions', require('./routes/subscriptionRoutes'));
apiRouter.use('/credit-notes', require('./routes/creditNoteRoutes'));
apiRouter.use('/notifications', require('./routes/notificationRoutes'));
apiRouter.use('/backups', require('./routes/backupRoutes'));
apiRouter.use('/fixed-assets', require('./routes/fixedAssetRoutes'));
apiRouter.use('/asset-categories', require('./routes/assetCategoryRoutes'));
apiRouter.use('/loans', require('./routes/loanRoutes'));
apiRouter.use('/budgets', require('./routes/budgetRoutes'));
apiRouter.use('/taxes', require('./routes/taxRoutes'));
apiRouter.use('/payroll', require('./routes/payrollRoutes'));
apiRouter.use('/payroll-runs', require('./routes/payrollRunRoutes'));
apiRouter.use('/expenses', require('./routes/expenseRoutes'));
apiRouter.use('/petty-cash', require('./routes/pettyCashRoutes'));
apiRouter.use('/bank-accounts', require('./routes/bankAccountRoutes'));
apiRouter.use('/purchase-returns', require('./routes/purchaseReturnRoutes'));
apiRouter.use('/payables', require('./routes/payableRoutes'));
apiRouter.use('/ar', require('./routes/arRoutes'));
apiRouter.use('/ar-reconciliation', require('./routes/arReconciliationRoutes'));
apiRouter.use('/ap', require('./routes/apRoutes'));
apiRouter.use('/ap-reconciliation', require('./routes/apReconciliationRoutes'));
apiRouter.use('/delivery-notes', require('./routes/deliveryNoteRoutes'));
apiRouter.use('/departments', require('./routes/departmentRoutes'));
apiRouter.use('/bulk', require('./routes/bulkDataRoutes'));
apiRouter.use('/audit-trail', require('./routes/auditTrailRoutes'));
apiRouter.use('/chat', require('./routes/chatRoutes'));
apiRouter.use('/journal-entries', require('./routes/journalRoutes'));
apiRouter.use('/accounting', require('./routes/accountingRoutes'));
apiRouter.use('/account-mappings', require('./routes/accountMappingRoutes'));
apiRouter.use('/chart-of-accounts', require('./routes/chartOfAccountsRoutes'));
apiRouter.use('/reconciliation', require('./routes/reconciliationRoutes'));
apiRouter.use('/gl-financials', require('./routes/glFinancialRoutes'));
apiRouter.use('/stock-transfers', require('./routes/stockTransferRoutes'));
apiRouter.use('/stock-audits', require('./routes/stockAuditRoutes'));
apiRouter.use('/batches', require('./routes/stockBatchRoutes'));
apiRouter.use('/serial-numbers', require('./routes/stockSerialNumberRoutes'));
apiRouter.use('/periods', require('./routes/periodRoutes'));
apiRouter.use('/settings', require('./routes/settingsRoutes'));
apiRouter.use('/opening-balances', require('./routes/openingBalanceRoutes'));
apiRouter.use('/audit-logs', require('./routes/auditRoutes'));

// Import/Export routes (PHASE 5)
apiRouter.use('/import', require('./src/routes/v1/import.routes'));
apiRouter.use('/export', require('./src/routes/v1/export.routes'));

app.use('/api', apiRouter);
app.use('/api/v1', apiRouter);

// Test-only upload endpoint (no auth) to validate upload middleware and storage
// NOTE: This is temporary for debugging; remove or protect in production.
try {
  const { uploadFor } = require('./middleware/upload');
  app.post('/api/test/upload/avatar', uploadFor('users').single('avatar'), (req, res) => {
    if (!req.file) return res.status(422).json({ success: false, message: 'No file uploaded' });
    return res.json({ success: true, path: `/uploads/users/${req.file.filename}` });
  });
} catch (e) {
  console.warn('Could not register test upload route:', e && e.message ? e.message : e);
}

// Admin: Reset rate limit for IP (for testing)
app.post('/admin/reset-rate-limit', async (req, res) => {
  try {
    const { resetRateLimit } = require('./middleware/redisRateLimiter');
    const ip = req.body.ip || req.ip;
    const result = await resetRateLimit(ip, 'ratelimit:auth');
    res.json({ success: result, message: `Rate limit reset for IP: ${ip}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Root route
app.get('/', (req, res) => {
  res.status(200).json({ 
    status: 'OK',
    message: 'Stock Management System API',
    endpoints: [
      '/api/auth',
      '/api/companies',
      '/api/users',
      '/api/products',
      '/api/categories',
      '/api/suppliers',
      '/api/clients',
      '/api/stock',
      '/api/quotations',
      '/api/invoices',
      '/api/reports',
      '/api/dashboard',
      '/api/exchange-rates',
      '/health',
      '/api/health'
    ]
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: 'Route not found' 
  });
});

// Error handler
app.use(errorHandler);

// Start background schedulers and workers (skip during tests and in Jest workers)
// Jest sets NODE_ENV='test' and also sets JEST_WORKER_ID; guard both to be safe.
if (!(NODE_ENV === 'test' || process.env.JEST_WORKER_ID)) {
  // Start recurring scheduler (non-blocking)
  try {
    const { startScheduler } = require('./services/recurringService');
    startScheduler();
  } catch (err) {
    console.warn('Could not start recurring invoice scheduler', err);
  }

  // Start notification scheduler (payment reminders, low-stock, summaries)
  try {
    const notify = require('./services/notificationScheduler');
    notify.startScheduler();
  } catch (err) {
    console.warn('Could not start recurring invoice scheduler', err);
  }

  // Start backup scheduler (automated backups, verification)
  try {
    const backupScheduler = require('./services/backupScheduler');
    backupScheduler.startBackupScheduler();
  } catch (err) {
    console.warn('Could not start backup scheduler', err);
  }

  // Start report scheduler (snapshot generation for weekly/monthly/quarterly/etc.)
  try {
    const reportScheduler = require('./services/reportSchedulerService');
    if (reportScheduler && typeof reportScheduler.initializeScheduler === 'function') {
      reportScheduler.initializeScheduler(app);
      console.log('Report scheduler initialized');
    }
  } catch (err) {
    console.warn('Could not initialize report scheduler', err && err.message ? err.message : err);
  }

  // Initialize Background Job Queue (BullMQ)
  // Runs nightly aggregations, report generation, email notifications
  try {
    const { initializeWorkers } = require('./services/jobWorkers');
    const { setupScheduledJobs } = require('./services/jobQueue');
    
    // Initialize workers to process background jobs
    initializeWorkers();
    
    // Setup scheduled jobs (nightly aggregations)
    setupScheduledJobs();
    
    console.log('Background job system initialized');
  } catch (err) {
    console.warn('Could not initialize job queue:', err.message || err);
  }
}

// Verify email server connection (non-blocking)
try {
  // Skip verifying external email connection during tests to avoid hangs
  if (!isTestEnv) {
    const { testConnection } = require('./config/email');
    testConnection();
  }
} catch (err) {
  console.warn('Could not verify email server:', err.message || err);
}

let server;
if (NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    console.log(`Server running in ${NODE_ENV} mode on port ${PORT}`);
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use.`);
      // Try next port once
      const fallbackPort = Number(PORT) + 1;
      console.log(`Attempting to listen on port ${fallbackPort} instead...`);
      server.close();
      app.listen(fallbackPort, () => {
        console.log(`Server running in ${NODE_ENV} mode on port ${fallbackPort}`);
      }).on('error', (e) => {
        console.error('Failed to bind to fallback port:', e.message);
        process.exit(1);
      });
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
}

// Attach server reference to app for test teardown
if (server) {
  app._server = server;
}

// Provide a graceful shutdown helper for tests and runtime
app.shutdown = async () => {
  try {
    // Close HTTP server if running
    if (app._server && typeof app._server.close === 'function') {
      await new Promise((resolve, reject) => {
        app._server.close((err) => (err ? reject(err) : resolve()));
      });
    }

    // Close mongoose connection
    try {
      const mongoose = require('mongoose');
      if (mongoose && mongoose.connection && mongoose.connection.readyState) {
        await mongoose.connection.close();
      }
    } catch (e) {
      console.warn('Error closing mongoose connection during shutdown', e && e.message ? e.message : e);
    }

    // Close Redis client if available
    try {
      const { redisClient } = require('./config/redis');
      if (redisClient) {
        if (typeof redisClient.quit === 'function') await redisClient.quit();
        else if (typeof redisClient.disconnect === 'function') await redisClient.disconnect();
        else if (typeof redisClient.close === 'function') await redisClient.close();
      }
    } catch (e) {
      console.warn('Error closing Redis client during shutdown', e && e.message ? e.message : e);
    }
  } catch (err) {
    console.error('Error during app.shutdown()', err && err.message ? err.message : err);
  }
};
// Initialize Socket.io for real-time notifications
try {
  // Avoid initializing socket.io during tests (it can create listeners/handles)
  if (!isTestEnv) {
    const socketService = require('./services/socketService');
    socketService.init(server);
  }
} catch (err) {
  console.warn('Could not initialize socket service', err.message || err);
}

module.exports = app;
