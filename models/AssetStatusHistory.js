/**
 * Asset Status History Model
 *
 * Tracks all status changes for fixed assets.
 * Required for audit trails and lifecycle reporting.
 */

const mongoose = require('mongoose');

const assetStatusHistorySchema = new mongoose.Schema({
  // Company reference
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },

  // Asset reference
  asset: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FixedAsset',
    required: true,
    index: true
  },

  // Status transition
  fromStatus: {
    type: String,
    enum: [
      'in_transit',
      'in_service',
      'under_maintenance',
      'idle',
      'fully_depreciated',
      'disposed'
    ],
    required: true
  },
  toStatus: {
    type: String,
    enum: [
      'in_transit',
      'in_service',
      'under_maintenance',
      'idle',
      'fully_depreciated',
      'disposed'
    ],
    required: true
  },

  // When the change occurred
  changedAt: {
    type: Date,
    default: Date.now
  },

  // Who made the change
  changedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Reason for change
  reason: {
    type: String,
    maxlength: 500,
    default: null
  },

  // Additional notes
  notes: {
    type: String,
    maxlength: 1000,
    default: null
  },

  // For certain transitions, supporting documents
  supportingDocumentUrl: {
    type: String,
    default: null
  },

  // Location/department at time of change
  locationAtChange: {
    type: String,
    default: null
  },
  departmentIdAtChange: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null
  },

  // Custodian at time of change
  custodianIdAtChange: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  // System metadata
  ipAddress: {
    type: String,
    default: null
  },
  userAgent: {
    type: String,
    default: null
  }
});

// Indexes
assetStatusHistorySchema.index({ company: 1, asset: 1, changedAt: -1 });
assetStatusHistorySchema.index({ company: 1, fromStatus: 1, toStatus: 1 });
assetStatusHistorySchema.index({ asset: 1, toStatus: 1 });
assetStatusHistorySchema.index({ changedAt: -1 });

// Static method to get asset timeline
assetStatusHistorySchema.statics.getAssetTimeline = async function(assetId) {
  return this.find({ asset: assetId })
    .sort({ changedAt: 1 })
    .populate('changedBy', 'name email')
    .populate('departmentIdAtChange', 'name')
    .populate('custodianIdAtChange', 'name');
};

// Static method to get status duration statistics
assetStatusHistorySchema.statics.getStatusDurationStats = async function(assetId) {
  const history = await this.find({ asset: assetId }).sort({ changedAt: 1 });

  const durations = {};
  let lastChange = null;

  for (const record of history) {
    if (lastChange) {
      const duration = record.changedAt - lastChange.changedAt;
      const status = lastChange.toStatus;
      durations[status] = (durations[status] || 0) + duration;
    }
    lastChange = record;
  }

  // Add current status duration
  if (lastChange) {
    const now = new Date();
    const duration = now - lastChange.changedAt;
    const status = lastChange.toStatus;
    durations[status] = (durations[status] || 0) + duration;
  }

  // Convert milliseconds to days
  const days = {};
  for (const [status, ms] of Object.entries(durations)) {
    days[status] = Math.round(ms / (1000 * 60 * 60 * 24));
  }

  return days;
};

const AssetStatusHistory = mongoose.model('AssetStatusHistory', assetStatusHistorySchema);

module.exports = AssetStatusHistory;
