const mongoose = require('mongoose');
require('dotenv').config();

async function testControllerMethods() {
  try {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) {
      console.error('MONGODB_URI not defined');
      process.exit(1);
    }
    await mongoose.connect(uri);
    console.log('Connected to DB');

    // Load all required modules as server does
    // Server model loading (subset)
    require('../models/GoodsReceivedNote');
    require('../models/Purchase');
    require('../models/APTransactionLedger');
    require('../models/APPayment');
    require('../models/APPaymentAllocation');
    require('../models/ARTransactionLedger');
    require('../models/ARReceipt');
    require('../models/ARReceiptAllocation');
    require('../models/ARBadDebtWriteoff');
    require('../models/CreditNote');
    require('../models/Client');
    require('../models/Invoice');
    require('../models/Supplier');
    // ... other models loaded by server but not needed for these tests

    // Now load controllers
    const apReconciliationController = require('../controllers/apReconciliationController');
    const arReconciliationController = require('../controllers/arReconciliationController');

    // Get a valid company ID from DB
    const Company = require('../models/Company');
    const company = await Company.findOne({});
    const companyId = company._id;
    console.log('Using company:', companyId);

    // Build mock request for AP
    const mockReq = {
      user: {
        company: { _id: companyId } // simulate populated company doc
      },
      query: {}
    };
    const mockRes = {
      json: (data) => { console.log('AP response:', JSON.stringify(data).substring(0, 500)); }
    };
    const next = (err) => { if (err) console.error('AP error:', err); };

    console.log('\n--- Calling AP getTransactions ---');
    await apReconciliationController.getTransactions(mockReq, mockRes, next);

    // AR
    const mockReq2 = {
      user: {
        company: { _id: companyId }
      },
      query: {}
    };
    const mockRes2 = {
      json: (data) => { console.log('\nAR response:', JSON.stringify(data).substring(0, 500)); }
    };
    const next2 = (err) => { if (err) console.error('AR error:', err); };

    console.log('\n--- Calling AR getTransactions ---');
    await arReconciliationController.getTransactions(mockReq2, mockRes2, next2);

    console.log('\nDone.');
    process.exit(0);
  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  }
}

testControllerMethods();
