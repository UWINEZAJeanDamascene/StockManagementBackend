const healthService = require('../services/healthService');
const { getHealthReport } = require('../services/accountingHealthService');

const FALLBACK_VERSION = () => {
  const v = process.env.API_VERSION || 'v1';
  return v.startsWith('v') ? v : `v${v}`;
};

// GET /api/health, GET /health
exports.systemHealth = async (req, res) => {
  try {
    const snapshot = await healthService.buildSystemHealthSnapshot();
    const { httpStatus, ...body } = snapshot;
    res.status(httpStatus).json(body);
  } catch (e) {
    res.status(503).json({
      status: 'down',
      version: FALLBACK_VERSION(),
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      database: { status: 'error', ping_ms: 0 },
      memory: { heap_used_mb: 0, heap_total_mb: 0, rss_mb: 0, status: 'ok' },
      cache: { status: 'ok' },
    });
  }
};

// GET /api/health/accounting
exports.accountingHealth = async (req, res, next) => {
  try {
    const companyId = req.company._id;
    const report = await getHealthReport(companyId);
    res.json({
      company_id: String(companyId),
      journal_balanced: !!(report.journal && report.journal.healthy),
      stock_reconciled: !!(report.stock && report.stock.healthy),
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
};
