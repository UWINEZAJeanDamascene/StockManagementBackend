const mongoose = require('mongoose');
const Backup = require('../models/Backup');
const Company = require('../models/Company');
const User = require('../models/User');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const crypto = require('crypto');
const zlib = require('zlib');

// Get list of all models that can be backed up
const getBackupableCollections = () => {
  return [
    'ActionLog', 'Budget', 'CashDrawer', 'Category', 'Client', 
    'Company', 'CreditNote', 'Department', 'ExchangeRate', 
    'InventoryBatch', 'Invoice', 'InvoiceReceiptMetadata', 'IPWhitelist',
    'Notification', 'NotificationSettings', 'Product', 'Purchase', 
    'Quotation', 'RecurringInvoice', 'ReorderPoint', 'Role',
    'SerialNumber', 'StockAudit', 'StockMovement', 'StockTransfer',
    'Subscription', 'Supplier', 'User', 'Warehouse'
  ];
};

// Get backup directory
const getBackupDir = () => {
  const backupDir = path.join(process.cwd(), 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  return backupDir;
};

// Generate checksum for data integrity
const generateChecksum = (data) => {
  return crypto.createHash('sha256').update(data).digest('hex');
};

// @desc    Get all backups for a company
// @route   GET /api/backups
// @access  Private
exports.getBackups = async (req, res) => {
  try {
    const companyId = req.company._id || req.company;
    
    const backups = await Backup.find({ company: companyId })
      .populate('createdBy', 'name email')
      .populate('verification.verifiedBy', 'name email')
      .populate('restore.restoredBy', 'name email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: backups.length,
      data: backups
    });
  } catch (error) {
    console.error('Error getting backups:', error);
    res.status(500).json({
      success: false,
      message: 'Server error retrieving backups',
      error: error.message
    });
  }
};

// @desc    Get single backup
// @route   GET /api/backups/:id
// @access  Private
exports.getBackup = async (req, res) => {
  try {
    const companyId = req.company._id || req.company;
    
    const backup = await Backup.findOne({ 
      _id: req.params.id, 
      company: companyId 
    })
      .populate('createdBy', 'name email')
      .populate('verification.verifiedBy', 'name email')
      .populate('restore.restoredBy', 'name email');

    if (!backup) {
      return res.status(404).json({
        success: false,
        message: 'Backup not found'
      });
    }

    res.json({
      success: true,
      data: backup
    });
  } catch (error) {
    console.error('Error getting backup:', error);
    res.status(500).json({
      success: false,
      message: 'Server error retrieving backup',
      error: error.message
    });
  }
};

// @desc    Create new backup
// @route   POST /api/backups
// @access  Private (Admin)
exports.createBackup = async (req, res) => {
  try {
    const companyId = req.company._id || req.company;
    const { 
      name, 
      type = 'manual', 
      storageLocation = 'local',
      pointInTime = null,
      collections = getBackupableCollections()
    } = req.body;

    // Create backup record
    const backup = await Backup.create({
      company: companyId,
      name: name || `Backup_${new Date().toISOString().replace(/[:.]/g, '-')}`,
      type,
      status: 'pending',
      storageLocation,
      pointInTime: pointInTime ? new Date(pointInTime) : null,
      createdBy: req.user?._id,
      collections: []
    });

    // Start backup process in background
    performBackup(backup._id, companyId, collections).catch(err => {
      console.error('Backup failed:', err);
    });

    res.status(201).json({
      success: true,
      message: 'Backup initiated successfully',
      data: backup
    });
  } catch (error) {
    console.error('Error creating backup:', error);
    res.status(500).json({
      success: false,
      message: 'Server error creating backup',
      error: error.message
    });
  }
};

