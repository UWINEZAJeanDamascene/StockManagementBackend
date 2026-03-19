const AccountMapping = require('../models/AccountMapping');
const accountMappingService = require('../services/accountMappingService');

// List mappings for company
exports.listMappings = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const mappings = await AccountMapping.find({ company: companyId }).sort({ module: 1, key: 1 });
    res.json({ success: true, data: mappings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get mapping by id
exports.getMapping = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const mapping = await AccountMapping.findOne({ _id: req.params.id, company: companyId });
    if (!mapping) return res.status(404).json({ success: false, message: 'Mapping not found' });
    res.json({ success: true, data: mapping });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Create mapping
exports.createMapping = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const payload = {
      company: companyId,
      module: req.body.module,
      key: req.body.key,
      accountCode: req.body.accountCode,
      description: req.body.description,
      createdBy: req.user._id
    };

    // Upsert: if exists update, otherwise create
    const existing = await AccountMapping.findOneAndUpdate(
      { company: companyId, module: payload.module, key: payload.key },
      payload,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({ success: true, data: existing });
  } catch (err) {
    // Handle duplicate key explicitly
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'Mapping already exists' });
    res.status(500).json({ success: false, message: err.message });
  }
};

// Update mapping
exports.updateMapping = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const mapping = await AccountMapping.findOneAndUpdate(
      { _id: req.params.id, company: companyId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!mapping) return res.status(404).json({ success: false, message: 'Mapping not found' });
    res.json({ success: true, data: mapping });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Delete mapping
exports.deleteMapping = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const mapping = await AccountMapping.findOneAndDelete({ _id: req.params.id, company: companyId });
    if (!mapping) return res.status(404).json({ success: false, message: 'Mapping not found' });
    res.json({ success: true, message: 'Mapping deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Resolve mapping (module + key) for current company
exports.resolve = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { module: moduleName, key } = req.query;
    if (!moduleName || !key) return res.status(400).json({ success: false, message: 'module and key are required' });
    const accountCode = await accountMappingService.resolve(companyId, moduleName, key);
    res.json({ success: true, data: { accountCode } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
