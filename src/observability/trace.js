'use strict';

const fs    = require('fs');
const path  = require('path');

const TRACE_DIR  = path.join(__dirname, '..', '..', 'data', 'traces');
const COST_FILE = path.join(__dirname, '..', '..', 'data', 'observability_cost.jsonl');

function _ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
_ensureDir(TRACE_DIR);

let _traceBuffer = [];
let _flushTimer = null;

function _appendCost(obj) {
  fs.appendFileSync(COST_FILE, JSON.stringify(obj) + '\n', 'utf8');
}

function _flushBuffer() {
  if (!_traceBuffer.length) return;
  const date = new Date();
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const file = path.join(TRACE_DIR, `trace_${dateStr}.jsonl`);
  for (const entry of _traceBuffer) {
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  }
  _traceBuffer = [];
  _flushTimer = null;
}

function _scheduleFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(_flushBuffer, 1000);
}

function _now() { return Date.now(); }

function createSpan(traceId, name, parentId = null) {
  return {
    span_id: cryptoRandomHex(6),
    trace_id: traceId,
    parent_id: parentId,
    name,
    start_ms: _now(),
    end_ms: null,
    children: [],
    logs: [],
    attrs: {},
  };
}

function cryptoRandomHex(bytes = 8) {
  return require('crypto').randomBytes(bytes).toString('hex');
}

function generateTraceId() {
  return cryptoRandomHex(16);
}

class Observable {
  constructor() {
    this._activeSpans = new Map();
    this._traceHistory = [];
  }

  startTrace(workflow = 'unknown', tags = []) {
    const traceId = generateTraceId();
    const rootSpan = createSpan(traceId, workflow);
    rootSpan.type = 'workflow';
    rootSpan.tags = tags;
    rootSpan.status = 'running';
    rootSpan.prompt_tokens = 0;
    rootSpan.completion_tokens = 0;
    rootSpan.total_tokens = 0;
    rootSpan.cost = 0;
    rootSpan.model = null;
    rootSpan.start_time = _now();
    this._activeSpans.set(traceId, rootSpan);
    return traceId;
  }

  endTrace(traceId, outcome = 'unknown') {
    const span = this._activeSpans.get(traceId);
    if (!span) return null;
    span.end_ms = _now();
    span.duration_ms = span.end_ms - span.start_ms;
    span.status = 'complete';
    span.outcome = outcome;

    _traceBuffer.push(span);
    _scheduleFlush();

    this._traceHistory.push(span);
    if (this._traceHistory.length > 100) this._traceHistory.shift();
    this._activeSpans.delete(traceId);

    return span;
  }

  startSpan(traceId, name, parentId = null) {
    const span = createSpan(traceId, name, parentId);
    span.type = 'span';
    const parent = this._activeSpans.get(traceId);
    if (parent) {
      parent.children.push(span.span_id);
    }
    this._activeSpans.set(`${traceId}:${span.span_id}`, span);
    return span;
  }

  endSpan(traceId, spanId, attrs = {}) {
    const key = `${traceId}:${spanId}`;
    const span = this._activeSpans.get(key);
    if (!span) return null;
    span.end_ms = _now();
    span.duration_ms = span.end_ms - span.start_ms;
    if (Object.keys(attrs).length) span.attrs = { ...span.attrs, ...attrs };
    return span;
  }

  logSpanEvent(traceId, spanId, event, attrs = {}) {
    const key = `${traceId}:${spanId}`;
    const span = this._activeSpans.get(key);
    if (!span) return;
    span.logs.push({ event, ts: _now(), ...attrs });
  }

  recordPrompt(traceId, spanId, prompt, model, promptTokens = 0) {
    const key = `${traceId}:${spanId}`;
    const span = this._activeSpans.get(key);
    if (!span) return;
    span.prompt = prompt?.slice(0, 500);
    span.prompt_length = prompt?.length || 0;
    span.model = model;
    span.prompt_tokens = promptTokens;
  }

