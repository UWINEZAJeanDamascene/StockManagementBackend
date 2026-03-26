/**
 * ProductImportValidator - Validates product import data
 * Worker Layer: Field-level validation for product CSV imports
 * 
 * Expected CSV columns:
 * - code (required, max 50 chars, unique)
 * - name (required)
 * - category_name (optional, resolves to category_id)
 * - unit_of_measure (required)
 * - cost_price (optional, non-negative)
 * - selling_price (optional, non-negative)
 * - costing_method (optional, 'fifo' or 'wac')
 * - reorder_point (optional)
 * - is_stockable (optional, 'true' or 'false')
 */

const Product = require('../../../models/Product');
const Category = require('../../../models/Category');

class ProductImportValidator {
  // Column name mapping (CSV header -> validation field)
  static COLUMN_MAPPING = {
    'code': 'code',
    'sku': 'code', // Alternate name
    'name': 'name',
    'product_name': 'name',
    'category_name': 'categoryName',
    'category': 'categoryName',
    'unit_of_measure': 'unitOfMeasure',
    'unit': 'unitOfMeasure',
    'uom': 'unitOfMeasure',
    'cost_price': 'costPrice',
    'cost': 'costPrice',
    'average_cost': 'costPrice',
    'selling_price': 'sellingPrice',
    'price': 'sellingPrice',
    'selling': 'sellingPrice',
    'costing_method': 'costingMethod',
    'costing': 'costingMethod',
    'method': 'costingMethod',
    'reorder_point': 'reorderPoint',
    'reorder': 'reorderPoint',
    'minimum_stock': 'reorderPoint',
    'is_stockable': 'isStockable',
    'stockable': 'isStockable',
    'track_stock': 'isStockable'
  };

  // Required columns
  static REQUIRED = ['code', 'name', 'unitOfMeasure'];

  // Valid units of measure
  static VALID_UNITS = [
    'piece', 'pcs', 'unit', 'units',
    'kg', 'kilogram', 'kilograms',
    'g', 'gram', 'grams',
    'liter', 'l', 'liters',
    'ml', 'milliliter',
    'meter', 'm', 'meters',
    'cm', 'centimeter',
    'box', 'boxes',
    'pack', 'packs',
    'pallet', 'pallets',
    'roll', 'rolls',
    'set', 'sets',
    'pair', 'pairs',
    'dozen', 'dozens',
    'ton', 'tons'
  ];

  // Valid costing methods
  static COSTING_METHODS = ['fifo', 'wac', 'weighted_average'];

