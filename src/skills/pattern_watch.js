'use strict';

/**
 * SKILL: pattern_watch
 *
 * Watch SCRIBE's memory stream for patterns.
 * Registers watchers that scan new memory entries for matching conditions.
 * When a pattern fires, it records an alert memory and optionally calls a webhook.
 *
 * Operations:
 *   register  — register a pattern watcher
 *   list      — list all active watchers
 *   cancel    — cancel a watcher
 *   scan_now  — manually scan current memory against all watchers
 *   alerts    — return all alert memories fired so far
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const ALERTS_FILE = path.join(__dirname, '..', '..', 'data', 'pattern_alerts.jsonl');

const MANIFEST = {
  name: 'pattern_watch',
  description: 'Watch SCRIBE\'s memory stream for patterns. Fire alerts when conditions match.',
  version: '1.0.0',
  inputs: {
    op:          { type: 'string', required: true,  description: '"register"|"list"|"cancel"|"scan_now"|"alerts"' },
    name:        { type: 'string', required: false, description: 'Watcher name/label' },
    pattern:     { type: 'string', required: false, description: 'Regex or keyword to match in memory summaries' },
    match_type:  { type: 'string', required: false, description: '"keyword" (default) or "regex"' },
    match_field: { type: 'string', required: false, description: 'Memory field to match against: "summary" (default), "type", "tags"' },
    min_weight:  { type: 'number', required: false, description: 'Only match memories at or above this weight' },
    action:      { type: 'object', required: false, description: '{ type: "memory" } or { type: "http", url }' },
    watcher_id:  { type: 'string', required: false, description: 'Watcher ID (cancel op)' },
    limit:       { type: 'number', required: false, description: 'Max alerts to return (alerts op)' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any',
    error:  'string',
    ts:     'string',
  },
};

const _watchers = new Map();
let _memory = null;
let _lastScanSize = 0;
let _scanIntervalStarted = false;
// Deduplication: track fired (watcher_id, memory_id) pairs
const _firedSet = new Set();

function setMemory(m) {
  _memory = m;
  // Only start one interval, no matter how many times setMemory is called
  if (!_scanIntervalStarted) {
    _scanIntervalStarted = true;
    setInterval(() => _auto_scan(), 30000);
  }
}

function _ensure_alerts_file() {
  const dir = path.dirname(ALERTS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(ALERTS_FILE)) fs.writeFileSync(ALERTS_FILE, '', 'utf-8');
}

async function run({ op, name, pattern, match_type, match_field, min_weight, action, watcher_id, limit = 20 }) {
  const ts = new Date().toISOString();
  _ensure_alerts_file();
  try {
    let result;
    switch (op) {
      case 'register': result = op_register(name, pattern, match_type, match_field, min_weight, action); break;
      case 'list':     result = op_list();                           break;
      case 'cancel':   result = op_cancel(watcher_id);              break;
      case 'scan_now': result = await op_scan_now();                 break;
      case 'alerts':   result = op_alerts(limit);                   break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

// ── Operations ────────────────────────────────────────────────────────────────

function op_register(name, pattern, match_type = 'keyword', match_field = 'summary', min_weight, action) {
  if (!pattern) throw new Error('pattern is required');
  const id = `watcher_${crypto.randomBytes(4).toString('hex')}`;
  _watchers.set(id, { id, name: name || id, pattern, match_type, match_field, min_weight: min_weight || 0, action, created: new Date().toISOString(), fire_count: 0 });
  return { watcher_id: id, name, pattern };
}

function op_list() {
  const watchers = [];
  for (const w of _watchers.values()) {
    watchers.push({ id: w.id, name: w.name, pattern: w.pattern, match_type: w.match_type, match_field: w.match_field, fire_count: w.fire_count, created: w.created });
  }
  return { count: watchers.length, watchers };
}

function op_cancel(watcher_id) {
  if (!watcher_id) throw new Error('watcher_id is required');
  const w = _watchers.get(watcher_id);
  if (!w) throw new Error(`No watcher: ${watcher_id}`);
  _watchers.delete(watcher_id);
  return { cancelled: watcher_id, name: w.name };
}

async function op_scan_now() {
  if (!_memory) return { scanned: 0, fired: 0, note: 'memory not available' };
  const entries = _memory.recent(100);
  let fired = 0;
  for (const entry of entries) {
    for (const watcher of _watchers.values()) {
      if (_matches(entry, watcher)) {
        _fire_alert(watcher, entry);
        fired++;
      }
    }
  }
  return { scanned: entries.length, fired, watchers: _watchers.size };
}

function op_alerts(limit) {
  try {
    const raw = fs.readFileSync(ALERTS_FILE, 'utf-8').trim();
    if (!raw) return { count: 0, alerts: [] };
    const alerts = raw.split('\n').filter(Boolean).map(l => JSON.parse(l)).slice(-limit);
    return { count: alerts.length, alerts };
  } catch {
    return { count: 0, alerts: [] };
  }
}

// ── Matching & firing ─────────────────────────────────────────────────────────

function _matches(entry, watcher) {
  if ((entry.weight || 0) < watcher.min_weight) return false;

  let haystack = '';
  switch (watcher.match_field) {
    case 'type': haystack = entry.type || ''; break;
    case 'tags': haystack = (entry.tags || []).join(' '); break;
    default:     haystack = entry.summary || '';
  }

  if (watcher.match_type === 'regex') {
    try { return new RegExp(watcher.pattern, 'i').test(haystack); }
    catch { return false; }
  }
  return haystack.toLowerCase().includes(watcher.pattern.toLowerCase());
}

function _fire_alert(watcher, entry) {
  // Deduplication: skip if already fired for this (watcher, memory) pair
  const dedupKey = `${watcher.id}:${entry.id}`;
  if (_firedSet.has(dedupKey)) return;
  _firedSet.add(dedupKey);

  watcher.fire_count++;
  const alert = {
    id: `alert_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    watcher_id: watcher.id,
    watcher_name: watcher.name,
    pattern: watcher.pattern,
    memory_id: entry.id,
    memory_summary: entry.summary,
    fired_at: new Date().toISOString(),
  };

  try { fs.appendFileSync(ALERTS_FILE, JSON.stringify(alert) + '\n', 'utf-8'); } catch { /* silent */ }

  if (_memory && watcher.action?.type === 'memory') {
    try {
      _memory.record({
        type: 'observation',
        summary: `PATTERN ALERT: watcher "${watcher.name}" matched — "${entry.summary?.slice(0, 100)}"`,
        tags: ['pattern_alert', watcher.id],
        weight: 0.9,
        source: { system: 'SCRIBE', chamber: 'pattern_watch' },
        meta: alert,
      });
    } catch { /* silent */ }
  }

  if (watcher.action?.type === 'http' && watcher.action?.url) {
    const https = require('https');
    const http  = require('http');
    const { URL } = require('url');
    try {
      const u = new URL(watcher.action.url);
      const body = JSON.stringify(alert);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } });
      req.on('error', () => {});
      req.write(body);
      req.end();
    } catch { /* silent */ }
  }
}

function _auto_scan() {
  if (!_memory || _watchers.size === 0) return;
  const entries = _memory.recent(50);
  const newEntries = entries.slice(_lastScanSize);
  _lastScanSize = entries.length;
  for (const entry of newEntries) {
    for (const watcher of _watchers.values()) {
      if (_matches(entry, watcher)) _fire_alert(watcher, entry);
    }
  }
}

module.exports = { MANIFEST, run, setMemory };
