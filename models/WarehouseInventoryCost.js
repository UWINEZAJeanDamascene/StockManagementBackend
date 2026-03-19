const mongoose = require('mongoose');

const warehouseInventoryCostSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  totalQty: { type: mongoose.Schema.Types.Decimal128, default: mongoose.Types.Decimal128.fromString('0') },
  totalValue: { type: mongoose.Schema.Types.Decimal128, default: mongoose.Types.Decimal128.fromString('0') }
}, { timestamps: true });

warehouseInventoryCostSchema.index({ company: 1, warehouse: 1, product: 1 }, { unique: true });

warehouseInventoryCostSchema.methods.getAvgCost = function() {
  const qty = Number(this.totalQty ? this.totalQty.toString() : 0);
  const val = Number(this.totalValue ? this.totalValue.toString() : 0);
  return qty > 0 ? val / qty : 0;
};

warehouseInventoryCostSchema.set('toJSON', {
  transform: (doc, ret) => {
    if (ret.totalQty && ret.totalQty.toString) ret.totalQty = parseFloat(ret.totalQty.toString());
    if (ret.totalValue && ret.totalValue.toString) ret.totalValue = ret.totalValue.toString();
    return ret;
  }
});

module.exports = mongoose.model('WarehouseInventoryCost', warehouseInventoryCostSchema);
