const mongoose = require("mongoose");
const PayrollRun = require("../models/PayrollRun");
const Payroll = require("../models/Payroll");
const JournalEntry = require("../models/JournalEntry");
const ChartOfAccount = require("../models/ChartOfAccount");
const { BankAccount } = require("../models/BankAccount");
const { nextSequence } = require("./sequenceService");
const PeriodService = require("./periodService");

class PayrollRunService {
  // ── PREVIEW JOURNAL ENTRY ─────────────────────────────────────────────
  static async preview(companyId, data) {
    const payrollRecords = await Payroll.find({
      company: companyId,
      record_status: "finalised",
      "period.month": data.pay_period_start.getMonth() + 1,
      "period.year": data.pay_period_start.getFullYear(),
    });

    if (payrollRecords.length === 0) {
      throw new Error("NO_FINALISED_RECORDS");
    }

    const totals = payrollRecords.reduce(
      (acc, p) => {
        acc.gross += p.salary?.grossSalary || 0;
        acc.tax += p.deductions?.paye || 0;
        acc.rssbEmployee +=
          (p.deductions?.rssbEmployeePension || 0) +
          (p.deductions?.rssbEmployeeMaternity || 0);
        acc.rssbEmployer +=
          (p.contributions?.rssbEmployerPension || 0) +
          (p.contributions?.rssbEmployerMaternity || 0);
        acc.net += p.netPay || 0;
        return acc;
      },
      { gross: 0, tax: 0, rssbEmployee: 0, rssbEmployer: 0, net: 0 },
    );

    const salaryAccount = await ChartOfAccount.findById(data.salary_account_id);
    const taxPayableAccount = await ChartOfAccount.findById(
      data.tax_payable_account_id,
    );
    const bankAccount = await BankAccount.findById(data.bank_account_id);

    const lines = [
      {
        accountCode: salaryAccount?.code || "6100",
        accountName: salaryAccount?.name || "Salaries & Wages",
        description: `Gross payroll ${data.pay_period_start.toISOString().split("T")[0]} to ${data.pay_period_end.toISOString().split("T")[0]}`,
        debit: totals.gross,
        credit: 0,
      },
      {
        accountCode: taxPayableAccount?.code || "2230",
        accountName: taxPayableAccount?.name || "PAYE Payable",
        description: "PAYE tax withheld",
        debit: 0,
        credit: totals.tax,
      },
      {
        accountCode: bankAccount?.accountCode || "1100",
        accountName: bankAccount?.name || "Cash at Bank",
        description: "Net salary payments",
        debit: 0,
        credit: totals.net,
      },
    ];

    if (totals.rssbEmployee > 0 || totals.rssbEmployer > 0) {
      lines.push({
        accountCode: "2210",
        accountName: "RSSB Payable",
        description: "RSSB deductions",
        debit: 0,
        credit: totals.rssbEmployee + totals.rssbEmployer,
      });
    }

    return {
      employeeCount: payrollRecords.length,
      totals,
      lines,
      isBalanced:
        lines.reduce((s, l) => s + l.debit, 0) ===
        lines.reduce((s, l) => s + l.credit, 0),
    };
  }

