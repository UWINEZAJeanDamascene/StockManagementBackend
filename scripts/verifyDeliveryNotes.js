const mongoose = require('mongoose');

// Set environment
process.env.NODE_ENV = 'development';

// Connection string
const MONGODB_URI = 'mongodb://localhost:27017/stock-management';

// Define minimal schemas inline to avoid model registration issues
const deliveryNoteSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, required: true },
  invoice: { type: mongoose.Schema.Types.ObjectId, required: true },
  client: { type: mongoose.Schema.Types.ObjectId, required: true },
  warehouse: { type: mongoose.Schema.Types.ObjectId, required: true },
  quotation: { type: mongoose.Schema.Types.ObjectId },
  referenceNo: { type: String, uppercase: true },
  deliveryDate: { type: Date, default: Date.now },
  carrier: { type: String },
  trackingNo: { type: String },
  lines: [{
    invoiceLineId: { type: mongoose.Schema.Types.ObjectId },
    product: { type: mongoose.Schema.Types.ObjectId, required: true },
    productName: String,
    productCode: String,
    unit: String,
    orderedQty: { type: Number, default: 0 },
    qtyToDeliver: { type: Number },
    deliveredQty: { type: Number, default: 0 },
    pendingQty: { type: Number, default: 0 },
    unitCost: { type: Number, default: 0 },
    batchId: { type: mongoose.Schema.Types.ObjectId },
    serialNumbers: [{ type: mongoose.Schema.Types.ObjectId }],
    notes: String
  }],
  items: [], // Legacy
  status: { 
    type: String, 
    enum: ['draft', 'confirmed', 'cancelled'],
    default: 'draft'
  },
  notes: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

const DeliveryNote = mongoose.model('DeliveryNote', deliveryNoteSchema);

async function verifyDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 0,
      connectTimeoutMS: 30000,
      heartbeatFrequencyMS: 10000
    });

    console.log('✅ Connected to MongoDB');

    // Count delivery notes
    const count = await DeliveryNote.countDocuments({});
    console.log(`📦 Total delivery notes in database: ${count}`);

    // List all delivery notes
    const notes = await DeliveryNote.find({}).limit(10);
    if (notes.length === 0) {
      console.log('   (none found)');
    } else {
      console.log('   Recent notes:');
      for (const note of notes) {
        console.log(`   - ${note.referenceNo} (status: ${note.status}, invoice: ${note.invoice})`);
      }
    }

    await mongoose.connection.close();
    console.log('\n✅ Verification complete');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error.message);
    await mongoose.connection.close();
    process.exit(1);
  }
}

verifyDB();
