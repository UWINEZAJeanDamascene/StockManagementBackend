/**
 * Attaches req.companyId for multi-tenant dashboard and report routes.
 * Must run after auth middleware that sets req.user (and req.isPlatformAdmin).
 */
function attachCompanyId (req, res, next) {
  if (req.isPlatformAdmin) {
    return res.status(400).json({
      success: false,
      message: 'Platform admin should use platform-specific endpoints'
    })
  }
  const c = req.user && req.user.company
  if (!c) {
    return res.status(401).json({
      success: false,
      message: 'Company context required'
    })
  }
  req.companyId = (c._id != null ? c._id : c).toString()
  next()
}

module.exports = { attachCompanyId }