  recordResponse(traceId, spanId, response, completionTokens = 0, cost = 0) {
    const key = `${traceId}:${spanId}`;
    const span = this._activeSpans.get(key);
    if (!span) return;
    span.response = response?.slice(0, 500);
    span.response_length = response?.length || 0;
    span.completion_tokens = completionTokens;
    span.total_tokens = (span.prompt_tokens || 0) + completionTokens;
    span.cost = cost;
  }

  recordToolCall(traceId, spanId, tool, args, result) {
    const key = `${traceId}:${spanId}`;
    const span = this._activeSpans.get(key);
    if (!span) return;
    if (!span.tool_calls) span.tool_calls = [];
    span.tool_calls.push({
      tool,
      args: args ? JSON.stringify(args).slice(0, 200) : '',
      result_preview: typeof result === 'string' ? result.slice(0, 200) : JSON.stringify(result).slice(0, 200),
      ts: _now(),
    });
  }

  recordLatency(traceId, spanId, latencyMs) {
    const key = `${traceId}:${spanId}`;
    const span = this._activeSpans.get(key);
    if (!span) return;
    span.latency_ms = latencyMs;
  }

  recordCost(traceId, model, promptTokens, completionTokens, cost) {
    _appendCost({
      trace_id: traceId,
      model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      cost,
      ts: _now(),
    });
  }

  getRecentTraces(limit = 20) {
    return this._traceHistory.slice(-limit);
  }

  getTraceSummary(traceId) {
    const span = this._activeSpans.get(traceId) || this._traceHistory.find(s => s.trace_id === traceId);
    if (!span) return null;
    return {
      trace_id: span.trace_id,
      name: span.name,
      status: span.status || 'unknown',
      duration_ms: span.duration_ms || (_now() - (span.start_ms || _now())),
      total_tokens: span.total_tokens || 0,
      cost: span.cost || 0,
      model: span.model || 'unknown',
      children_count: span.children?.length || 0,
    };
  }

  getCostSummary(days = 7) {
    const cutoff = _now() - (days * 24 * 60 * 60 * 1000);
    const entries = _loadCostEntries().filter(e => e.ts > cutoff);
    const byModel = {};
    let totalCost = 0;
    let totalTokens = 0;
    for (const e of entries) {
      if (!byModel[e.model]) byModel[e.model] = { prompt: 0, completion: 0, total: 0, cost: 0 };
      byModel[e.model].prompt += e.prompt_tokens || 0;
      byModel[e.model].completion += e.completion_tokens || 0;
      byModel[e.model].total += e.total_tokens || 0;
      byModel[e.model].cost += e.cost || 0;
      totalCost += e.cost || 0;
      totalTokens += e.total_tokens || 0;
    }
    return { days, total_cost: totalCost, total_tokens: totalTokens, by_model: byModel, entry_count: entries.length };
  }
}

function _loadCostEntries() {
  if (!fs.existsSync(COST_FILE)) return [];
  return fs.readFileSync(COST_FILE, 'utf8').split('\n')
    .filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

const _globalObservable = new Observable();

function getGlobalObservable() { return _globalObservable; }

function tracePrompt(prompt, model, tokens = 0) {
  return {
    prompt,
    model,
    prompt_tokens: tokens,
    ts: _now(),
  };
}

const COST_PER_1K = {
  'deepseek-r1:7b': 0,
  'deepseek-r1:14b': 0,
  'deepseek-r1:32b': 0,
  'qwen2.5-coder:7b': 0,
  'gpt-4o': 0.015,
  'gpt-4o-mini': 0.003,
  'gpt-4-turbo': 0.01,
  'claude-3-opus': 0.015,
  'claude-3-sonnet': 0.003,
};

function estimateCost(model, promptTokens, completionTokens) {
  const rate = COST_PER_1K[model] || 0.01;
  return ((promptTokens + completionTokens) / 1000) * rate;
}

module.exports = {
  Observable,
  getGlobalObservable,
  generateTraceId,
  tracePrompt,
  estimateCost,
  COST_PER_1K,
  createSpan,
};