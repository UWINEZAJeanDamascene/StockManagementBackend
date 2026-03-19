const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Product = require('../models/Product');
const StockMovement = require('../models/StockMovement');
const pc = require('../controllers/productController');

(async ()=>{
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri();
  await mongoose.connect(uri, { useNewUrlParser: true });
  try {
    const companyId = new mongoose.Types.ObjectId();
    const prod = await Product.create({ company: companyId, name: 'Debug2', sku: 'DBG2', category: new mongoose.Types.ObjectId(), unit: 'pcs', inventoryAccount: '1400', cogsAccount: '5000', revenueAccount: '4000'});
    await StockMovement.create({ company: prod.company, product: prod._id, type: 'in', reason: 'initial_stock', quantity: 10, previousStock: 0, newStock: 10, performedBy: new mongoose.Types.ObjectId(), warehouse: new mongoose.Types.ObjectId() });

    // build req/res mocks
    const req = { params: { id: String(prod._id) }, user: { company: { _id: companyId } } };
    const res = {
      json: (obj) => { console.log('RES JSON:', JSON.stringify(obj, null, 2)); },
      status: function(code) { this._status = code; return this; },
      send: (x) => console.log('send:', x)
    };

    await pc.getProduct(req, res, (err) => { if (err) console.error('controller next err', err); });
  } catch (err) {
    console.error('script err', err.stack || err);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
})();
