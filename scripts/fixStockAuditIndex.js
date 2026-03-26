/**
 * Script to fix the stockaudits unique index issue
 * 
 * The issue: There's a duplicate key error on items.audit_1_items.product_1 index
 * because it was created without the proper partialFilterExpression.
 * 
 * This script drops the old index and recreates it with the correct filter
 * to only enforce uniqueness when both audit and product are defined.
 * 
 * Usage: 
 *   - Set MONGODB_URI environment variable before running
 *   - Run: node scripts/fixStockAuditIndex.js
 */

const mongoose = require('mongoose');

async function fixStockAuditIndex() {
  try {
    // Get MongoDB URI from environment or use a direct approach
    const dbUri = process.env.MONGODB_URI;
    
    if (!dbUri) {
      console.error('Error: MONGODB_URI environment variable is not set');
      console.log('Please set it and run again:');
      console.log('  Windows: set MONGODB_URI=your_connection_string');
      console.log('  Linux/Mac: export MONGODB_URI=your_connection_string');
      process.exit(1);
    }

    await mongoose.connect(dbUri);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('stockaudits');

    // First, let's see what indexes exist
    console.log('\nCurrent indexes on stockaudits collection:');
    const indexes = await collection.indexes();
    indexes.forEach(idx => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
      if (idx.partialFilterExpression) {
        console.log(`      partialFilterExpression: ${JSON.stringify(idx.partialFilterExpression)}`);
      }
    });

    // Check if there's an index on items.audit and items.product 
    const itemsIndex = indexes.find(idx => 
      idx.name.includes('items.audit') && 
      idx.name.includes('items.product')
    );

    if (itemsIndex) {
      console.log(`\nFound items index: ${itemsIndex.name}`);
      console.log(`Current key: ${JSON.stringify(itemsIndex.key)}`);
      console.log(`Current partialFilterExpression: ${JSON.stringify(itemsIndex.partialFilterExpression)}`);

      // Drop the old index
      console.log(`\nDropping index: ${itemsIndex.name}`);
      await collection.dropIndex(itemsIndex.name);
      console.log('Index dropped');
    } else {
      console.log('\nNo existing items index found.');
    }

    // Create new index with proper partial filter expression
    console.log('\nCreating new index with partialFilterExpression...');
    await collection.createIndex(
      { 'items.audit': 1, 'items.product': 1 },
      {
        unique: true,
        partialFilterExpression: {
          'items.audit': { $exists: true, $ne: null },
          'items.product': { $exists: true, $ne: null }
        }
      }
    );
    console.log('New index created successfully');

    // Verify the new index
    console.log('\nVerifying new indexes:');
    const newIndexes = await collection.indexes();
    newIndexes.forEach(idx => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
      if (idx.partialFilterExpression) {
        console.log(`      partialFilterExpression: ${JSON.stringify(idx.partialFilterExpression)}`);
      }
    });

    console.log('\n✅ StockAudit index fix completed successfully!');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    if (error.codeName === 'IndexNotFound') {
      console.log('\nNote: The index was already removed.');
      console.log('This is fine - the new index will be created when you restart the app.');
    }
    await mongoose.disconnect();
    process.exit(1);
  }
}

fixStockAuditIndex();
