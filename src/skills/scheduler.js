'use strict';

/**
 * SKILL: scheduler
 *
 * In-process scheduling: one-shot timers, recurring intervals, countdowns.
 * Jobs are stored in memory (survive only as long as SCRIBE is running).
 * The engine is a singleton so all callers share the same job registry.
 *
 * Operations:
 *   schedule    — run a webhook/memory-record once after a delay
 *   recurring   — run a webhook/memory-record every N milliseconds
 *   countdown   — return time remaining to a target ISO timestamp
 *   list        — list all active jobs
 *   cancel      — cancel a job by id
 *   clear_all   — cancel all jobs
 */

const crypto = require('crypto');

const MANIFEST = {
  name: 'scheduler',
  description: 'Schedule one-shot timers, recurring tasks, and countdowns. Jobs persist in-process.',
  version: '1.0.0',
  inputs: {
    op:       { type: 'string', required: true,  description: '"schedule"|"recurring"|"countdown"|"list"|"cancel"|"clear_all"' },
    label:    { type: 'string', required: false, description: 'Human-readable job label' },
    delay_ms: { type: 'number', required: false, description: 'Delay in ms (schedule op)' },
    every_ms: { type: 'number', required: false, description: 'Interval in ms (recurring op)' },
    target:   { type: 'string', required: false, description: 'ISO timestamp to count down to (countdown op)' },
    action:   { type: 'object', required: false, description: 'What to do on fire: { type: "memory", summary } or { type: "http", url, body }' },
    job_id:   { type: 'string', required: false, description: 'Job ID to cancel' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any',
    error:  'string',
    ts:     'string',
  },
};

// ── Singleton job registry ─────────────────────────────────────────────────
const _jobs = new Map(); // id -> { id, label, type, timer, created, fires_at?, every_ms?, action }

let _memory = null; // injected by SkillEngine if available (see engine.js note)

function setMemory(m) { _memory = m; }

async function run({ op, label, delay_ms, every_ms, target, action, job_id }) {
  const ts = new Date().toISOString();
  try {
    let result;
    switch (op) {
      case 'schedule':  result = op_schedule(label, delay_ms, action);  break;
      case 'recurring': result = op_recurring(label, every_ms, action); break;
      case 'countdown': result = op_countdown(target);                  break;
      case 'list':      result = op_list();                             break;
      case 'cancel':    result = op_cancel(job_id);                     break;
      case 'clear_all': result = op_clear_all();                        break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

// ── Operations ────────────────────────────────────────────────────────────────

function op_schedule(label, delay_ms, action) {
  if (!delay_ms || delay_ms < 1) throw new Error('delay_ms is required and must be > 0');
  const id = `job_${crypto.randomBytes(4).toString('hex')}`;
  const fires_at = new Date(Date.now() + delay_ms).toISOString();
  const timer = setTimeout(() => {
    _fire(id, label, action);
    _jobs.delete(id);
  }, delay_ms);
  _jobs.set(id, { id, label: label || id, type: 'once', timer, created: new Date().toISOString(), fires_at, action });
  return { job_id: id, label, fires_at, delay_ms };
}

function op_recurring(label, every_ms, action) {
  if (!every_ms || every_ms < 1000) throw new Error('every_ms is required and must be >= 1000');
  const id = `job_${crypto.randomBytes(4).toString('hex')}`;
  const timer = setInterval(() => _fire(id, label, action), every_ms);
  _jobs.set(id, { id, label: label || id, type: 'recurring', timer, created: new Date().toISOString(), every_ms, action });
  return { job_id: id, label, every_ms };
}

function op_countdown(target) {
  if (!target) throw new Error('target is required');
  const targetMs = new Date(target).getTime();
  if (isNaN(targetMs)) throw new Error(`Invalid target timestamp: ${target}`);
  const remaining_ms = targetMs - Date.now();
  const remaining_s  = Math.floor(Math.abs(remaining_ms) / 1000);
  const h = Math.floor(remaining_s / 3600);
  const m = Math.floor((remaining_s % 3600) / 60);
  const s = remaining_s % 60;
  return {
    target,
    remaining_ms,
    past: remaining_ms < 0,
    human: `${h}h ${m}m ${s}s`,
  };
}

function op_list() {
  const jobs = [];
  for (const j of _jobs.values()) {
    jobs.push({ id: j.id, label: j.label, type: j.type, created: j.created, fires_at: j.fires_at || null, every_ms: j.every_ms || null });
  }
  return { count: jobs.length, jobs };
}

function op_cancel(job_id) {
  if (!job_id) throw new Error('job_id is required');
  const job = _jobs.get(job_id);
  if (!job) throw new Error(`No job found with id: ${job_id}`);
  clearTimeout(job.timer);
  clearInterval(job.timer);
  _jobs.delete(job_id);
  return { cancelled: job_id, label: job.label };
}

function op_clear_all() {
  const count = _jobs.size;
  for (const job of _jobs.values()) {
    clearTimeout(job.timer);
    clearInterval(job.timer);
  }
  _jobs.clear();
  return { cancelled_count: count };
}

// ── Fire action ───────────────────────────────────────────────────────────────

function _fire(id, label, action) {
  if (!action) return;

  if (action.type === 'memory' && _memory) {
    try {
      _memory.record({
        type: 'observation',
        summary: action.summary || `Scheduled job "${label}" fired`,
        tags: ['scheduler', id],
        weight: 0.3,
        source: { system: 'SCRIBE', chamber: 'scheduler' },
      });
    } catch { /* silent */ }
    return;
  }

  if (action.type === 'http' && action.url) {
    // Fire and forget — use Node's built-in http/https
    const https = require('https');
    const http  = require('http');
    const { URL } = require('url');
    try {
      const u = new URL(action.url);
      const body = JSON.stringify(action.body || { job_id: id, label, fired_at: new Date().toISOString() });
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request({
        hostname: u.hostname, port: u.port, path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      });
      req.on('error', () => {}); // silent
      req.write(body);
      req.end();
    } catch { /* silent */ }
  }
}

module.exports = { MANIFEST, run, setMemory };
