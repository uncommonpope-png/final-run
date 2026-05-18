'use strict';

// tamper_detect.js — Hash-chain integrity verification on the SCRIBE ledger
// On first seal, assigns a hash to each entry. On verify, detects any mutation.
// Ops: seal, verify, status, repair_index, clear_index

const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const readline = require('readline');

const DATA_DIR   = path.join(__dirname, '..', '..', 'data');
const LEDGER     = path.join(DATA_DIR, 'ledger.jsonl');
const INDEX_FILE = path.join(DATA_DIR, 'tamper_index.jsonl');
// Index entries: { seq, entry_id, hash, prev_hash, sealed_at }

function _hashEntry(entry_str, prev_hash) {
  return crypto.createHash('sha256').update(prev_hash + '|' + entry_str).digest('hex');
}

async function _readLedgerRaw() {
  if (!fs.existsSync(LEDGER)) return [];
  const lines = [];
  const rl = readline.createInterface({ input: fs.createReadStream(LEDGER), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (t) lines.push(t);
  }
  return lines;
}

async function _readIndex() {
  if (!fs.existsSync(INDEX_FILE)) return [];
  const entries = [];
  const rl = readline.createInterface({ input: fs.createReadStream(INDEX_FILE), crlfDelay: Infinity });
  for await (const line of rl) {
    try { entries.push(JSON.parse(line.trim())); } catch (_) {}
  }
  return entries;
}

// op: seal — build/extend hash-chain index for all ledger entries
async function op_seal() {
  const lines = await _readLedgerRaw();
  if (!lines.length) return { status: 'empty_ledger', sealed: 0 };

  const existing = await _readIndex();
  const indexed_ids = new Set(existing.map(e => e.entry_id));

  let prev_hash = existing.length ? existing[existing.length - 1].hash : '0'.repeat(64);
  let sealed = 0;
  const new_entries = [];

  for (let i = 0; i < lines.length; i++) {
    let entry;
    try { entry = JSON.parse(lines[i]); } catch (_) { continue; }
    const id = entry.id || `no_id_${i}`;
    if (indexed_ids.has(id)) {
      // Already sealed — advance prev_hash using existing index
      const ex = existing.find(e => e.entry_id === id);
      if (ex) prev_hash = ex.hash;
      continue;
    }
    const hash = _hashEntry(lines[i], prev_hash);
    new_entries.push({ seq: existing.length + new_entries.length + 1, entry_id: id, hash, prev_hash, sealed_at: new Date().toISOString() });
    prev_hash = hash;
    sealed++;
  }

  if (new_entries.length) {
    fs.appendFileSync(INDEX_FILE, new_entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  }

  return { status: 'sealed', new_entries: sealed, total_indexed: existing.length + sealed, chain_tip: prev_hash.slice(0, 16) + '...' };
}

// op: verify — walk the chain and detect any mutation
async function op_verify() {
  const lines = await _readLedgerRaw();
  const index = await _readIndex();

  if (!index.length) return { status: 'not_sealed', note: 'Run op seal first.' };

  const line_map = new Map();
  for (const line of lines) {
    try { const e = JSON.parse(line); if (e.id) line_map.set(e.id, line); } catch (_) {}
  }

  let prev_hash = '0'.repeat(64);
  const violations = [];
  let checked = 0;

  for (const idx_entry of index) {
    const raw = line_map.get(idx_entry.entry_id);
    if (!raw) {
      violations.push({ seq: idx_entry.seq, entry_id: idx_entry.entry_id, type: 'missing' });
      prev_hash = idx_entry.hash; // advance to keep checking rest of chain
      continue;
    }
    const expected = _hashEntry(raw, idx_entry.prev_hash);
    if (expected !== idx_entry.hash) {
      violations.push({ seq: idx_entry.seq, entry_id: idx_entry.entry_id, type: 'hash_mismatch' });
    }
    prev_hash = idx_entry.hash;
    checked++;
  }

  return {
    status: violations.length ? 'TAMPERED' : 'CLEAN',
    checked,
    violations_count: violations.length,
    violations,
    chain_tip: index[index.length - 1]?.hash?.slice(0, 16) + '...',
  };
}

// op: status — quick summary
async function op_status() {
  const index = await _readIndex();
  const lines = await _readLedgerRaw();
  return {
    ledger_entries: lines.length,
    indexed_entries: index.length,
    sealed: index.length > 0,
    chain_tip: index.length ? index[index.length - 1].hash.slice(0, 16) + '...' : null,
    last_sealed_at: index.length ? index[index.length - 1].sealed_at : null,
    unindexed: lines.length - index.length,
  };
}

// op: repair_index — rebuild entire index from scratch
async function op_repair_index() {
  if (fs.existsSync(INDEX_FILE)) {
    const bak = INDEX_FILE + '.bak_' + Date.now();
    fs.copyFileSync(INDEX_FILE, bak);
    fs.unlinkSync(INDEX_FILE);
  }
  return op_seal();
}

// op: clear_index
function op_clear_index() {
  if (fs.existsSync(INDEX_FILE)) fs.unlinkSync(INDEX_FILE);
  return { status: 'cleared' };
}

const MANIFEST = {
  name: 'tamper_detect',
  description: 'Hash-chain integrity verification on the SCRIBE ledger. Ops: seal, verify, status, repair_index, clear_index.',
  ops: ['seal', 'verify', 'status', 'repair_index', 'clear_index'],
};

async function run(op, params) {
  switch (op) {
    case 'seal':          return op_seal();
    case 'verify':        return op_verify();
    case 'status':        return op_status();
    case 'repair_index':  return op_repair_index();
    case 'clear_index':   return op_clear_index();
    default:
      throw new Error(`Unknown op: ${op}. Available: seal, verify, status, repair_index, clear_index`);
  }
}

module.exports = { MANIFEST, run };
