/**
 * AI Provider Service — Multi-provider LLM client with automatic fallback
 *
 * Provider chain: Groq → Mistral → OpenRouter → DeepSeek → Together → Gemini → Ollama (local)
 * Each provider gets a configurable timeout (default 10s).
 * Responses are cached for 30s to reduce API costs and improve speed.
 *
 * Cloud compatibility:
 *   - Groq, Mistral, OpenRouter, DeepSeek, Together, Gemini work anywhere with an API key.
 *   - Ollama only works where the host is reachable (local dev, or a
 *     dedicated Ollama host exposed via OLLAMA_BASE_URL).
 *   - If Ollama is unreachable, the fallback chain skips it automatically.
 */

const crypto = require('crypto');
const OpenAI = require('openai');
const env = require('../src/config/environment');
const config = env.getConfig();
const { redisClient, isRedisConfigured } = require('../config/redis');

// ─── Configuration ──────────────────────────────────────────────────────────
const CACHE_TTL_SECONDS = config.ai.cacheTtlSeconds || 30;
const TIMEOUT_MS = config.ai.timeoutMs || 10000;

// ─── Provider setup ─────────────────────────────────────────────────────────
function createProviders() {
  const providers = [];
  const configured = [];
  const missing = [];

  // 1. Groq (fast hosted LLM)
  if (config.ai.groqApiKey) {
    providers.push({
      name: 'groq',
      displayName: 'Groq',
      client: new OpenAI({
        apiKey: config.ai.groqApiKey,
        baseURL: config.ai.groqBaseUrl || 'https://api.groq.com/openai/v1',
      }),
      model: config.ai.groqModel || 'llama-3.3-70b-versatile',
      timeout: Math.min(TIMEOUT_MS, 15000), // Groq is fast — 15s max
    });
    configured.push('groq');
  } else { 
    missing.push('groq'); 
    console.log('Groq provider is missing'); 
  }

  // 2. Mistral AI
  if (config.ai.mistralApiKey) {
    providers.push({
      name: 'mistral',
      displayName: 'Mistral',
      client: new OpenAI({
        apiKey: config.ai.mistralApiKey,
        baseURL: config.ai.mistralBaseUrl || 'https://api.mistral.ai/v1',
      }),
      model: config.ai.mistralModel || 'mistral-small-latest',
      timeout: Math.min(TIMEOUT_MS, 20000),
    });
    configured.push('mistral');
  } else { missing.push('mistral'); }

  // 3. OpenRouter
  if (config.ai.openrouterApiKey) {
    providers.push({
      name: 'openrouter',
      displayName: 'OpenRouter',
      client: new OpenAI({
        apiKey: config.ai.openrouterApiKey,
        baseURL: config.ai.openrouterBaseUrl || 'https://openrouter.ai/api/v1',
      }),
      model: config.ai.openrouterModel || 'openrouter/quasar-alpha',
      timeout: Math.min(TIMEOUT_MS, 20000),
    });
    configured.push('openrouter');
  } else { missing.push('openrouter'); }

  // 4. DeepSeek
  if (config.ai.deepseekApiKey) {
    providers.push({
      name: 'deepseek',
      displayName: 'DeepSeek',
      client: new OpenAI({
        apiKey: config.ai.deepseekApiKey,
        baseURL: config.ai.deepseekBaseUrl || 'https://api.deepseek.com/v1',
      }),
      model: config.ai.deepseekModel || 'deepseek-chat',
      timeout: Math.min(TIMEOUT_MS, 20000),
    });
    configured.push('deepseek');
  } else { missing.push('deepseek'); }

  // 5. Together AI
  if (config.ai.togetherApiKey) {
    providers.push({
      name: 'together',
      displayName: 'Together',
      client: new OpenAI({
        apiKey: config.ai.togetherApiKey,
        baseURL: config.ai.togetherBaseUrl || 'https://api.together.xyz/v1',
      }),
      model: config.ai.togetherModel || 'meta-llama/Llama-3.2-3B-Instruct-Turbo',
      timeout: Math.min(TIMEOUT_MS, 20000),
    });
    configured.push('together');
  } else { missing.push('together'); }

  // 6. Google Gemini (hosted fallback)
  if (config.ai.geminiApiKey) {
    providers.push({
      name: 'gemini',
      displayName: 'Gemini',
      client: new OpenAI({
        apiKey: config.ai.geminiApiKey,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      }),
      model: config.ai.geminiModel || 'gemini-2.0-flash',
      timeout: Math.min(TIMEOUT_MS, 20000), // Gemini medium — 20s max
    });
    configured.push('gemini');
  } else { missing.push('gemini'); }

  // 7. Ollama (local / self-hosted)
  // If OLLAMA_BASE_URL points to localhost but we're in production,
  // do not include the provider since a deployed host cannot reach local services.
  if (config.ai.ollamaBaseUrl) {
    const ollamaBase = config.ai.ollamaBaseUrl;
    const isLocalhost = /(^https?:\/\/)?(localhost|127\.0\.0\.1|::1)/i.test(ollamaBase);
    if (isLocalhost && process.env.NODE_ENV === 'production') {
      console.warn('[AI] OLLAMA_BASE_URL points to localhost but running in production — skipping Ollama provider.');
    } else {
      providers.push({
        name: 'ollama',
        displayName: 'Ollama',
        client: new OpenAI({
          apiKey: 'ollama',
          baseURL: config.ai.ollamaBaseUrl,
        }),
        model: config.ai.ollamaModel || 'llama3.2',
        timeout: Math.max(TIMEOUT_MS, 30000), // Ollama local — 30s min
      });
    }
  }

  console.log(`[AI Providers] Configured: ${configured.join(', ') || 'none'}`);
  if (missing.length) console.log(`[AI Providers] Missing API keys: ${missing.join(', ')}`);

  return providers;
}

