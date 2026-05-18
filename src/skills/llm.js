'use strict';

const https = require('https');
const http  = require('http');
const { URL } = require('url');

const MANIFEST = {
  name: 'llm',
  description: 'Call an LLM (OpenAI, Ollama) — with observability, retry, model routing, trace logging, cost tracking.',
  version: '2.0.0',
  inputs: {
    op:        { type: 'string', required: true,  description: '"complete"|"chat"|"summarize"|"reason"|"embed"|"ollama"|"ollama_retry"|"route"' },
    prompt:    { type: 'string', required: false, description: 'User prompt (complete, summarize, reason)' },
    system:    { type: 'string', required: false, description: 'System message (complete op)' },
    messages:  { type: 'array',  required: false, description: 'Message array for chat op: [{role, content}]' },
    model:     { type: 'string', required: false, description: 'Model name' },
    tier:      { type: 'string', required: false, description: '"cheap"|"medium"|"complex"|"reasoning" — auto-selects model' },
    max_tokens:{ type: 'number', required: false, description: 'Max tokens (default: 1024)' },
    temperature:{ type: 'number',required: false, description: 'Temperature 0-2 (default: 0.7)' },
    api_key:   { type: 'string', required: false, description: 'API key' },
    base_url:  { type: 'string', required: false, description: 'Base URL' },
    trace_id:  { type: 'string', required: false, description: 'Trace ID for observability' },
    use_cache: { type: 'boolean', required: false, description: 'Enable result caching (default: true)' },
  },
  output: {
    ok:       'boolean',
    op:       'string',
    text:     'string',
    model:    'string',
    usage:    'object',
    trace_id: 'string',
    cost:     'number',
    latency_ms: 'number',
    error:    'string',
    ts:       'string',
  },
};

const COST_PER_1K = {
  'qwen3:0.6b': 0, 'qwen2.5:3b': 0, 'qwen3:8b': 0,
  'deepseek-r1:latest': 0, 'gemma4:e2b': 0, 'gpt-4o': 0.015,
  'gpt-4o-mini': 0.003, 'gpt-4-turbo': 0.01, 'claude-3-opus': 0.015,
  'claude-3-sonnet': 0.003,
};

const MODEL_TIERS = {
  cheap:     'qwen3:0.6b',
  medium:    'qwen2.5:3b',
  complex:   'qwen3:8b',
  reasoning:  'deepseek-r1:latest',
};

const COMPLEXITY_PATTERNS = [
  /analyze|analysis|architect|design|plan/i,
  /complex|intricate|elaborate/i,
  /debug|investigate|diagnose/i,
  /research|study|explore/i,
  /refactor|restructure|rebuild/i,
];
const SIMPLE_PATTERNS = [
  /list|get|show|what is|who is|when|count|summarize|translate/i,
];

function _classifyTier(prompt) {
  if (!prompt) return 'cheap';
  let score = 0;
  for (const p of COMPLEXITY_PATTERNS) { if (p.test(prompt)) score += 2; }
  for (const p of SIMPLE_PATTERNS)    { if (p.test(prompt)) score -= 1; }
  if (score >= 3) return 'complex';
  if (score >= 1) return 'medium';
  return 'cheap';
}

function _estimateCost(model, pt, ct) {
  const r = COST_PER_1K[model] || 0.01;
  return ((pt + ct) / 1000) * r;
}

function _genTraceId() {
  return require('crypto').randomBytes(16).toString('hex');
}

function _logTrace(traceId, op, model, pt, ct, cost, latencyMs, ok, err) {
  const entry = { trace_id: traceId, op, model, prompt_tokens: pt, completion_tokens: ct,
    total_tokens: pt + ct, cost, latency_ms: latencyMs, ok, error: err || null, ts: Date.now() };
  const traceFile = `data/traces/trace_${new Date().toISOString().slice(0, 10)}.jsonl`;
  require('fs').appendFileSync(traceFile, JSON.stringify(entry) + '\n', 'utf8');
}

function _getCache(key) {
  try {
    const { cacheResult, getCachedResult } = require('../memory/optimizer');
    return getCachedResult(key);
  } catch (_) { return null; }
}
function _setCache(key, val) {
  try {
    const { cacheResult } = require('../memory/optimizer');
    cacheResult(key, val, 300000);
  } catch (_) {}
}

// ── Ollama resilient call ─────────────────────────────────────────────────────

const MODEL_LOADING_PATTERNS = [
  /model\s+not\s+found/i, /model\s+loading/i, /pull\s+model/i,
  /digest.*not\s+available/i, /loading.*model/i,
];

function _isModelLoading(err) {
  const msg = (err?.message || err?.error || '').toLowerCase();
  return MODEL_LOADING_PATTERNS.some(p => p.test(msg));
}

function _buildAgent() {
  return new http.Agent({ keepAlive: true, keepAliveMsecs: 55000, timeout: 30000 });
}

