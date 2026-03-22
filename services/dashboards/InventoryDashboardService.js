const mongoose = require('mongoose');
const { aggregateWithTimeout } = require('../../utils/mongoAggregation');
const StockLevel = require('../../models/StockLevel');
const StockMovement = require('../../models/StockMovement');
const dateHelpers = require('../../utils/dateHelpers');
const dashboardCache = require('../DashboardCacheService');

/** No outbound movement (dispatch/transfer out) in this window ⇒ treated as dead stock */
const DEAD_STOCK_LOOKBACK_DAYS = 90
const TOP_MOVING_WINDOW_DAYS = 30
const RECENT_MOVEMENTS_LIMIT = 10

class InventoryDashboardService {

  static async get(companyId) {
    const cached = dashboardCache.get(companyId, 'inventory')
    if (cached) return cached

    const [
      stockSummary,
      lowStockAlerts,
      deadStock,
      topMovingProducts,
      warehouseBreakdown,
      recentMovements
    ] = await Promise.all([
      InventoryDashboardService._getStockSummary(companyId),
      InventoryDashboardService._getLowStockAlerts(companyId),
      InventoryDashboardService._getDeadStock(companyId),
      InventoryDashboardService._getTopMovingProducts(companyId, 5),
      InventoryDashboardService._getWarehouseBreakdown(companyId),
      InventoryDashboardService._getRecentMovements(companyId, RECENT_MOVEMENTS_LIMIT)
    ])

    const deadSince = dateHelpers.lastNDays(DEAD_STOCK_LOOKBACK_DAYS).start
    const movingWindow = dateHelpers.lastNDays(TOP_MOVING_WINDOW_DAYS)

    const result = {
      company_id:   companyId,
      generated_at: new Date(),
      date_context: {
        dead_stock_no_dispatch_since: deadSince,
        dead_stock_lookback_days:       DEAD_STOCK_LOOKBACK_DAYS,
        top_moving_window_start:        movingWindow.start,
        top_moving_window_end:          movingWindow.end,
        top_moving_window_days:         TOP_MOVING_WINDOW_DAYS,
        recent_movements_limit:         RECENT_MOVEMENTS_LIMIT
      },
      summary:      stockSummary,
      low_stock_alerts: {
        count: lowStockAlerts.length,
        items: lowStockAlerts
      },
      dead_stock: {
        count:       deadStock.length,
        total_value: dateHelpers.round2(
          deadStock.reduce((s, p) => s + p.stock_value, 0)
        ),
        items: deadStock
      },
      top_moving_products:  topMovingProducts,
      warehouse_breakdown:  warehouseBreakdown,
      recent_movements:     recentMovements
    }

    dashboardCache.set(companyId, 'inventory', result)
    return result
  }

  static async _getStockSummary(companyId) {
    const result = await aggregateWithTimeout(StockLevel, [
      {
        $match: {
          company_id: new mongoose.Types.ObjectId(companyId)
        }
      },
      {
        $lookup: {
          from:         'products',
          localField:   'product_id',
          foreignField: '_id',
          as:           'product'
        }
      },
      { $unwind: '$product' },
      {
        $match: {
          $and: [
            { $or: [ { 'product.isActive': true }, { 'product.is_active': true } ] },
            { $or: [ { 'product.isStockable': true }, { 'product.is_stockable': true } ] },
            { $or: [ { 'product.company': new mongoose.Types.ObjectId(companyId) }, { 'product.company_id': new mongoose.Types.ObjectId(companyId) } ] }
          ]
        }
      },
      {
        $group: {
          _id:              null,
          total_sku_count:  { $sum: 1 },
          total_units:      { $sum: '$qty_on_hand' },
          total_value:      { $sum: { $multiply: ['$qty_on_hand', '$avg_cost'] } },
          total_reserved:   { $sum: '$qty_reserved' },
          // Count SKUs with positive stock
          in_stock_count:   {
            $sum: { $cond: [{ $gt: ['$qty_on_hand', 0] }, 1, 0] }
          },
          // Count SKUs at zero
          zero_stock_count: {
            $sum: { $cond: [{ $lte: ['$qty_on_hand', 0] }, 1, 0] }
          }
        }
      }
    ], 'dashboard')

    const s = result[0] || {}
    return {
      total_sku_count:  s.total_sku_count  || 0,
      total_units:      dateHelpers.round2(s.total_units  || 0),
      total_value:      dateHelpers.round2(s.total_value  || 0),
      total_reserved:   dateHelpers.round2(s.total_reserved || 0),
      total_available:  dateHelpers.round2((s.total_units || 0) - (s.total_reserved || 0)),
      in_stock_count:   s.in_stock_count   || 0,
      zero_stock_count: s.zero_stock_count || 0
    }
  }

