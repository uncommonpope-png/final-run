'use strict';

/**
 * SKILL: log_writer
 *
 * Structured JSON logging with levels (info/warn/error/debug).
 * Writes to a rotating log file in SCRIBE's data directory.
 *
 * Operations:
 *   write  — write a log entry at a given level
 *   read   — read recent log entries (filtered by level or query)
 *   clear  — clear the log file (use with care)
 *   stats  — log statistics (counts per level, time range)
 */

const fs   = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', '..', 'data', 'scribe.log.jsonl');
const MAX_SIZE = 5 * 1024 * 1024; // 5MB — rotate at this size

const LEVELS = ['debug', 'info', 'warn', 'error'];

const MANIFEST = {
  name: 'log_writer',
  description: 'Structured JSON logging with levels. Write, read, and query SCRIBE\'s log stream.',
  version: '1.0.0',
  inputs: {
    op:      { type: 'string', required: true,  description: '"write"|"read"|"clear"|"stats"' },
    level:   { type: 'string', required: false, description: '"debug"|"info"|"warn"|"error" (write op)' },
    message: { type: 'string', required: false, description: 'Log message (write op)' },
    data:    { type: 'any',    required: false, description: 'Structured data to attach (write op)' },
    filter_level: { type: 'string', required: false, description: 'Filter by level (read op)' },
    query:   { type: 'string', required: false, description: 'Filter by message content (read op)' },
    limit:   { type: 'number', required: false, description: 'Max entries (read op, default 50)' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any',
    error:  'string',
    ts:     'string',
  },
};

function ensure_log() {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '', 'utf-8');
}

function rotate_if_needed() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > MAX_SIZE) {
      const archive = LOG_FILE + '.1';
      if (fs.existsSync(archive)) fs.unlinkSync(archive);
      fs.renameSync(LOG_FILE, archive);
      fs.writeFileSync(LOG_FILE, '', 'utf-8');
    }
  } catch { /* ok */ }
}

async function run({ op, level = 'info', message, data, filter_level, query, limit = 50 }) {
  const ts = new Date().toISOString();
  ensure_log();
  try {
    let result;
    switch (op) {
      case 'write': result = op_write(level, message, data, ts); break;
      case 'read':  result = op_read(filter_level, query, limit); break;
      case 'clear': result = op_clear();                          break;
      case 'stats': result = op_stats();                          break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

function op_write(level, message, data, ts) {
  if (!message) throw new Error('message is required');
  if (!LEVELS.includes(level)) level = 'info';
  rotate_if_needed();
  const entry = { ts, level, message, ...(data ? { data } : {}) };
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf-8');
  return { logged: true, level, message };
}

function op_read(filter_level, query, limit) {
  const raw = fs.readFileSync(LOG_FILE, 'utf-8').trim();
  if (!raw) return { count: 0, entries: [] };
  let entries = raw.split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  if (filter_level) entries = entries.filter(e => e.level === filter_level);
  if (query) {
    const q = query.toLowerCase();
    entries = entries.filter(e => (e.message || '').toLowerCase().includes(q));
  }
  return { count: entries.length, entries: entries.slice(-limit) };
}

function op_clear() {
  fs.writeFileSync(LOG_FILE, '', 'utf-8');
  return { cleared: true };
}

function op_stats() {
  const raw = fs.readFileSync(LOG_FILE, 'utf-8').trim();
  if (!raw) return { total: 0, by_level: {} };
  const entries = raw.split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const by_level = {};
  for (const e of entries) by_level[e.level] = (by_level[e.level] || 0) + 1;
  const dates = entries.map(e => e.ts).filter(Boolean).sort();
  return { total: entries.length, by_level, earliest: dates[0] || null, latest: dates[dates.length - 1] || null };
}

module.exports = { MANIFEST, run };
