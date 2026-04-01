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

        // Normalize sku (mapped from 'code' or 'sku' CSV column)
        const sku = record.sku || record.code;
        const normalizedSku = sku ? sku.trim().toUpperCase() : null;

        // Check if already exists by sku
        const existing = await Product.findOne({
          company: companyId,
          sku: normalizedSku
        }).lean();

        if (existing) {
          // Upsert: update existing product if option is set
          if (options.upsert) {
            const updateData = {};
            if (record.name) updateData.name = record.name.trim();
            if (record.description !== undefined) updateData.description = record.description;
            if (categoryId) updateData.category = categoryId;
            if (record.unitOfMeasure || record.unit) updateData.unit = record.unitOfMeasure || record.unit;
            if (record.costPrice !== undefined) updateData.costPrice = record.costPrice;
            if (record.sellingPrice !== undefined) updateData.sellingPrice = record.sellingPrice;
            if (record.costingMethod) updateData.costingMethod = record.costingMethod;
            if (record.reorderPoint !== undefined) updateData.reorderPoint = record.reorderPoint;
            if (record.barcode) updateData.barcode = record.barcode;
            if (record.taxCode) updateData.taxCode = record.taxCode;
            if (record.taxRate !== undefined) updateData.taxRate = record.taxRate;
            if (record.brand) updateData.brand = record.brand;
            if (record.location) updateData.location = record.location;
            if (record.weight !== undefined) updateData.weight = record.weight;

            await Product.findOneAndUpdate(
              { company: companyId, sku: normalizedSku },
              { $set: updateData }
            );
            updated++;
          } else {
            skipped++;
          }
          continue;
        }

        // Build product data matching the expected CSV columns
        const productData = {
          sku: normalizedSku,
          name: record.name ? record.name.trim() : null,
          description: record.description || '',
          category: categoryId,
          unit: record.unitOfMeasure || record.unit || 'pcs',
          currentStock: 0, // Start at 0 for import
          averageCost: record.costPrice || 0,
          costPrice: record.costPrice || 0,
          sellingPrice: record.sellingPrice || 0,
          costingMethod: record.costingMethod || 'fifo',
          reorderPoint: record.reorderPoint || 0,
          isStockable: record.isStockable !== undefined ? record.isStockable : true,
          isActive: true,
          isArchived: false,
          company: companyId,
          createdBy: options.userId || null
        };

        // Optional fields
        if (record.barcode) productData.barcode = record.barcode;
        if (record.barcodeType) productData.barcodeType = record.barcodeType;
        if (record.taxCode) productData.taxCode = record.taxCode;
        if (record.taxRate !== undefined) productData.taxRate = record.taxRate;
        if (record.brand) productData.brand = record.brand;
        if (record.location) productData.location = record.location;
        if (record.weight !== undefined) productData.weight = record.weight;
        if (record.lowStockThreshold !== undefined) productData.lowStockThreshold = record.lowStockThreshold;
        if (record.reorderQuantity !== undefined) productData.reorderQuantity = record.reorderQuantity;

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
              value: normalizedSku
            });
          }
        }

      } catch (err) {
        errors.push({
          row: records.indexOf(record) + 1,
          field: 'product',
          message: err.message,
          value: record.sku || record.code
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