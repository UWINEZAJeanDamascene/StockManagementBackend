const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const CHART_OF_ACCOUNTS = {
  '1000': { name: 'Cash in Hand', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1100': { name: 'Cash at Bank', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1400': { name: 'Inventory', type: 'asset', subtype: 'current', normalBalance: 'debit', allowDirectPosting: true },
  '1700': { name: 'Equipment', type: 'asset', subtype: 'fixed', normalBalance: 'debit', allowDirectPosting: true },
  '2000': { name: 'Accounts Payable', type: 'liability', subtype: 'current', normalBalance: 'credit', allowDirectPosting: true },
  '3000': { name: 'Share Capital', type: 'equity', subtype: 'capital', normalBalance: 'credit', allowDirectPosting: true },
  '3100': { name: 'Retained Earnings', type: 'equity', subtype: 'retained', normalBalance: 'credit', allowDirectPosting: false },
  '4000': { name: 'Sales Revenue', type: 'revenue', subtype: 'operating', normalBalance: 'credit', allowDirectPosting: true },
  '5000': { name: 'Cost of Goods Sold', type: 'cogs', subtype: 'cogs', normalBalance: 'debit', allowDirectPosting: true },
  '5400': { name: 'Salaries & Wages', type: 'expense', subtype: 'operating', normalBalance: 'debit', allowDirectPosting: true },
  '5500': { name: 'Rent', type: 'expense', subtype: 'operating', normalBalance: 'debit', allowDirectPosting: true },
  '5600': { name: 'Utilities', type: 'expense', subtype: 'operating', normalBalance: 'debit', allowDirectPosting: true },
};

const seedProductData = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected...');

    const User = require('../models/User');
    const Category = require('../models/Category');
    const Product = require('../models/Product');
    const Supplier = require('../models/Supplier');
    const Warehouse = require('../models/Warehouse');
    const ChartOfAccount = require('../models/ChartOfAccount');
    const Company = require('../models/Company');

    // Create or get company
    console.log('Creating company...');
    let company = await Company.findOne({ name: 'Test Construction Ltd' });
    if (!company) {
      company = await Company.create({
        name: 'Test Construction Ltd',
        code: 'TCL001',
        email: 'admin@testconstruction.com',
        phone: '+1234567890',
        address: '123 Test Street, Test City',
        isActive: true,
      });
      console.log('Company created:', company._id);
    } else {
      console.log('Company already exists:', company._id);
    }

    // Create chart of accounts for company
    console.log('Creating chart of accounts...');
    const existingAccounts = await ChartOfAccount.countDocuments({ company: company._id });
    if (existingAccounts === 0) {
      const accounts = Object.entries(CHART_OF_ACCOUNTS).map(([code, account]) => ({
        company: company._id,
        code,
        name: account.name,
        type: account.type,
        subtype: account.subtype,
        normal_balance: account.normalBalance,
        allow_direct_posting: account.allowDirectPosting,
        isActive: true,
      }));
      await ChartOfAccount.insertMany(accounts);
      console.log('Chart of accounts seeded');
    } else {
      console.log('Chart of accounts already exists');
    }

    // Create admin user
    console.log('Creating users...');
    let admin = await User.findOne({ email: 'admin@test.com' });
    if (!admin) {
      admin = await User.create({
        name: 'Admin User',
        email: 'admin@test.com',
        password: 'admin123',
        role: 'admin',
        company: company._id,
      });
      console.log('User created:', admin._id);
    } else {
      admin.company = company._id;
      await admin.save();
      console.log('User already exists:', admin._id);
    }

    // Create warehouse
    console.log('Creating warehouse...');
    let warehouse = await Warehouse.findOne({ company: company._id, code: 'WH001' });
    if (!warehouse) {
      warehouse = await Warehouse.create({
        company: company._id,
        name: 'Main Warehouse',
        code: 'WH001',
        isActive: true,
        createdBy: admin._id,
      });
      console.log('Warehouse created:', warehouse._id);
    } else {
      console.log('Warehouse already exists:', warehouse._id);
    }

    // Create categories
    console.log('Creating categories...');
    const categoryData = [
      { name: 'Building Materials', description: 'Construction and building materials' },
      { name: 'Tools & Equipment', description: 'Construction tools and equipment' },
      { name: 'Electrical', description: 'Electrical supplies and components' },
      { name: 'Plumbing', description: 'Plumbing supplies and fixtures' },
      { name: 'Hardware', description: 'General hardware items' },
    ];

    const categories = [];
    for (const cat of categoryData) {
      let existing = await Category.findOne({ company: company._id, name: cat.name });
      if (!existing) {
        existing = await Category.create({
          company: company._id,
          name: cat.name,
          description: cat.description,
          createdBy: admin._id,
        });
      }
      categories.push(existing);
      console.log('Category:', existing.name);
    }

    // Create supplier
    console.log('Creating supplier...');
    let supplier = await Supplier.findOne({ company: company._id, 'contact.email': 'supplies@abc.com' });
    if (!supplier) {
      supplier = await Supplier.create({
        company: company._id,
        name: 'ABC Building Supplies',
        code: 'SUP001',
        contact: {
          phone: '+1234567890',
          email: 'supplies@abc.com',
          address: '123 Main Street',
          city: 'New York',
          country: 'USA',
        },
        paymentTerms: 'credit_30',
        createdBy: admin._id,
      });
      console.log('Supplier created:', supplier._id);
    } else {
      console.log('Supplier already exists:', supplier._id);
    }

    // Create products with accounting accounts
    console.log('Creating products...');
    const productData = [
      {
        name: 'Portland Cement 50kg',
        sku: 'CEM001',
        barcode: '1234567890123',
        barcodeType: 'CODE128',
        description: 'High quality Portland cement in 50kg bags',
        category: categories[0]._id,
        unit: 'bag',
        supplier: supplier._id,
        costPrice: 12.50,
        averageCost: 12.50,
        sellingPrice: 15.99,
        taxCode: 'A',
        taxRate: 0.18,
        lowStockThreshold: 50,
        reorderPoint: 20,
        reorderQuantity: 50,
        costingMethod: 'fifo',
        trackingType: 'none',
        isStockable: true,
        inventoryAccount: '1400',
        cogsAccount: '5000',
        revenueAccount: '4000',
        brand: 'BuildStrong',
        location: 'Aisle A-1',
        weight: 50,
      },
      {
        name: 'Steel Rebar 12mm',
        sku: 'REB012',
        barcode: '1234567890124',
        barcodeType: 'CODE128',
        description: 'Steel reinforcement bars 12mm diameter, 6m length',
        category: categories[0]._id,
        unit: 'pcs',
        supplier: supplier._id,
        costPrice: 8.00,
        averageCost: 8.00,
        sellingPrice: 10.50,
        taxCode: 'A',
        taxRate: 0.18,
        lowStockThreshold: 100,
        reorderPoint: 50,
        reorderQuantity: 200,
        costingMethod: 'fifo',
        trackingType: 'batch',
        isStockable: true,
        inventoryAccount: '1400',
        cogsAccount: '5000',
        revenueAccount: '4000',
        brand: 'SteelCorp',
        location: 'Aisle B-2',
        weight: 15,
      },
      {
        name: 'Power Drill Set',
        sku: 'DRL001',
        barcode: '1234567890125',
        barcodeType: 'CODE128',
        description: 'Professional cordless power drill with accessories',
        category: categories[1]._id,
        unit: 'set',
        supplier: supplier._id,
        costPrice: 45.00,
        averageCost: 45.00,
        sellingPrice: 69.99,
        taxCode: 'A',
        taxRate: 0.18,
        lowStockThreshold: 10,
        reorderPoint: 5,
        reorderQuantity: 15,
        costingMethod: 'avg',
        trackingType: 'none',
        isStockable: true,
        inventoryAccount: '1400',
        cogsAccount: '5000',
        revenueAccount: '4000',
        brand: 'ProTool',
        location: 'Tool Wall',
        weight: 2.5,
      },
      {
        name: 'Electrical Wire 2.5mm',
        sku: 'WIR025',
        barcode: '1234567890126',
        barcodeType: 'CODE128',
        description: 'Electrical copper wire 2.5mm, 100m roll',
        category: categories[2]._id,
        unit: 'roll',
        supplier: supplier._id,
        costPrice: 25.00,
        averageCost: 25.00,
        sellingPrice: 32.50,
        taxCode: 'A',
        taxRate: 0.18,
        lowStockThreshold: 20,
        reorderPoint: 10,
        reorderQuantity: 30,
        costingMethod: 'fifo',
        trackingType: 'none',
        isStockable: true,
        inventoryAccount: '1400',
        cogsAccount: '5000',
        revenueAccount: '4000',
        brand: 'ElecWire',
        location: 'Electrical Aisle',
        weight: 8,
      },
      {
        name: 'PVC Pipe 1 inch',
        sku: 'PVC001',
        barcode: '1234567890127',
        barcodeType: 'CODE128',
        description: 'PVC plumbing pipe 1 inch diameter, 3m length',
        category: categories[3]._id,
        unit: 'pcs',
        supplier: supplier._id,
        costPrice: 5.00,
        averageCost: 5.00,
        sellingPrice: 7.99,
        taxCode: 'A',
        taxRate: 0.18,
        lowStockThreshold: 50,
        reorderPoint: 25,
        reorderQuantity: 100,
        costingMethod: 'fifo',
        trackingType: 'none',
        isStockable: true,
        inventoryAccount: '1400',
        cogsAccount: '5000',
        revenueAccount: '4000',
        brand: 'PipePro',
        location: 'Plumbing Section',
        weight: 2,
      },
    ];

    for (const p of productData) {
      let existing = await Product.findOne({ company: company._id, sku: p.sku });
      if (!existing) {
        const product = await Product.create({
          company: company._id,
          ...p,
          createdBy: admin._id,
        });
        console.log('Product created:', product.name, '- SKU:', product.sku);
      } else {
        // Update existing product with accounting fields
        existing.inventoryAccount = p.inventoryAccount;
        existing.cogsAccount = p.cogsAccount;
        existing.revenueAccount = p.revenueAccount;
        await existing.save();
        console.log('Product updated:', existing.name, '- SKU:', existing.sku);
      }
    }

    // List all products
    console.log('\n=== All Products in Database ===');
    const products = await Product.find({ company: company._id }).populate('category', 'name');
    products.forEach((p) => {
      console.log(`- ${p.name} (SKU: ${p.sku})`);
      console.log(`  Category: ${p.category?.name}`);
      console.log(`  Cost: $${p.averageCost}, Sell: $${p.sellingPrice}`);
      console.log(`  Stock: ${p.currentStock}, Low Threshold: ${p.lowStockThreshold}`);
      console.log(`  Inventory: ${p.inventoryAccount}, COGS: ${p.cogsAccount}, Revenue: ${p.revenueAccount}`);
    });

    console.log('\n✅ Seed data created successfully!');
    console.log('\n📝 Login Credentials:');
    console.log('=====================');
    console.log('Email: admin@test.com');
    console.log('Password: admin123');
    console.log('Company: Test Construction Ltd');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

seedProductData();