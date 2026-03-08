const FixedAsset = require('../models/FixedAsset');

// @desc    Get all fixed assets for a company
// @route   GET /api/fixed-assets
// @access  Private
exports.getFixedAssets = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { status, category } = req.query;
    
    const query = { company: companyId };
    if (status) query.status = status;
    if (category) query.category = category;

    const assets = await FixedAsset.find(query)
      .populate('supplier', 'name code')
      .populate('createdBy', 'name email')
      .sort({ purchaseDate: -1 });

    // Calculate totals
    const totalCost = assets.reduce((sum, asset) => sum + (asset.purchaseCost || 0), 0);
    const totalDepreciation = assets.reduce((sum, asset) => sum + (asset.accumulatedDepreciation || 0), 0);
    const totalNetValue = assets.reduce((sum, asset) => sum + (asset.netBookValue || 0), 0);

    res.json({
      success: true,
      count: assets.length,
      data: assets,
      summary: {
        totalCost,
        totalDepreciation,
        totalNetValue
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single fixed asset
// @route   GET /api/fixed-assets/:id
// @access  Private
exports.getFixedAsset = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    const asset = await FixedAsset.findOne({ _id: req.params.id, company: companyId })
      .populate('supplier', 'name code')
      .populate('createdBy', 'name email');

    if (!asset) {
      return res.status(404).json({ success: false, message: 'Fixed asset not found' });
    }

    res.json({ success: true, data: asset });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new fixed asset
// @route   POST /api/fixed-assets
// @access  Private
exports.createFixedAsset = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    const asset = await FixedAsset.create({
      ...req.body,
      company: companyId,
      createdBy: req.user._id
    });

    res.status(201).json({ success: true, data: asset });
  } catch (error) {
    next(error);
  }
};

// @desc    Update fixed asset
// @route   PUT /api/fixed-assets/:id
// @access  Private
exports.updateFixedAsset = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    let asset = await FixedAsset.findOne({ _id: req.params.id, company: companyId });

    if (!asset) {
      return res.status(404).json({ success: false, message: 'Fixed asset not found' });
    }

    asset = await FixedAsset.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    res.json({ success: true, data: asset });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete fixed asset
// @route   DELETE /api/fixed-assets/:id
// @access  Private
exports.deleteFixedAsset = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    const asset = await FixedAsset.findOne({ _id: req.params.id, company: companyId });

    if (!asset) {
      return res.status(404).json({ success: false, message: 'Fixed asset not found' });
    }

    await FixedAsset.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'Fixed asset deleted' });
  } catch (error) {
    next(error);
  }
};

// @desc    Get fixed assets summary for Balance Sheet
// @route   GET /api/fixed-assets/summary
// @access  Private
exports.getFixedAssetsSummary = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    
    // Get all active assets
    const assets = await FixedAsset.find({ company: companyId, status: 'active' });

    // Group by category
    const byCategory = {
      equipment: { cost: 0, depreciation: 0, netValue: 0 },
      furniture: { cost: 0, depreciation: 0, netValue: 0 },
      vehicles: { cost: 0, depreciation: 0, netValue: 0 },
      buildings: { cost: 0, depreciation: 0, netValue: 0 },
      land: { cost: 0, depreciation: 0, netValue: 0 },
      computers: { cost: 0, depreciation: 0, netValue: 0 },
      machinery: { cost: 0, depreciation: 0, netValue: 0 },
      other: { cost: 0, depreciation: 0, netValue: 0 }
    };

    assets.forEach(asset => {
      const cat = asset.category || 'other';
      if (byCategory[cat]) {
        byCategory[cat].cost += asset.purchaseCost || 0;
        byCategory[cat].depreciation += asset.accumulatedDepreciation || 0;
        byCategory[cat].netValue += asset.netBookValue || 0;
      }
    });

    const totalCost = assets.reduce((sum, asset) => sum + (asset.purchaseCost || 0), 0);
    const totalDepreciation = assets.reduce((sum, asset) => sum + (asset.accumulatedDepreciation || 0), 0);
    const totalNetValue = assets.reduce((sum, asset) => sum + (asset.netBookValue || 0), 0);

    res.json({
      success: true,
      data: {
        byCategory,
        total: {
          cost: totalCost,
          depreciation: totalDepreciation,
          netValue: totalNetValue
        }
      }
    });
  } catch (error) {
    next(error);
  }
};
