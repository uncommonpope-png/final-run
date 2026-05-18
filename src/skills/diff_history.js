'use strict';

// diff_history.js — Compare SCRIBE's memory ledger at two points in time
// Ops: compare, snapshot_list, entry_diff

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const LEDGER = path.join(DATA_DIR, 'ledger.jsonl');
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');

function _ensureSnapDir() {
  if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR, { recursive: true });
}

async function _readLedger(filePath) {
  const entries = [];
  if (!fs.existsSync(filePath)) return entries;
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    try { entries.push(JSON.parse(t)); } catch (_) { /* skip malformed */ }
  }
  return entries;
}

// Snapshot: save current ledger state as a named point-in-time reference
async function op_snapshot(params) {
  const { label } = params || {};
  if (!label) throw new Error('label required (e.g. "before_deploy", "week_2025_04_19")');
  _ensureSnapDir();
  const snap_id = `${label}_${Date.now()}`;
  const dest = path.join(SNAP_DIR, `${snap_id}.jsonl`);
  if (!fs.existsSync(LEDGER)) throw new Error('Ledger not found — nothing to snapshot.');
  fs.copyFileSync(LEDGER, dest);
  const entries = await _readLedger(dest);
  return { status: 'snapshot_taken', snap_id, label, entry_count: entries.length, file: dest };
}

// List available snapshots
function op_snapshot_list() {
  _ensureSnapDir();
  const files = fs.existsSync(SNAP_DIR)
    ? fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.jsonl'))
    : [];
  const snaps = files.map(f => {
    const full = path.join(SNAP_DIR, f);
    const stat = fs.statSync(full);
    return { snap_id: f.replace('.jsonl', ''), file: full, size_bytes: stat.size, mtime: stat.mtime.toISOString() };
  }).sort((a, b) => a.mtime.localeCompare(b.mtime));
  return { count: snaps.length, snapshots: snaps };
}

// Compare two snapshots (or one snapshot vs current ledger)
// Returns: added entries (in B but not A), removed entries (in A but not B), summary stats
async function op_compare(params) {
  const { snap_a, snap_b, limit = 50 } = params || {};
  if (!snap_a) throw new Error('snap_a required (snap_id or "current")');

  _ensureSnapDir();

  async function load(ref) {
    if (ref === 'current') return _readLedger(LEDGER);
    const f = path.join(SNAP_DIR, `${ref}.jsonl`);
    if (!fs.existsSync(f)) throw new Error(`Snapshot not found: ${ref}`);
    return _readLedger(f);
  }

  const a_entries = await load(snap_a);
  const b_entries = await load(snap_b || 'current');

  const a_ids = new Set(a_entries.map(e => e.id).filter(Boolean));
  const b_ids = new Set(b_entries.map(e => e.id).filter(Boolean));

  const added = b_entries.filter(e => e.id && !a_ids.has(e.id));
  const removed = a_entries.filter(e => e.id && !b_ids.has(e.id));
  const unchanged_count = b_entries.filter(e => e.id && a_ids.has(e.id)).length;

  const summarize = (arr) => arr.slice(0, limit).map(e => ({
    id: e.id,
    summary: e.summary || '',
    timestamp: e.timestamp || null,
    tags: e.tags || [],
  }));

  return {
    snap_a,
    snap_b: snap_b || 'current',
    a_total: a_entries.length,
    b_total: b_entries.length,
    added_count: added.length,
    removed_count: removed.length,
    unchanged_count,
    added: summarize(added),
    removed: summarize(removed),
    note: added.length > limit || removed.length > limit ? `Results capped at ${limit} per category.` : null,
  };
}

// Diff two individual entries by id across snapshots
async function op_entry_diff(params) {
  const { entry_id, snap_a, snap_b } = params || {};
  if (!entry_id) throw new Error('entry_id required');
  if (!snap_a) throw new Error('snap_a required');

  _ensureSnapDir();

  async function findEntry(ref, id) {
    let file;
    if (ref === 'current') { file = LEDGER; }
    else { file = path.join(SNAP_DIR, `${ref}.jsonl`); }
    if (!fs.existsSync(file)) return null;
    const entries = await _readLedger(file);
    return entries.find(e => e.id === id) || null;
  }

  const a = await findEntry(snap_a, entry_id);
  const b = await findEntry(snap_b || 'current', entry_id);

  if (!a && !b) return { entry_id, status: 'not_found_in_either' };

  const fields = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const diff = {};
  for (const k of fields) {
    const va = a ? a[k] : undefined;
    const vb = b ? b[k] : undefined;
    const sa = JSON.stringify(va);
    const sb = JSON.stringify(vb);
    if (sa !== sb) diff[k] = { a: va, b: vb };
  }

  return {
    entry_id,
    snap_a,
    snap_b: snap_b || 'current',
    exists_in_a: !!a,
    exists_in_b: !!b,
    changed_fields: Object.keys(diff),
    diff,
  };
}

async function run(op, params) {
  switch (op) {
    case 'snapshot':       return op_snapshot(params);
    case 'snapshot_list':  return op_snapshot_list();
    case 'compare':        return op_compare(params);
    case 'entry_diff':     return op_entry_diff(params);
    default:
      throw new Error(`Unknown op: ${op}. Available: snapshot, snapshot_list, compare, entry_diff`);
  }
}

const MANIFEST = {
  name: 'diff_history',
  description: 'Compare SCRIBE memory ledger at two points in time. Ops: snapshot, snapshot_list, compare, entry_diff.',
  ops: ['snapshot', 'snapshot_list', 'compare', 'entry_diff'],
};

module.exports = { MANIFEST, run };
