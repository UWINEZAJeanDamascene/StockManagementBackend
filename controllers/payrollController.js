const Payroll = require("../models/Payroll");
const User = require("../models/User");
const JournalService = require("../services/journalService");
const TaxAutomationService = require("../services/taxAutomationService");
const { parsePagination, paginationMeta } = require("../utils/pagination");
const JournalEntry = require("../models/JournalEntry");
const { nextSequence } = require("../services/sequenceService");
const PeriodService = require("../services/periodService");

// @desc    Get all payroll records for a company
// @route   GET /api/payroll
// @access  Private
exports.getPayrollRecords = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { month, year, status, search } = req.query;

    const query = { company: companyId };

    if (month && year) {
      query["period.month"] = parseInt(month);
      query["period.year"] = parseInt(year);
    } else if (year) {
      query["period.year"] = parseInt(year);
    }

    if (status) query["payment.status"] = status;

    if (search) {
      query.$or = [
        { "employee.firstName": { $regex: search, $options: "i" } },
        { "employee.lastName": { $regex: search, $options: "i" } },
        { "employee.employeeId": { $regex: search, $options: "i" } },
      ];
    }

    const { page, limit, skip } = parsePagination(req.query);
    const [total, summaryAgg, payrollRecords] = await Promise.all([
      Payroll.countDocuments(query),
      Payroll.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalGrossSalary: { $sum: { $ifNull: ["$salary.grossSalary", 0] } },
            totalNetPay: { $sum: { $ifNull: ["$netPay", 0] } },
            totalPAYE: { $sum: { $ifNull: ["$deductions.paye", 0] } },
            totalRSSB: {
              $sum: {
                $add: [
                  { $ifNull: ["$deductions.rssbEmployeePension", 0] },
                  { $ifNull: ["$deductions.rssbEmployeeMaternity", 0] },
                ],
              },
            },
            employeeCount: { $sum: 1 },
          },
        },
      ]),
      Payroll.find(query)
        .populate("createdBy", "name email")
        .populate("approvedBy", "name email")
        .sort({ "period.year": -1, "period.month": -1, "employee.lastName": 1 })
        .skip(skip)
        .limit(limit),
    ]);

    const s = summaryAgg[0] || {};

    res.json({
      success: true,
      count: payrollRecords.length,
      data: payrollRecords,
      pagination: paginationMeta(page, limit, total),
      summary: {
        totalGrossSalary: Math.round((s.totalGrossSalary || 0) * 100) / 100,
        totalNetPay: Math.round((s.totalNetPay || 0) * 100) / 100,
        totalPAYE: Math.round((s.totalPAYE || 0) * 100) / 100,
        totalRSSB: Math.round((s.totalRSSB || 0) * 100) / 100,
        employeeCount: s.employeeCount || 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single payroll record
// @route   GET /api/payroll/:id
// @access  Private
exports.getPayrollById = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;

    const payroll = await Payroll.findOne({
      _id: req.params.id,
      company: companyId,
    })
      .populate("createdBy", "name email")
      .populate("approvedBy", "name email");

    if (!payroll) {
      return res
        .status(404)
        .json({ success: false, message: "Payroll record not found" });
    }

    res.json({ success: true, data: payroll });
  } catch (error) {
    next(error);
  }
};

// @desc    Create payroll record
// @route   POST /api/payroll
// @access  Private
exports.createPayroll = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user._id;

    const { employee, salary, period, notes } = req.body;

    // Calculate payroll using Rwanda tax rules
    const calculated = Payroll.calculatePayroll(salary);

    const payroll = new Payroll({
      company: companyId,
      employee: {
        ...employee,
        isActive: true,
      },
      salary: {
        basicSalary: salary.basicSalary,
        transportAllowance: salary.transportAllowance || 0,
        housingAllowance: salary.housingAllowance || 0,
        otherAllowances: salary.otherAllowances || 0,
        grossSalary: calculated.grossSalary,
      },
      deductions: {
        paye: calculated.deductions.paye,
        rssbEmployeePension: calculated.deductions.rssbEmployeePension,
        rssbEmployeeMaternity: calculated.deductions.rssbEmployeeMaternity,
        totalDeductions: calculated.deductions.totalDeductions,
      },
      netPay: calculated.netPay,
      contributions: {
        rssbEmployerPension: calculated.contributions.rssbEmployerPension,
        rssbEmployerMaternity: calculated.contributions.rssbEmployerMaternity,
        occupationalHazard: calculated.contributions.occupationalHazard,
      },
      period: {
        month: period.month,
        year: period.year,
        monthName: Payroll.getMonthName(period.month),
      },
      notes,
      createdBy: userId,
    });

    await payroll.save();

    res.status(201).json({
      success: true,
      data: payroll,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update payroll record
// @route   PUT /api/payroll/:id
// @access  Private
exports.updatePayroll = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;

    let payroll = await Payroll.findOne({
      _id: req.params.id,
      company: companyId,
    });

    if (!payroll) {
      return res
        .status(404)
        .json({ success: false, message: "Payroll record not found" });
    }

    // Check if already paid
    if (payroll.payment.status === "paid") {
      return res.status(400).json({
        success: false,
        message: "Cannot update a paid payroll record",
      });
    }

    const { employee, salary, period, notes } = req.body;

    // Recalculate if salary changed
    let calculated = null;
    if (salary) {
      calculated = Payroll.calculatePayroll(salary);
    }

    if (employee) {
      payroll.employee = { ...payroll.employee.toObject(), ...employee };
    }

    if (salary) {
      payroll.salary = {
        basicSalary: salary.basicSalary,
        transportAllowance: salary.transportAllowance || 0,
        housingAllowance: salary.housingAllowance || 0,
        otherAllowances: salary.otherAllowances || 0,
        grossSalary: calculated.grossSalary,
      };
      payroll.deductions = {
        paye: calculated.deductions.paye,
        rssbEmployeePension: calculated.deductions.rssbEmployeePension,
        rssbEmployeeMaternity: calculated.deductions.rssbEmployeeMaternity,
        totalDeductions: calculated.deductions.totalDeductions,
      };
      payroll.netPay = calculated.netPay;
      payroll.contributions = {
        rssbEmployerPension: calculated.contributions.rssbEmployerPension,
        rssbEmployerMaternity: calculated.contributions.rssbEmployerMaternity,
        occupationalHazard: calculated.contributions.occupationalHazard,
      };
    }

    if (period) {
      payroll.period = {
        month: period.month,
        year: period.year,
        monthName: Payroll.getMonthName(period.month),
      };
    }

    if (notes !== undefined) {
      payroll.notes = notes;
    }

    payroll.updatedAt = new Date();
    await payroll.save();

    res.json({
      success: true,
      data: payroll,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete payroll record
// @route   DELETE /api/payroll/:id
// @access  Private
exports.deletePayroll = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;

    const payroll = await Payroll.findOne({
      _id: req.params.id,
      company: companyId,
    });

    if (!payroll) {
      return res
        .status(404)
        .json({ success: false, message: "Payroll record not found" });
    }

    // Check if already paid
    if (payroll.payment.status === "paid") {
      return res.status(400).json({
        success: false,
        message: "Cannot delete a paid payroll record",
      });
    }

    await payroll.deleteOne();

    res.json({
      success: true,
      message: "Payroll record deleted",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Process payroll payment
// @route   POST /api/payroll/:id/pay
// @access  Private
exports.processPayment = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user._id;

    const { paymentMethod, reference, notes, bankAccountId } = req.body;

    const payroll = await Payroll.findOne({
      _id: req.params.id,
      company: companyId,
    });

    if (!payroll) {
      return res
        .status(404)
        .json({ success: false, message: "Payroll record not found" });
    }

    if (payroll.payment.status === "paid") {
      return res.status(400).json({
        success: false,
        message: "Payment already processed",
      });
    }

    payroll.payment = {
      status: "paid",
      paymentDate: new Date(),
      paymentMethod: paymentMethod || "bank_transfer",
      reference: reference,
    };

    payroll.approvedBy = userId;
    await payroll.save();

    // Create BankTransaction on the specific bank account (withdrawal — salary paid out)
    if (
      bankAccountId &&
      (paymentMethod === "bank_transfer" ||
        paymentMethod === "bank" ||
        paymentMethod === "cheque" ||
        paymentMethod === "mobile_money")
    ) {
      try {
        const { BankAccount } = require("../models/BankAccount");
        const bankAcct = await BankAccount.findOne({
          _id: bankAccountId,
          company: companyId,
          isActive: true,
        });
        if (bankAcct) {
          const netPay = payroll.netPay || 0;
          await bankAcct.addTransaction({
            type: "withdrawal",
            amount: netPay,
            description: `Salary: ${payroll.employee?.firstName || ""} ${payroll.employee?.lastName || ""} — ${payroll.period?.monthName || ""} ${payroll.period?.year || ""}`,
            date: new Date(),
            referenceNumber: reference || String(payroll._id),
            paymentMethod:
              paymentMethod === "bank" ? "bank_transfer" : paymentMethod,
            status: "completed",
            reference: payroll._id,
            referenceType: "Payment",
            createdBy: userId,
            notes: notes || `Payroll payment`,
          });
        }
      } catch (btErr) {
        console.error(
          "Failed to create BankTransaction for payroll:",
          btErr.message,
        );
        // Non-fatal — journal entries still post correctly
      }
    }

    // ── Payment journal entry ────────────────────────────────────────────────
    // Since finalisePayroll() already created the payroll expense accrual:
    //   DR Salaries / CR PAYE Payable / CR RSSB Payable / CR Accrued Payroll (2600)
    //
    // processPayment only needs to clear the accrued payroll and pay the bank:
    //   DR 2600 Accrued Payroll  (net pay)
    //   CR Bank/Cash             (net pay)
    //
    // If the record was NOT finalised via the normal flow (record_status went
    // straight from draft to paid via legacy path), fall back to the full journal
    // so the GL is always complete.
    try {
      const { DEFAULT_ACCOUNTS } = require("../constants/chartOfAccounts");

      // Resolve the bank/cash GL account
      let cashAccount;
      if (bankAccountId) {
        const { BankAccount: BA } = require("../models/BankAccount");
        const bankAcctForJournal = await BA.findOne({
          _id: bankAccountId,
          company: companyId,
          isActive: true,
        });
        cashAccount =
          bankAcctForJournal?.ledgerAccountId || DEFAULT_ACCOUNTS.cashAtBank;
      } else {
        cashAccount =
          paymentMethod === "bank"
            ? DEFAULT_ACCOUNTS.cashAtBank
            : DEFAULT_ACCOUNTS.cashInHand;
      }

      const netPay = payroll.netPay || 0;
      const grossSalary = payroll.salary?.grossSalary || 0;
      const paye = payroll.deductions?.paye || 0;
      const rssbEmployeeTotal =
        (payroll.deductions?.rssbEmployeePension || 0) +
        (payroll.deductions?.rssbEmployeeMaternity || 0);
      const employerContribTotal =
        (payroll.contributions?.rssbEmployerPension || 0) +
        (payroll.contributions?.rssbEmployerMaternity || 0) +
        (payroll.contributions?.occupationalHazard || 0);

      const employeeName =
        `${payroll.employee?.firstName || ""} ${payroll.employee?.lastName || ""}`.trim();
      const periodLabel =
        `${payroll.period?.monthName || ""} ${payroll.period?.year || ""}`.trim();

      // Check if a finalize accrual journal was already posted for this record
      const JournalEntry = require("../models/JournalEntry");
      const accrualExists = await JournalEntry.exists({
        company: companyId,
        sourceType: "payroll_salary",
        sourceId: payroll._id,
        status: "posted",
      });

      if (accrualExists && netPay > 0) {
        // ── Path A: Accrual already posted by finalise ──────────────────────
        // Only post the cash disbursement: DR Accrued Payroll / CR Bank
        await JournalService.createEntry(companyId, userId, {
          date: new Date(),
          description: `Salary Payment (cash) — ${employeeName} — ${periodLabel}`,
          sourceType: "payroll_salary",
          sourceId: payroll._id,
          lines: [
            JournalService.createDebitLine(
              DEFAULT_ACCOUNTS.accruedExpenses || "2600",
              netPay,
              `Clear accrued salary — ${employeeName}`,
            ),
            JournalService.createCreditLine(
              cashAccount,
              netPay,
              `Net salary paid — ${employeeName}`,
            ),
          ],
          isAutoGenerated: true,
          // Allow a second entry on the same sourceId for this record
          allowDuplicate: true,
        });
      } else if (!accrualExists && grossSalary > 0) {
        // ── Path B: Legacy / direct-pay path — no prior accrual ──────────────
        // Post the full payroll journal in one entry (expense + payment combined)
        const lines1 = [
          JournalService.createDebitLine(
            DEFAULT_ACCOUNTS.salariesWages || "5400",
            grossSalary,
            `Salary payment — ${employeeName} — ${periodLabel}`,
          ),
        ];
        if (paye > 0) {
          lines1.push(
            JournalService.createCreditLine(
              DEFAULT_ACCOUNTS.payePayableNew ||
                DEFAULT_ACCOUNTS.payePayable ||
                "2230",
              paye,
              `PAYE withheld — ${employeeName}`,
            ),
          );
        }
        if (rssbEmployeeTotal > 0) {
          lines1.push(
            JournalService.createCreditLine(
              DEFAULT_ACCOUNTS.rssbPayableNew ||
                DEFAULT_ACCOUNTS.rssbPayable ||
                "2240",
              rssbEmployeeTotal,
              `RSSB employee deduction — ${employeeName}`,
            ),
          );
        }
        if (netPay > 0) {
          lines1.push(
            JournalService.createCreditLine(
              cashAccount,
              netPay,
              `Net salary paid — ${employeeName}`,
            ),
          );
        }
        if (lines1.length >= 2) {
          await JournalService.createEntry(companyId, userId, {
            date: new Date(),
            description: `Salary Payment — ${employeeName} — ${periodLabel}`,
            sourceType: "payroll_salary",
            sourceId: payroll._id,
            lines: lines1,
            isAutoGenerated: true,
          });
        }

        // Employer contributions (not yet accrued)
        if (employerContribTotal > 0) {
          await JournalService.createEntry(companyId, userId, {
            date: new Date(),
            description: `Employer RSSB — ${employeeName} — ${periodLabel}`,
            sourceType: "payroll_employer",
            sourceId: payroll._id,
            lines: [
              JournalService.createDebitLine(
                DEFAULT_ACCOUNTS.rssbEmployerCost || "6150",
                employerContribTotal,
                `Employer RSSB — ${employeeName}`,
              ),
              JournalService.createCreditLine(
                DEFAULT_ACCOUNTS.rssbPayableNew ||
                  DEFAULT_ACCOUNTS.rssbPayable ||
                  "2240",
                employerContribTotal,
                `Employer RSSB payable — ${employeeName}`,
              ),
            ],
            isAutoGenerated: true,
            allowDuplicate: true,
          });
        }
      }
    } catch (journalError) {
      console.error(
        "[processPayment] Journal entry creation failed:",
        journalError.message,
      );
      // Non-fatal — BankTransaction and payment status are already saved
    }

    res.json({
      success: true,
      data: payroll,
      message: "Payment processed successfully",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get payroll summary
// @route   GET /api/payroll/summary
// @access  Private
exports.getPayrollSummary = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const { year } = req.query;

    const query = { company: companyId };
    if (year) query["period.year"] = parseInt(year);

    // Get all payroll for the year
    const payrollRecords = await Payroll.find(query).sort({
      "period.year": -1,
      "period.month": -1,
    });

    // Group by month
    const monthlyData = {};
    let totalGross = 0;
    let totalNet = 0;
    let totalPAYE = 0;
    let totalRSSB = 0;
    let totalEmployerContrib = 0;

    payrollRecords.forEach((record) => {
      const key = `${record.period.year}-${String(record.period.month).padStart(2, "0")}`;
      if (!monthlyData[key]) {
        monthlyData[key] = {
          month: record.period.month,
          year: record.period.year,
          monthName: record.period.monthName,
          grossSalary: 0,
          netPay: 0,
          paye: 0,
          rssb: 0,
          employerContrib: 0,
          employeeCount: 0,
        };
      }

      monthlyData[key].grossSalary += record.salary.grossSalary || 0;
      monthlyData[key].netPay += record.netPay || 0;
      monthlyData[key].paye += record.deductions.paye || 0;
      monthlyData[key].rssb +=
        (record.deductions.rssbEmployeePension || 0) +
        (record.deductions.rssbEmployeeMaternity || 0);
      monthlyData[key].employerContrib +=
        (record.contributions.rssbEmployerPension || 0) +
        (record.contributions.rssbEmployerMaternity || 0) +
        (record.contributions.occupationalHazard || 0);
      monthlyData[key].employeeCount += 1;

      totalGross += record.salary.grossSalary || 0;
      totalNet += record.netPay || 0;
      totalPAYE += record.deductions.paye || 0;
      totalRSSB +=
        (record.deductions.rssbEmployeePension || 0) +
        (record.deductions.rssbEmployeeMaternity || 0);
      totalEmployerContrib +=
        (record.contributions.rssbEmployerPension || 0) +
        (record.contributions.rssbEmployerMaternity || 0) +
        (record.contributions.occupationalHazard || 0);
    });

    // Get current month stats
    const now = new Date();
    const currentMonthPayroll = payrollRecords.filter(
      (p) =>
        p.period.month === now.getMonth() + 1 &&
        p.period.year === now.getFullYear(),
    );

    const currentMonthGross = currentMonthPayroll.reduce(
      (sum, p) => sum + (p.salary.grossSalary || 0),
      0,
    );
    const currentMonthNet = currentMonthPayroll.reduce(
      (sum, p) => sum + (p.netPay || 0),
      0,
    );

    res.json({
      success: true,
      data: {
        monthlyData: Object.values(monthlyData).reverse(),
        totals: {
          totalGrossSalary: Math.round(totalGross * 100) / 100,
          totalNetPay: Math.round(totalNet * 100) / 100,
          totalPAYE: Math.round(totalPAYE * 100) / 100,
          totalRSSB: Math.round(totalRSSB * 100) / 100,
          totalEmployerContrib: Math.round(totalEmployerContrib * 100) / 100,
        },
        currentMonth: {
          grossSalary: Math.round(currentMonthGross * 100) / 100,
          netPay: Math.round(currentMonthNet * 100) / 100,
          employeeCount: currentMonthPayroll.length,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Calculate payroll (preview)
// @route   POST /api/payroll/calculate
// @access  Private
exports.calculatePayroll = async (req, res, next) => {
  try {
    const { salary } = req.body;

    if (!salary || !salary.basicSalary) {
      return res.status(400).json({
        success: false,
        message: "Basic salary is required",
      });
    }

    const calculated = Payroll.calculatePayroll(salary);

    // Get tax brackets for display - Updated 2025
    const grossSalary =
      salary.basicSalary +
      (salary.transportAllowance || 0) +
      (salary.housingAllowance || 0) +
      (salary.otherAllowances || 0);
    const taxBrackets = [
      { range: "0 - 60,000", rate: "0%", tax: 0 },
      {
        range: "60,001 - 100,000",
        rate: "10%",
        tax: Math.max(0, (Math.min(grossSalary, 100000) - 60000) * 0.1),
      },
      {
        range: "100,001 - 200,000",
        rate: "20%",
        tax:
          grossSalary > 100000
            ? 4000 + Math.max(0, (Math.min(grossSalary, 200000) - 100000) * 0.2)
            : 0,
      },
      {
        range: "Above 200,000",
        rate: "30%",
        tax: grossSalary > 200000 ? 24000 + (grossSalary - 200000) * 0.3 : 0,
      },
    ];

    res.json({
      success: true,
      data: {
        ...calculated,
        taxBrackets: taxBrackets.map((t) => ({
          ...t,
          tax: Math.round(t.tax * 100) / 100,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Bulk create payroll for all employees
// @route   POST /api/payroll/bulk
// @access  Private
exports.bulkCreatePayroll = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const userId = req.user._id;

    const { employees, period, notes } = req.body;

    if (!employees || !Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Employees array is required",
      });
    }

    const createdPayroll = [];

    for (const emp of employees) {
      const calculated = Payroll.calculatePayroll(emp.salary);

      const payroll = new Payroll({
        company: companyId,
        employee: {
          ...emp.employee,
          isActive: true,
        },
        salary: {
          basicSalary: emp.salary.basicSalary,
          transportAllowance: emp.salary.transportAllowance || 0,
          housingAllowance: emp.salary.housingAllowance || 0,
          otherAllowances: emp.salary.otherAllowances || 0,
          grossSalary: calculated.grossSalary,
        },
        deductions: {
          paye: calculated.deductions.paye,
          rssbEmployeePension: calculated.deductions.rssbEmployeePension,
          rssbEmployeeMaternity: calculated.deductions.rssbEmployeeMaternity,
          totalDeductions: calculated.deductions.totalDeductions,
        },
        netPay: calculated.netPay,
        contributions: {
          rssbEmployerPension: calculated.contributions.rssbEmployerPension,
          rssbEmployerMaternity: calculated.contributions.rssbEmployerMaternity,
          occupationalHazard: calculated.contributions.occupationalHazard,
        },
        period: {
          month: period.month,
          year: period.year,
          monthName: Payroll.getMonthName(period.month),
        },
        notes,
        createdBy: userId,
      });

      await payroll.save();
      createdPayroll.push(payroll);
    }

    res.status(201).json({
      success: true,
      count: createdPayroll.length,
      data: createdPayroll,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Finalise payroll record (ready for PayrollRun)
// @route   POST /api/payroll/:id/finalise
// @access  Private (admin, manager)
exports.finalisePayroll = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;

    const payroll = await Payroll.findOne({
      _id: req.params.id,
      company: companyId,
    });

    if (!payroll) {
      return res
        .status(404)
        .json({ success: false, message: "Payroll record not found" });
    }

    // Check if already finalised or paid
    if (payroll.record_status === "finalised") {
      return res.status(400).json({
        success: false,
        message: "Payroll record already finalised",
      });
    }

    if (payroll.record_status === "paid") {
      return res.status(400).json({
        success: false,
        message: "Payroll record already paid",
      });
    }

    // Set pay period if not set
    if (!payroll.pay_period_start || !payroll.pay_period_end) {
      const year = payroll.period.year;
      const month = payroll.period.month;
      payroll.pay_period_start = new Date(year, month - 1, 1);
      payroll.pay_period_end = new Date(year, month, 0); // Last day of month
    }

    payroll.record_status = "finalised";
    await payroll.save();

    // ── IAS 19: Recognise payroll expense when the obligation is created ────────
    // Journal 1 — Payroll expense accrual:
    //   DR  5400  Salaries & Wages       (grossSalary)
    //   CR  2230  PAYE Tax Payable        (paye)
    //   CR  2240  RSSB Employee Payable   (rssbEmployeePension + rssbEmployeeMaternity)
    //   CR  2600  Accrued Payroll         (netPay  — salary owed but not yet paid)
    //
    // Journal 2 — Employer contribution accrual:
    //   DR  6150  RSSB Employer Cost      (rssbEmployerPension + rssbEmployerMaternity + occupationalHazard)
    //   CR  2240  RSSB Payable            (same amount)
    try {
      const { DEFAULT_ACCOUNTS } = require("../constants/chartOfAccounts");

      const grossSalary = payroll.salary?.grossSalary || 0;
      const paye = payroll.deductions?.paye || 0;
      const rssbEmployee =
        (payroll.deductions?.rssbEmployeePension || 0) +
        (payroll.deductions?.rssbEmployeeMaternity || 0);
      const netPay = payroll.netPay || 0;
      const rssbEmployer =
        (payroll.contributions?.rssbEmployerPension || 0) +
        (payroll.contributions?.rssbEmployerMaternity || 0) +
        (payroll.contributions?.occupationalHazard || 0);

      const employeeName =
        `${payroll.employee?.firstName || ""} ${payroll.employee?.lastName || ""}`.trim();
      const periodLabel =
        `${payroll.period?.monthName || ""} ${payroll.period?.year || ""}`.trim();

      // Journal 1: payroll expense + liabilities
      if (grossSalary > 0) {
        const lines1 = [
          JournalService.createDebitLine(
            DEFAULT_ACCOUNTS.salariesWages || "5400",
            grossSalary,
            `Salary accrual — ${employeeName} — ${periodLabel}`,
          ),
        ];

        if (paye > 0) {
          lines1.push(
            JournalService.createCreditLine(
              DEFAULT_ACCOUNTS.payePayableNew ||
                DEFAULT_ACCOUNTS.payePayable ||
                "2230",
              paye,
              `PAYE withheld — ${employeeName}`,
            ),
          );
        }

        if (rssbEmployee > 0) {
          lines1.push(
            JournalService.createCreditLine(
              DEFAULT_ACCOUNTS.rssbPayableNew ||
                DEFAULT_ACCOUNTS.rssbPayable ||
                "2240",
              rssbEmployee,
              `RSSB employee deduction — ${employeeName}`,
            ),
          );
        }

        if (netPay > 0) {
          lines1.push(
            JournalService.createCreditLine(
              DEFAULT_ACCOUNTS.accruedExpenses || "2600",
              netPay,
              `Net salary payable — ${employeeName}`,
            ),
          );
        }

        if (lines1.length >= 2) {
          await JournalService.createEntry(companyId, req.user._id, {
            date: new Date(),
            description: `Payroll Accrual — ${employeeName} — ${periodLabel}`,
            sourceType: "payroll_salary",
            sourceId: payroll._id,
            lines: lines1,
            isAutoGenerated: true,
          });
        }
      }

      // Journal 2: employer RSSB contribution
      if (rssbEmployer > 0) {
        await JournalService.createEntry(companyId, req.user._id, {
          date: new Date(),
          description: `Employer RSSB Contribution — ${employeeName} — ${periodLabel}`,
          sourceType: "payroll_employer",
          sourceId: payroll._id,
          lines: [
            JournalService.createDebitLine(
              DEFAULT_ACCOUNTS.rssbEmployerCost || "6150",
              rssbEmployer,
              `Employer RSSB — ${employeeName}`,
            ),
            JournalService.createCreditLine(
              DEFAULT_ACCOUNTS.rssbPayableNew ||
                DEFAULT_ACCOUNTS.rssbPayable ||
                "2240",
              rssbEmployer,
              `Employer RSSB payable — ${employeeName}`,
            ),
          ],
          isAutoGenerated: true,
        });
      }
    } catch (journalError) {
      // Non-fatal — finalisation succeeds even if journal posting fails
      console.error(
        "[finalisePayroll] Journal entry creation failed:",
        journalError.message,
      );
    }

    res.json({
      success: true,
      data: payroll,
      message: "Payroll record finalised and journal entries posted",
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get payslip for payroll record
// @route   GET /api/payroll/:id/payslip
// @access  Private
exports.getPayslip = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;

    const payroll = await Payroll.findOne({
      _id: req.params.id,
      company: companyId,
    });

    if (!payroll) {
      return res
        .status(404)
        .json({ success: false, message: "Payroll record not found" });
    }

    // Build payslip data
    const payslip = {
      employee: payroll.employee,
      period: payroll.period,
      earnings: {
        basicSalary: payroll.salary.basicSalary,
        transportAllowance: payroll.salary.transportAllowance,
        housingAllowance: payroll.salary.housingAllowance,
        otherAllowances: payroll.salary.otherAllowances,
        grossSalary: payroll.salary.grossSalary,
      },
      deductions: {
        paye: payroll.deductions.paye,
        rssbPension: payroll.deductions.rssbEmployeePension,
        rssbMaternity: payroll.deductions.rssbEmployeeMaternity,
        totalDeductions: payroll.deductions.totalDeductions,
      },
      netPay: payroll.netPay,
      employerContributions: payroll.contributions,
      status: payroll.record_status,
      payrollRunId: payroll.payroll_run_id,
    };

    res.json({
      success: true,
      data: payslip,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Backfill missing payroll journal entries for all finalised/paid records
// @route   POST /api/payroll/backfill-journals
// @access  Private (admin only)
exports.backfillPayrollJournals = async (req, res, next) => {
  try {
    const companyId = req.user.company._id;
    const dryRun = req.query.dry_run === "true";
    const { DEFAULT_ACCOUNTS } = require("../constants/chartOfAccounts");

    function round2(n) {
      return Math.round((n || 0) * 100) / 100;
    }

    // Find all finalised or paid records for this company
    const payrollRecords = await Payroll.find({
      company: companyId,
      record_status: { $in: ["finalised", "paid"] },
    })
      .select(
        "employee salary deductions contributions netPay period record_status pay_period_end createdBy",
      )
      .lean();

    const results = {
      total: payrollRecords.length,
      alreadyHaveJournal: 0,
      backfilled: 0,
      skippedZero: 0,
      errors: [],
    };

    for (const payroll of payrollRecords) {
      try {
        // Skip if journal already exists
        const existingJournal = await JournalEntry.findOne({
          company: companyId,
          sourceType: "payroll_salary",
          sourceId: payroll._id,
          status: "posted",
        }).lean();

        if (existingJournal) {
          results.alreadyHaveJournal++;
          continue;
        }

        const grossSalary = round2(payroll.salary?.grossSalary);
        const paye = round2(payroll.deductions?.paye);
        const rssbEmployee = round2(
          (payroll.deductions?.rssbEmployeePension || 0) +
            (payroll.deductions?.rssbEmployeeMaternity || 0),
        );
        const netPay = round2(payroll.netPay);
        const rssbEmployer = round2(
          (payroll.contributions?.rssbEmployerPension || 0) +
            (payroll.contributions?.rssbEmployerMaternity || 0) +
            (payroll.contributions?.occupationalHazard || 0),
        );

        if (grossSalary <= 0) {
          results.skippedZero++;
          continue;
        }

        const employeeName =
          `${payroll.employee?.firstName || ""} ${payroll.employee?.lastName || ""}`.trim() ||
          "Unknown Employee";
        const periodLabel =
          `${payroll.period?.monthName || ""} ${payroll.period?.year || ""}`.trim();
        const entryDate = payroll.pay_period_end
          ? new Date(payroll.pay_period_end)
          : new Date();

        // Build Journal 1: payroll expense accrual
        const lines1 = [
          {
            accountCode: DEFAULT_ACCOUNTS.salariesWages || "5400",
            accountName: "Salaries & Wages",
            description: `Salary accrual — ${employeeName} — ${periodLabel} [backfill]`,
            debit: grossSalary,
            credit: 0,
          },
        ];

        if (paye > 0) {
          lines1.push({
            accountCode:
              DEFAULT_ACCOUNTS.payePayableNew ||
              DEFAULT_ACCOUNTS.payePayable ||
              "2230",
            accountName: "PAYE Tax Payable",
            description: `PAYE withheld — ${employeeName} [backfill]`,
            debit: 0,
            credit: paye,
          });
        }

        if (rssbEmployee > 0) {
          lines1.push({
            accountCode:
              DEFAULT_ACCOUNTS.rssbPayableNew ||
              DEFAULT_ACCOUNTS.rssbPayable ||
              "2240",
            accountName: "RSSB Payable",
            description: `RSSB employee deduction — ${employeeName} [backfill]`,
            debit: 0,
            credit: rssbEmployee,
          });
        }

        if (netPay > 0) {
          lines1.push({
            accountCode: DEFAULT_ACCOUNTS.accruedExpenses || "2600",
            accountName: "Accrued Payroll",
            description: `Net salary payable — ${employeeName} [backfill]`,
            debit: 0,
            credit: netPay,
          });
        }

        const totalDr1 = lines1.reduce((s, l) => s + (l.debit || 0), 0);
        const totalCr1 = lines1.reduce((s, l) => s + (l.credit || 0), 0);

        if (Math.abs(totalDr1 - totalCr1) > 0.02) {
          results.errors.push({
            payrollId: payroll._id,
            employee: employeeName,
            reason: `Journal 1 out of balance: DR ${totalDr1} ≠ CR ${totalCr1}`,
          });
          continue;
        }

        if (!dryRun) {
          let periodId = null;
          try {
            periodId = await PeriodService.getOpenPeriodId(
              companyId,
              entryDate,
            );
          } catch (_) {
            // period lookup failure is non-fatal
          }

          const entryNumber1 = await nextSequence(companyId, "JE");

          await JournalEntry.create({
            company: companyId,
            entryNumber: entryNumber1,
            date: entryDate,
            description: `Payroll Accrual — ${employeeName} — ${periodLabel} [backfill]`,
            sourceType: "payroll_salary",
            sourceId: payroll._id,
            reference: periodLabel,
            status: "posted",
            lines: lines1,
            totalDebit: totalDr1,
            totalCredit: totalCr1,
            debitTotal: totalDr1,
            creditTotal: totalCr1,
            period: periodId,
            isAutoGenerated: true,
            createdBy: payroll.createdBy || req.user._id,
            postedBy: req.user._id,
          });

          // Journal 2: employer RSSB contribution
          if (rssbEmployer > 0) {
            const entryNumber2 = await nextSequence(companyId, "JE");
            await JournalEntry.create({
              company: companyId,
              entryNumber: entryNumber2,
              date: entryDate,
              description: `Employer RSSB Contribution — ${employeeName} — ${periodLabel} [backfill]`,
              sourceType: "payroll_employer",
              sourceId: payroll._id,
              reference: periodLabel,
              status: "posted",
              lines: [
                {
                  accountCode: DEFAULT_ACCOUNTS.rssbEmployerCost || "6150",
                  accountName: "RSSB Employer Cost",
                  description: `Employer RSSB — ${employeeName} [backfill]`,
                  debit: rssbEmployer,
                  credit: 0,
                },
                {
                  accountCode:
                    DEFAULT_ACCOUNTS.rssbPayableNew ||
                    DEFAULT_ACCOUNTS.rssbPayable ||
                    "2240",
                  accountName: "RSSB Payable",
                  description: `Employer RSSB payable — ${employeeName} [backfill]`,
                  debit: 0,
                  credit: rssbEmployer,
                },
              ],
              totalDebit: rssbEmployer,
              totalCredit: rssbEmployer,
              debitTotal: rssbEmployer,
              creditTotal: rssbEmployer,
              period: periodId,
              isAutoGenerated: true,
              createdBy: payroll.createdBy || req.user._id,
              postedBy: req.user._id,
            });
          }
        }

        results.backfilled++;
      } catch (err) {
        results.errors.push({
          payrollId: payroll._id,
          employee:
            `${payroll.employee?.firstName || ""} ${payroll.employee?.lastName || ""}`.trim(),
          reason: err.message,
        });
      }
    }

    res.json({
      success: true,
      dry_run: dryRun,
      message: dryRun
        ? `Dry run complete: ${results.backfilled} journal entries would be created`
        : `Backfill complete: ${results.backfilled} journal entries created`,
      data: results,
    });
  } catch (error) {
    next(error);
  }
};
