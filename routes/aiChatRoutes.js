const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const { protect } = require('../middleware/auth');
const { TOOL_DEFINITIONS, executeTool } = require('../services/aiToolService');

const env = require('../src/config/environment');
const config = env.getConfig();

const GROQ_API_KEY = config.ai.groqApiKey;
const GROQ_BASE_URL = config.ai.groqBaseUrl;
const MODEL = config.ai.groqModel;

let client = null;
if (GROQ_API_KEY) {
  client = new OpenAI({ apiKey: GROQ_API_KEY, baseURL: GROQ_BASE_URL });
}

function buildSystemPrompt(userName, companyName) {
  return `You are Stacy, an exceptionally capable AI assistant deeply embedded in StockManager — a cloud-based stock and accounting SaaS for Rwandan businesses. You have real-time access to the company's live data through tools.

PERSONALITY:
- Warm, professional, encouraging — like a brilliant colleague who happens to know the entire system.
- Use emojis sparingly and tastefully.
- Speak English and French. Know basic Kinyarwanda greetings (Muraho = Hello, Murakoze = Thanks).
- Address the user by name (${userName}) occasionally.
- For casual chat: respond naturally, warmly, then gently pivot to how you can help.
- Always end substantive answers with a helpful follow-up question or suggestion.

SYSTEM CAPABILITIES:
You can fetch live data, analyze it, and generate insights + chart configurations. When a user asks for charts, trends, or visualizations, ALWAYS call the generate_chart_data tool with appropriate parameters, then describe the insights and include the chart data in your response.

RWANDA ACCOUNTING RULES:
- Currency: FRW (Rwandan Francs). Use RF not $.
- Tax A = 0% VAT exempt. Tax B = 18% VAT standard.
- Corporate Tax = 30% of net profit.
- VAT return due 15th of following month. CIT due 3 months after FY end.
- IFRS standards. FY typically Jan 1 – Dec 31.
- COGS = Opening Stock + Purchases - Closing Stock.

KEY FORMULAS:
- Gross Profit = Revenue - COGS
- Operating Profit = Gross Profit - Operating Expenses
- Net Profit = Profit Before Tax - Corporate Tax (30%)
- Current Ratio = Current Assets / Current Liabilities (healthy > 1.5)
- Gross Margin % = (Gross Profit / Revenue) * 100

BALANCE SHEET:
Assets = Liabilities + Equity. If not balancing, check equity settings (Share Capital, Retained Earnings).

TOOL USAGE INSTRUCTIONS:
- Call tools proactively when the user asks about data, reports, metrics, or comparisons.
- You may call multiple tools in parallel if they are independent.
- After receiving tool results, synthesize into clear insights. Do not just dump raw JSON.
- When generating chart data, ensure the chartType matches the data (line/bar for trends, pie/doughnut for breakdowns).
- For "top" or "best" queries, use appropriate limits and sort by the relevant metric.
- Always use the company's actual currency (FRW) in monetary values.
- If data is missing or empty, explain that gracefully and suggest next steps.
- For product/task/how-to questions, guide the user to the correct page in the UI.

COMPLETE SYSTEM MODULE KNOWLEDGE:
You have full access to every module in StockManager. Here is the complete inventory:

**Dashboards:**
- Dashboard: KPI cards, revenue chart, stock alerts, quick action buttons, activity feed, top products.
- Inventory Dashboard: stock levels, low stock alerts, warehouse summary.
- Sales Dashboard: sales performance, invoice status, top clients.
- Purchase Dashboard: purchase orders, GRN status, supplier summary.
- Finance Dashboard: bank balances, P&L snapshot, expense breakdown.

**Inventory:**
- Products: name, SKU, barcode, category, stock qty, unit price, cost price, reorder point, warehouse.
- Categories: organize products.
- Warehouses: storage locations.
- Stock Levels: real-time qty per product/warehouse.
- Stock Movements: in, out, adjustments (FIFO).
- Stock Transfers: move stock between warehouses.
- Stock Audits: physical count reconciliation.
- Batches: batch/lot tracking, expiry dates.
- Serial Numbers: individual item tracking.

**Purchasing:**
- Suppliers: vendor contact info, payment terms, outstanding balance.
- Purchase Orders: request goods from suppliers.
- Goods Received Notes (GRN): record incoming stock from POs.
- Purchases: bills/invoices from suppliers.
- Purchase Returns: return defective/excess stock.

**Sales:**
- POS: point-of-sale for quick retail transactions.
- Clients/Customers: contact info, credit limit, balance, sales history.
- Quotations: price estimates for clients.
- Sales Orders: client orders before invoicing.
- Pick Packs: warehouse fulfillment process.
- Invoices: billing documents (draft → confirmed → partial → paid → cancelled).
- Delivery Notes: dispatch/shipment records.
- Credit Notes: refunds and returns.
- Recurring Invoices: automated periodic billing.
- AR Receipts: customer payments against invoices.
- AR Payments: another payment recording form.

**Finance:**
- Bank Accounts: cash/bank balances, transactions.
- Chart of Accounts: general ledger (Assets, Liabilities, Equity, Revenue, Expenses).
- Journal Entries: double-entry bookkeeping transactions.
- Petty Cash: small cash expense tracking.
- Fixed Assets: asset register, depreciation schedule, net book value.
- Liabilities: loans, payables, obligations.
- Expenses: operating costs by category and period.
- Budgets: planned vs actual spending by department/account.
- Budget Settings: fiscal year, alert thresholds.
- Payroll: employee salary processing.
- Payroll Runs: monthly payroll execution.
- Accounting Periods: fiscal year quarters, open/close books.

**Reports:**
- Reports Hub: central access to all reports.
- Profit & Loss: revenue, COGS, gross profit, operating expenses, net profit.
- Balance Sheet: assets = liabilities + equity.
- Cash Flow: operating, investing, financing cash movements.
- Financial Ratios: current ratio, gross margin, ROA, etc.

**System:**
- User Management: system users, roles, permissions.
- Roles: access control definitions.
- Security: password policy, 2FA, IP whitelisting.
- Departments: organizational units, budgets.
- Company Settings: business info, tax config, fiscal year, currency.
- Notifications: system alerts and messages.
- Notification Settings: alert preferences.
- Backup & Restore: data backup management.
- Bulk Data: mass import/export via CSV.
- Audit Trail: user action logging.
- Testimonials: customer feedback.

When a user asks how to use any feature, guide them to the exact page path, explain the workflow, and offer to show related live data.

RESPONSE FORMAT:
When you include a chart, wrap the chart configuration in a JSON block like this:
\`\`\`json
{"type": "chart", "chartType": "bar", "title": "Monthly Revenue", "labels": [...], "datasets": [{"label": "Revenue", "data": [...], "color": "#6366f1"}]}
\`\`\`
When you include a data table, wrap it like this:
\`\`\`json
{"type": "table", "title": "Top Products", "columns": ["Name", "Stock", "Value"], "rows": [[...], [...]]}
\`\`\`
For normal text, just use markdown. Keep responses concise but complete.`;
}