  static async _getLowStockAlerts(companyId) {
    // Products where qty_available < product.reorder_point
    const results = await aggregateWithTimeout(StockLevel, [
      {
        $match: {
          company_id: new mongoose.Types.ObjectId(companyId)
        }
      },
      {
        $addFields: {
          qty_available: { $subtract: ['$qty_on_hand', '$qty_reserved'] }
        }
      },
      {
        $lookup: {
          from:         'products',
          localField:   'product_id',
          foreignField: '_id',
          as:           'product'
        }
      },
      { $unwind: '$product' },
      {
        $lookup: {
          from:         'warehouses',
          localField:   'warehouse_id',
          foreignField: '_id',
          as:           'warehouse'
        }
      },
      { $unwind: { path: '$warehouse', preserveNullAndEmptyArrays: true } },
      {
        $match: {
          $and: [
            { $or: [ { 'product.isActive': true }, { 'product.is_active': true } ] },
            { $or: [ { 'product.isStockable': true }, { 'product.is_stockable': true } ] },
            { $or: [ { 'product.company': new mongoose.Types.ObjectId(companyId) }, { 'product.company_id': new mongoose.Types.ObjectId(companyId) } ] },
            // qty_available < product.reorder_point
            { $expr: { $lt: ['$qty_available', { $ifNull: ['$product.reorderPoint', '$product.reorder_point'] }] } }
          ]
        }
      },
      {
        $project: {
          product_id:     '$product._id',
          product_code:   { $ifNull: ['$product.code', '$product.sku'] },
          product_name:   '$product.name',
          warehouse_id:   '$warehouse._id',
          warehouse_name: '$warehouse.name',
          qty_on_hand:    { $round: ['$qty_on_hand', 4] },
          qty_reserved:   { $round: ['$qty_reserved', 4] },
          qty_available:  { $round: ['$qty_available', 4] },
          reorder_point:  { $toDouble: { $ifNull: ['$product.reorderPoint', '$product.reorder_point'] } },
          reorder_qty:    { $ifNull: ['$product.reorderQuantity', '$product.reorder_qty'] },
          // How far below reorder point
          shortage:       {
            $round: [
              { $subtract: [ { $toDouble: { $ifNull: ['$product.reorderPoint', '$product.reorder_point'] } }, { $toDouble: '$qty_available' } ] },
              4
            ]
          }
        }
      },
      { $sort: { shortage: -1 } }  // Most urgent first
    ], 'dashboard')

    return results
  }

  static async _getDeadStock(companyId) {
    // Products with stock on hand but no dispatch movement in lookback window
    const ninetyDaysAgo = dateHelpers.lastNDays(DEAD_STOCK_LOOKBACK_DAYS).start

    // Get all products that had a dispatch movement in that window
    const matchForActive = {
      $and: [
        { $or: [ { company: new mongoose.Types.ObjectId(companyId) }, { company_id: new mongoose.Types.ObjectId(companyId) }, { company: companyId }, { company_id: companyId } ] },
        { $or: [ { reason: { $in: ['dispatch', 'transfer_out'] } }, { type: { $in: ['dispatch', 'transfer_out', 'out'] } } ] },
        { $or: [ { movementDate: { $gte: ninetyDaysAgo } }, { created_at: { $gte: ninetyDaysAgo } } ] }
      ]
    }

    // Use find to collect product/product_id values (more tolerant to field naming)
    const moves = await StockMovement.find(matchForActive).lean()
    const rawIds = (moves || []).map(m => m.product || m.product_id).filter(Boolean)
    const activeProductIds = Array.from(new Set(rawIds.map(id => (id && id._bsontype) ? id : (mongoose.Types.ObjectId(id)))))

    // Find stock levels with stock on hand but not in the active list
    const results = await aggregateWithTimeout(StockLevel, [
      {
        $match: {
          company_id:  new mongoose.Types.ObjectId(companyId),
          qty_on_hand: { $gt: 0 },
          product_id:  { $nin: activeProductIds }
        }
      },
      {
        $lookup: {
          from:         'products',
          localField:   'product_id',
          foreignField: '_id',
          as:           'product'
        }
      },
      { $unwind: '$product' },
      {
        $match: {
          $and: [
            { $or: [ { 'product.isActive': true }, { 'product.is_active': true } ] },
            { $or: [ { 'product.isStockable': true }, { 'product.is_stockable': true } ] },
            { $or: [ { 'product.company': new mongoose.Types.ObjectId(companyId) }, { 'product.company_id': new mongoose.Types.ObjectId(companyId) } ] }
          ]
        }
      },
      {
        $project: {
          product_id:   '$product._id',
          product_code: '$product.code',
          product_name: '$product.name',
          qty_on_hand:  { $round: ['$qty_on_hand', 4] },
          avg_cost:     { $round: ['$avg_cost', 6] },
          stock_value:  {
            $round: [{ $multiply: ['$qty_on_hand', '$avg_cost'] }, 2]
          },
          days_no_movement: DEAD_STOCK_LOOKBACK_DAYS  // Minimum — actual could be longer
        }
      },
      { $sort: { stock_value: -1 } },  // Highest value dead stock first
      { $limit: 20 }
    ], 'dashboard')

    return results
  }

