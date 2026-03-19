const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Product = require('../models/Product');
const StockMovement = require('../models/StockMovement');

(async ()=>{
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri();
  await mongoose.connect(uri, { useNewUrlParser: true });
  try {
    const companyId = new mongoose.Types.ObjectId();
    const prod = await Product.create({ company: companyId, name: 'Debug', sku: 'DBG', category: new mongoose.Types.ObjectId(), unit: 'pcs', inventoryAccount: '1400', cogsAccount: '5000', revenueAccount: '4000'});
    await StockMovement.create({ company: prod.company, product: prod._id, type: 'in', reason: 'initial_stock', quantity: 10, previousStock: 0, newStock: 10, performedBy: new mongoose.Types.ObjectId(), warehouse: new mongoose.Types.ObjectId() });
    await StockMovement.create({ company: prod.company, product: prod._id, type: 'in', reason: 'purchase', quantity: 5, previousStock: 10, newStock: 15, performedBy: new mongoose.Types.ObjectId(), warehouse: new mongoose.Types.ObjectId() });

    const agg = await StockMovement.aggregate([
      { $match: { company: companyId, product: prod._id } },
      { $project: { warehouse: 1, quantity: 1, type: 1 } },
      { $group: {
          _id: '$warehouse',
          qty: { $sum: { $cond: [{ $eq: ['$type', 'in'] }, '$quantity', { $multiply: ['$quantity', -1] }] } }
      } },
      { $group: { _id: null, total: { $sum: '$qty' } } }
    ]);

    console.log('agg result:', JSON.stringify(agg, null, 2));
  } catch (err) {
    console.error(err.stack || err);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
})();
