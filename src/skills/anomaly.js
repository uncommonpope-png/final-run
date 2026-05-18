'use strict';

// anomaly.js — Statistical anomaly detection over SCRIBE memory and time-series data
// Uses Z-score, IQR, and rate-of-change methods. No external deps.
// Ops: detect_zscore, detect_iqr, detect_spike, scan_memory, watch, unwatch, list_watches

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

const DATA_DIR   = path.join(__dirname, '..', '..', 'data');
const TS_FILE    = path.join(DATA_DIR, 'time_series.jsonl');
const LEDGER     = path.join(DATA_DIR, 'ledger.jsonl');
const ALERTS_FILE = path.join(DATA_DIR, 'anomaly_alerts.jsonl');
const WATCHES_FILE = path.join(DATA_DIR, 'anomaly_watches.json');

let _memory = null;
function setMemory(m) { _memory = m; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function _mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function _std(arr, mean) {
  const m = mean !== undefined ? mean : _mean(arr);
  return Math.sqrt(arr.reduce((a, v) => a + (v - m) ** 2, 0) / arr.length);
}
function _percentile(sorted, p) {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

async function _loadTSSeries(series_name, limit = 1000) {
  if (!fs.existsSync(TS_FILE)) return [];
  const results = [];
  const rl = readline.createInterface({ input: fs.createReadStream(TS_FILE), crlfDelay: Infinity });
  for await (const line of rl) {
    try {
      const e = JSON.parse(line.trim());
      if (e.series === series_name) results.push(e);
      if (results.length >= limit) break;
    } catch (_) {}
  }
  return results;
}

function _logAlert(alert) {
  fs.appendFileSync(ALERTS_FILE, JSON.stringify({ ...alert, alerted_at: new Date().toISOString() }) + '\n', 'utf8');
}

// ── Z-score detection ─────────────────────────────────────────────────────────

async function op_detect_zscore(params) {
  const { series, threshold = 3.0, window = 200 } = params || {};
  if (!series) throw new Error('series required');
  const points = await _loadTSSeries(series, window);
  if (points.length < 3) return { series, method: 'zscore', anomalies: [], reason: 'insufficient data' };

  const vals = points.map(p => p.value);
  const mean = _mean(vals);
  const std = _std(vals, mean);
  if (std === 0) return { series, method: 'zscore', anomalies: [], mean, std: 0 };

  const anomalies = points
    .map(p => ({ ...p, zscore: Math.abs((p.value - mean) / std) }))
    .filter(p => p.zscore >= threshold)
    .map(p => ({ timestamp: p.timestamp, value: p.value, zscore: parseFloat(p.zscore.toFixed(3)) }));

  if (anomalies.length) {
    for (const a of anomalies) _logAlert({ type: 'zscore', series, ...a, threshold });
  }

  return { series, method: 'zscore', mean: parseFloat(mean.toFixed(4)), std: parseFloat(std.toFixed(4)), threshold, window: points.length, anomaly_count: anomalies.length, anomalies };
}

// ── IQR detection ─────────────────────────────────────────────────────────────

async function op_detect_iqr(params) {
  const { series, multiplier = 1.5, window = 200 } = params || {};
  if (!series) throw new Error('series required');
  const points = await _loadTSSeries(series, window);
  if (points.length < 4) return { series, method: 'iqr', anomalies: [], reason: 'insufficient data' };

  const sorted = [...points.map(p => p.value)].sort((a, b) => a - b);
  const q1 = _percentile(sorted, 25);
  const q3 = _percentile(sorted, 75);
  const iqr = q3 - q1;
  const lo = q1 - multiplier * iqr;
  const hi = q3 + multiplier * iqr;

  const anomalies = points
    .filter(p => p.value < lo || p.value > hi)
    .map(p => ({ timestamp: p.timestamp, value: p.value, direction: p.value < lo ? 'low' : 'high' }));

  if (anomalies.length) {
    for (const a of anomalies) _logAlert({ type: 'iqr', series, ...a, lo, hi });
  }

  return { series, method: 'iqr', q1: parseFloat(q1.toFixed(4)), q3: parseFloat(q3.toFixed(4)), iqr: parseFloat(iqr.toFixed(4)), fence_low: parseFloat(lo.toFixed(4)), fence_high: parseFloat(hi.toFixed(4)), anomaly_count: anomalies.length, anomalies };
}

// ── Spike detection (rate of change) ─────────────────────────────────────────

async function op_detect_spike(params) {
  const { series, pct_threshold = 50, window = 100 } = params || {};
  if (!series) throw new Error('series required');
  const points = await _loadTSSeries(series, window);
  if (points.length < 2) return { series, method: 'spike', anomalies: [] };

  const anomalies = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].value;
    const curr = points[i].value;
    if (prev === 0) continue;
    const pct = Math.abs((curr - prev) / Math.abs(prev)) * 100;
    if (pct >= pct_threshold) {
      anomalies.push({ timestamp: points[i].timestamp, value: curr, prev, pct_change: parseFloat(pct.toFixed(2)) });
    }
  }

  if (anomalies.length) {
    for (const a of anomalies) _logAlert({ type: 'spike', series, ...a, pct_threshold });
  }

  return { series, method: 'spike', pct_threshold, window: points.length, anomaly_count: anomalies.length, anomalies };
}