// ─── Provider health tracking ─────────────────────────────────────────────
// Mark providers unhealthy when they repeatedly fail so we skip them quickly.
const unhealthyProviders = new Map(); // providerName -> { until: timestamp }
const HEALTHY_RETRY_MS = 60000; // Re-check a failed provider after 60s
const HEALTH_CHECK_TIMEOUT_MS = 3000; // Quick 3s timeout for health probes

function isProviderHealthy(name) {
  const entry = unhealthyProviders.get(name);
  if (!entry) return true;
  if (Date.now() > entry.until) {
    unhealthyProviders.delete(name);
    return true;
  }
  return false;
}

function markProviderUnhealthy(name) {
  unhealthyProviders.set(name, { until: Date.now() + HEALTHY_RETRY_MS });
}

function markProviderUnhealthyUntil(name, untilTimestampMs) {
  unhealthyProviders.set(name, { until: untilTimestampMs });
}

function parseRetryAfterFromError(err) {
  // Try common locations for retry-after information.
  try {
    // Header may be present on some clients
    const headers = err?.headers || err?.response?.headers || err?.rawHeaders;
    if (headers) {
      const raw = headers['retry-after'] || headers['Retry-After'] || headers['retry_after'];
      if (raw) {
        const secs = parseFloat(raw);
        if (!Number.isNaN(secs)) return Date.now() + Math.round(secs * 1000);
      }
    }

    // Some providers embed a human-readable wait time in the message, e.g.
    // "Please try again in 1h1m8.544s." — parse that pattern.
    const msg = err?.message || '';
    const m = msg.match(/in\s*((\d+)h)?\s*((\d+)m)?\s*((\d+(?:\.\d+)?)s)?/i);
    if (m) {
      const hours = parseInt(m[2] || '0', 10);
      const mins = parseInt(m[4] || '0', 10);
      const secs = parseFloat(m[6] || '0');
      const totalMs = ((hours * 3600) + (mins * 60) + secs) * 1000;
      if (totalMs > 0) return Date.now() + Math.round(totalMs);
    }
  } catch (e) {
    // ignore parsing errors
  }
  return null;
}

