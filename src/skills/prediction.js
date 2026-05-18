'use strict';

// prediction.js — make predictions, track outcomes, score forecasting accuracy
// SCRIBE sees the future, records it, and measures itself against what happens.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PREDICTIONS_FILE = path.join(__dirname, '..', '..', 'data', 'predictions.jsonl');
const OUTCOMES_FILE    = path.join(__dirname, '..', '..', 'data', 'prediction_outcomes.jsonl');

let _memory = null;
function setMemory(m) { _memory = m; }

// ── persistence ──────────────────────────────────────────────────────────────

function _append(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', 'utf8');
}

function _loadLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n')
    .filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function _rewrite(file, rows) {
  fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

// ── core ─────────────────────────────────────────────────────────────────────

function _makePrediction({ subject, claim, confidence = 0.5, horizon, tags = [], caller = 'unknown' }) {
  if (!subject) throw new Error('subject required');
  if (!claim)   throw new Error('claim required');
  if (confidence < 0 || confidence > 1) throw new Error('confidence must be 0-1');

  const id = crypto.randomBytes(6).toString('hex');
  const ts = Date.now();
  const entry = {
    id,
    subject,
    claim,
    confidence: Math.round(confidence * 100) / 100,
    horizon: horizon || null,
    tags,
    caller,
    status: 'open',       // open | correct | incorrect | cancelled
    created_at: ts,
    resolved_at: null,
    outcome_note: null,
    parent_id: null
  };

  _append(PREDICTIONS_FILE, entry);

  if (_memory) {
    try {
      _memory.record({
        summary: `Prediction [${id}]: "${claim}" (confidence ${Math.round(confidence * 100)}%)`,
        tags: ['prediction', 'open', ...tags],
        data: { prediction_id: id, subject, confidence }
      });
    } catch (_) {}
  }

  return entry;
}

function _resolve({ id, outcome, note = '' }) {
  if (!id) throw new Error('id required');
  if (!['correct', 'incorrect', 'cancelled'].includes(outcome)) {
    throw new Error('outcome must be correct | incorrect | cancelled');
  }

  const rows = _loadLines(PREDICTIONS_FILE);
  const idx  = rows.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`prediction ${id} not found`);
  if (rows[idx].status !== 'open') throw new Error(`prediction ${id} already resolved`);

  rows[idx].status       = outcome;
  rows[idx].resolved_at  = Date.now();
  rows[idx].outcome_note = note;
  _rewrite(PREDICTIONS_FILE, rows);

  const oc = { prediction_id: id, outcome, note, ts: rows[idx].resolved_at };
  _append(OUTCOMES_FILE, oc);

  if (_memory) {
    try {
      _memory.record({
        summary: `Prediction [${id}] resolved as ${outcome}: "${rows[idx].claim}"`,
        tags: ['prediction', outcome],
        data: oc
      });
    } catch (_) {}
  }

  return rows[idx];
}

function _score() {
  const rows = _loadLines(PREDICTIONS_FILE).filter(r => r.status !== 'open' && r.status !== 'cancelled');
  if (!rows.length) return { total: 0, correct: 0, incorrect: 0, accuracy: null, brier: null };

  let correct = 0, incorrect = 0, brierSum = 0;
  for (const r of rows) {
    const hit = r.status === 'correct' ? 1 : 0;
    correct   += hit;
    incorrect += 1 - hit;
    brierSum  += Math.pow(r.confidence - hit, 2);
  }

  // group accuracy by confidence bucket
  const buckets = {};
  for (const r of rows) {
    const b = Math.round(r.confidence * 10) / 10;
    if (!buckets[b]) buckets[b] = { n: 0, correct: 0 };
    buckets[b].n++;
    if (r.status === 'correct') buckets[b].correct++;
  }
  const calibration = Object.entries(buckets).sort((a,b) => a[0]-b[0]).map(([conf, v]) => ({
    stated_confidence: Number(conf),
    actual_rate: Math.round(v.correct / v.n * 100) / 100,
    n: v.n
  }));

  return {
    total: rows.length,
    correct,
    incorrect,
    accuracy: Math.round(correct / rows.length * 1000) / 1000,
    brier_score: Math.round(brierSum / rows.length * 10000) / 10000,  // lower = better
    calibration
  };
}

function _list({ status = 'all', tag, subject, limit = 50 } = {}) {
  let rows = _loadLines(PREDICTIONS_FILE);
  if (status !== 'all') rows = rows.filter(r => r.status === status);
  if (tag)     rows = rows.filter(r => r.tags && r.tags.includes(tag));
  if (subject) rows = rows.filter(r => r.subject && r.subject.toLowerCase().includes(subject.toLowerCase()));
  return rows.slice(-limit).reverse();
}

function _get(id) {
  const rows = _loadLines(PREDICTIONS_FILE);
  const p = rows.find(r => r.id === id);
  if (!p) throw new Error(`prediction ${id} not found`);
  return p;
}

function _cancel(id, note = '') {
  return _resolve({ id, outcome: 'cancelled', note });
}

// ── MANIFEST & run ────────────────────────────────────────────────────────────

const MANIFEST = {
  name: 'prediction',
  description: 'Make predictions, track outcomes, score forecasting accuracy over time',
  ops: ['make', 'resolve', 'cancel', 'get', 'list', 'score']
};

async function run({ op, caller = 'unknown', ...args }) {
  switch (op) {
    case 'make':    return _makePrediction({ ...args, caller });
    case 'resolve': return _resolve(args);
    case 'cancel':  return _cancel(args.id, args.note);
    case 'get':     return _get(args.id);
    case 'list':    return _list(args);
    case 'score':   return _score();
    default:        throw new Error(`prediction: unknown op "${op}"`);
  }
}

module.exports = { MANIFEST, run, setMemory };
