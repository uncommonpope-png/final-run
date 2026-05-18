'use strict';

// time_series.js — Numeric time-series tracking, trend detection, and rollup
// Data persisted to data/time_series.jsonl
// Ops: record, query, trend, rollup, list_series, delete_series, stats

const fs   = require('fs');
const path = require('path');
const readline = require('readline');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const TS_FILE  = path.join(DATA_DIR, 'time_series.jsonl');
const MAX_READ = 50000; // max data points read at once

function _append(entry) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(TS_FILE, JSON.stringify(entry) + '\n', 'utf8');
}

async function _load(series_name, since_ms, until_ms) {
  if (!fs.existsSync(TS_FILE)) return [];
  const results = [];
  const rl = readline.createInterface({ input: fs.createReadStream(TS_FILE), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    try {
      const e = JSON.parse(t);
      if (series_name && e.series !== series_name) continue;
      const ts = new Date(e.timestamp).getTime();
      if (since_ms && ts < since_ms) continue;
      if (until_ms && ts > until_ms) continue;
      results.push(e);
      if (results.length >= MAX_READ) break;
    } catch (_) {}
  }
  return results;
}

// op: record — append a data point
function op_record(params) {
  const { series, value, tags = [], meta = {} } = params || {};
  if (!series) throw new Error('series required');
  if (value === undefined || value === null) throw new Error('value required');
  const v = parseFloat(value);
  if (isNaN(v)) throw new Error('value must be numeric');
  const entry = {
    id: `ts_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    series,
    value: v,
    timestamp: new Date().toISOString(),
    tags,
    meta,
  };
  _append(entry);
  return { status: 'recorded', series, value: v, timestamp: entry.timestamp };
}

// op: query — retrieve data points for a series
async function op_query(params) {
  const { series, since, until, limit = 500 } = params || {};
  if (!series) throw new Error('series required');
  const since_ms = since ? new Date(since).getTime() : null;
  const until_ms = until ? new Date(until).getTime() : null;
  const points = await _load(series, since_ms, until_ms);
  return {
    series,
    count: points.length,
    points: points.slice(-limit).map(p => ({ ts: p.timestamp, v: p.value, tags: p.tags })),
    truncated: points.length > limit,
  };
}

// op: stats — descriptive statistics for a series
async function op_stats(params) {
  const { series, since, until } = params || {};
  if (!series) throw new Error('series required');
  const since_ms = since ? new Date(since).getTime() : null;
  const until_ms = until ? new Date(until).getTime() : null;
  const points = await _load(series, since_ms, until_ms);
  if (!points.length) return { series, count: 0 };
  const vals = points.map(p => p.value).sort((a, b) => a - b);
  const sum = vals.reduce((a, b) => a + b, 0);
  const mean = sum / vals.length;
  const mid = Math.floor(vals.length / 2);
  const median = vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
  const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
  return {
    series,
    count: vals.length,
    min: vals[0],
    max: vals[vals.length - 1],
    sum: parseFloat(sum.toFixed(6)),
    mean: parseFloat(mean.toFixed(6)),
    median: parseFloat(median.toFixed(6)),
    std_dev: parseFloat(Math.sqrt(variance).toFixed(6)),
    first_at: points[0].timestamp,
    last_at: points[points.length - 1].timestamp,
  };
}

// op: trend — detect trend direction using linear regression slope
async function op_trend(params) {
  const { series, since, window = 50 } = params || {};
  if (!series) throw new Error('series required');
  const since_ms = since ? new Date(since).getTime() : null;
  const points = await _load(series, since_ms, null);
  const recent = points.slice(-window);
  if (recent.length < 2) return { series, trend: 'insufficient_data', slope: null };

  // Normalize x to [0..n-1] for numerical stability
  const n = recent.length;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) {
    sx += i; sy += recent[i].value; sxy += i * recent[i].value; sx2 += i * i;
  }
  const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx);
  const mean_y = sy / n;
  const direction = slope > mean_y * 0.01 ? 'rising' : slope < -mean_y * 0.01 ? 'falling' : 'flat';

  return {
    series,
    window: n,
    slope: parseFloat(slope.toFixed(6)),
    direction,
    first_value: recent[0].value,
    last_value: recent[n - 1].value,
    pct_change: mean_y !== 0 ? parseFloat(((recent[n - 1].value - recent[0].value) / Math.abs(recent[0].value) * 100).toFixed(2)) : null,
  };
}

// op: rollup — bucket data by time period and compute aggregate
async function op_rollup(params) {
  const { series, period = '1h', agg = 'mean', since, until } = params || {};
  if (!series) throw new Error('series required');
  const PERIODS = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '6h': 21600000, '1d': 86400000 };
  const bucket_ms = PERIODS[period];
  if (!bucket_ms) throw new Error(`Unknown period: ${period}. Use: ${Object.keys(PERIODS).join(', ')}`);

  const since_ms = since ? new Date(since).getTime() : null;
  const until_ms = until ? new Date(until).getTime() : null;
  const points = await _load(series, since_ms, until_ms);
  if (!points.length) return { series, period, agg, buckets: [] };

  const buckets = new Map();
  for (const p of points) {
    const ts = new Date(p.timestamp).getTime();
    const key = Math.floor(ts / bucket_ms) * bucket_ms;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p.value);
  }

  const result = [];
  for (const [ts_ms, vals] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    const sum = vals.reduce((a, b) => a + b, 0);
    let v;
    switch (agg) {
      case 'mean':  v = sum / vals.length; break;
      case 'sum':   v = sum; break;
      case 'min':   v = Math.min(...vals); break;
      case 'max':   v = Math.max(...vals); break;
      case 'count': v = vals.length; break;
      default: throw new Error(`Unknown agg: ${agg}. Use: mean, sum, min, max, count`);
    }
    result.push({ ts: new Date(ts_ms).toISOString(), value: parseFloat(v.toFixed(6)), count: vals.length });
  }

  return { series, period, agg, bucket_count: result.length, buckets: result };
}

// op: list_series — list all unique series names
async function op_list_series() {
  if (!fs.existsSync(TS_FILE)) return { count: 0, series: [] };
  const seen = new Set();
  const rl = readline.createInterface({ input: fs.createReadStream(TS_FILE), crlfDelay: Infinity });
  for await (const line of rl) {
    try { const e = JSON.parse(line.trim()); if (e.series) seen.add(e.series); } catch (_) {}
  }
  return { count: seen.size, series: [...seen].sort() };
}

// op: delete_series — remove all data points for a series
async function op_delete_series(params) {
  const { series } = params || {};
  if (!series) throw new Error('series required');
  if (!fs.existsSync(TS_FILE)) return { status: 'not_found', series };
  const lines = fs.readFileSync(TS_FILE, 'utf8').trim().split('\n').filter(Boolean);
  let removed = 0;
  const kept = lines.filter(l => {
    try { const e = JSON.parse(l); if (e.series === series) { removed++; return false; } } catch (_) {}
    return true;
  });
  const tmp = TS_FILE + '.tmp';
  fs.writeFileSync(tmp, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8');
  fs.renameSync(tmp, TS_FILE);
  return { status: 'deleted', series, removed };
}

const MANIFEST = {
  name: 'time_series',
  description: 'Numeric time-series tracking with trend detection and rollup. Ops: record, query, stats, trend, rollup, list_series, delete_series.',
  ops: ['record', 'query', 'stats', 'trend', 'rollup', 'list_series', 'delete_series'],
};

async function run(op, params) {
  switch (op) {
    case 'record':         return op_record(params);
    case 'query':          return op_query(params);
    case 'stats':          return op_stats(params);
    case 'trend':          return op_trend(params);
    case 'rollup':         return op_rollup(params);
    case 'list_series':    return op_list_series();
    case 'delete_series':  return op_delete_series(params);
    default:
      throw new Error(`Unknown op: ${op}. Available: record, query, stats, trend, rollup, list_series, delete_series`);
  }
}

module.exports = { MANIFEST, run };