// ─── Provider health check (lightweight ping) ─────────────────────────────
async function checkProviderHealth(provider) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

  try {
    // For Ollama, try listing models to verify connectivity.
    // For hosted providers (Groq/Gemini), we skip explicit health checks
    // because their API keys are validated on first real request.
    if (provider.name === 'ollama') {
      const resp = await fetch(`${provider.client.baseURL.replace(/\/$/, '')}/models`, {
        signal: controller.signal,
        headers: { Authorization: 'Bearer ollama' },
      });
      clearTimeout(timer);
      return resp.ok;
    }

    clearTimeout(timer);
    return true; // Hosted providers assumed healthy if configured
  } catch (err) {
    clearTimeout(timer);
    return false;
  }
}

// ─── Rebuild providers on demand (for hot reloads / config changes) ─────────
function getProviders() {
  return createProviders().filter((p) => isProviderHealthy(p.name));
}

// ─── Simple in-memory cache (LRU with TTL) ────────────────────────────────
const memoryCache = new Map();

function cleanupMemoryCache() {
  const now = Date.now();
  for (const [key, entry] of memoryCache) {
    if (entry.expires < now) memoryCache.delete(key);
  }
}

// ─── Cache helpers ──────────────────────────────────────────────────────────
function makeCacheKey(systemPrompt, messages) {
  const payload = JSON.stringify({ system: systemPrompt, messages });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function getCachedResponse(cacheKey) {
  // Try Redis first if available
  if (isRedisConfigured() && redisClient) {
    try {
      const val = await redisClient.get(`ai:response:${cacheKey}`);
      if (val) {
        const parsed = JSON.parse(val);
        return { ...parsed, cached: true, provider: parsed.provider || 'cache' };
      }
    } catch (e) {
      // Redis error — fall through to memory cache
    }
  }

  // Fallback to in-memory
  const entry = memoryCache.get(cacheKey);
  if (entry && entry.expires > Date.now()) {
    return { ...entry.data, cached: true, provider: entry.data.provider || 'cache' };
  }
  return null;
}

async function setCachedResponse(cacheKey, response) {
  const payload = { reply: response.reply, provider: response.provider };
  if (isRedisConfigured() && redisClient) {
    try {
      await redisClient.setex(`ai:response:${cacheKey}`, CACHE_TTL_SECONDS, JSON.stringify(payload));
      return;
    } catch (e) {
      // Redis error — fall through to memory cache
    }
  }

  // In-memory fallback
  cleanupMemoryCache();
  memoryCache.set(cacheKey, { data: payload, expires: Date.now() + CACHE_TTL_SECONDS * 1000 });
}

// ─── Single provider call with AbortController timeout ──────────────────────
async function callProviderRaw(provider, requestParams) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), provider.timeout);

  try {
    const result = await provider.client.chat.completions.create(
      {
        ...requestParams,
        model: provider.model,
      },
      { signal: controller.signal }
    );
    clearTimeout(timer);
    return { result, provider: provider.name, displayName: provider.displayName };
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

async function callProviderWithRetry(provider, requestParams, opts = {}) {
  const maxRetries = opts.maxRetries ?? 2; // retry a couple times for transient errors
  let attempt = 0;
  let delay = 1000;

  while (attempt <= maxRetries) {
    try {
      return await callProviderRaw(provider, requestParams);
    } catch (err) {
      attempt += 1;

      const status = err?.status || err?.statusCode || 'no-status';

      // If we receive 429, parse Retry-After or message and mark provider unhealthy until then.
      if (status === 429) {
        const until = parseRetryAfterFromError(err) || (Date.now() + HEALTHY_RETRY_MS);
        markProviderUnhealthyUntil(provider.name, until);
        // Do not block waiting here; escalate to outer loop to try next provider.
        throw err;
      }

      // For timeouts / aborts or network errors, do exponential backoff and retry.
      const isAbort = err.name === 'AbortError' || /timeout|aborted/i.test(err.message || '');
      if (attempt > maxRetries || !isAbort) {
        // Give up on other non-transient errors
        throw err;
      }

      // transient error — wait and retry
      await new Promise((res) => setTimeout(res, delay));
      delay *= 2;
      continue;
    }
  }
  // If we exit loop without returning, throw generic error
  throw new Error('Provider retries exhausted');
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Returns true if at least one AI provider is configured.
 */
function isConfigured() {
  return createProviders().length > 0;
}

/**
 * Get a list of configured provider names (for diagnostics).
 */
function getConfiguredProviders() {
  return createProviders().map((p) => ({ name: p.name, displayName: p.displayName, model: p.model }));
}

/**
 * Execute a chat completion with automatic provider fallback.
 *
 * @param {object} params — OpenAI-compatible chat.completions.create params
 * @returns {Promise<{result: object, provider: string, displayName: string}>}
 * @throws {Error} if all providers fail
 */
async function createCompletion(params) {
  let lastError = null;
  const allConfigured = createProviders();
  const activeProviders = getProviders();

  if (allConfigured.length === 0) {
    throw new Error('No AI providers are configured. Set GROQ_API_KEY, GEMINI_API_KEY, or OLLAMA_BASE_URL environment variables.');
  }

  if (activeProviders.length === 0) {
    throw new Error('All configured AI providers are temporarily unhealthy. Please try again in a minute.');
  }

  for (const provider of activeProviders) {
    try {
      const start = Date.now();
      const response = await callProviderWithRetry(provider, params, { maxRetries: 2 });
      const elapsed = Date.now() - start;
      if (elapsed > 8000) {
        console.warn(`Provider ${provider.name} responded slowly (${elapsed}ms)`);
      }
      return response;
    } catch (err) {
      lastError = err;
      const reason = err.name === 'AbortError' ? 'timeout' : (err.message || 'unknown');
      const status = err.status || err.statusCode || 'no-status';
      console.warn(`AI provider ${provider.name} failed (status=${status}, reason=${reason}, type=${err.type || 'n/a'}). Trying next...`);
      if (err.stack) console.warn(`Stack: ${err.stack.split('\n').slice(0, 3).join(' | ')}`);
      // Only mark unhealthy on actual rate limits (429), not on random errors
      // Continue to next provider
    }
  }

  throw new Error(
    `All AI providers failed. Last error: ${lastError?.message || 'Unknown error'}`
  );
}

/**
 * Cached chat completion. Checks cache first, then falls through to createCompletion.
 *
 * @param {string} systemPrompt
 * @param {Array} messages
 * @param {object} completionParams — params passed to createCompletion
 * @returns {Promise<{reply: string, provider: string, cached: boolean}>}
 */
async function cachedChatCompletion(systemPrompt, messages, completionParams) {
  const cacheKey = makeCacheKey(systemPrompt, messages);
  const cached = await getCachedResponse(cacheKey);
  if (cached) {
    return { reply: cached.reply, provider: cached.provider, cached: true };
  }

  const { result, provider, displayName } = await createCompletion(completionParams);
  const reply = result.choices?.[0]?.message?.content || '';
  const response = { reply, provider: displayName || provider, cached: false };

  await setCachedResponse(cacheKey, response);
  return response;
}

/**
 * Return detailed health status for every configured provider.
 * Used by the /api/chat/providers status endpoint.
 */
async function getProviderStatus() {
  const all = createProviders();
  const statuses = await Promise.all(
    all.map(async (p) => {
      const healthy = await checkProviderHealth(p);
      if (!healthy && isProviderHealthy(p.name)) {
        markProviderUnhealthy(p.name);
      }
      return {
        name: p.name,
        displayName: p.displayName,
        model: p.model,
        configured: true,
        healthy,
        reachable: isProviderHealthy(p.name) && healthy,
      };
    })
  );
  return statuses;
}

// ─── Startup diagnostic ─────────────────────────────────────────────────────
const configured = createProviders();
console.log(`[AI] Provider config: groq=${config.ai.groqApiKey ? 'set' : 'missing'}, gemini=${config.ai.geminiApiKey ? 'set' : 'missing'}, ollama=${config.ai.ollamaBaseUrl ? 'set' : 'missing'}`);
console.log(`[AI] Active providers: ${configured.map(p => p.name).join(', ') || 'NONE'}`);

module.exports = {
  isConfigured,
  getConfiguredProviders,
  getProviderStatus,
  createCompletion,
  cachedChatCompletion,
};