// ── Memory scan — find unusual entry frequency or tag spikes ─────────────────

async function op_scan_memory(params) {
  const { hours = 24, tag, min_entries = 1 } = params || {};
  if (!fs.existsSync(LEDGER)) return { anomalies: [], reason: 'no ledger' };

  const cutoff = Date.now() - hours * 3600000;
  const rl = readline.createInterface({ input: fs.createReadStream(LEDGER), crlfDelay: Infinity });
  const buckets = new Map(); // hour_bucket -> count
  const tag_counts = new Map();
  let total = 0;

  for await (const line of rl) {
    try {
      const e = JSON.parse(line.trim());
      const ts = new Date(e.timestamp).getTime();
      if (ts < cutoff) continue;
      const bucket = Math.floor(ts / 3600000);
      buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
      for (const t of (e.tags || [])) tag_counts.set(t, (tag_counts.get(t) || 0) + 1);
      total++;
    } catch (_) {}
  }

  if (total === 0) return { method: 'memory_scan', hours, total_entries: 0, anomalies: [] };

  const counts = [...buckets.values()];
  const mean = _mean(counts);
  const std = _std(counts, mean);
  const anomalies = [];

  for (const [bucket_ts, count] of buckets.entries()) {
    const z = std > 0 ? Math.abs((count - mean) / std) : 0;
    if (z >= 2.5 && count >= min_entries) {
      anomalies.push({ hour: new Date(bucket_ts * 3600000).toISOString(), entry_count: count, zscore: parseFloat(z.toFixed(2)) });
    }
  }

  const top_tags = [...tag_counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, c]) => ({ tag: t, count: c }));

  return { method: 'memory_scan', hours, total_entries: total, mean_per_hour: parseFloat(mean.toFixed(2)), anomaly_hours: anomalies, top_tags };
}

// ── Watch registry ────────────────────────────────────────────────────────────

function _loadWatches() {
  if (!fs.existsSync(WATCHES_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(WATCHES_FILE, 'utf8')); } catch (_) { return {}; }
}
function _saveWatches(w) {
  const tmp = WATCHES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(w, null, 2), 'utf8');
  fs.renameSync(tmp, WATCHES_FILE);
}

function op_watch(params) {
  const { id, series, method = 'zscore', threshold, interval = '5m' } = params || {};
  if (!id) throw new Error('id required');
  if (!series) throw new Error('series required');
  const watches = _loadWatches();
  watches[id] = { id, series, method, threshold, interval, created_at: new Date().toISOString() };
  _saveWatches(watches);
  return { status: 'watching', id, series, method };
}

function op_unwatch(params) {
  const { id } = params || {};
  if (!id) throw new Error('id required');
  const watches = _loadWatches();
  if (!watches[id]) throw new Error(`Watch not found: ${id}`);
  delete watches[id];
  _saveWatches(watches);
  return { status: 'removed', id };
}

function op_list_watches() {
  const watches = _loadWatches();
  return { count: Object.keys(watches).length, watches: Object.values(watches) };
}

// ── MANIFEST + entry ──────────────────────────────────────────────────────────

const MANIFEST = {
  name: 'anomaly',
  description: 'Statistical anomaly detection (Z-score, IQR, spike) over time-series and memory. Ops: detect_zscore, detect_iqr, detect_spike, scan_memory, watch, unwatch, list_watches.',
  ops: ['detect_zscore', 'detect_iqr', 'detect_spike', 'scan_memory', 'watch', 'unwatch', 'list_watches'],
};

async function run(op, params) {
  switch (op) {
    case 'detect_zscore': return op_detect_zscore(params);
    case 'detect_iqr':    return op_detect_iqr(params);
    case 'detect_spike':  return op_detect_spike(params);
    case 'scan_memory':   return op_scan_memory(params);
    case 'watch':         return op_watch(params);
    case 'unwatch':       return op_unwatch(params);
    case 'list_watches':  return op_list_watches();
    default:
      throw new Error(`Unknown op: ${op}. Available: detect_zscore, detect_iqr, detect_spike, scan_memory, watch, unwatch, list_watches`);
  }
}

module.exports = { MANIFEST, run, setMemory };
