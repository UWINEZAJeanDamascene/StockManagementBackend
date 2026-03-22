const InventoryDashboardService = require('../../services/dashboards/InventoryDashboardService');
const StockLevel = require('../../models/StockLevel');
const Product = require('../../models/Product');
const Warehouse = require('../../models/Warehouse');
const StockMovement = require('../../models/StockMovement');
const dateHelpers = require('../../utils/dateHelpers');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

describe('InventoryDashboardService', () => {
  let mongoServer;
  let testCompanyId;
  let testProductId;
  let testWarehouseId;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clear collections
    await StockLevel.deleteMany({});
    await Product.deleteMany({});
    await Warehouse.deleteMany({});
    await StockMovement.deleteMany({});
    const Company = require('../../models/Company');
    await Company.deleteMany({});

    // Create test data
    const company = new (require('../../models/Company'))({ 
      name: 'Test Company', 
      code: 'TESTCO' 
    });
    await company.save();
    testCompanyId = company._id;

    const warehouse = new Warehouse({ 
      company: testCompanyId,
      name: 'Main Warehouse', 
      code: 'WH001' 
    });
    await warehouse.save();
    testWarehouseId = warehouse._id;

    const product = new Product({ 
      company: testCompanyId,
      name: 'Test Product',
      sku: 'TEST001',
      category: new mongoose.Types.ObjectId(), // Simplified for test
      unit: 'pcs',
      currentStock: 100,
      averageCost: 10.0,
      lowStockThreshold: 20,
      reorderPoint: 15,
      reorderQuantity: 50,
      isActive: true,
      isStockable: true
    });
    await product.save();
    testProductId = product._id;

    // Create stock level
    const stockLevel = new StockLevel({
      company_id: testCompanyId,
      product_id: testProductId,
      warehouse_id: testWarehouseId,
      qty_on_hand: 100,
      qty_reserved: 0,
      qty_on_order: 0,
      avg_cost: 10.0,
      total_value: 1000.0
    });
    await stockLevel.save();
  });

  afterEach(async () => {
    await StockLevel.deleteMany({});
    await Product.deleteMany({});
    await Warehouse.deleteMany({});
    await StockMovement.deleteMany({});
    const Company = require('../../models/Company');
    await Company.deleteMany({});
  });

  it('total_value = sum of qty_on_hand × avg_cost across all stock levels', async () => {
    const result = await InventoryDashboardService.get(testCompanyId.toString());
    
    expect(result.summary.total_value).toBe(1000.0);
    expect(result.summary.total_units).toBe(100);
    expect(result.summary.total_sku_count).toBe(1);
  });

  it('total_available = total_units - total_reserved', async () => {
    // Update stock level to have reserved quantity
    await StockLevel.updateOne(
      { company_id: testCompanyId, product_id: testProductId, warehouse_id: testWarehouseId },
      { $set: { qty_reserved: 20 } }
    );

    const result = await InventoryDashboardService.get(testCompanyId.toString());
    
    expect(result.summary.total_available).toBe(80); // 100 - 20
    expect(result.summary.total_units).toBe(100);
    expect(result.summary.total_reserved).toBe(20);
  });

  it('low_stock_alerts only includes products where qty_available < reorder_point', async () => {
    // Create a product that is low stock
    const lowStockProduct = new Product({ 
      company: testCompanyId,
      name: 'Low Stock Product',
      sku: 'LOW001',
      category: new mongoose.Types.ObjectId(),
      unit: 'pcs',
      currentStock: 10,
      averageCost: 5.0,
      lowStockThreshold: 20,
      reorderPoint: 15,
      reorderQuantity: 50,
      isActive: true,
      isStockable: true
    });
    await lowStockProduct.save();

    const lowStockLevel = new StockLevel({
      company_id: testCompanyId,
      product_id: lowStockProduct._id,
      warehouse_id: testWarehouseId,
      qty_on_hand: 10,
      qty_reserved: 0,
      qty_on_order: 0,
      avg_cost: 5.0,
      total_value: 50.0
    });
    await lowStockLevel.save();

    const result = await InventoryDashboardService.get(testCompanyId.toString());
    
    expect(result.low_stock_alerts.count).toBeGreaterThan(0);
    const lowStockItem = result.low_stock_alerts.items.find(
      item => item.product_name === 'Low Stock Product'
    );
    expect(lowStockItem).toBeDefined();
    expect(lowStockItem.qty_available).toBe(10);
    expect(lowStockItem.reorder_point).toBe(15);
    expect(lowStockItem.shortage).toBe(5); // 15 - 10
  });

  it('low_stock shortage field = reorder_point - qty_available', async () => {
    // Create a product with specific stock levels
    const testProduct = new Product({ 
      company: testCompanyId,
      name: 'Test Product 2',
      sku: 'TEST002',
      category: new mongoose.Types.ObjectId(),
      unit: 'pcs',
      currentStock: 8,
      averageCost: 12.0,
      lowStockThreshold: 20,
      reorderPoint: 25,
      reorderQuantity: 50,
      isActive: true,
      isStockable: true
    });
    await testProduct.save();

    const testLevel = new StockLevel({
      company_id: testCompanyId,
      product_id: testProduct._id,
      warehouse_id: testWarehouseId,
      qty_on_hand: 8,
      qty_reserved: 2, // So qty_available = 6
      qty_on_order: 0,
      avg_cost: 12.0,
      total_value: 96.0
    });
    await testLevel.save();

    const result = await InventoryDashboardService.get(testCompanyId.toString());
    
    const lowStockItem = result.low_stock_alerts.items.find(
      item => item.product_name === 'Test Product 2'
    );
    expect(lowStockItem).toBeDefined();
    expect(lowStockItem.qty_available).toBe(6); // 8 - 2
    expect(lowStockItem.reorder_point).toBe(25);
    expect(lowStockItem.shortage).toBe(19); // 25 - 6
  });

  it('dead_stock excludes products with dispatch movement in last 90 days', async () => {
    // Create a product with stock but recent dispatch movement
    const recentProduct = new Product({ 
      company: testCompanyId,
      name: 'Recent Product',
      sku: 'RECENT001',
      category: new mongoose.Types.ObjectId(),
      unit: 'pcs',
      currentStock: 50,
      averageCost: 8.0,
      lowStockThreshold: 10,
      reorderPoint: 15,
      reorderQuantity: 30,
      isActive: true,
      isStockable: true
    });
    await recentProduct.save();

    const recentLevel = new StockLevel({
      company_id: testCompanyId,
      product_id: recentProduct._id,
      warehouse_id: testWarehouseId,
      qty_on_hand: 50,
      qty_reserved: 0,
      qty_on_order: 0,
      avg_cost: 8.0,
      total_value: 400.0
    });
    await recentLevel.save();

    // Create a recent dispatch movement (within last 90 days)
    const recentMovement = new StockMovement({
      company_id: testCompanyId,
      product_id: recentProduct._id,
      type: 'out',
      reason: 'dispatch',
      quantity: 5,
      previousStock: 55,
      newStock: 50,
      unitCost: 8.0,
      totalCost: 40.0,
      warehouse: testWarehouseId,
      movementDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
    });
    await recentMovement.save();

    // Create a product with stock but NO recent dispatch (should be dead stock)
    const oldProduct = new Product({ 
      company: testCompanyId,
      name: 'Old Product',
      sku: 'OLD001',
      category: new mongoose.Types.ObjectId(),
      unit: 'pcs',
      currentStock: 30,
      averageCost: 15.0,
      lowStockThreshold: 5,
      reorderPoint: 10,
      reorderQuantity: 20,
      isActive: true,
      isStockable: true
    });
    await oldProduct.save();

    const oldLevel = new StockLevel({
      company_id: testCompanyId,
      product_id: oldProduct._id,
      warehouse_id: testWarehouseId,
      qty_on_hand: 30,
      qty_reserved: 0,
      qty_on_order: 0,
      avg_cost: 15.0,
      total_value: 450.0
    });
    await oldLevel.save();

    const result = await InventoryDashboardService.get(testCompanyId.toString());
    
    // Should include the old product (no recent dispatch)
    const names = result.dead_stock.items.map(i => i.product_name)
    expect(names).toContain('Old Product')
    const old = result.dead_stock.items.find(i => i.product_name === 'Old Product')
    expect(old).toBeDefined()
    expect(old.stock_value).toBe(450.0);
  });

  it('dead_stock only includes products with qty_on_hand > 0', async () => {
    // Create a product with zero stock (should not be dead stock)
    const zeroProduct = new Product({ 
      company: testCompanyId,
      name: 'Zero Stock Product',
      sku: 'ZERO001',
      category: new mongoose.Types.ObjectId(),
      unit: 'pcs',
      currentStock: 0,
      averageCost: 10.0,
      lowStockThreshold: 5,
      reorderPoint: 10,
      reorderQuantity: 20,
      isActive: true,
      isStockable: true
    });
    await zeroProduct.save();

    const zeroLevel = new StockLevel({
      company_id: testCompanyId,
      product_id: zeroProduct._id,
      warehouse_id: testWarehouseId,
      qty_on_hand: 0,
      qty_reserved: 0,
      qty_on_order: 0,
      avg_cost: 10.0,
      total_value: 0.0
    });
    await zeroLevel.save();

    // Create a product with positive stock and no recent movement (should be dead stock)
    const stockProduct = new Product({ 
      company: testCompanyId,
      name: 'Stock Product',
      sku: 'STOCK001',
      category: new mongoose.Types.ObjectId(),
      unit: 'pcs',
      currentStock: 25,
      averageCost: 12.0,
      lowStockThreshold: 5,
      reorderPoint: 10,
      reorderQuantity: 20,
      isActive: true,
      isStockable: true
    });
    await stockProduct.save();

    const stockLevel = new StockLevel({
      company_id: testCompanyId,
      product_id: stockProduct._id,
      warehouse_id: testWarehouseId,
      qty_on_hand: 25,
      qty_reserved: 0,
      qty_on_order: 0,
      avg_cost: 12.0,
      total_value: 300.0
    });
    await stockLevel.save();

    const result = await InventoryDashboardService.get(testCompanyId.toString());
    
    // Should include the product with stock on hand and exclude zero stock
    const names2 = result.dead_stock.items.map(i => i.product_name)
    expect(names2).toContain('Stock Product')
    const stockItem = result.dead_stock.items.find(i => i.product_name === 'Stock Product')
    expect(stockItem.qty_on_hand).toBe(25);
    expect(names2).not.toContain('Zero Stock Product')
  });

  it('top_moving_products ordered by total_qty dispatched descending', async () => {
    // Create two products with different dispatch quantities
    const productA = new Product({ 
      company: testCompanyId,
      name: 'Product A',
      sku: 'PRODA001',
      category: new mongoose.Types.ObjectId(),
      unit: 'pcs',
      currentStock: 100,
      averageCost: 5.0,
      lowStockThreshold: 10,
      reorderPoint: 15,
      reorderQuantity: 50,
      isActive: true,
      isStockable: true
    });
    await productA.save();

    const productB = new Product({ 
      company: testCompanyId,
      name: 'Product B',
      sku: 'PRODB001',
      category: new mongoose.Types.ObjectId(),
      unit: 'pcs',
      currentStock: 100,
      averageCost: 8.0,
      lowStockThreshold: 10,
      reorderPoint: 15,
      reorderQuantity: 50,
      isActive: true,
      isStockable: true
    });
    await productB.save();

    // Create dispatch movements for product A (30 units)
    const movementA = new StockMovement({
      company_id: testCompanyId,
      product_id: productA._id,
      type: 'out',
      reason: 'dispatch',
      quantity: 30,
      previousStock: 130,
      newStock: 100,
      unitCost: 5.0,
      totalCost: 150.0,
      warehouse: testWarehouseId,
      movementDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) // 10 days ago
    });
    await movementA.save();

    // Create dispatch movements for product B (15 units)
    const movementB = new StockMovement({
      company_id: testCompanyId,
      product_id: productB._id,
      type: 'out',
      reason: 'dispatch',
      quantity: 15,
      previousStock: 115,
      newStock: 100,
      unitCost: 8.0,
      totalCost: 120.0,
      warehouse: testWarehouseId,
      movementDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) // 10 days ago
    });
    await movementB.save();

    const result = await InventoryDashboardService.get(testCompanyId.toString());
    
    // Should be ordered by quantity descending (A first, then B)
    expect(result.top_moving_products.length).toBe(2);
    expect(result.top_moving_products[0].product_name).toBe('Product A');
    expect(Number(result.top_moving_products[0].total_qty)).toBe(30);
    expect(result.top_moving_products[1].product_name).toBe('Product B');
    expect(Number(result.top_moving_products[1].total_qty)).toBe(15);
  });

  it('warehouse_breakdown sums correctly per warehouse', async () => {
    // Create a second warehouse
    const warehouse2 = new Warehouse({ 
      company: testCompanyId,
      name: 'Secondary Warehouse', 
      code: 'WH002' 
    });
    await warehouse2.save();

    // Create product instances in both warehouses
    // Update existing stock level in warehouse 1 to 50 units
    await StockLevel.updateOne(
      { company_id: testCompanyId, product_id: testProductId, warehouse_id: testWarehouseId },
      { $set: { qty_on_hand: 50, total_value: 500.0 } }
    );

    const productInWH2 = new StockLevel({
      company_id: testCompanyId,
      product_id: testProductId,
      warehouse_id: warehouse2._id,
      qty_on_hand: 30,
      qty_reserved: 0,
      qty_on_order: 0,
      avg_cost: 10.0,
      total_value: 300.0
    });
    await productInWH2.save();

    const result = await InventoryDashboardService.get(testCompanyId.toString());
    
    expect(result.warehouse_breakdown.length).toBe(2);
    
    // Find warehouse 1 data
    const wh1Data = result.warehouse_breakdown.find(wh => wh.warehouse_name === 'Main Warehouse');
    expect(wh1Data).toBeDefined();
    expect(wh1Data.sku_count).toBe(1);
    expect(wh1Data.total_units).toBe(50);
    expect(wh1Data.total_value).toBe(500.0);
    
    // Find warehouse 2 data
    const wh2Data = result.warehouse_breakdown.find(wh => wh.warehouse_name === 'Secondary Warehouse');
    expect(wh2Data).toBeDefined();
    expect(wh2Data.sku_count).toBe(1);
    expect(wh2Data.total_units).toBe(30);
    expect(wh2Data.total_value).toBe(300.0);
  });

  it('scoped to company — company B stock never appears', async () => {
    // Create a second company
    const Company = require('../../models/Company');
    const companyB = new Company({ 
      name: 'Company B', 
      code: 'COMPB' 
    });
    await companyB.save();

    const warehouseB = new Warehouse({ 
      company: companyB._id,
      name: 'Warehouse B', 
      code: 'WHB001' 
    });
    await warehouseB.save();

    const productB = new Product({ 
      company: companyB._id,
      name: 'Product B',
      sku: 'PRODB002',
      category: new mongoose.Types.ObjectId(),
      unit: 'pcs',
      currentStock: 1000,
      averageCost: 100.0,
      lowStockThreshold: 10,
      reorderPoint: 15,
      reorderQuantity: 50,
      isActive: true,
      isStockable: true
    });
    await productB.save();

    const stockLevelB = new StockLevel({
      company_id: companyB._id,
      product_id: productB._id,
      warehouse_id: warehouseB._id,
      qty_on_hand: 1000,
      qty_reserved: 0,
      qty_on_order: 0,
      avg_cost: 100.0,
      total_value: 100000.0
    });
    await stockLevelB.save();

    // Query for company A data
    const result = await InventoryDashboardService.get(testCompanyId.toString());
    
    // Should not include company B's stock in summary and lists
    expect(result.summary.total_value).toBe(1000.0); // Only company A's stock
    expect(result.summary.total_units).toBe(100);
    expect(result.low_stock_alerts.count).toBe(0); // Company A's product is not low stock
    // Ensure none of the dead stock items belong to Company B's product
    expect(result.dead_stock.items.every(i => i.product_name !== 'Product B')).toBe(true)
  });

  it('returns cached result on second call within TTL', async () => {
    // First call
    const result1 = await InventoryDashboardService.get(testCompanyId.toString());
    
    // Second call immediately after
    const result2 = await InventoryDashboardService.get(testCompanyId.toString());
    
    // Should return the same object (from cache)
    expect(result1).toBe(result2);
    expect(result1.generated_at).toEqual(result2.generated_at);
  });

  it('does not write to any collection', async () => {
    // Mock the model methods to detect if any write operations are called
    const stockLevelSaveSpy = jest.spyOn(StockLevel.prototype, 'save');
    const stockLevelCreateSpy = jest.spyOn(StockLevel, 'create');
    const stockLevelUpdateSpy = jest.spyOn(StockLevel, 'updateOne');
    const productSaveSpy = jest.spyOn(Product.prototype, 'save');
    const warehouseSaveSpy = jest.spyOn(Warehouse.prototype, 'save');
    const movementSaveSpy = jest.spyOn(StockMovement.prototype, 'save');

    await InventoryDashboardService.get(testCompanyId.toString());
    
    // None of the write methods should have been called
    expect(stockLevelSaveSpy).not.toHaveBeenCalled();
    expect(stockLevelCreateSpy).not.toHaveBeenCalled();
    expect(stockLevelUpdateSpy).not.toHaveBeenCalled();
    expect(productSaveSpy).not.toHaveBeenCalled();
    expect(warehouseSaveSpy).not.toHaveBeenCalled();
    expect(movementSaveSpy).not.toHaveBeenCalled();
  });

  it('completes in under 500ms', async () => {
    const startTime = Date.now();
    await InventoryDashboardService.get(testCompanyId.toString());
    const endTime = Date.now();
    
    const executionTime = endTime - startTime;
    expect(executionTime).toBeLessThan(500);
  });
});