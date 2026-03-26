/**
 * ProductExportBuilder - Builds product export data
 * Worker Layer: Transforms product data for export
 */

const Product = require('../../../models/Product');

class ProductExportBuilder {
  /**
   * Get products for export
   * @param {string} companyId - Company ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Products data
   */
  static async build(companyId, options = {}) {
    const { 
      includeArchived = false,
      category = null,
      lowStockOnly = false 
    } = options;

    const query = { company: companyId };
    
    if (!includeArchived) {
      query.isArchived = false;
    }
    
    if (category) {
      query.category = category;
    }
    
    if (lowStockOnly) {
      query.$expr = { 
        $lte: ['$currentStock', '$lowStockThreshold'] 
      };
    }

    const products = await Product.find(query)
      .populate('category', 'name')
      .populate('supplier', 'name code')
      .lean();

    return this.transform(products);
  }

  /**
   * Transform product data for export
   * @param {Array} products - Raw product data
   * @returns {Array} Transformed data
   */
  static transform(products) {
    return products.map(p => ({
      name: p.name,
      sku: p.sku,
      description: p.description || '',
      category: p.category?.name || '',
      unit: p.unit,
      currentStock: p.currentStock,
      lowStockThreshold: p.lowStockThreshold,
      averageCost: p.averageCost,
      sellingPrice: p.sellingPrice || 0,
      supplier: p.supplier?.name || '',
      supplierCode: p.supplier?.code || '',
      barcode: p.barcode || '',
      barcodeType: p.barcodeType || '',
      taxCode: p.taxCode || '',
      taxRate: p.taxRate || 0,
      reorderPoint: p.reorderPoint || '',
      reorderQuantity: p.reorderQuantity || '',
      weight: p.weight || '',
      brand: p.brand || '',
      location: p.location || '',
      isActive: p.isActive !== false,
      isArchived: p.isArchived === true
    }));
  }

  /**
   * Get column definitions for export
   * @returns {Array} Column definitions
   */
  static getColumns() {
    return [
      { key: 'name', name: 'Name', width: 25 },
      { key: 'sku', name: 'SKU', width: 15 },
      { key: 'description', name: 'Description', width: 30 },
      { key: 'category', name: 'Category', width: 15 },
      { key: 'unit', name: 'Unit', width: 10 },
      { key: 'currentStock', name: 'Current Stock', type: 'number', width: 12 },
      { key: 'lowStockThreshold', name: 'Low Stock Threshold', type: 'number', width: 15 },
      { key: 'averageCost', name: 'Average Cost', type: 'currency', width: 12 },
      { key: 'sellingPrice', name: 'Selling Price', type: 'currency', width: 12 },
      { key: 'supplier', name: 'Supplier', width: 20 },
      { key: 'barcode', name: 'Barcode', width: 15 },
      { key: 'taxRate', name: 'Tax Rate (%)', type: 'number', width: 10 },
      { key: 'brand', name: 'Brand', width: 15 },
      { key: 'location', name: 'Location', width: 15 }
    ];
  }
}

module.exports = ProductExportBuilder;