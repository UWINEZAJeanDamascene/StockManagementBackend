const mongoose = require('mongoose');

const inventoryLayerSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  qtyReceived: { type: Number, required: true, min: 0 },
  qtyRemaining: { type: Number, required: true, min: 0 },
  unitCost: { type: Number, required: true, min: 0 },
  receiptDate: { type: Date, default: Date.now },
  sourceRef: {
    sourceType: { type: String },
    sourceId: { type: mongoose.Schema.Types.ObjectId }
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId },
  createdAt: { type: Date, default: Date.now }
});

inventoryLayerSchema.index({ company: 1, product: 1, receiptDate: 1 });

const InventoryLayer = mongoose.model('InventoryLayer', inventoryLayerSchema);

module.exports = InventoryLayer;
