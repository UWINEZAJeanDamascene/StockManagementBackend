/**
 * Requires X-Company-Id header to match the authenticated user's company (after protect).
 */
function requireCompanyHeader(req, res, next) {
  const raw = req.headers['x-company-id'];
  if (raw == null || String(raw).trim() === '') {
    return res.status(400).json({
      success: false,
      message: 'X-Company-Id header required',
    });
  }
  if (!req.company || req.isPlatformAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Company context required',
    });
  }
  if (String(req.company._id) !== String(raw).trim()) {
    return res.status(403).json({
      success: false,
      message: 'Company mismatch',
    });
  }
  next();
}

module.exports = requireCompanyHeader;
