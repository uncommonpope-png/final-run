'use strict';

// cron_schedule.js — Recurring cron-style scheduled jobs for SCRIBE
// Supports simple interval-based schedules (no external dependencies)
// Ops: add, remove, list, run_now, clear

const JOBS = new Map(); // job_id -> { id, label, interval_ms, last_run, next_run, op, params, run_count, errors }
let _memory = null;

function setMemory(mem) { _memory = mem; }

function _now() { return Date.now(); }

function _parseInterval(spec) {
  // Accepts: number (ms), or strings like "30s", "5m", "1h", "2d"
  if (typeof spec === 'number') return spec;
  const match = String(spec).trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i);
  if (!match) throw new Error(`Invalid interval spec: ${spec}. Use e.g. "30s", "5m", "1h", "2d", or ms number.`);
  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const mult = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return Math.round(val * mult[unit]);
}

function _schedule(job) {
  if (job._timer) clearTimeout(job._timer);
  const delay = Math.max(0, job.next_run - _now());
  job._timer = setTimeout(async () => {
    job.last_run = _now();
    job.run_count = (job.run_count || 0) + 1;
    job.next_run = job.last_run + job.interval_ms;
    try {
      if (_memory && job.record_to_memory) {
        await _memory.record({
          summary: `[cron] ${job.label} fired (run #${job.run_count})`,
          tags: ['cron', job.id],
        });
      }
    } catch (_) { /* memory not critical */ }
    _schedule(job); // reschedule
  }, delay);
  job._timer.unref && job._timer.unref(); // don't block process exit
}

// --- ops ---

function op_add(params) {
  const { job_id, label, interval, record_to_memory = false } = params || {};
  if (!job_id) throw new Error('job_id required');
  if (!interval) throw new Error('interval required (e.g. "5m", "1h", 60000)');
  if (JOBS.has(job_id)) throw new Error(`Job already exists: ${job_id}. Remove it first.`);

  const interval_ms = _parseInterval(interval);
  if (interval_ms < 1000) throw new Error('Minimum interval is 1000ms (1s).');

  const job = {
    id: job_id,
    label: label || job_id,
    interval_ms,
    interval_spec: String(interval),
    record_to_memory,
    last_run: null,
    next_run: _now() + interval_ms,
    run_count: 0,
    created_at: new Date().toISOString(),
    _timer: null,
  };
  JOBS.set(job_id, job);
  _schedule(job);
  return { status: 'scheduled', job_id, label: job.label, interval_ms, next_run: new Date(job.next_run).toISOString() };
}

function op_remove(params) {
  const { job_id } = params || {};
  if (!job_id) throw new Error('job_id required');
  const job = JOBS.get(job_id);
  if (!job) throw new Error(`No job found: ${job_id}`);
  if (job._timer) clearTimeout(job._timer);
  JOBS.delete(job_id);
  return { status: 'removed', job_id };
}

function op_list() {
  const jobs = [];
  for (const job of JOBS.values()) {
    jobs.push({
      id: job.id,
      label: job.label,
      interval_spec: job.interval_spec,
      interval_ms: job.interval_ms,
      last_run: job.last_run ? new Date(job.last_run).toISOString() : null,
      next_run: new Date(job.next_run).toISOString(),
      run_count: job.run_count,
      created_at: job.created_at,
      record_to_memory: job.record_to_memory,
    });
  }
  return { count: jobs.length, jobs };
}

function op_run_now(params) {
  const { job_id } = params || {};
  if (!job_id) throw new Error('job_id required');
  const job = JOBS.get(job_id);
  if (!job) throw new Error(`No job found: ${job_id}`);
  if (job._timer) clearTimeout(job._timer);
  job.next_run = _now();
  _schedule(job);
  return { status: 'triggered', job_id, next_run: new Date(job.next_run).toISOString() };
}

function op_clear() {
  let count = 0;
  for (const job of JOBS.values()) {
    if (job._timer) clearTimeout(job._timer);
    count++;
  }
  JOBS.clear();
  return { status: 'cleared', removed: count };
}

// --- entry point ---

async function run(op, params) {
  switch (op) {
    case 'add':      return op_add(params);
    case 'remove':   return op_remove(params);
    case 'list':     return op_list();
    case 'run_now':  return op_run_now(params);
    case 'clear':    return op_clear();
    default:
      throw new Error(`Unknown op: ${op}. Available: add, remove, list, run_now, clear`);
  }
}

const MANIFEST = {
  name: 'cron_schedule',
  description: 'Recurring cron-style scheduled jobs. Ops: add, remove, list, run_now, clear.',
  ops: ['add', 'remove', 'list', 'run_now', 'clear'],
};

module.exports = { MANIFEST, run, setMemory };
