const multer = require('multer');
const path = require('path');
const fs = require('fs');

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {}
}

function storageFor(type) {
  const dest = path.join(__dirname, '..', 'uploads', type);
  ensureDir(dest);
  return multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, dest);
    },
    filename: function (req, file, cb) {
      const safe = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      cb(null, safe);
    }
  });
}

function uploadFor(type) {
  return multer({
    storage: storageFor(type),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
      // accept common image types
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (allowed.includes(file.mimetype)) return cb(null, true);
      cb(new Error('INVALID_FILE_TYPE'));
    }
  });
}

module.exports = { uploadFor };