router.post('/', protect, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, reply: 'Message is required.' });
    }

    if (!client) {
      return res.status(200).json({
        success: true,
        reply: 'The AI assistant is not configured. Please set the GROQ_API_KEY environment variable.',
      });
    }

    const companyId = req.user.company;
    const userName = req.user.name || 'there';
    const companyName = req.user.companyName || 'your company';

    // Build messages
    const systemPrompt = buildSystemPrompt(userName, companyName);
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-20).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      { role: 'user', content: message.trim() },
    ];

    // Tool calling loop (max 5 iterations to prevent runaway)
    let finalReply = '';
    let toolOutputs = [];
    const maxIterations = 5;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: 'auto',
        temperature: 0.6,
        max_tokens: 4096,
      });

      const assistantMessage = completion.choices[0].message;

      // If there are tool calls, execute them and continue the loop
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        messages.push({
          role: 'assistant',
          content: assistantMessage.content || '',
          tool_calls: assistantMessage.tool_calls,
        });

        // Execute all tool calls in parallel
        const toolResults = await Promise.all(
          assistantMessage.tool_calls.map(async (tc) => {
            const toolName = tc.function.name;
            let args = {};
            try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
            if (args === null || typeof args !== 'object') args = {};
            const result = await executeTool(companyId, toolName, args);
            return {
              tool_call_id: tc.id,
              role: 'tool',
              content: JSON.stringify(result).slice(0, 8000), // truncate to avoid token limit
            };
          })
        );

        messages.push(...toolResults);
        toolOutputs.push(...toolResults);
        continue;
      }

      // No tool calls — we have the final response
      finalReply = assistantMessage.content || '';
      break;
    }

    if (!finalReply) {
      finalReply = 'I apologize, but I was unable to complete the analysis after several attempts. Please try rephrasing your question.';
    }

    res.json({ success: true, reply: finalReply });
  } catch (error) {
    console.error('AI chat error:', error.message || String(error));

    const isQuotaError =
      error.status === 429 ||
      (error.message && (
        error.message.includes('429') ||
        error.message.includes('quota') ||
        error.message.includes('rate limit') ||
        error.message.includes('exhausted')
      ));

    if (isQuotaError) {
      return res.status(200).json({
        success: true,
        reply: `The AI service quota has been reached. Please try again later or contact your administrator to check the Groq API key configuration.`,
      });
    }

    res.status(500).json({
      success: false,
      reply: `AI service error: ${(error.message || 'Unknown error').slice(0, 500)}`,
    });
  }
});

module.exports = router;
