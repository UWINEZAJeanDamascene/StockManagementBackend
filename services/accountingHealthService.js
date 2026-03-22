const JournalEntry = require('../models/JournalEntry');
const InventoryBatch = require('../models/InventoryBatch');
const Product = require('../models/Product');
const { aggregateWithTimeout } = require('../utils/mongoAggregation');

async function getJournalTotals(companyId) {
  const jeAgg = await aggregateWithTimeout(JournalEntry, [
    { $match: { company: companyId, status: 'posted' } },
    { $group: { _id: null, totalDebit: { $sum: '$totalDebit' }, totalCredit: { $sum: '$totalCredit' }, count: { $sum: 1 } } }
  ]);
  const jeTotals = jeAgg && jeAgg.length ? jeAgg[0] : { totalDebit: 0, totalCredit: 0, count: 0 };
  const diff = (jeTotals.totalDebit || 0) - (jeTotals.totalCredit || 0);
  return { totals: jeTotals, difference: diff, healthy: Math.abs(diff) < 0.01 };
}

async function getStockDiscrepancies(companyId) {
  const batchAgg = await aggregateWithTimeout(InventoryBatch, [
    { $match: { company: companyId } },
    { $group: { _id: '$product', totalAvailable: { $sum: '$availableQuantity' }, batches: { $sum: 1 } } },
    { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
    { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
    { $project: { productId: '$_id', totalAvailable: 1, batches: 1, currentStock: '$product.currentStock', name: '$product.name' } }
  ]);

  const productsWithStock = await Product.find({ company: companyId, currentStock: { $ne: null, $ne: 0 } }).select('_id currentStock name').lean();
  const batchMap = new Map();
  batchAgg.forEach(b => batchMap.set(String(b.productId), b));

  const discrepancies = [];
  batchAgg.forEach(entry => {
    const pid = entry.productId ? String(entry.productId) : null;
    const currentStock = (entry.currentStock || 0);
    const totalAvailable = (entry.totalAvailable || 0);
    const diff = Number(currentStock) - Number(totalAvailable);
    if (Math.abs(diff) > 0.0001) {
      discrepancies.push({ productId: pid, name: entry.name || null, currentStock: Number(currentStock), totalAvailable: Number(totalAvailable), difference: Number(diff) });
    }
  });

  productsWithStock.forEach(p => {
    const pid = String(p._id);
    if (!batchMap.has(pid)) {
      const currentStock = (p.currentStock || 0);
      if (Math.abs(Number(currentStock)) > 0.0001) {
        discrepancies.push({ productId: pid, name: p.name || null, currentStock: Number(currentStock), totalAvailable: 0, difference: Number(currentStock) });
      }
    }
  });

  return { discrepancies, discrepanciesCount: discrepancies.length, healthy: discrepancies.length === 0, checked: batchAgg.length + productsWithStock.length };
}

async function getHealthReport(companyId) {
  const journal = await getJournalTotals(companyId);
  const stock = await getStockDiscrepancies(companyId);
  return {
    healthy: journal.healthy && stock.healthy,
    journal,
    stock
  };
}

module.exports = { getJournalTotals, getStockDiscrepancies, getHealthReport };