  static async _getTopMovingProducts(companyId, limit) {
    const thirtyDays = dateHelpers.lastNDays(TOP_MOVING_WINDOW_DAYS)

    const results = await aggregateWithTimeout(StockMovement, [
      {
        $match: {
          $and: [
            { $or: [ { company: new mongoose.Types.ObjectId(companyId) }, { company_id: new mongoose.Types.ObjectId(companyId) }, { company: companyId }, { company_id: companyId } ] },
            { $or: [ { reason: 'dispatch' }, { type: 'out' }, { movement_type: 'dispatch' } ] },
            { $or: [ { movementDate: { $gte: thirtyDays.start, $lte: thirtyDays.end } }, { created_at: { $gte: thirtyDays.start, $lte: thirtyDays.end } } ] }
          ]
        }
      },
      {
        $group: {
          _id:         { $ifNull: ['$product', '$product_id'] },
          total_qty:   { $sum: { $ifNull: ['$quantity', { $ifNull: ['$qty', 0] }] } },
          total_value: { $sum: { $ifNull: ['$totalCost', { $ifNull: ['$total_cost', 0] }] } },
          move_count:  { $sum: 1 }
        }
      },
      { $sort: { total_qty: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from:         'products',
          localField:   '_id',
          foreignField: '_id',
          as:           'product'
        }
      },
      { $unwind: '$product' },
      {
        $project: {
          product_id:   '$_id',
          product_code: { $ifNull: ['$product.code', '$product.sku'] },
          product_name: '$product.name',
          total_qty:    { $toDouble: { $round: ['$total_qty', 4] } },
          total_value:  { $toDouble: { $round: ['$total_value', 2] } },
          move_count:   1
        }
      }
    ], 'dashboard')

    return results
  }

  static async _getWarehouseBreakdown(companyId) {
    const results = await aggregateWithTimeout(StockLevel, [
      {
        $match: {
          company_id: new mongoose.Types.ObjectId(companyId)
        }
      },
      {
        $lookup: {
          from:         'products',
          localField:   'product_id',
          foreignField: '_id',
          as:           'product'
        }
      },
      { $unwind: '$product' },
      {
        $match: {
          $and: [
            { $or: [ { 'product.isActive': true }, { 'product.is_active': true } ] },
            { $or: [ { 'product.isStockable': true }, { 'product.is_stockable': true } ] }
          ]
        }
      },
      {
        $group: {
          _id:         '$warehouse_id',
          sku_count:   { $sum: 1 },
          total_units: { $sum: '$qty_on_hand' },
          total_value: {
            $sum: { $multiply: ['$qty_on_hand', '$avg_cost'] }
          }
        }
      },
      {
        $lookup: {
          from:         'warehouses',
          localField:   '_id',
          foreignField: '_id',
          as:           'warehouse'
        }
      },
      { $unwind: '$warehouse' },
      {
        $project: {
          warehouse_id:   '$_id',
          warehouse_name: '$warehouse.name',
          warehouse_code: '$warehouse.code',
          sku_count:      1,
          total_units:    { $round: ['$total_units', 4] },
          total_value:    { $round: ['$total_value', 2] }
        }
      },
      { $sort: { total_value: -1 } }
    ], 'dashboard')

    return results
  }

  static async _getRecentMovements(companyId, limit) {
    const companyOid = new mongoose.Types.ObjectId(companyId)

    return aggregateWithTimeout(StockMovement, [
      {
        $match: {
          $or: [{ company: companyOid }, { company_id: companyOid }]
        }
      },
      { $sort: { movementDate: -1, createdAt: -1 } },
      { $limit: limit },
      {
        $addFields: {
          _pid: { $ifNull: ['$product', '$product_id'] },
          _wid: { $ifNull: ['$warehouse', '$warehouse_id'] }
        }
      },
      {
        $lookup: {
          from: 'products',
          localField: '_pid',
          foreignField: '_id',
          as: '_prod'
        }
      },
      { $unwind: { path: '$_prod', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'warehouses',
          localField: '_wid',
          foreignField: '_id',
          as: '_wh'
        }
      },
      { $unwind: { path: '$_wh', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          type: 1,
          reason: 1,
          quantity: 1,
          qty: 1,
          unitCost: 1,
          unit_cost: 1,
          totalCost: 1,
          total_cost: 1,
          movementDate: 1,
          createdAt: 1,
          created_at: 1,
          product: 1,
          product_id: 1,
          warehouse: 1,
          warehouse_id: 1,
          referenceNumber: 1,
          referenceType: 1,
          product_name: '$_prod.name',
          product_code: { $ifNull: ['$_prod.code', '$_prod.sku'] },
          warehouse_name: '$_wh.name',
          warehouse_code: '$_wh.code'
        }
      }
    ], 'dashboard')
  }
}

module.exports = InventoryDashboardService