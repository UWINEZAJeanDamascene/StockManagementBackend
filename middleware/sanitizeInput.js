/**
 * Input sanitisation — strip HTML/script-like fragments, Mongo-style keys, and
 * dangerous characters from string inputs. Applied to req.body, req.query, req.params.
 */
const DANGEROUS_PATTERN = /[<>'"`;\\\x00-\x08\x0b\x0c\x0e-\x1f]/g;
const HTML_TAG_PATTERN = /<[^>]*>/g;

function sanitizeKey(key) {
  if (typeof key !== 'string') return key;
  return key.replace(/\$/g, '_');
}

function sanitize(obj) {
  if (obj == null) return obj;
  if (typeof obj === 'string') {
    let s = obj.replace(HTML_TAG_PATTERN, '');
    return s.replace(DANGEROUS_PATTERN, '');
  }
  if (Array.isArray(obj)) {
    return obj.map((v) => sanitize(v));
  }
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const newKey = sanitizeKey(k);
      // Skip sanitization for avatar/logo fields and data URLs to avoid
      // corrupting base64 data URIs (e.g., "data:image/png;base64,...").
      const lowerKey = String(newKey).toLowerCase();
      if ((lowerKey === 'avatar' || lowerKey === 'logo' || lowerKey === 'logo_url' || lowerKey === 'avatar_url') && typeof v === 'string') {
        out[newKey] = v; // store raw value
      } else {
        out[newKey] = sanitize(v);
      }
    }
    return out;
  }
  return obj;
}

function sanitizeInput(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitize(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitize(req.query);
  }
  if (req.params && typeof req.params === 'object') {
    req.params = sanitize(req.params);
  }
  next();
}

module.exports = sanitizeInput;