  // ── GET AVAILABLE PERIODS (months with finalised, unprocessed records) ──
  /**
   * Returns an array of { month, year, count, totalGross, totalNet } for every
   * calendar month that has at least one finalised, unassigned Payroll record.
   * Used by the UI to populate the month/year picker before creating a run.
   */
  static async getAvailablePeriods(companyId) {
    const results = await Payroll.aggregate([
      {
        $match: {
          company: new (require("mongoose").Types.ObjectId)(companyId),
          record_status: "finalised",
          $or: [
            { payroll_run_id: null },
            { payroll_run_id: { $exists: false } }
          ]
        },
      },
      {
        $group: {
          _id: { month: "$period.month", year: "$period.year" },
          count: { $sum: 1 },
          totalGross: { $sum: { $ifNull: ["$salary.grossSalary", 0] } },
          totalNet: { $sum: { $ifNull: ["$netPay", 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          month: "$_id.month",
          year: "$_id.year",
          count: 1,
          totalGross: 1,
          totalNet: 1,
        },
      },
      { $sort: { year: -1, month: -1 } },
    ]);
    return results;
  }

  // ── CREATE FROM FINALISED RECORDS ─────────────────────────────────────
  static async createFromRecords(companyId, data, userId) {
    // ── Determine which period to process ────────────────────────────────────
    // If the caller supplies explicit period_month/period_year, use those.
    // Otherwise fall back to deriving from pay_period_start (legacy path).
    let filterMonth, filterYear;

    if (data.period_month && data.period_year) {
      filterMonth = parseInt(data.period_month, 10);
      filterYear = parseInt(data.period_year, 10);
    } else if (data.pay_period_start) {
      filterMonth = data.pay_period_start.getMonth() + 1;
      filterYear = data.pay_period_start.getFullYear();
    } else {
      throw new Error(
        "PERIOD_REQUIRED: Please provide period_month and period_year.",
      );
    }

    const payrollRecords = await Payroll.find({
      company: companyId,
      record_status: "finalised",
      $or: [
        { payroll_run_id: null },
        { payroll_run_id: { $exists: false } }
      ],
      "period.month": filterMonth,
      "period.year": filterYear,
    });

    if (payrollRecords.length === 0) {
      const err = new Error(
        `NO_FINALISED_RECORDS: No finalised payroll records found for ${filterMonth}/${filterYear}. ` +
          `Please go to Payroll, create and finalise employee records for that month first.`,
      );
      err.statusCode = 422;
      throw err;
    }

    let totalGross = 0;
    let totalTax = 0;
    let totalRssbEmployee = 0;
    let totalRssbEmployer = 0;
    let totalNet = 0;
    const lines = [];

    payrollRecords.forEach((p) => {
      totalGross += p.salary?.grossSalary || 0;
      totalTax += p.deductions?.paye || 0;
      totalRssbEmployee +=
        (p.deductions?.rssbEmployeePension || 0) +
        (p.deductions?.rssbEmployeeMaternity || 0);
      totalRssbEmployer +=
        (p.contributions?.rssbEmployerPension || 0) +
        (p.contributions?.rssbEmployerMaternity || 0);
      totalNet += p.netPay || 0;

      lines.push({
        employee_name: `${p.employee?.firstName} ${p.employee?.lastName}`,
        employee_id: p.employee?.employeeId || "N/A",
        gross_salary: p.salary?.grossSalary || 0,
        tax_deduction: p.deductions?.paye || 0,
        other_deductions:
          (p.deductions?.rssbEmployeePension || 0) +
          (p.deductions?.rssbEmployeeMaternity || 0),
        rssb_employer:
          (p.contributions?.rssbEmployerPension || 0) +
          (p.contributions?.rssbEmployerMaternity || 0),
        net_pay: p.netPay || 0,
        payroll_id: p._id,
      });
    });

    const expectedNet = totalGross - totalTax - totalRssbEmployee;
    if (Math.abs(expectedNet - totalNet) > 0.01) {
      throw new Error("PAYROLL_TOTALS_MISMATCH");
    }

    await ChartOfAccount.findOne({
      _id: data.salary_account_id,
      company: companyId,
    });
    await ChartOfAccount.findOne({
      _id: data.tax_payable_account_id,
      company: companyId,
    });
    await BankAccount.findOne({
      _id: data.bank_account_id,
      company: companyId,
    });

    const refNo = await nextSequence(companyId, "PYRL");

    const payrollRun = await PayrollRun.create({
      company: companyId,
      reference_no: refNo,
      pay_period_start: data.pay_period_start,
      pay_period_end: data.pay_period_end,
      payment_date: data.payment_date,
      status: "draft",
      total_gross: totalGross,
      total_tax: totalTax,
      total_other_deductions: totalRssbEmployee,
      total_net: totalNet,
      bank_account_id: data.bank_account_id,
      salary_account_id: data.salary_account_id,
      tax_payable_account_id: data.tax_payable_account_id,
      other_deductions_account_id: data.other_deductions_account_id,
      lines,
      employee_count: payrollRecords.length,
      notes: data.notes || null,
      posted_by: null,
    });

    await Payroll.updateMany(
      { _id: { $in: payrollRecords.map((p) => p._id) } },
      { payroll_run_id: payrollRun._id },
    );

    return payrollRun;
  }

  // ── CREATE DRAFT PAYROLL RUN ─────────────────────────────────────────────
  static async create(companyId, data, userId) {
    const salaryAccount = await ChartOfAccount.findOne({
      _id: data.salary_account_id,
      company: companyId,
    });
    if (!salaryAccount) {
      const error = new Error("NOT_FOUND");
      error.statusCode = 404;
      throw error;
    }

    const taxPayableAccount = await ChartOfAccount.findOne({
      _id: data.tax_payable_account_id,
      company: companyId,
    });
    if (!taxPayableAccount) {
      const error = new Error("NOT_FOUND");
      error.statusCode = 404;
      throw error;
    }

    if (data.total_other_deductions > 0 && !data.other_deductions_account_id) {
      throw new Error("OTHER_DEDUCTIONS_ACCOUNT_REQUIRED");
    }

    if (data.other_deductions_account_id) {
      const otherDedAccount = await ChartOfAccount.findOne({
        _id: data.other_deductions_account_id,
        company: companyId,
      });
      if (!otherDedAccount) {
        const error = new Error("NOT_FOUND");
        error.statusCode = 404;
        throw error;
      }
    }

    const bankAccount = await BankAccount.findOne({
      _id: data.bank_account_id,
      company: companyId,
    });
    if (!bankAccount) {
      const error = new Error("NOT_FOUND");
      error.statusCode = 404;
      throw error;
    }

    const expectedNet =
      data.total_gross - data.total_tax - data.total_other_deductions;
    if (Math.abs(expectedNet - data.total_net) > 0.01) {
      throw new Error("PAYROLL_TOTALS_MISMATCH");
    }

    const lineGross = data.lines.reduce(
      (sum, l) => sum + (l.gross_salary || 0),
      0,
    );
    const lineTax = data.lines.reduce(
      (sum, l) => sum + (l.tax_deduction || 0),
      0,
    );
    const lineOther = data.lines.reduce(
      (sum, l) => sum + (l.other_deductions || 0),
      0,
    );
    const lineNet = data.lines.reduce((sum, l) => sum + (l.net_pay || 0), 0);

    if (Math.abs(lineGross - data.total_gross) > 0.01)
      throw new Error("PAYROLL_LINE_GROSS_MISMATCH");
    if (Math.abs(lineTax - data.total_tax) > 0.01)
      throw new Error("PAYROLL_LINE_TAX_MISMATCH");
    if (Math.abs(lineNet - data.total_net) > 0.01)
      throw new Error("PAYROLL_LINE_NET_MISMATCH");

    const refNo = await nextSequence(companyId, "PYRL");

    const payrollRun = await PayrollRun.create({
      company: companyId,
      reference_no: refNo,
      pay_period_start: data.pay_period_start,
      pay_period_end: data.pay_period_end,
      payment_date: data.payment_date,
      status: "draft",
      total_gross: data.total_gross,
      total_tax: data.total_tax,
      total_other_deductions: data.total_other_deductions || 0,
      total_net: data.total_net,
      bank_account_id: data.bank_account_id,
      salary_account_id: data.salary_account_id,
      tax_payable_account_id: data.tax_payable_account_id,
      other_deductions_account_id: data.other_deductions_account_id || null,
      lines: data.lines,
      notes: data.notes || null,
      posted_by: null,
    });

    return payrollRun;
  }

  // ── POST PAYROLL RUN ────────────────────────────────────────────────────
  static async post(companyId, runId, userId) {
    const payrollRun = await PayrollRun.findOne({
      _id: runId,
      company: companyId,
    });

    if (!payrollRun) {
      const error = new Error("NOT_FOUND");
      error.statusCode = 404;
      throw error;
    }

    if (payrollRun.status !== "draft") {
      throw new Error("PAYROLL_ALREADY_POSTED");
    }

    const salaryAccount = await ChartOfAccount.findOne({
      _id: payrollRun.salary_account_id,
      company: companyId,
    });
    if (!salaryAccount) {
      const error = new Error("NOT_FOUND");
      error.statusCode = 404;
      throw error;
    }

    const taxPayableAccount = await ChartOfAccount.findOne({
      _id: payrollRun.tax_payable_account_id,
      company: companyId,
    });
    if (!taxPayableAccount) {
      const error = new Error("NOT_FOUND");
      error.statusCode = 404;
      throw error;
    }

    const bankAccount = await BankAccount.findOne({
      _id: payrollRun.bank_account_id,
      company: companyId,
    });
    if (!bankAccount) {
      const error = new Error("NOT_FOUND");
      error.statusCode = 404;
      throw error;
    }

    let otherDedAccount = null;
    if (
      payrollRun.total_other_deductions > 0 &&
      payrollRun.other_deductions_account_id
    ) {
      otherDedAccount = await ChartOfAccount.findOne({
        _id: payrollRun.other_deductions_account_id,
        company: companyId,
      });
    }

    const periodId = await PeriodService.getOpenPeriodId(
      companyId,
      payrollRun.payment_date,
    );

    try {
      const entryNumber = await nextSequence(companyId, "JE");

      // Calculate employer contributions from employee records
      const employerContributions = payrollRun.lines.reduce((sum, l) => {
        return sum + (l.rssb_employer || 0);
      }, 0);

      // ── Determine whether the individual payroll records were already accrued ───
      // If finalisePayroll() was called for each record before creating this run,
      // each record already has:
      //   DR Salaries / CR PAYE / CR RSSB / CR Accrued Payroll (2600)
      //   DR RSSB Employer Cost / CR RSSB Payable
      //
      // In that case the PayrollRun only needs to post the CASH DISBURSEMENT:
      //   DR Accrued Payroll (2600)  [net_pay]
      //   CR Bank                    [net_pay]
      //
      // If the records were NOT individually accrued (legacy / shortcut path),
      // fall back to the full payroll journal so the GL is always complete.
      const JournalEntry = require("../models/JournalEntry");
      const payrollIds = payrollRun.lines
        .map((l) => l.payroll_id)
        .filter(Boolean);

      let accrualCount = 0;
      if (payrollIds.length > 0) {
        accrualCount = await JournalEntry.countDocuments({
          company: companyId,
          sourceType: "payroll_salary",
          sourceId: { $in: payrollIds },
          status: "posted",
        });
      }

      const accrualAlreadyPosted = accrualCount > 0;

      let lines = [];

      if (accrualAlreadyPosted) {
        // ── Path A: accruals exist → only post the cash disbursement ───────────
        // DR Accrued Payroll (2600) / CR Bank
        if (payrollRun.total_net > 0) {
          lines.push({
            accountCode: "2600",
            accountName: "Accrued Payroll",
            description: `Clear accrued salaries ${payrollRun.pay_period_start.toISOString().split("T")[0]} – ${payrollRun.pay_period_end.toISOString().split("T")[0]}`,
            debit: payrollRun.total_net,
            credit: 0,
          });
          lines.push({
            accountCode: bankAccount.ledgerAccountId || "1100",
            accountName: bankAccount.name || "Cash at Bank",
            description: "Net salary payments disbursed",
            debit: 0,
            credit: payrollRun.total_net,
          });
        }
      } else {
        // ── Path B: no prior accruals → post the full payroll journal ──────────
        // DR Salaries / DR RSSB Employer Cost / CR PAYE / CR RSSB / CR Bank
        lines.push({
          accountCode: salaryAccount.code,
          accountName: salaryAccount.name,
          description: `Gross payroll ${payrollRun.pay_period_start.toISOString().split("T")[0]} to ${payrollRun.pay_period_end.toISOString().split("T")[0]}`,
          debit: payrollRun.total_gross,
          credit: 0,
        });

        // DR RSSB Employer Contributions (6150 = RSSB Employer Cost)
        if (employerContributions > 0) {
          lines.push({
            accountCode: "6150",
            accountName: "RSSB Employer Cost",
            description: "RSSB employer contributions",
            debit: employerContributions,
            credit: 0,
          });
        }

        // CR Tax Payable — PAYE withheld
        if (payrollRun.total_tax > 0) {
          lines.push({
            accountCode: taxPayableAccount.code,
            accountName: taxPayableAccount.name,
            description: "PAYE tax withheld",
            debit: 0,
            credit: payrollRun.total_tax,
          });
        }

        // CR RSSB Payable — employee + employer contributions (2240)
        if (
          payrollRun.total_other_deductions > 0 ||
          employerContributions > 0
        ) {
          const rssbTotal =
            (payrollRun.total_other_deductions || 0) + employerContributions;
          lines.push({
            accountCode: otherDedAccount?.code || "2240",
            accountName: otherDedAccount?.name || "RSSB Payable",
            description: "RSSB employee & employer contributions",
            debit: 0,
            credit: rssbTotal,
          });
        }

        // CR Bank — net pay disbursed
        if (payrollRun.total_net > 0) {
          lines.push({
            accountCode: bankAccount.ledgerAccountId || "1100",
            accountName: bankAccount.name || "Cash at Bank",
            description: "Net salary payments",
            debit: 0,
            credit: payrollRun.total_net,
          });
        }
      }

      const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
      const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);

      const journalEntry = await JournalEntry.create({
        company: companyId,
        entryNumber,
        date: payrollRun.payment_date,
        description: `Payroll - ${payrollRun.pay_period_start.toISOString().split("T")[0]} to ${payrollRun.pay_period_end.toISOString().split("T")[0]} - PYRL#${payrollRun.reference_no}`,
        sourceType: "payroll_run",
        sourceId: payrollRun._id.toString(),
        reference: payrollRun.reference_no,
        status: "posted",
        lines,
        totalDebit,
        totalCredit,
        debitTotal: totalDebit,
        creditTotal: totalCredit,
        postedBy: userId,
        period: periodId,
        isAutoGenerated: false,
      });

      // Update payroll run status
      payrollRun.status = "posted";
      payrollRun.journal_entry_id = journalEntry._id;
      payrollRun.posted_by = userId;
      payrollRun.employee_count = payrollRun.lines?.length || 0;
      await payrollRun.save();

      // Update employee records to paid status
      await Payroll.updateMany(
        { payroll_run_id: payrollRun._id },
        { record_status: "paid" },
      );

      // Create BankTransaction to reduce bank balance (net salary disbursement)
      // Uses addTransaction() so cachedBalance is correctly updated and per-account
      // transaction history is populated.
      if (bankAccount && payrollRun.total_net > 0) {
        try {
          await bankAccount.addTransaction({
            type: "withdrawal",
            amount: payrollRun.total_net,
            description: `Payroll net pay — ${payrollRun.pay_period_start.toISOString().split("T")[0]} to ${payrollRun.pay_period_end.toISOString().split("T")[0]} — PYRL#${payrollRun.reference_no}`,
            date: payrollRun.payment_date || new Date(),
            referenceNumber: payrollRun.reference_no,
            referenceType: "Payment",
            reference: payrollRun._id,
            createdBy: userId,
            notes: `Payroll run ${payrollRun.reference_no}`,
            journalEntryId: journalEntry._id,
          });
        } catch (btErr) {
          console.error(
            "BankTransaction creation failed for payroll run post:",
            btErr.message,
          );
          // Non-fatal — journal entry already posted
        }
      }

      return payrollRun;
    } catch (err) {
      throw err;
    }
  }

  // ── REVERSE PAYROLL RUN ─────────────────────────────────────────────────
  static async reverse(companyId, runId, data, userId) {
    const payrollRun = await PayrollRun.findOne({
      _id: runId,
      company: companyId,
    });

    if (!payrollRun) {
      const error = new Error("NOT_FOUND");
      error.statusCode = 404;
      throw error;
    }

    if (payrollRun.status === "reversed") {
      throw new Error("PAYROLL_ALREADY_REVERSED");
    }

    if (payrollRun.status !== "posted") {
      throw new Error("PAYROLL_NOT_POSTED");
    }

    if (!payrollRun.journal_entry_id) {
      throw new Error("NO_JOURNAL_ENTRY");
    }

    try {
      const originalEntry = await JournalEntry.findById(
        payrollRun.journal_entry_id,
      );
      if (!originalEntry) {
        throw new Error("JOURNAL_ENTRY_NOT_FOUND");
      }

      const periodId = await PeriodService.getOpenPeriodId(
        companyId,
        data.reversal_date || new Date(),
      );

      const reversalEntryNumber = await nextSequence(companyId, "JE");

      const reversalLines = originalEntry.lines.map((line) => ({
        accountCode: line.accountCode,
        accountName: line.accountName,
        description: `REVERSAL: ${line.description}`,
        debit: line.credit || 0,
        credit: line.debit || 0,
      }));

      const reversalEntry = await JournalEntry.create({
        company: companyId,
        entryNumber: reversalEntryNumber,
        date: data.reversal_date || new Date(),
        description: `Payroll Reversal - ${payrollRun.reference_no}`,
        sourceType: "payroll_reversal",
        sourceId: payrollRun._id.toString(),
        reference: payrollRun.reference_no,
        status: "posted",
        lines: reversalLines,
        totalDebit: originalEntry.totalDebit,
        totalCredit: originalEntry.totalCredit,
        debitTotal: originalEntry.debitTotal,
        creditTotal: originalEntry.creditTotal,
        postedBy: userId,
        period: periodId,
        isAutoGenerated: false,
      });

      payrollRun.status = "reversed";
      payrollRun.reversal_journal_entry_id = reversalEntry._id;
      await payrollRun.save();

      // Set employee records back to finalised status
      await Payroll.updateMany(
        { payroll_run_id: payrollRun._id },
        { record_status: "finalised" },
      );

      // Create BankTransaction to restore bank balance on reversal
      const bankAccountForReversal = await BankAccount.findOne({
        _id: payrollRun.bank_account_id,
        company: companyId,
      });
      if (bankAccountForReversal && payrollRun.total_net > 0) {
        try {
          await bankAccountForReversal.addTransaction({
            type: "deposit",
            amount: payrollRun.total_net,
            description: `Payroll reversal — PYRL#${payrollRun.reference_no}`,
            date: data.reversal_date || new Date(),
            referenceNumber: payrollRun.reference_no,
            referenceType: "Payment",
            reference: payrollRun._id,
            createdBy: userId,
            notes: `Reversal of payroll run ${payrollRun.reference_no}`,
            journalEntryId: reversalEntry._id,
          });
        } catch (btErr) {
          console.error(
            "BankTransaction creation failed for payroll run reversal:",
            btErr.message,
          );
          // Non-fatal — journal entry already posted
        }
      }

      return payrollRun;
    } catch (err) {
      throw err;
    }
  }
}

module.exports = PayrollRunService;
