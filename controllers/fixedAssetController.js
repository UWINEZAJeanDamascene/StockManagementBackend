/**
 * Module 5 - Fixed Assets Controller
 * 
 * Handles asset registration, depreciation schedules, and disposal
 * Following exact specifications from Module 5 docs
 */

const mongoose = require('mongoose');
const { FixedAsset, DepreciationEntry } = require('../models/FixedAsset');
const JournalEntry = require('../models/JournalEntry');
const ChartOfAccount = require('../models/ChartOfAccount');
const { canPostToAccount, DEFAULT_ACCOUNTS, CHART_OF_ACCOUNTS } = require('../constants/chartOfAccounts');

// Get all fixed assets for a company
exports.getAssets = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { status, purchase_date_from, purchase_date_to, page = 1, limit = 50 } = req.query;

    const query = { company: companyId, isDeleted: false };
    if (status) query.status = status;
    if (purchase_date_from || purchase_date_to) {
      query.purchaseDate = {};
      if (purchase_date_from) query.purchaseDate.$gte = new Date(purchase_date_from);
      if (purchase_date_to) query.purchaseDate.$lte = new Date(purchase_date_to);
    }

    const assets = await FixedAsset.find(query)
      .populate('assetAccountId', 'code name')
      .populate('accumDepreciationAccountId', 'code name')
      .populate('depreciationExpenseAccountId', 'code name')
      .populate('supplierId', 'name')
      .populate('createdBy', 'name')
      .populate('categoryId', 'name description defaultUsefulLifeMonths defaultDepreciationMethod')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await FixedAsset.countDocuments(query);

    res.json({
      success: true,
      data: assets,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error getting fixed assets:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get single asset by ID
exports.getAssetById = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company._id;

    const asset = await FixedAsset.findOne({ _id: id, company: companyId })
      .populate('assetAccountId', 'code name')
      .populate('accumDepreciationAccountId', 'code name')
      .populate('depreciationExpenseAccountId', 'code name')
      .populate('supplierId', 'name')
      .populate('createdBy', 'name')
      .populate('categoryId', 'name description defaultUsefulLifeMonths defaultDepreciationMethod')
      .populate('purchaseJournalEntryId')
      .populate('disposalJournalEntryId');

    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    res.json({
      success: true,
      data: asset
    });
  } catch (error) {
    console.error('Error getting fixed asset:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get depreciation schedule for an asset
exports.getDepreciationSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company._id;

    const asset = await FixedAsset.findOne({ _id: id, company: companyId });
    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    // Generate schedule from today to end of useful life
    const schedule = [];
    const today = new Date();
    const purchaseCost = parseFloat(asset.purchaseCost?.toString() || 0);
    const salvageValue = parseFloat(asset.salvageValue?.toString() || 0);
    const depreciableAmount = purchaseCost - salvageValue;
    
    const startMonth = today.getMonth();
    const startYear = today.getFullYear();
    const totalMonths = asset.usefulLifeMonths;

    let accumulatedDepreciation = parseFloat(asset.accumulatedDepreciation?.toString() || 0);

    for (let i = 0; i < totalMonths; i++) {
      const month = (startMonth + i) % 12;
      const year = startYear + Math.floor((startMonth + i) / 12);
      const periodDate = new Date(year, month, 1);

      // Stop if already fully depreciated
      if (accumulatedDepreciation >= depreciableAmount) {
        break;
      }

      let depreciation = 0;
      if (asset.depreciationMethod === 'straight_line') {
        depreciation = depreciableAmount / totalMonths;
      } else if (asset.depreciationMethod === 'declining_balance') {
        const rate = asset.decliningRate ? parseFloat(asset.decliningRate.toString()) : 0.2;
        const nbv = purchaseCost - accumulatedDepreciation;
        depreciation = (nbv * rate) / 12;
      }

      // CRITICAL: Cap depreciation so NBV never goes below salvage value
      const remainingDepreciable = depreciableAmount - accumulatedDepreciation;
      depreciation = Math.min(depreciation, remainingDepreciable);

      accumulatedDepreciation += depreciation;

      if (depreciation > 0) {
        // NBV = max(salvage_value, purchase_cost - accumulated_depreciation)
        const netBookValue = Math.max(salvageValue, purchaseCost - accumulatedDepreciation);
        schedule.push({
          period: i + 1,
          periodDate,
          year,
          month: month + 1,
          depreciationAmount: Math.round(depreciation * 100) / 100,
          accumulatedDepreciation: Math.round(accumulatedDepreciation * 100) / 100,
          netBookValue: Math.round(netBookValue * 100) / 100
        });
      }
    }

    res.json({
      success: true,
      data: {
        asset: {
          _id: asset._id,
          referenceNo: asset.referenceNo,
          name: asset.name,
          purchaseCost,
          salvageValue,
          usefulLifeMonths: asset.usefulLifeMonths,
          depreciationMethod: asset.depreciationMethod,
          status: asset.status
        },
        schedule
      }
    });
  } catch (error) {
    console.error('Error getting depreciation schedule:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create a new fixed asset and post purchase entry
exports.createAsset = async (req, res) => {
  try {
    const companyId = req.user.company._id;
    const { 
      name, 
      description,
      categoryId,
      assetAccountCode,
      accumDepreciationAccountCode,
      depreciationExpenseAccountCode,
      purchaseDate,
      purchaseCost,
      salvageValue,
      usefulLifeMonths,
      depreciationMethod,
      decliningRate,
      supplierId,
      paymentAccountCode, // 2100 for AP or 1100 for Bank
      createdBy
    } = req.body;

    // Validate required fields
    if (!name || !assetAccountCode || !accumDepreciationAccountCode || 
        !depreciationExpenseAccountCode || !purchaseDate || !purchaseCost || 
        !usefulLifeMonths || !createdBy) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }
    // Determine payment account (default to 1100 Bank if not provided)
    const payAccountCode = paymentAccountCode || '1100';
    const payAccountVal = canPostToAccount(payAccountCode);
    if (!payAccountVal.valid) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid payment account: ${payAccountVal.reason}` 
      });
    }

    // Get category defaults if categoryId provided
    let categoryDefaults = null;
    if (categoryId) {
      const AssetCategory = require('../models/AssetCategory');
      categoryDefaults = await AssetCategory.findOne({ 
        _id: categoryId, 
        company: companyId,
        isDeleted: false
      });
      if (!categoryDefaults) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid category' 
        });
      }
    }

    // Use category defaults if not explicitly provided
    const finalAssetAccountCode = assetAccountCode || categoryDefaults?.defaultAssetAccountCode || '1500';
    const finalAccumDepAccountCode = accumDepreciationAccountCode || categoryDefaults?.defaultAccumDepreciationAccountCode || '1510';
    const finalDepExpenseAccountCode = depreciationExpenseAccountCode || categoryDefaults?.defaultDepreciationExpenseAccountCode || '6050';
    const finalUsefulLifeMonths = usefulLifeMonths || categoryDefaults?.defaultUsefulLifeMonths || 60;
    const finalDepreciationMethod = depreciationMethod || categoryDefaults?.defaultDepreciationMethod || 'straight_line';
    const finalDecliningRate = decliningRate || (categoryDefaults?.defaultDecliningRate ? parseFloat(categoryDefaults.defaultDecliningRate.toString()) : null);

    // Validate account codes exist and allow direct posting (after final codes computed)
    const assetAccountVal = canPostToAccount(finalAssetAccountCode);
    if (!assetAccountVal.valid) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid asset account: ${assetAccountVal.reason}` 
      });
    }

    const accumDepAccountVal = canPostToAccount(finalAccumDepAccountCode);
    if (!accumDepAccountVal.valid) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid accumulated depreciation account: ${accumDepAccountVal.reason}` 
      });
    }

    const depExpenseAccountVal = canPostToAccount(finalDepExpenseAccountCode);
    if (!depExpenseAccountVal.valid) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid depreciation expense account: ${depExpenseAccountVal.reason}` 
      });
    }

    // Get chart of account IDs
    const assetAccountDoc = await ChartOfAccount.findOne({ 
      company: companyId, 
      code: finalAssetAccountCode 
    });
    const accumDepAccountDoc = await ChartOfAccount.findOne({ 
      company: companyId, 
      code: finalAccumDepAccountCode 
    });
    const depExpenseAccountDoc = await ChartOfAccount.findOne({ 
      company: companyId, 
      code: finalDepExpenseAccountCode 
    });

    // Create the asset
    const asset = new FixedAsset({
      company: companyId,
      name,
      description,
      categoryId: categoryId || null,
      assetAccountId: assetAccountDoc?._id || null,
      assetAccountCode: finalAssetAccountCode,
      accumDepreciationAccountId: accumDepAccountDoc?._id || null,
      accumDepreciationAccountCode: finalAccumDepAccountCode,
      depreciationExpenseAccountId: depExpenseAccountDoc?._id || null,
      depreciationExpenseAccountCode: finalDepExpenseAccountCode,
      purchaseDate: new Date(purchaseDate),
      purchaseCost: mongoose.Types.Decimal128.fromString(String(purchaseCost)),
      salvageValue: mongoose.Types.Decimal128.fromString(String(salvageValue || 0)),
      usefulLifeMonths: finalUsefulLifeMonths,
      depreciationMethod: finalDepreciationMethod,
      decliningRate: finalDecliningRate ? mongoose.Types.Decimal128.fromString(String(finalDecliningRate)) : null,
      supplierId: supplierId || null,
      status: 'active',
      createdBy
    });

    try {
      await asset.save();
    } catch (err) {
      // Handle rare duplicate referenceNo race by regenerating ref and retrying a few times
      if (err && err.code === 11000 && err.keyPattern && err.keyPattern.referenceNo) {
        let saved = false;
        let attempts = 0;
        const maxAttempts = 5;
        while (!saved && attempts < maxAttempts) {
          attempts += 1;
          try {
            asset.referenceNo = await asset.constructor.generateReferenceNo(companyId);
            await asset.save();
            saved = true;
            break;
          } catch (err2) {
            // If still duplicate on referenceNo, loop and try next sequence value
            if (err2 && err2.code === 11000 && err2.keyPattern && err2.keyPattern.referenceNo) {
              console.warn(`Duplicate referenceNo on retry ${attempts}, regenerating...`);
              // continue to next attempt
            } else {
              console.error('Error saving fixed asset after regenerating referenceNo:', err2);
              return res.status(500).json({ success: false, error: err2.message });
            }
          }
        }

        if (!saved) {
          console.error('Failed to save fixed asset after multiple referenceNo regeneration attempts - falling back to timestamp ref');
          // Final fallback: generate a timestamp+random based referenceNo to guarantee uniqueness
          try {
            const year = new Date().getFullYear();
            asset.referenceNo = `AST-${year}-TS${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 900 + 100)}`;
            await asset.save();
            saved = true;
          } catch (err3) {
            console.error('Final fallback failed saving fixed asset with timestamp ref:', err3);
            return res.status(500).json({ success: false, error: 'Failed to generate unique reference number for asset' });
          }
        }
      } else {
        throw err;
      }
    }

    // Create journal entry for asset purchase (per Module 5.3 spec)
    // DR asset_account_id purchase_cost
    // CR payment_account_code (2100 AP or 1100 Bank) purchase_cost
    // source_type: asset_purchase
    // Narration: "Asset Purchase - [Asset Name] - AST#[ref]"
    const purchaseCostNum = parseFloat(purchaseCost);
    const entryNumber = await JournalEntry.generateEntryNumber(companyId);
    const journalEntry = await JournalEntry.create({
      company: companyId,
      entryNumber,
      date: new Date(purchaseDate),
      description: `Asset Purchase - ${name} - AST#${asset.referenceNo}`,
      sourceType: 'asset_purchase',
      sourceId: asset._id,
      sourceReference: asset.referenceNo,
      status: 'posted',
      isAutoGenerated: true,
      lines: [
        {
          accountCode: finalAssetAccountCode,
          accountName: CHART_OF_ACCOUNTS[finalAssetAccountCode]?.name || 'Fixed Asset',
          debit: purchaseCostNum,
          credit: 0,
          description: `Asset purchase: ${asset.referenceNo}`
        },
        {
          accountCode: payAccountCode,
          accountName: CHART_OF_ACCOUNTS[payAccountCode]?.name || 'Bank/Payable',
          debit: 0,
          credit: purchaseCostNum,
          description: `Asset purchase: ${asset.referenceNo}`
        }
      ],
      createdBy
    });

    asset.purchaseJournalEntryId = journalEntry._id;
    await asset.save();

    res.status(201).json({
      success: true,
      data: asset,
      journalEntry
    });
  } catch (error) {
    console.error('Error creating fixed asset:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Calculate depreciation for an asset (preview)
exports.calculateDepreciation = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company._id;
    const { periodDate } = req.body;

    const asset = await FixedAsset.findOne({ _id: id, company: companyId });
    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    if (asset.status === 'disposed') {
      return res.status(400).json({ 
        success: false, 
        error: 'Cannot calculate depreciation for disposed asset' 
      });
    }

    const period = periodDate ? new Date(periodDate) : new Date();
    const depreciationAmount = asset.calculateDepreciation(period);

    res.json({
      success: true,
      data: {
        assetId: asset._id,
        referenceNo: asset.referenceNo,
        periodDate: period,
        depreciationAmount,
        currentAccumulatedDepreciation: parseFloat(asset.accumulatedDepreciation?.toString() || 0),
        netBookValue: parseFloat(asset.netBookValue?.toString() || 0),
        purchaseCost: parseFloat(asset.purchaseCost?.toString() || 0),
        salvageValue: parseFloat(asset.salvageValue?.toString() || 0),
        usefulLifeMonths: asset.usefulLifeMonths,
        depreciationMethod: asset.depreciationMethod
      }
    });
  } catch (error) {
    console.error('Error calculating depreciation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Post depreciation for an asset
exports.postDepreciation = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company._id;
    const { periodDate, postedBy } = req.body;

    const asset = await FixedAsset.findOne({ _id: id, company: companyId });
    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    if (asset.status === 'disposed') {
      return res.status(400).json({ 
        success: false, 
        error: 'Cannot post depreciation for disposed asset' 
      });
    }

    const period = periodDate ? new Date(periodDate) : new Date();
    
    // Check if depreciation already posted for this period (idempotency)
    const existingEntry = await DepreciationEntry.findOne({
      asset: asset._id,
      periodDate: {
        $gte: new Date(period.getFullYear(), period.getMonth(), 1),
        $lt: new Date(period.getFullYear(), period.getMonth() + 1, 1)
      },
      isReversed: false,
      isDeleted: false
    });

    if (existingEntry) {
      return res.status(400).json({ 
        success: false, 
        error: 'Depreciation already posted for this period' 
      });
    }

    // Calculate depreciation
    const depreciationAmount = asset.calculateDepreciation(period);
    
    if (depreciationAmount <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'No depreciation to post (asset may be fully depreciated)' 
      });
    }

    // Get current accumulated depreciation
    const currentAccumDep = parseFloat(asset.accumulatedDepreciation?.toString() || 0);
    const newAccumDep = currentAccumDep + depreciationAmount;
    const newNetBookValue = parseFloat(asset.purchaseCost?.toString() || 0) - newAccumDep;

    // Create journal entry for depreciation (per Module 5.4 spec)
    // DR depreciation_expense_account_id depreciation_amount
    // CR accum_depreciation_account_id depreciation_amount
    // source_type: depreciation
    // Narration: "Depreciation - [Asset Name] - [Month Year] - AST#[ref]"
    const monthYear = period.toLocaleString('default', { month: 'long', year: 'numeric' });
    const entryNumber = await JournalEntry.generateEntryNumber(asset.company);
    const journalEntry = await JournalEntry.create({
      company: asset.company,
      entryNumber,
      date: period,
      description: `Depreciation - ${asset.name} - ${monthYear} - AST#${asset.referenceNo}`,
      sourceType: 'depreciation',
      sourceId: asset._id,
      sourceReference: asset.referenceNo,
      status: 'posted',
      isAutoGenerated: true,
      lines: [
        {
          accountCode: asset.depreciationExpenseAccountCode,
          accountName: CHART_OF_ACCOUNTS[asset.depreciationExpenseAccountCode]?.name || 'Depreciation Expense',
          debit: depreciationAmount,
          credit: 0,
          description: `Depreciation: ${asset.referenceNo}`
        },
        {
          accountCode: asset.accumDepreciationAccountCode,
          accountName: CHART_OF_ACCOUNTS[asset.accumDepreciationAccountCode]?.name || 'Accumulated Depreciation',
          debit: 0,
          credit: depreciationAmount,
          description: `Depreciation: ${asset.referenceNo}`
        }
      ],
      createdBy: postedBy
    });

    // Create depreciation entry record (for idempotency)
    const depreciationEntry = await DepreciationEntry.create({
      company: asset.company,
      asset: asset._id,
      periodDate: period,
      depreciationAmount: mongoose.Types.Decimal128.fromString(depreciationAmount.toString()),
      accumulatedBefore: mongoose.Types.Decimal128.fromString(currentAccumDep.toString()),
      accumulatedAfter: mongoose.Types.Decimal128.fromString(newAccumDep.toString()),
      netBookValueAfter: mongoose.Types.Decimal128.fromString(newNetBookValue.toString()),
      journalEntryId: journalEntry._id,
      postedBy
    });

    // Update asset
    asset.accumulatedDepreciation = mongoose.Types.Decimal128.fromString(newAccumDep.toString());
    asset.netBookValue = mongoose.Types.Decimal128.fromString(newNetBookValue.toString());
    asset.lastDepreciationDate = period;
    
    // Check if fully depreciated (NBV <= salvage_value)
    const salvageValue = parseFloat(asset.salvageValue?.toString() || 0);
    if (newNetBookValue <= salvageValue) {
      asset.status = 'fully_depreciated';
    }
    
    await asset.save();

    res.status(201).json({
      success: true,
      data: {
        asset,
        depreciationEntry,
        journalEntry
      }
    });
  } catch (error) {
    console.error('Error posting depreciation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Dispose an asset
exports.disposeAsset = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company._id;
    const { disposalDate, disposalProceeds, createdBy } = req.body;

    const asset = await FixedAsset.findOne({ _id: id, company: companyId });
    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    if (asset.status === 'disposed') {
      return res.status(400).json({ 
        success: false, 
        error: 'Asset already disposed' 
      });
    }

    const disposalDateVal = disposalDate ? new Date(disposalDate) : new Date();
    const proceeds = disposalProceeds ? parseFloat(disposalProceeds) : 0;
    const netBookValue = parseFloat(asset.netBookValue?.toString() || 0);
    const purchaseCost = parseFloat(asset.purchaseCost?.toString() || 0);
    const accumulatedDepreciation = parseFloat(asset.accumulatedDepreciation?.toString() || 0);
    const gainLoss = proceeds - netBookValue;

    // Create journal entry for disposal (per Module 5.6 spec)
    // DR 1510 Accum. Depreciation accumulated_depreciation
    // DR 1100 Bank disposal_proceeds (if any)
    // CR 1500 Fixed Asset purchase_cost
    // If gain: CR 4200 Other Income gain_amount
    // If loss: DR 6xxx Loss on Disposal loss_amount
    // source_type: asset_disposal
    
    const lines = [
      // Remove accumulated depreciation
      {
        accountCode: asset.accumDepreciationAccountCode,
        accountName: CHART_OF_ACCOUNTS[asset.accumDepreciationAccountCode]?.name || 'Accumulated Depreciation',
        debit: accumulatedDepreciation,
        credit: 0,
        description: `Disposal: ${asset.referenceNo}`
      }
    ];

    // Add proceeds if any (DR Bank)
    if (proceeds > 0) {
      lines.push({
        accountCode: '1100',
        accountName: CHART_OF_ACCOUNTS['1100']?.name || 'Cash at Bank',
        debit: proceeds,
        credit: 0,
        description: `Disposal proceeds: ${asset.referenceNo}`
      });
    }

    // Remove original asset cost (CR Fixed Asset)
    lines.push({
      accountCode: asset.assetAccountCode,
      accountName: CHART_OF_ACCOUNTS[asset.assetAccountCode]?.name || 'Fixed Asset',
      debit: 0,
      credit: purchaseCost,
      description: `Disposal: ${asset.referenceNo}`
    });

    // Handle gain or loss
    if (gainLoss !== 0) {
      if (gainLoss > 0) {
        // Gain on disposal - CR Other Income
        lines.push({
          accountCode: DEFAULT_ACCOUNTS.gainOnDisposal || '4200',
          accountName: CHART_OF_ACCOUNTS['4200']?.name || 'Gain on Asset Disposal',
          debit: 0,
          credit: gainLoss,
          description: `Gain on disposal: ${asset.referenceNo}`
        });
      } else {
        // Loss on disposal - DR Loss on Disposal
        lines.push({
          accountCode: DEFAULT_ACCOUNTS.lossOnDisposal || '6050',
          accountName: CHART_OF_ACCOUNTS['6050']?.name || 'Loss on Asset Disposal',
          debit: Math.abs(gainLoss),
          credit: 0,
          description: `Loss on disposal: ${asset.referenceNo}`
        });
      }
    }

    const entryNumber = await JournalEntry.generateEntryNumber(asset.company);
    const journalEntry = await JournalEntry.create({
      company: asset.company,
      entryNumber,
      date: disposalDateVal,
      description: `Asset Disposal - ${asset.name} - AST#${asset.referenceNo}`,
      sourceType: 'asset_disposal',
      sourceId: asset._id,
      sourceReference: asset.referenceNo,
      status: 'posted',
      isAutoGenerated: true,
      lines,
      createdBy
    });

    // Update asset - set NBV to 0 after disposal
    asset.status = 'disposed';
    asset.disposalDate = disposalDateVal;
    asset.disposalProceeds = proceeds > 0 ? mongoose.Types.Decimal128.fromString(proceeds.toString()) : null;
    asset.disposalJournalEntryId = journalEntry._id;
    asset.accumulatedDepreciation = mongoose.Types.Decimal128.fromString('0');
    asset.netBookValue = mongoose.Types.Decimal128.fromString('0');
    await asset.save();

    res.json({
      success: true,
      data: {
        asset,
        journalEntry,
        gainLoss
      }
    });
  } catch (error) {
    console.error('Error disposing asset:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update an asset (only allowed before first depreciation is posted)
exports.updateAsset = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company._id;
    const { name, description, usefulLifeMonths, depreciationMethod, decliningRate } = req.body;

    const asset = await FixedAsset.findOne({ _id: id, company: companyId });
    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    // Check if any depreciation has been posted
    const hasDepreciation = await DepreciationEntry.countDocuments({
      asset: asset._id,
      company: companyId,
      isReversed: false,
      isDeleted: false
    }) > 0;

    if (hasDepreciation) {
      return res.status(400).json({ 
        success: false, 
        error: 'Cannot edit asset after depreciation has been posted' 
      });
    }

    // Update fields
    if (name) asset.name = name;
    if (description !== undefined) asset.description = description;
    if (usefulLifeMonths) asset.usefulLifeMonths = usefulLifeMonths;
    if (depreciationMethod) asset.depreciationMethod = depreciationMethod;
    if (decliningRate) asset.decliningRate = mongoose.Types.Decimal128.fromString(String(decliningRate));

    await asset.save();

    res.json({
      success: true,
      data: asset
    });
  } catch (error) {
    console.error('Error updating fixed asset:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get depreciation report for all assets
exports.getDepreciationReport = async (req, res) => {
  try {
    const companyId = req.user.company._id;

    const query = { 
      company: companyId, 
      isDeleted: false,
      status: { $ne: 'disposed' }
    };

    const assets = await FixedAsset.find(query)
      .populate('assetAccountId', 'code name')
      .populate('depreciationExpenseAccountId', 'code name');

    const report = assets.map(asset => {
      const purchaseCost = parseFloat(asset.purchaseCost?.toString() || 0);
      const accumulatedDep = parseFloat(asset.accumulatedDepreciation?.toString() || 0);
      const netBookValue = parseFloat(asset.netBookValue?.toString() || 0);
      const salvageValue = parseFloat(asset.salvageValue?.toString() || 0);
      
      // Calculate monthly depreciation
      let monthlyDep = 0;
      if (asset.depreciationMethod === 'straight_line') {
        monthlyDep = (purchaseCost - salvageValue) / asset.usefulLifeMonths;
      }

      return {
        assetId: asset._id,
        referenceNo: asset.referenceNo,
        name: asset.name,
        assetAccount: asset.assetAccountCode,
        purchaseCost,
        accumulatedDepreciation: accumulatedDep,
        netBookValue,
        monthlyDepreciation: Math.round(monthlyDep * 100) / 100,
        status: asset.status,
        depreciationMethod: asset.depreciationMethod
      };
    });

    // Calculate totals
    const totals = report.reduce((acc, asset) => {
      acc.purchaseCost += asset.purchaseCost;
      acc.accumulatedDepreciation += asset.accumulatedDepreciation;
      acc.netBookValue += asset.netBookValue;
      acc.monthlyDepreciation += asset.monthlyDepreciation;
      return acc;
    }, { purchaseCost: 0, accumulatedDepreciation: 0, netBookValue: 0, monthlyDepreciation: 0 });

    res.json({
      success: true,
      data: {
        assets: report,
        totals: {
          purchaseCost: Math.round(totals.purchaseCost * 100) / 100,
          accumulatedDepreciation: Math.round(totals.accumulatedDepreciation * 100) / 100,
          netBookValue: Math.round(totals.netBookValue * 100) / 100,
          monthlyDepreciation: Math.round(totals.monthlyDepreciation * 100) / 100
        }
      }
    });
  } catch (error) {
    console.error('Error getting depreciation report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete (soft delete) an asset - with strict guards
exports.deleteAsset = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.company._id;
    const { deletedBy } = req.body;

    const asset = await FixedAsset.findOne({ _id: id, company: companyId });
    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    // Guard 1: Block if already disposed
    if (asset.status === 'disposed') {
      return res.status(400).json({ 
        success: false, 
        error: 'ASSET_ALREADY_DISPOSED: Asset is already disposed. Use the disposal endpoint, not delete.' 
      });
    }

    // Guard 2: Block if depreciation has been posted
    const accumulatedDep = parseFloat(asset.accumulatedDepreciation?.toString() || 0);
    if (accumulatedDep > 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'ASSET_HAS_DEPRECIATION_HISTORY: Cannot delete asset after depreciation has been posted. Financial history exists.' 
      });
    }

    // Guard 3: Block if purchase journal entry was posted
    if (asset.purchaseJournalEntryId) {
      return res.status(400).json({ 
        success: false, 
        error: 'ASSET_HAS_POSTED_JOURNAL: Cannot delete asset after purchase journal entry was posted. Reversing this requires an accounting operation, not a delete.' 
      });
    }

    // Only allow soft delete for brand new assets with no financial history
    asset.isDeleted = true;
    asset.deletedAt = new Date();
    await asset.save();

    res.json({
      success: true,
      data: { message: 'Asset deleted successfully', assetId: asset._id }
    });
  } catch (error) {
    console.error('Error deleting asset:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Reverse depreciation - can only reverse the most recent entry (LIFO)
exports.reverseDepreciation = async (req, res) => {
  try {
    const { id, entryId } = req.params;
    const companyId = req.user.company._id;
    const { reason, reversedBy } = req.body;

    const asset = await FixedAsset.findOne({ _id: id, company: companyId });
    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    // Find the depreciation entry
    const entry = await DepreciationEntry.findOne({ 
      _id: entryId, 
      asset: asset._id,
      company: companyId 
    });
    
    if (!entry) {
      return res.status(404).json({ success: false, error: 'Depreciation entry not found' });
    }

    // Guard 1: Check if already reversed
    if (entry.isReversed) {
      return res.status(400).json({ 
        success: false, 
        error: 'ENTRY_ALREADY_REVERSED: This depreciation entry has already been reversed' 
      });
    }

    // Guard 2: Check this is the LATEST entry - cannot reverse out of order (LIFO)
    const latestEntry = await DepreciationEntry.findOne({
      asset: asset._id,
      company: companyId,
      isReversed: false,
      isDeleted: false
    }).sort({ periodDate: -1, createdAt: -1 });

    if (!latestEntry || latestEntry._id.toString() !== entryId) {
      return res.status(400).json({ 
        success: false, 
        error: 'REVERSAL_ORDER_VIOLATION: Can only reverse the most recent depreciation entry. Later entries must be reversed first.' 
      });
    }

    // Get the accumulated value BEFORE this entry (stored in the entry)
    const accumulatedBefore = parseFloat(entry.accumulatedBefore?.toString() || 0);
    const newNetBookValue = parseFloat(asset.purchaseCost?.toString() || 0) - accumulatedBefore;

    // Create reversing journal entry
    // Reverse the original: DR Accum Depreciation, CR Depreciation Expense
    const entryNumber = await JournalEntry.generateEntryNumber(companyId);
    const reversingEntry = await JournalEntry.create({
      company: companyId,
      entryNumber,
      date: new Date(),
      description: `Depreciation Reversal - ${asset.name} - AST#${asset.referenceNo} - ${reason || 'Reversal'}`,
      sourceType: 'depreciation_reversal',
      sourceId: asset._id,
      sourceReference: asset.referenceNo,
      status: 'posted',
      isAutoGenerated: true,
      lines: [
        {
          accountCode: asset.accumDepreciationAccountCode,
          accountName: CHART_OF_ACCOUNTS[asset.accumDepreciationAccountCode]?.name || 'Accumulated Depreciation',
          debit: 0,  // Credit to reduce the contra-asset (reverse the credit)
          credit: parseFloat(entry.depreciationAmount?.toString() || 0),
          description: `Reversal: ${asset.referenceNo}`
        },
        {
          accountCode: asset.depreciationExpenseAccountCode,
          accountName: CHART_OF_ACCOUNTS[asset.depreciationExpenseAccountCode]?.name || 'Depreciation Expense',
          debit: parseFloat(entry.depreciationAmount?.toString() || 0),  // Debit to reverse the expense
          credit: 0,
          description: `Reversal: ${asset.referenceNo}`
        }
      ],
      createdBy: reversedBy
    });

    // Update the depreciation entry as reversed
    entry.isReversed = true;
    entry.reversedBy = reversedBy;
    entry.reversedAt = new Date();
    await entry.save();

    // Roll back the asset's accumulated depreciation to the value BEFORE this entry
    asset.accumulatedDepreciation = mongoose.Types.Decimal128.fromString(accumulatedBefore.toString());
    asset.netBookValue = mongoose.Types.Decimal128.fromString(newNetBookValue.toString());
    
    // Restore status to active if it was fully_depreciated
    if (asset.status === 'fully_depreciated') {
      asset.status = 'active';
    }
    
    asset.lastDepreciationDate = null;
    await asset.save();

    res.json({
      success: true,
      data: {
        asset,
        reversedEntry: entry,
        reversingJournalEntry: reversingEntry,
        message: 'Depreciation reversed successfully'
      }
    });
  } catch (error) {
    console.error('Error reversing depreciation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
