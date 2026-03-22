const PurchaseOrder = require('../models/PurchaseOrder');
const GoodsReceivedNote = require('../models/GoodsReceivedNote');
const { parsePagination, paginationMeta } = require('../utils/pagination');

exports.createPurchaseOrder = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const payload = req.body;
    payload.company = companyId;
    payload.createdBy = req.user.id;
    payload.status = payload.status || 'draft';

    const po = await PurchaseOrder.create(payload);
    res.status(201).json({ success: true, data: po });
  } catch (err) { next(err); }
};

exports.updatePurchaseOrder = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const po = await PurchaseOrder.findOne({ _id: req.params.id, company: companyId });
    if (!po) return res.status(404).json({ success: false, message: 'PO not found' });
    if (po.status !== 'draft') return res.status(409).json({ success: false, message: 'Only draft POs can be edited' });

    Object.assign(po, req.body);
    await po.save();
    res.json({ success: true, data: po });
  } catch (err) { next(err); }
};

exports.approvePurchaseOrder = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const po = await PurchaseOrder.findOne({ _id: req.params.id, company: companyId });
    if (!po) return res.status(404).json({ success: false, message: 'PO not found' });
    if (po.status !== 'draft') return res.status(409).json({ success: false, message: 'Only draft POs can be approved' });

    po.status = 'approved';
    po.approvedBy = req.user.id;
    po.approvedAt = new Date();
    await po.save();
    res.json({ success: true, data: po });
  } catch (err) { next(err); }
};

exports.cancelPurchaseOrder = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const po = await PurchaseOrder.findOne({ _id: req.params.id, company: companyId });
    if (!po) return res.status(404).json({ success: false, message: 'PO not found' });

    // Block cancellation if any GRN exists
    const grn = await GoodsReceivedNote.findOne({ purchaseOrder: po._id, company: companyId });
    if (grn) return res.status(409).json({ success: false, message: 'Cannot cancel PO with existing GRN' });

    po.status = 'cancelled';
    await po.save();
    res.json({ success: true, data: po });
  } catch (err) { next(err); }
};

exports.getPurchaseOrders = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { supplier_id, status, date_from, date_to } = req.query;
    const q = { company: companyId };
    if (supplier_id) q.supplier = supplier_id;
    if (status) q.status = status;
    if (date_from || date_to) q.orderDate = {};
    if (date_from) q.orderDate.$gte = new Date(date_from);
    if (date_to) q.orderDate.$lte = new Date(date_to);

    const { page, limit, skip } = parsePagination(req.query);
    const total = await PurchaseOrder.countDocuments(q);
    const list = await PurchaseOrder.find(q)
      .sort({ orderDate: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      success: true,
      data: list,
      pagination: paginationMeta(page, limit, total),
    });
  } catch (err) { next(err); }
};

exports.getPurchaseOrder = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const po = await PurchaseOrder.findOne({ _id: req.params.id, company: companyId });
    if (!po) return res.status(404).json({ success: false, message: 'PO not found' });
    res.json({ success: true, data: po });
  } catch (err) { next(err); }
};
