/**
 * ProductImportProcessor - Processes product imports
 * Worker Layer: Creates products in database via service layer
 * Uses Product.create() to ensure all business rules apply
 */

const Product = require('../../../models/Product');
const Category = require('../../../models/Category');
const InventoryService = require('../../../services/inventoryService');

class ProductImportProcessor {
  /**
   * Process product import
   * Creates products via model to ensure business rules are applied
   * @param {Array} records - Validated product records
   * @param {string} companyId - Company ID
   * @param {Object} options - Processing options
   * @returns {Object} Import result
   */
  static async process(records, companyId, options = {}) {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    // Get existing categories for mapping
    const categories = await Category.find({ company: companyId }).lean();
    const categoryMap = new Map(categories.map(c => [c.name.toLowerCase(), c._id]));

    for (const record of records) {
      try {
        // Resolve category
        let categoryId = null;
        if (record.categoryName) {
          const categoryName = record.categoryName.toLowerCase().trim();
          categoryId = categoryMap.get(categoryName) || record.categoryId;
          
          // Auto-create category if doesn't exist and categoryId was provided
          if (!categoryId && record.categoryName) {
            const newCategory = await Category.create({
              name: record.categoryName,
              company: companyId,
              description: `Auto-created from import`
            });
            categoryId = newCategory._id;
            categoryMap.set(categoryName, categoryId);
          }
        }

        // Normalize code
        const code = record.code ? record.code.trim().toUpperCase() : null;

        // Check if already exists
        const existing = await Product.findOne({
          company: companyId,
          code: code
        }).lean();

        if (existing) {
          skipped++;
          continue;
        }

        // Build product data matching the expected CSV columns
        const productData = {
          code: code,
          name: record.name ? record.name.trim() : null,
          description: record.description || '',
          category: categoryId,
          unit: record.unitOfMeasure || record.unit || 'piece',
          currentStock: 0, // Start at 0 for import
          averageCost: record.costPrice || 0,
          sellingPrice: record.sellingPrice || 0,
          costingMethod: record.costingMethod || 'fifo',
          reorderPoint: record.reorderPoint || 0,
          isStockable: record.isStockable !== undefined ? record.isStockable : true,
          isActive: true,
          isArchived: false,
          company: companyId
        };

        // Create product using model (ensures all hooks and validation run)
        const product = await Product.create(productData);
        created++;

        // Update initial stock if provided
        if (record.initialStock && record.initialStock > 0) {
          // Use inventory service to add stock
          try {
            await InventoryService.adjustStock({
              companyId,
              productId: product._id,
              quantity: record.initialStock,
              type: 'in',
              reference: 'IMPORT',
              description: 'Initial stock from import'
            });
          } catch (stockError) {
            // Log but don't fail the import
            errors.push({
              row: records.indexOf(record) + 1,
              field: 'stock',
              message: `Created but failed to set initial stock: ${stockError.message}`,
              value: record.code
            });
          }
        }

      } catch (err) {
        errors.push({
          row: records.indexOf(record) + 1,
          field: 'product',
          message: err.message,
          value: record.code
        });
      }
    }

    return {
      created,
      updated,
      skipped,
      errors
    };
  }
}

module.exports = ProductImportProcessor;