  /**
   * Validate a single product record
   * @param {Object} record - Raw CSV record
   * @param {number} rowNum - Row number for error reporting
   * @param {string} companyId - Company ID for uniqueness checks
   * @returns {Object} Validation result with errors
   */
  static async validate(record, rowNum, companyId) {
    const errors = [];
    const normalized = this.normalize(record);

    // 1. Check code is present and not longer than 50 chars
    if (!normalized.code || normalized.code.trim() === '') {
      errors.push({
        row: rowNum,
        field: 'code',
        message: 'Product code is required',
        value: record.code
      });
    } else if (normalized.code.length > 50) {
      errors.push({
        row: rowNum,
        field: 'code',
        message: 'Product code cannot exceed 50 characters',
        value: normalized.code
      });
    } else {
      // Check uniqueness - code must not already exist for this company
      const existing = await Product.findOne({
        company: companyId,
        code: normalized.code.trim().toUpperCase()
      }).lean();

      if (existing) {
        errors.push({
          row: rowNum,
          field: 'code',
          message: 'Product code already exists for this company',
          value: normalized.code
        });
      }
    }

    // 2. Check name is present
    if (!normalized.name || normalized.name.trim() === '') {
      errors.push({
        row: rowNum,
        field: 'name',
        message: 'Product name is required',
        value: record.name
      });
    }

    // 3. Check category exists in database (if provided)
    if (normalized.categoryName && normalized.categoryName.trim() !== '') {
      const category = await Category.findOne({
        company: companyId,
        name: normalized.categoryName.trim()
      }).lean();

      if (!category) {
        errors.push({
          row: rowNum,
          field: 'category_name',
          message: `Category "${normalized.categoryName}" does not exist`,
          value: record.category_name
        });
      } else {
        normalized.categoryId = category._id;
      }
    }

    // 4. Check unit_of_measure is present
    if (!normalized.unitOfMeasure || normalized.unitOfMeasure.trim() === '') {
      errors.push({
        row: rowNum,
        field: 'unit_of_measure',
        message: 'Unit of measure is required',
        value: record.unit_of_measure
      });
    } else {
      // Validate unit is in allowed list
      const unitLower = normalized.unitOfMeasure.toLowerCase().trim();
      const isValidUnit = this.VALID_UNITS.some(u => u === unitLower);
      if (!isValidUnit) {
        errors.push({
          row: rowNum,
          field: 'unit_of_measure',
          message: `Invalid unit. Use: ${this.VALID_UNITS.slice(0, 5).join(', ')}...`,
          value: record.unit_of_measure
        });
      }
    }

    // 5. Validate cost_price is non-negative
    if (normalized.costPrice !== undefined && normalized.costPrice !== '') {
      const cost = parseFloat(normalized.costPrice);
      if (isNaN(cost) || cost < 0) {
        errors.push({
          row: rowNum,
          field: 'cost_price',
          message: 'Cost price must be a non-negative number',
          value: record.cost_price
        });
      } else {
        normalized.costPrice = cost;
      }
    }

    // 6. Validate selling_price is non-negative
    if (normalized.sellingPrice !== undefined && normalized.sellingPrice !== '') {
      const price = parseFloat(normalized.sellingPrice);
      if (isNaN(price) || price < 0) {
        errors.push({
          row: rowNum,
          field: 'selling_price',
          message: 'Selling price must be a non-negative number',
          value: record.selling_price
        });
      } else {
        normalized.sellingPrice = price;
      }
    }

    // 7. Validate costing_method is either fifo or wac
    if (normalized.costingMethod && normalized.costingMethod.trim() !== '') {
      const methodLower = normalized.costingMethod.toLowerCase().trim();
      if (!this.COSTING_METHODS.includes(methodLower)) {
        errors.push({
          row: rowNum,
          field: 'costing_method',
          message: `Invalid costing method. Use: ${this.COSTING_METHODS.join(', ')}`,
          value: record.costing_method
        });
      } else {
        normalized.costingMethod = methodLower;
      }
    }

    // 8. Validate reorder_point is non-negative
    if (normalized.reorderPoint !== undefined && normalized.reorderPoint !== '') {
      const reorder = parseFloat(normalized.reorderPoint);
      if (isNaN(reorder) || reorder < 0) {
        errors.push({
          row: rowNum,
          field: 'reorder_point',
          message: 'Reorder point must be a non-negative number',
          value: record.reorder_point
        });
      } else {
        normalized.reorderPoint = reorder;
      }
    }

    // 9. Validate is_stockable
    if (normalized.isStockable !== undefined && normalized.isStockable !== '') {
      const stockable = normalized.isStockable.toLowerCase().trim();
      if (!['true', 'false', 'yes', 'no', '1', '0'].includes(stockable)) {
        errors.push({
          row: rowNum,
          field: 'is_stockable',
          message: 'is_stockable must be true/false or yes/no',
          value: record.is_stockable
        });
      } else {
        normalized.isStockable = ['true', 'yes', '1'].includes(stockable);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      data: normalized
    };
  }

  /**
   * Normalize column names
   * @param {Object} record - Raw CSV record
   * @returns {Object} Normalized record
   */
  static normalize(record) {
    const normalized = {};
    for (const [key, value] of Object.entries(record)) {
      const normalizedKey = this.COLUMN_MAPPING[key.toLowerCase().trim()] || key;
      normalized[normalizedKey] = value;
    }
    return normalized;
  }

  /**
   * Validate column headers
   * @param {Array} headers - CSV column headers
   * @returns {Object} Validation result
   */
  static validateHeaders(headers) {
    const normalizedHeaders = headers.map(h => h.toLowerCase().trim());
    
    // Check required columns exist
    const hasCode = normalizedHeaders.includes('code') || normalizedHeaders.includes('sku');
    const hasName = normalizedHeaders.includes('name') || normalizedHeaders.includes('product_name');
    const hasUnit = normalizedHeaders.includes('unit_of_measure') || normalizedHeaders.includes('unit') || normalizedHeaders.includes('uom');

    const missing = [];
    if (!hasCode) missing.push('code');
    if (!hasName) missing.push('name');
    if (!hasUnit) missing.push('unit_of_measure');

    return {
      valid: missing.length === 0,
      message: missing.length === 0 
        ? 'Valid headers' 
        : `Missing required columns: ${missing.join(', ')}`,
      missing,
      columns: normalizedHeaders
    };
  }
}

module.exports = ProductImportValidator;