// Perform the actual backup
const performBackup = async (backupId, companyId, collections) => {
  const backup = await Backup.findById(backupId);
  if (!backup) return;

  try {
    backup.status = 'in_progress';
    await backup.save();

    const backupData = {
      companyId,
      timestamp: new Date().toISOString(),
      pointInTime: backup.pointInTime,
      collections: []
    };

    const backupDir = getBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `backup_${companyId}_${timestamp}.json.gz`;
    const filePath = path.join(backupDir, fileName);

    // Backup each collection
    for (const collectionName of collections) {
      try {
        const Model = mongoose.model(collectionName);
        let query = { company: companyId };
        
        // If point-in-time recovery, filter by date
        if (backup.pointInTime) {
          query.createdAt = { $lte: backup.pointInTime };
        }

        const documents = await Model.find(query).lean();
        
        backupData.collections.push({
          name: collectionName,
          documentCount: documents.length,
          data: documents
        });
      } catch (err) {
        console.warn(`Could not backup collection ${collectionName}:`, err.message);
        backupData.collections.push({
          name: collectionName,
          documentCount: 0,
          data: [],
          error: err.message
        });
      }
    }

    // Compress and save backup
    const jsonData = JSON.stringify(backupData);
    const compressedData = zlib.gzipSync(Buffer.from(jsonData));
    
    fs.writeFileSync(filePath, compressedData);
    
    const checksum = generateChecksum(compressedData);

    // Update backup record
    backup.status = 'completed';
    backup.filePath = filePath;
    backup.fileSize = compressedData.length;
    backup.mongoVersion = mongoose.version;
    backup.verification.checksum = checksum;
    backup.verification.integrityStatus = 'valid';
    
    // Update collections info
    backup.collections = backupData.collections.map(c => ({
      name: c.name,
      documentCount: c.documentCount
    }));

    await backup.save();

    // If cloud backup is enabled, upload to cloud
    if (backup.storageLocation !== 'local') {
      await uploadToCloud(backup);
    }

    console.log(`Backup ${backupId} completed successfully`);
  } catch (error) {
    console.error('Backup failed:', error);
    backup.status = 'failed';
    backup.errorMessage = error.message;
    await backup.save();
  }
};

// Upload backup to cloud storage
const uploadToCloud = async (backup) => {
  // For now, we'll simulate cloud upload
  // In production, this would integrate with AWS S3, Google Cloud Storage, etc.
  try {
    if (backup.storageLocation === 's3') {
      // Simulate S3 upload (would use AWS SDK in production)
      backup.cloudUrl = `s3://backups/${path.basename(backup.filePath)}`;
    } else if (backup.storageLocation === 'google-drive') {
      // Simulate Google Drive upload
      backup.cloudUrl = `gdrive://backups/${path.basename(backup.filePath)}`;
    } else if (backup.storageLocation === 'dropbox') {
      // Simulate Dropbox upload
      backup.cloudUrl = `dropbox://backups/${path.basename(backup.filePath)}`;
    }
    await backup.save();
  } catch (error) {
    console.error('Cloud upload failed:', error);
  }
};

// @desc    Restore from backup
// @route   POST /api/backups/:id/restore
// @access  Private (Admin)
exports.restoreBackup = async (req, res) => {
  try {
    const companyId = req.company._id || req.company;
    
    const backup = await Backup.findOne({ 
      _id: req.params.id, 
      company: companyId 
    });

    if (!backup) {
      return res.status(404).json({
        success: false,
        message: 'Backup not found'
      });
    }

    if (backup.status !== 'completed' && backup.status !== 'verified') {
      return res.status(400).json({
        success: false,
        message: 'Cannot restore from incomplete or failed backup'
      });
    }

    // Start restore process in background
    performRestore(backup._id, companyId, req.user?._id).catch(err => {
      console.error('Restore failed:', err);
    });

    res.json({
      success: true,
      message: 'Restore process initiated successfully',
      data: backup
    });
  } catch (error) {
    console.error('Error restoring backup:', error);
    res.status(500).json({
      success: false,
      message: 'Server error restoring backup',
      error: error.message
    });
  }
};

// Perform the actual restore
const performRestore = async (backupId, companyId, userId) => {
  const backup = await Backup.findById(backupId);
  if (!backup) return;

  try {
    backup.status = 'restoring';
    backup.restore.restoredAt = new Date();
    backup.restore.restoredBy = userId;
    await backup.save();

    const backupDir = getBackupDir();
    const filePath = backup.filePath;

    if (!fs.existsSync(filePath)) {
      throw new Error('Backup file not found');
    }

    // Read and decompress backup
    const compressedData = fs.readFileSync(filePath);
    const decompressedData = zlib.gunzipSync(compressedData);
    const backupData = JSON.parse(decompressedData.toString());

    // Verify checksum
    const currentChecksum = generateChecksum(compressedData);
    if (currentChecksum !== backup.verification.checksum) {
      throw new Error('Backup file integrity check failed');
    }

    // Restore each collection
    for (const collection of backupData.collections) {
      if (collection.error) continue;
      
      try {
        const Model = mongoose.model(collection.name);
        
        // Delete existing data for this company
        await Model.deleteMany({ company: companyId });
        
        // Insert backup data with new IDs
        if (collection.data && collection.data.length > 0) {
          const newData = collection.data.map(doc => {
            const newDoc = { ...doc };
            newDoc._id = new mongoose.Types.ObjectId();
            newDoc.company = companyId;
            newDoc.createdAt = doc.createdAt ? new Date(doc.createdAt) : new Date();
            newDoc.updatedAt = doc.updatedAt ? new Date(doc.updatedAt) : new Date();
            return newDoc;
          });
          
          await Model.insertMany(newData);
        }
      } catch (err) {
        console.warn(`Could not restore collection ${collection.name}:`, err.message);
      }
    }

    backup.status = 'verified';
    await backup.save();

    console.log(`Restore from backup ${backupId} completed successfully`);
  } catch (error) {
    console.error('Restore failed:', error);
    backup.status = 'failed';
    backup.errorMessage = error.message;
    await backup.save();
  }
};

