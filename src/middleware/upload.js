/**
 * File Upload Middleware
 * Shared multer configuration for all import endpoints
 * 
 * Rules:
 * - Accept only .csv and .ofx files by MIME type
 * - Maximum file size: 10MB (configurable via MAX_UPLOAD_SIZE env)
 * - Store files in memory buffer
 * - Reject unrecognized file types with 422 error
 */

const multer = require('multer');

// Get max file size from env or default to 10MB
const MAX_SIZE = process.env.MAX_UPLOAD_SIZE 
  ? parseInt(process.env.MAX_UPLOAD_SIZE) 
  : 10 * 1024 * 1024;

// Allowed MIME types
const ALLOWED_MIMES = [
  'text/csv',
  'application/csv',
  'text/plain',
  'application/octet-stream', // Some systems send OFX as this
  'text/ofx'
];

// Allowed extensions
const ALLOWED_EXTENSIONS = ['.csv', '.ofx', '.qif'];

/**
 * Custom file filter for multer
 * Validates MIME type and file extension
 */
const fileFilter = (req, file, cb) => {
  const ext = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));
  
  // Check extension first
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new Error(`Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`), false);
  }
  
  // Check MIME type
  if (!ALLOWED_MIMES.includes(file.mimetype) && !file.mimetype.startsWith('text/')) {
    // Some systems may not set correct MIME type, so allow if extension is valid
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return cb(new Error(`Invalid MIME type: ${file.mimetype}`), false);
    }
  }
  
  cb(null, true);
};

/**
 * Multer configuration - memory storage for processing
 * Files are not written to disk in this phase
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_SIZE
  },
  fileFilter
});

/**
 * Middleware factory for specific import types
 * Returns multer middleware configured for that import
 */
const createUploadMiddleware = (fieldName = 'file') => {
  return upload.single(fieldName);
};

/**
 * Validate uploaded file
 * Call this in route handler after multer middleware
 */
const validateUpload = (req, res, next) => {
  if (!req.file) {
    return res.status(422).json({
      success: false,
      message: 'No file uploaded. Please attach a file.',
      code: 'NO_FILE'
    });
  }

  // Check file is not empty
  if (!req.file.buffer || req.file.buffer.length === 0) {
    return res.status(422).json({
      success: false,
      message: 'Uploaded file is empty',
      code: 'EMPTY_FILE'
    });
  }

  // Check file size
  if (req.file.size > MAX_SIZE) {
    return res.status(422).json({
      success: false,
      message: `File too large. Maximum size: ${MAX_SIZE / 1024 / 1024}MB`,
      code: 'FILE_TOO_LARGE'
    });
  }

  next();
};

module.exports = {
  upload,
  createUploadMiddleware,
  validateUpload,
  MAX_SIZE,
  ALLOWED_EXTENSIONS
};