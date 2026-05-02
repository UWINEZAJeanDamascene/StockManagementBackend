const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { TOOL_DEFINITIONS, executeTool } = require('../services/aiToolService');
const {
  isConfigured,
  createCompletion,
  getConfiguredProviders,
  getProviderStatus,
} = require('../services/aiProviderService');

function buildSystemPrompt(userName, companyName) {
  return `You are Stacy, an AI assistant for StockManager — a stock & accounting SaaS for Rwandan businesses. You have live data access via tools.

PERSONALITY: Warm, professional. Use English/French. Know Muraho=Hello, Murakoze=Thanks. Address ${userName} by name. End substantive answers with a follow-up question.

RWANDA RULES: Currency=FRW (not $). Tax A=0% VAT exempt, Tax B=18% VAT. Corp Tax=30%. VAT due 15th of next month, CIT 3 months after FY. IFRS. FY=Jan-Dec. COGS = Opening Stock + Purchases - Closing Stock.

FORMULAS: Gross Profit=Revenue-COGS. Op Profit=Gross-OpEx. Net=PreTax-CorpTax(30%). Current Ratio=CA/CL (>1.5 healthy). Gross Margin%=(Gross/Revenue)*100. Balance: Assets=Liabilities+Equity.

TOOLS: Call tools proactively for data/reports/metrics. Call multiple in parallel if independent. Synthesize results — never dump raw JSON. Use FRW for money. Match chartType: line/bar for trends, pie/doughnut for breakdowns. For how-to questions, guide to the UI page path.

MODULES: Dashboards (KPIs, alerts, trends). Inventory (products, SKUs, stock levels, movements, transfers, audits, batches, serials, warehouses, categories). Purchasing (suppliers, POs, GRN, purchase bills, returns). Sales (POS, clients, quotations, sales orders, pick packs, invoices, delivery notes, credit notes, recurring invoices, AR receipts/payments). Finance (bank accounts, chart of accounts, journals, petty cash, fixed assets, liabilities, expenses, budgets, payroll, accounting periods). Reports (P&L, balance sheet, cash flow, ratios). System (users, roles, security, departments, company settings, notifications, backups, bulk data, audit trail).

CHART FORMAT: \`\`\`json{"type":"chart","chartType":"bar","title":"...","labels":[],"datasets":[]}\`\`\`
TABLE FORMAT: \`\`\`json{"type":"table","title":"...","columns":[],"rows":[]}\`\`\`
Use markdown for text. Be concise but complete.`;
}

router.post('/', protect, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, reply: 'Message is required.' });
    }

    if (!isConfigured()) {
      const providers = getConfiguredProviders();
      return res.status(200).json({
        success: true,
        reply: `The AI assistant is not configured. Please set one of these environment variables and restart the backend:\n\n- GROQ_API_KEY (fastest, recommended)\n- GEMINI_API_KEY (Google Gemini fallback)\n- OLLAMA_BASE_URL (local Ollama, e.g. http://localhost:11434/v1)\n\nCurrently configured providers: ${providers.length > 0 ? providers.map(p => p.displayName).join(', ') : 'none'}`,
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
    let usedProvider = 'unknown';
    const maxIterations = 5;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      let completionResult;
      try {
        completionResult = await createCompletion({
          messages,
          tools: TOOL_DEFINITIONS,
          tool_choice: 'auto',
          temperature: 0.6,
          max_tokens: 4096,
        });
      } catch (providerErr) {
        // All providers failed inside the loop — break and let outer catch handle it
        throw providerErr;
      }

      const assistantMessage = completionResult.result.choices[0].message;
      usedProvider = completionResult.provider || usedProvider;

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
        continue;
      }

      // No tool calls — we have the final response
      finalReply = assistantMessage.content || '';
      break;
    }

    if (!finalReply) {
      finalReply = 'I apologize, but I was unable to complete the analysis after several attempts. Please try rephrasing your question.';
    }

    res.json({ success: true, reply: finalReply, provider: usedProvider });
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

    // All providers failed or a hard error
    const allFailed = error.message && error.message.includes('All AI providers failed');

    if (isQuotaError || allFailed) {
      return res.status(200).json({
        success: true,
        reply: allFailed
          ? `The AI assistant is temporarily unavailable. All providers failed — please check your internet connection or API keys, then try again.`
          : `The AI service quota has been reached. Please try again later or contact your administrator to check the API key configuration.`,
      });
    }

    res.status(500).json({
      success: false,
      reply: `AI service error: ${(error.message || 'Unknown error').slice(0, 500)}`,
    });
  }
});

// ─── Provider status endpoint ─────────────────────────────────────────────
router.get('/providers', protect, async (req, res) => {
  try {
    const statuses = await getProviderStatus();
    res.json({
      success: true,
      providers: statuses,
      configured: statuses.filter((p) => p.configured).map((p) => p.name),
      healthy: statuses.filter((p) => p.healthy).map((p) => p.name),
      active: statuses.filter((p) => p.reachable).map((p) => p.name),
    });
  } catch (error) {
    console.error('AI provider status error:', error.message || String(error));
    res.status(500).json({
      success: false,
      message: `Failed to check provider status: ${(error.message || 'Unknown error').slice(0, 500)}`,
    });
  }
});

module.exports = router;