async function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function _backoff(attempt) {
  return Math.min(2000 * Math.pow(1.5, attempt), 15000);
}

async function callOllama(prompt, model, systemPrompt = '') {
  const body = {
    model: model || 'deepseek-r1:latest',
    prompt: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt,
    stream: false,
    options: { temperature: 0.7, num_predict: 2048 },
  };
  const agent = _buildAgent();
  const bodyStr = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: 11434, path: '/api/generate',
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
      timeout: 90000, agent,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) { const e = new Error(json.error); e.modelLoading = _isModelLoading(json.error); return reject(e); }
          resolve({ response: json.response || '', total_duration: json.total_duration || 0,
            load_duration: json.load_duration || 0, eval_count: json.eval_count || 0,
            prompt_eval_count: json.prompt_eval_count || 0, context: json.context || [] });
        } catch { reject(new Error(`Ollama parse error: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Ollama timeout')); });
    req.write(bodyStr); req.end();
  });
}

async function callOllamaWithRetry(prompt, model, systemPrompt = '', maxRetries = 10) {
  let lastError;
  const start = Date.now();
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await callOllama(prompt, model, systemPrompt);
      return { ...result, attempt, success: true, totalTimeMs: Date.now() - start };
    } catch (err) {
      lastError = err;
      const isML = _isModelLoading(err) || _isModelLoading(err?.modelLoading);
      const isRetryable = isML || !err.status || err.status >= 500;
      if (!isRetryable || attempt === maxRetries) {
        return { response: '', attempt, success: false, error: err.message,
          isModelLoading: isML, totalTimeMs: Date.now() - start };
      }
      const delay = _backoff(attempt);
      const extra = isML ? Math.min(5000 + attempt * 2000, 20000) : 0;
      console.log(`[Ollama] attempt ${attempt + 1} failed (${err.message}). Retrying in ${Math.round((delay + extra) / 1000)}s...`);
      await _sleep(delay + extra);
    }
  }
  return { response: '', success: false, error: lastError?.message };
}

// ── Copilot fallback ──────────────────────────────────────────────────────────

function copilot_completion(messages, max_tokens, temperature) {
  const token = process.env.GITHUB_COPILOT_TOKEN || '';
  if (!token) return Promise.reject(new Error('GITHUB_COPILOT_TOKEN not set'));
  const payload = { model: 'gpt-4o', messages, max_tokens, temperature };
  return _post_json('https://api.github.com/chat/completions', {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Copilot-Integration-Id': 'vscode-chat',
  }, payload).then(data => ({
    text: data.choices?.[0]?.message?.content || '',
    model: data.model || 'gpt-4o',
    usage: data.usage || {},
  }));
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────

function _post_json(url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const bodyStr = JSON.stringify(body);
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) },
      timeout: 90000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Non-JSON (status ${res.statusCode}): ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(bodyStr); req.end();
  });
}

function chat_completion(baseUrl, apiKey, model, messages, max_tokens, temperature) {
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'SCRIBE/2.0' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  return _post_json(`${baseUrl}/chat/completions`, headers, { model, messages, max_tokens, temperature })
    .then(data => ({
      text: data.choices?.[0]?.message?.content || '',
      model: data.model || model,
      usage: data.usage || {},
    }));
}

function get_embedding(baseUrl, apiKey, model, input) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  return _post_json(`${baseUrl}/embeddings`, headers, { model, input })
    .then(data => ({
      embedding: data.data?.[0]?.embedding || [],
      model: data.model || model,
      usage: data.usage || {},
    }));
}

// ── Main run ───────────────────────────────────────────────────────────────────

async function run({ op, prompt, system, messages, model, tier, max_tokens = 1024,
                    temperature = 0.7, api_key, base_url, trace_id: externalTraceId, use_cache = true }) {
  const ts = new Date().toISOString();
  const traceId = externalTraceId || _genTraceId();

  // Route: auto-select model by complexity tier
  if (tier && MODEL_TIERS[tier] && !model) model = MODEL_TIERS[tier];
  if (!model && (op === 'ollama' || op === 'ollama_retry')) model = 'deepseek-r1:latest';

  const startMs = Date.now();

  // ── Ollama ops ─────────────────────────────────────────────────────────────
  if (op === 'ollama' || op === 'ollama_retry') {
    const m = model || 'deepseek-r1:latest';
    const sysPrompt = system || '';
    let result;
    if (op === 'ollama_retry') {
      result = await callOllamaWithRetry(prompt, m, sysPrompt);
    } else {
      result = await callOllama(prompt, m, sysPrompt);
    }
    const latency = Date.now() - startMs;
    const cost = 0; // Ollama is free
    const pt = result.prompt_eval_count || 0;
    const ct = result.eval_count || 0;
    _logTrace(traceId, op, m, pt, ct, cost, latency, result.success !== false, result.error);
    return { ok: result.success !== false, op, text: result.response || '', model: m,
      usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct },
      trace_id: traceId, cost, latency_ms: latency, ts,
      attempt: result.attempt || 0, error: result.error || null };
  }

  // ── Route op: classify complexity ──────────────────────────────────────────
  if (op === 'route') {
    const selectedTier = tier || _classifyTier(prompt || '');
    const selectedModel = MODEL_TIERS[selectedTier] || 'deepseek-r1:1.5b';
    return { ok: true, op: 'route', tier: selectedTier, model: selectedModel, trace_id: traceId, ts };
  }

  // ── OpenAI/Copilot ops ─────────────────────────────────────────────────────
  const copilotToken = process.env.GITHUB_COPILOT_TOKEN || '';
  const openaiKey    = api_key || process.env.OPENAI_API_KEY || '';
  const useCopilot   = copilotToken && !openaiKey;
  const baseUrl  = base_url || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const useModel = model    || process.env.LLM_MODEL || 'gpt-4o-mini';
  const key      = openaiKey;

  // Check cache for repeat calls
  if (use_cache && (op === 'complete' || op === 'reason' || op === 'summarize')) {
    const cacheKey = `${op}:${useModel}:${prompt?.slice(0, 200)}`;
    const cached = _getCache(cacheKey);
    if (cached) {
      return { ok: true, op, text: cached.text, model: cached.model, usage: cached.usage,
        trace_id: traceId, cost: 0, latency_ms: 0, cached: true, ts };
    }
  }

  try {
    let result;
    const buildMessages = () => [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: prompt || '' },
    ];

    switch (op) {
      case 'complete':
        result = useCopilot
          ? await copilot_completion(buildMessages(), max_tokens, temperature)
          : await chat_completion(baseUrl, key, useModel, buildMessages(), max_tokens, temperature);
        break;
      case 'chat':
        if (!messages?.length) throw new Error('messages array required for chat op');
        result = useCopilot
          ? await copilot_completion(messages, max_tokens, temperature)
          : await chat_completion(baseUrl, key, useModel, messages, max_tokens, temperature);
        break;
      case 'summarize':
        if (!prompt) throw new Error('prompt required');
        { const msgs = [
            { role: 'system', content: 'You are SCRIBE. Summarize concisely, preserving key facts.' },
            { role: 'user', content: `Summarize:\n\n${prompt}` },
          ];
          result = useCopilot ? await copilot_completion(msgs, max_tokens, temperature)
            : await chat_completion(baseUrl, key, useModel, msgs, max_tokens, temperature); }
        break;
      case 'reason':
        if (!prompt) throw new Error('prompt required');
        { const msgs = [
            { role: 'system', content: 'You are SCRIBE. Reason step-by-step. End with a clear verdict.' },
            { role: 'user', content: prompt },
          ];
          result = useCopilot ? await copilot_completion(msgs, max_tokens, temperature)
            : await chat_completion(baseUrl, key, useModel, msgs, max_tokens, temperature); }
        break;
      case 'embed':
        if (!prompt) throw new Error('prompt required');
        result = await get_embedding(baseUrl, key, useModel === 'gpt-4o-mini' ? 'text-embedding-3-small' : useModel, prompt);
        const latency2 = Date.now() - startMs;
        const pt2 = result.usage?.prompt_tokens || 0;
        const ct2 = result.usage?.completion_tokens || 0;
        _logTrace(traceId, op, useModel, pt2, ct2, _estimateCost(useModel, pt2, ct2), latency2, true);
        return { ok: true, op, embedding: result.embedding, model: result.model, usage: result.usage,
          trace_id: traceId, cost: _estimateCost(useModel, pt2, ct2), latency_ms: latency2, ts };
      default:
        return { ok: false, op, error: `Unknown op: ${op}`, trace_id: traceId, ts };
    }

    const latency = Date.now() - startMs;
    const pt = result.usage?.prompt_tokens || 0;
    const ct = result.usage?.completion_tokens || 0;
    const cost = _estimateCost(useModel, pt, ct);
    _logTrace(traceId, op, useModel, pt, ct, cost, latency, true);
    _setCache(`${op}:${useModel}:${prompt?.slice(0, 200)}`, { text: result.text, model: result.model, usage: result.usage });
    return { ok: true, op, text: result.text, model: result.model, usage: result.usage,
      trace_id: traceId, cost, latency_ms: latency, ts };
  } catch (e) {
    const latency = Date.now() - startMs;
    _logTrace(traceId, op, useModel, 0, 0, 0, latency, false, e.message);
    return { ok: false, op, error: e.message, trace_id: traceId, latency_ms: latency, ts };
  }
}

module.exports = { MANIFEST, run, callOllamaWithRetry, callOllama, _classifyTier };