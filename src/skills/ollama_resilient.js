'use strict';

const https = require('https');
const http  = require('http');
const { URL } = require('url');

const AGENT_KEEPALIVE = 55 * 1000;
const TCP_KEEPALIVE   = 30 * 1000;

const DEFAULT_RETRY_CONFIG = {
  maxRetries:     10,
  initialDelayMs: 2000,
  backoffMultiplier: 1.5,
  maxDelayMs:     15000,
};

const MODEL_LOADING_PATTERNS = [
  /model\s+not\s+found/i,
  /model\s+loading/i,
  /pull\s+model/i,
  /digest.*not\s+available/i,
  /context\s+length/i,
  /loading.*model/i,
];

function isModelLoadingError(err) {
  const msg = (err?.message || err?.error || '').toLowerCase();
  return MODEL_LOADING_PATTERNS.some(p => p.test(msg));
}

function buildAgent(keepAlive = true) {
  const agent = new http.Agent({
    keepAlive,
    keepAliveMsecs: AGENT_KEEPALIVE,
    timeout: TCP_KEEPALIVE,
    scheduling: 'fifo',
  });
  agent.on('error', () => {});
  return agent;
}

function computeBackoff(attempt, config) {
  const { initialDelayMs, backoffMultiplier, maxDelayMs } = config;
  const delay = Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt), maxDelayMs);
  return delay;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requestWithKeepalive(url, method, headers, body, timeout = 90000, agent) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers, 'Content-Length': Buffer.byteLength(JSON.stringify(body)) },
      timeout,
      agent: agent || buildAgent(true),
    };
    const req = lib.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = chunks.join('');
        try {
          const json = JSON.parse(raw);
          resolve({ status: res.statusCode, body: json, raw });
        } catch {
          resolve({ status: res.statusCode, body: raw, raw });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`timeout after ${timeout}ms`)); });
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function callOllama(prompt, model = 'deepseek-r1:latest', systemPrompt = '') {
  const agent = buildAgent(true);
  const body = {
    model,
    prompt: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt,
    stream: false,
    options: {
      temperature: 0.7,
      num_predict: 2048,
    },
  };

  const response = await requestWithKeepalive(
    'http://127.0.0.1:11434/api/generate',
    'POST',
    {},
    body,
    90000,
    agent
  );

  if (response.status !== 200) {
    const errMsg = typeof response.body === 'string' ? response.body : (response.body?.error || `HTTP ${response.status}`);
    const err = new Error(errMsg);
    err.status = response.status;
    throw err;
  }

  const json = response.body;
  if (json.error) {
    const err = new Error(json.error);
    err.modelLoading = isModelLoadingError(json.error);
    throw err;
  }

  return {
    response: json.response || '',
    model,
    done: json.done || false,
    totalDuration: json.total_duration || 0,
    loadDuration: json.load_duration || 0,
    promptEvalCount: json.prompt_eval_count || 0,
    promptEvalDuration: json.prompt_eval_duration || 0,
    evalCount: json.eval_count || 0,
    evalDuration: json.eval_duration || 0,
    context: json.context || [],
  };
}

async function callOllamaWithRetry(prompt, model = 'deepseek-r1:latest', systemPrompt = '', config = DEFAULT_RETRY_CONFIG) {
  let lastError;
  const startTs = Date.now();

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await callOllama(prompt, model, systemPrompt);
      return {
        ...result,
        attempt,
        totalTimeMs: Date.now() - startTs,
        fromCache: false,
      };
    } catch (err) {
      lastError = err;
      const isModelLoading = isModelLoadingError(err) || isModelLoadingError(err.modelLoading);
      const status = err.status || 0;
      const isRetryable = isModelLoading || status === 0 || status >= 500;

      if (!isRetryable || attempt === config.maxRetries) {
        return {
          response: '',
          model,
          attempt,
          success: false,
          error: err.message,
          totalTimeMs: Date.now() - startTs,
          isModelLoading,
        };
      }

      const delay = computeBackoff(attempt, config);
      console.log(`[Ollama] attempt ${attempt + 1} failed (${err.message}). Retrying in ${Math.round(delay / 1000)}s...`);

      if (isModelLoading) {
        const extraWait = Math.min(5000 + attempt * 2000, 20000);
        await sleep(delay + extraWait);
      } else {
        await sleep(delay);
      }
    }
  }

  return {
    response: '',
    model,
    attempt: config.maxRetries + 1,
    success: false,
    error: lastError?.message || 'unknown',
    totalTimeMs: Date.now() - startTs,
  };
}

async function* streamOllama(prompt, model = 'deepseek-r1:latest', systemPrompt = '') {
  const body = {
    model,
    prompt: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt,
    stream: true,
  };

  const parsed = new URL('http://127.0.0.1:11434/api/generate');
  const req = http.request({
    hostname: parsed.hostname,
    port: parsed.port || 11434,
    path: parsed.pathname,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(JSON.stringify(body)) },
    timeout: 120000,
    agent: buildAgent(true),
  });

  const stream = new Promise((resolve, reject) => {
    const chunks = [];
    req.on('response', res => {
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('stream timeout')); });
  });

  req.write(JSON.stringify(body));
  req.end();

  const full = await stream;
  for (const line of full.split('\n')) {
    if (!line.trim()) continue;
    try {
      const json = JSON.parse(line);
      yield {
        token: json.response || '',
        done: json.done || false,
        totalDuration: json.total_duration || 0,
        evalCount: json.eval_count || 0,
      };
      if (json.done) break;
    } catch {}
  }
}

async function checkOllamaHealth(model = 'deepseek-r1:latest') {
  const start = Date.now();
  try {
    await callOllama('ping', model, '');
    return { healthy: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { healthy: false, latencyMs: Date.now() - start, error: e.message };
  }
}

module.exports = {
  callOllamaWithRetry,
  callOllama,
  streamOllama,
  checkOllamaHealth,
  DEFAULT_RETRY_CONFIG,
  isModelLoadingError,
  AGENT_KEEPALIVE,
  TCP_KEEPALIVE,
};