module.exports = function auditSoftDeletePlugin(schema, options) {
  // Add fields
  schema.add({
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: schema.constructor.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    confirmedBy: { type: schema.constructor.Types.ObjectId, ref: 'User', default: null },
    confirmedAt: { type: Date, default: null }
  });

  // Update timestamps
  schema.pre('save', function (next) {
    this.updatedAt = new Date();
    if (!this.createdAt) this.createdAt = this.updatedAt;
    next();
  });

  // Soft delete helper method
  schema.methods.softDelete = async function (byUser) {
    this.isActive = false;
    this.updatedAt = new Date();
    if (byUser) this.confirmedBy = byUser;
    return this.save();
  };
};
