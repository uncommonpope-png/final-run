'use strict';

/**
 * SKILL: rate_limiter
 *
 * In-process rate limiting for outbound calls and skill invocations.
 * Tracks call counts per key (e.g. domain, skill name) within a sliding window.
 *
 * Operations:
 *   check   — check if a key is within its rate limit (returns allowed: true/false)
 *   record  — record a call for a key (call after check passes)
 *   status  — return current counts for all tracked keys
 *   reset   — reset counts for a specific key
 */

const MANIFEST = {
  name: 'rate_limiter',
  description: 'In-process rate limiting. Check and record call counts per key within a sliding window.',
  version: '1.0.0',
  inputs: {
    op:         { type: 'string', required: true,  description: '"check"|"record"|"status"|"reset"' },
    key:        { type: 'string', required: false, description: 'Rate limit key (e.g. hostname, skill name)' },
    max_calls:  { type: 'number', required: false, description: 'Max calls allowed in window (default 10)' },
    window_ms:  { type: 'number', required: false, description: 'Window size in ms (default 60000 = 1 minute)' },
  },
  output: {
    ok:      'boolean',
    op:      'string',
    result:  'any',
    error:   'string',
    ts:      'string',
  },
};

// In-memory store: key -> array of timestamps (call log)
const _store = new Map();

async function run({ op, key, max_calls = 10, window_ms = 60000 }) {
  const ts = new Date().toISOString();
  try {
    let result;
    switch (op) {
      case 'check':  result = op_check(key, max_calls, window_ms);  break;
      case 'record': result = op_record(key, window_ms);            break;
      case 'status': result = op_status();                          break;
      case 'reset':  result = op_reset(key);                        break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

function _prune(key, window_ms) {
  const now = Date.now();
  const calls = _store.get(key) || [];
  const pruned = calls.filter(t => now - t < window_ms);
  _store.set(key, pruned);
  return pruned;
}

function op_check(key, max_calls, window_ms) {
  if (!key) throw new Error('key is required');
  const calls = _prune(key, window_ms);
  const allowed = calls.length < max_calls;
  return { key, allowed, current_count: calls.length, max_calls, window_ms, remaining: Math.max(0, max_calls - calls.length) };
}

function op_record(key, window_ms) {
  if (!key) throw new Error('key is required');
  _prune(key, window_ms);
  const calls = _store.get(key) || [];
  calls.push(Date.now());
  _store.set(key, calls);
  return { key, recorded: true, count_in_window: calls.length };
}

function op_status() {
  const entries = [];
  for (const [key, calls] of _store) {
    entries.push({ key, call_count: calls.length, oldest: calls[0] ? new Date(calls[0]).toISOString() : null });
  }
  return { tracked_keys: entries.length, entries };
}

function op_reset(key) {
  if (!key) throw new Error('key is required');
  _store.delete(key);
  return { key, reset: true };
}

module.exports = { MANIFEST, run };