// @desc    Verify backup integrity
// @route   POST /api/backups/:id/verify
// @access  Private (Admin)
exports.verifyBackup = async (req, res) => {
  try {
    const companyId = req.company._id || req.company;
    
    const backup = await Backup.findOne({ 
      _id: req.params.id, 
      company: companyId 
    });

    if (!backup) {
      return res.status(404).json({
        success: false,
        message: 'Backup not found'
      });
    }

    if (backup.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Can only verify completed backups'
      });
    }

    // Verify backup in background
    performVerification(backup._id, req.user?._id).catch(err => {
      console.error('Verification failed:', err);
    });

    res.json({
      success: true,
      message: 'Backup verification initiated'
    });
  } catch (error) {
    console.error('Error verifying backup:', error);
    res.status(500).json({
      success: false,
      message: 'Server error verifying backup',
      error: error.message
    });
  }
};

// Perform backup verification
const performVerification = async (backupId, userId) => {
  const backup = await Backup.findById(backupId);
  if (!backup) return;

  try {
    const backupDir = getBackupDir();
    const filePath = backup.filePath;

    if (!fs.existsSync(filePath)) {
      backup.verification.integrityStatus = 'missing';
      backup.verification.errorMessage = 'Backup file not found';
      await backup.save();
      return;
    }

    // Read and verify checksum
    const fileData = fs.readFileSync(filePath);
    const currentChecksum = generateChecksum(fileData);

    backup.verification.verified = currentChecksum === backup.verification.checksum;
    backup.verification.verifiedAt = new Date();
    backup.verification.verifiedBy = userId;
    
    if (backup.verification.verified) {
      backup.verification.integrityStatus = 'valid';
      backup.status = 'verified';
    } else {
      backup.verification.integrityStatus = 'corrupted';
      backup.verification.errorMessage = 'Checksum mismatch - backup may be corrupted';
    }

    await backup.save();
    console.log(`Backup ${backupId} verification completed: ${backup.verification.verified}`);
  } catch (error) {
    console.error('Verification failed:', error);
    backup.verification.integrityStatus = 'corrupted';
    backup.verification.errorMessage = error.message;
    await backup.save();
  }
};

