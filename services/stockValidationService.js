const Product = require('../models/Product');
const warehouseService = require('./warehouseService');

/**
 * Validate available qty and reserve it.
 * If session provided, operations use that session.
 * Throws an error with code 'ERR_INSUFFICIENT_STOCK' when not enough.
 */
async function reserveForOrder(companyId, productId, qty, warehouseId = null, options = {}) {
  const session = options.session || null;

  if (warehouseId) {
    // Delegate to warehouse service which should support session option
    return warehouseService.reserveStock(companyId, productId, warehouseId, qty, { session });
  }

  // Use Product document to check and update qtyReserved under session
  const prod = await Product.findOne({ _id: productId, company: companyId }).session(session);
  if (!prod) {
    const err = new Error('Product not found');
    err.code = 'ERR_PRODUCT_NOT_FOUND';
    throw err;
  }

  const available = (prod.currentStock || 0) - (prod.qtyReserved || 0);
  if (available < qty) {
    const err = new Error('Insufficient stock');
    err.code = 'ERR_INSUFFICIENT_STOCK';
    throw err;
  }

  prod.qtyReserved = (prod.qtyReserved || 0) + qty;
  await prod.save({ session });
  return prod;
}

module.exports = {
  reserveForOrder
};
