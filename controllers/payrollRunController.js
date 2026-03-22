const PayrollRunService = require('../services/payrollRunService');
const PayrollRun = require('../models/PayrollRun');
const Payroll = require('../models/Payroll');
const { parsePagination, paginationMeta } = require('../utils/pagination');

// @desc    Get all payroll runs for company
// @route   GET /api/payroll-runs
// @access  Private
const getPayrollRuns = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { status, startDate, endDate } = req.query;

    const filter = { company: companyId };
    if (status) filter.status = status;
    if (startDate || endDate) {
      filter.payment_date = {};
      if (startDate) filter.payment_date.$gte = new Date(startDate);
      if (endDate) filter.payment_date.$lte = new Date(endDate);
    }

    const { page, limit, skip } = parsePagination(req.query);
    const total = await PayrollRun.countDocuments(filter);
    const payrollRuns = await PayrollRun.find(filter)
      .populate('bank_account_id', 'name accountCode')
      .populate('salary_account_id', 'name code')
      .populate('tax_payable_account_id', 'name code')
      .populate('posted_by', 'name')
      .sort({ payment_date: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json({
      success: true,
      count: payrollRuns.length,
      data: payrollRuns,
      pagination: paginationMeta(page, limit, total),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single payroll run
// @route   GET /api/payroll-runs/:id
// @access  Private
const getPayrollRunById = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { id } = req.params;

    const payrollRun = await PayrollRun.findOne({
      _id: id,
      company: companyId
    })
      .populate('bank_account_id', 'name accountCode')
      .populate('salary_account_id', 'name code')
      .populate('tax_payable_account_id', 'name code')
      .populate('other_deductions_account_id', 'name code')
      .populate('posted_by', 'name');

    if (!payrollRun) {
      return res.status(404).json({
        success: false,
        message: 'Payroll run not found'
      });
    }

    res.status(200).json({
      success: true,
      data: payrollRun
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new payroll run (draft)
// @route   POST /api/payroll-runs
// @access  Private (admin, manager)
const createPayrollRun = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user._id;

    const payrollRun = await PayrollRunService.create(companyId, req.body, userId);

    res.status(201).json({
      success: true,
      data: payrollRun
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Post payroll run (create journal entry)
// @route   POST /api/payroll-runs/:id/post
// @access  Private (admin)
const postPayrollRun = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user._id;
    const { id } = req.params;

    const payrollRun = await PayrollRunService.post(companyId, id, userId);

    res.status(200).json({
      success: true,
      data: payrollRun,
      message: 'Payroll run posted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reverse payroll run
// @route   POST /api/payroll-runs/:id/reverse
// @access  Private (admin)
const reversePayrollRun = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user._id;
    const { id } = req.params;
    const { reason, reversal_date } = req.body;

    const payrollRun = await PayrollRunService.reverse(
      companyId,
      id,
      { reason, reversal_date },
      userId
    );

    res.status(200).json({
      success: true,
      data: payrollRun,
      message: 'Payroll run reversed successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete payroll run (draft only)
// @route   DELETE /api/payroll-runs/:id
// @access  Private (admin)
const deletePayrollRun = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { id } = req.params;

    const payrollRun = await PayrollRun.findOne({
      _id: id,
      company: companyId
    });

    if (!payrollRun) {
      return res.status(404).json({
        success: false,
        message: 'Payroll run not found'
      });
    }

    if (payrollRun.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Can only delete draft payroll runs'
      });
    }

    await payrollRun.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Payroll run deleted'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Preview journal entry before posting
// @route   GET /api/payroll-runs/preview
// @access  Private (admin, manager)
const previewPayrollRun = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const data = {
      pay_period_start: new Date(req.query.pay_period_start),
      pay_period_end: new Date(req.query.pay_period_end),
      salary_account_id: req.query.salary_account_id,
      tax_payable_account_id: req.query.tax_payable_account_id,
      bank_account_id: req.query.bank_account_id,
      other_deductions_account_id: req.query.other_deductions_account_id
    };

    const preview = await PayrollRunService.preview(companyId, data);

    res.status(200).json({
      success: true,
      data: preview
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create payroll run from finalised employee records
// @route   POST /api/payroll-runs/from-records
// @access  Private (admin, manager)
const createFromRecords = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user._id;

    const data = {
      pay_period_start: new Date(req.body.pay_period_start),
      pay_period_end: new Date(req.body.pay_period_end),
      payment_date: new Date(req.body.payment_date),
      salary_account_id: req.body.salary_account_id,
      tax_payable_account_id: req.body.tax_payable_account_id,
      bank_account_id: req.body.bank_account_id,
      other_deductions_account_id: req.body.other_deductions_account_id,
      notes: req.body.notes
    };

    const payrollRun = await PayrollRunService.createFromRecords(companyId, data, userId);

    res.status(201).json({
      success: true,
      data: payrollRun
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPayrollRuns,
  getPayrollRunById,
  createPayrollRun,
  postPayrollRun,
  reversePayrollRun,
  deletePayrollRun,
  previewPayrollRun,
  createFromRecords
};