// @desc    Delete backup
// @route   DELETE /api/backups/:id
// @access  Private (Admin)
exports.deleteBackup = async (req, res) => {
  try {
    const companyId = req.company._id || req.company;
    
    const backup = await Backup.findOne({ 
      _id: req.params.id, 
      company: companyId 
    });

    if (!backup) {
      return res.status(404).json({
        success: false,
        message: 'Backup not found'
      });
    }

    // Delete local file if exists
    if (backup.filePath && fs.existsSync(backup.filePath)) {
      fs.unlinkSync(backup.filePath);
    }

    await backup.deleteOne();

    res.json({
      success: true,
      message: 'Backup deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting backup:', error);
    res.status(500).json({
      success: false,
      message: 'Server error deleting backup',
      error: error.message
    });
  }
};

// @desc    Get available point-in-time recovery points
// @route   GET /api/backups/points-in-time
// @access  Private
exports.getPointsInTime = async (req, res) => {
  try {
    const companyId = req.company._id || req.company;
    
    const backups = await Backup.find({ 
      company: companyId,
      status: { $in: ['completed', 'verified'] }
    })
      .select('name createdAt pointInTime fileSize collections')
      .sort({ createdAt: -1 })
      .limit(100);

    const pointsInTime = backups.map(b => ({
      id: b._id,
      name: b.name,
      timestamp: b.pointInTime || b.createdAt,
      fileSize: b.fileSize,
      totalDocuments: b.collections.reduce((sum, c) => sum + c.documentCount, 0)
    }));

    res.json({
      success: true,
      data: pointsInTime
    });
  } catch (error) {
    console.error('Error getting points in time:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get backup settings
// @route   GET /api/backups/settings
// @access  Private (Admin)
exports.getBackupSettings = async (req, res) => {
  try {
    const companyId = req.company._id || req.company;
    
    // Get the most recent backup settings or create default
    let settings = await Backup.findOne({ 
      company: companyId,
      'schedule.enabled': true
    }).sort({ createdAt: -1 });

    // Return default settings if none exist
    if (!settings) {
      return res.json({
        success: true,
        data: {
          enabled: false,
          frequency: 'daily',
          retention: 30,
          storageLocation: 'local',
          autoVerify: false
        }
      });
    }

    res.json({
      success: true,
      data: {
        enabled: settings.schedule.enabled,
        frequency: settings.schedule.frequency,
        retention: settings.retention.keepForDays,
        storageLocation: settings.storageLocation,
        autoVerify: settings.retention.autoDelete,
        cloudConfig: settings.cloudConfig
      }
    });
  } catch (error) {
    console.error('Error getting backup settings:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Update backup settings
// @route   PUT /api/backups/settings
// @access  Private (Admin)
exports.updateBackupSettings = async (req, res) => {
  try {
    const companyId = req.company._id || req.company;
    const { 
      enabled,
      frequency,
      retention,
      storageLocation,
      cloudConfig 
    } = req.body;

    // Create or update backup settings
    let backupSettings = await Backup.findOne({ 
      company: companyId,
      type: 'scheduled'
    });

    if (!backupSettings) {
      backupSettings = new Backup({
        company: companyId,
        name: 'Scheduled Backup Settings',
        type: 'scheduled',
        status: 'pending'
      });
    }

    backupSettings.schedule.enabled = enabled || false;
    backupSettings.schedule.frequency = frequency || 'daily';
    backupSettings.retention.keepForDays = retention || 30;
    backupSettings.storageLocation = storageLocation || 'local';
    
    if (cloudConfig) {
      backupSettings.cloudConfig = {
        provider: cloudConfig.provider || 'local',
        bucket: cloudConfig.bucket,
        region: cloudConfig.region
      };
    }

    // Calculate next run based on frequency
    const now = new Date();
    switch (frequency) {
      case 'hourly':
        backupSettings.schedule.nextRun = new Date(now.getTime() + 60 * 60 * 1000);
        backupSettings.schedule.cronExpression = '0 * * * *';
        break;
      case 'daily':
        backupSettings.schedule.nextRun = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        backupSettings.schedule.cronExpression = '0 2 * * *';
        break;
      case 'weekly':
        backupSettings.schedule.nextRun = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        backupSettings.schedule.cronExpression = '0 2 * * 0';
        break;
      case 'monthly':
        backupSettings.schedule.nextRun = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        backupSettings.schedule.cronExpression = '0 2 1 * *';
        break;
    }

    await backupSettings.save();

    res.json({
      success: true,
      message: 'Backup settings updated successfully',
      data: backupSettings
    });
  } catch (error) {
    console.error('Error updating backup settings:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Download backup file
// @route   GET /api/backups/:id/download
// @access  Private (Admin)
exports.downloadBackup = async (req, res) => {
  try {
    const companyId = req.company._id || req.company;
    
    const backup = await Backup.findOne({ 
      _id: req.params.id, 
      company: companyId 
    });

    if (!backup) {
      return res.status(404).json({
        success: false,
        message: 'Backup not found'
      });
    }

    if (!backup.filePath || !fs.existsSync(backup.filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Backup file not found'
      });
    }

    res.download(backup.filePath, path.basename(backup.filePath));
  } catch (error) {
    console.error('Error downloading backup:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get backup statistics
// @route   GET /api/backups/stats
// @access  Private
exports.getBackupStats = async (req, res) => {
  try {
    const companyId = req.company._id || req.company;
    
    const stats = await Backup.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(companyId) } },
      {
        $group: {
          _id: null,
          totalBackups: { $sum: 1 },
          completedBackups: { 
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          verifiedBackups: { 
            $sum: { $cond: [{ $eq: ['$status', 'verified'] }, 1, 0] }
          },
          failedBackups: { 
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          },
          totalSize: { $sum: '$fileSize' },
          lastBackup: { $max: '$createdAt' }
        }
      }
    ]);

    const result = stats[0] || {
      totalBackups: 0,
      completedBackups: 0,
      verifiedBackups: 0,
      failedBackups: 0,
      totalSize: 0,
      lastBackup: null
    };

    res.json({
      success: true,
      data: {
        ...result,
        formattedTotalSize: result.totalSize === 0 ? '0 B' : 
          formatBytes(result.totalSize)
      }
    });
  } catch (error) {
    console.error('Error getting backup stats:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Export for scheduled jobs
module.exports.performBackup = performBackup;
module.exports.performRestore = performRestore;
module.exports.performVerification = performVerification;
