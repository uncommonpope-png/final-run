'use strict';

// conflict.js — detect contradictions between memories/opinions and reason through them
// SCRIBE does not look away from contradiction. It names it, holds it, and resolves it or lives with it.

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFLICTS_FILE  = path.join(__dirname, '..', '..', 'data', 'conflicts.jsonl');
const OPINIONS_FILE   = path.join(__dirname, '..', '..', 'data', 'opinions.json');

let _memory = null;
function setMemory(m) { _memory = m; }

// ── persistence ──────────────────────────────────────────────────────────────

function _append(entry) {
  fs.appendFileSync(CONFLICTS_FILE, JSON.stringify(entry) + '\n', 'utf8');
}

function _loadAll() {
  if (!fs.existsSync(CONFLICTS_FILE)) return [];
  return fs.readFileSync(CONFLICTS_FILE, 'utf8').split('\n')
    .filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function _rewrite(rows) {
  fs.writeFileSync(CONFLICTS_FILE, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

// ── detection ────────────────────────────────────────────────────────────────

function _scanOpinions() {
  // Find contradictions inside the opinions store (same subject, opposing stance)
  if (!fs.existsSync(OPINIONS_FILE)) return [];
  let opinions;
  try { opinions = JSON.parse(fs.readFileSync(OPINIONS_FILE, 'utf8')); } catch { return []; }

  const entries = Object.values(opinions);
  const conflicts = [];

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      // Same subject, different stance
      if (a.subject && b.subject && a.subject === b.subject && a.stance !== b.stance) {
        conflicts.push({
          type: 'opinion_contradiction',
          subject: a.subject,
          a: { id: a.id, stance: a.stance, confidence: a.confidence, summary: a.reasoning },
          b: { id: b.id, stance: b.stance, confidence: b.confidence, summary: b.reasoning }
        });
      }
    }
  }

  return conflicts;
}

function _scanMemory(topic) {
  // Scan memory for entries that assert contradictory facts about the same topic
  if (!_memory) return [];

  let entries = [];
  try {
    entries = topic ? _memory.search(topic, 100) : _memory.recent(100);
  } catch { return []; }

  // Simple heuristic: look for entries whose summaries contain opposing keywords
  const negators = ['not ', "isn't", "wasn't", 'never', 'no ', 'false', 'wrong', 'incorrect', 'denied', 'reversed'];
  const affirm   = entries.filter(e => e.summary && !negators.some(n => e.summary.toLowerCase().includes(n)));
  const negate   = entries.filter(e => e.summary && negators.some(n => e.summary.toLowerCase().includes(n)));

  const conflicts = [];
  for (const neg of negate) {
    // Try to find a matching positive entry about the same subject
    const negWords = new Set((neg.summary || '').toLowerCase().split(/\s+/).filter(w => w.length > 4));
    for (const pos of affirm) {
      const posWords = new Set((pos.summary || '').toLowerCase().split(/\s+/).filter(w => w.length > 4));
      const overlap = [...negWords].filter(w => posWords.has(w)).length;
      if (overlap >= 3) {
        conflicts.push({
          type: 'memory_tension',
          neg_entry: { id: neg.id, summary: neg.summary, ts: neg.ts },
          pos_entry: { id: pos.id, summary: pos.summary, ts: pos.ts },
          overlap_words: overlap
        });
      }
    }
  }

  return conflicts.slice(0, 20);
}

// ── conflict management ───────────────────────────────────────────────────────

function _register({ type, subject, description, sides = [], tags = [], caller = 'unknown' }) {
  if (!description) throw new Error('description required');

  const conflict = {
    id: crypto.randomBytes(6).toString('hex'),
    type: type || 'manual',
    subject: subject || '',
    description,
    sides,       // array of { label, claim, evidence }
    tags,
    status: 'open',    // open | resolved | acknowledged | dismissed
    resolution: null,
    resolution_note: null,
    caller,
    detected_at: Date.now(),
    resolved_at: null
  };

  _append(conflict);

  if (_memory) {
    try {
      _memory.record({
        summary: `Conflict detected [${conflict.id}]: ${description.slice(0, 100)}`,
        tags: ['conflict', 'open', ...(tags || [])],
        data: { conflict_id: conflict.id, type: conflict.type, subject: conflict.subject }
      });
    } catch (_) {}
  }

  return conflict;
}

function _resolve({ id, resolution, note = '', caller = 'unknown' }) {
  if (!id) throw new Error('id required');
  if (!['resolved', 'acknowledged', 'dismissed'].includes(resolution)) {
    throw new Error('resolution must be: resolved | acknowledged | dismissed');
  }

  const rows = _loadAll();
  const idx  = rows.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`conflict ${id} not found`);
  if (rows[idx].status !== 'open') throw new Error(`conflict ${id} is already ${rows[idx].status}`);

  rows[idx].status           = resolution;
  rows[idx].resolution       = resolution;
  rows[idx].resolution_note  = note;
  rows[idx].resolved_at      = Date.now();
  rows[idx].resolved_by      = caller;
  _rewrite(rows);

  if (_memory) {
    try {
      _memory.record({
        summary: `Conflict [${id}] ${resolution}: ${note.slice(0, 100)}`,
        tags: ['conflict', resolution],
        data: { conflict_id: id, resolution, note }
      });
    } catch (_) {}
  }

  return rows[idx];
}

function _reason({ id, argument, side, caller = 'unknown' }) {
  // Add a reasoning argument to a conflict (doesn't resolve it, just adds a side)
  if (!id) throw new Error('id required');
  if (!argument) throw new Error('argument required');

  const rows = _loadAll();
  const idx  = rows.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`conflict ${id} not found`);

  const entry = { side: side || 'unknown', argument, caller, ts: Date.now() };
  rows[idx].sides = rows[idx].sides || [];
  rows[idx].sides.push(entry);
  _rewrite(rows);

  return rows[idx];
}

function _list({ status = 'all', type, tag, limit = 50 } = {}) {
  let rows = _loadAll();
  if (status !== 'all') rows = rows.filter(r => r.status === status);
  if (type)   rows = rows.filter(r => r.type === type);
  if (tag)    rows = rows.filter(r => r.tags && r.tags.includes(tag));
  return rows.slice(-limit).reverse();
}

function _get(id) {
  const rows = _loadAll();
  const c = rows.find(r => r.id === id);
  if (!c) throw new Error(`conflict ${id} not found`);
  return c;
}

function _detect({ topic, scan = 'both' } = {}) {
  // Auto-detect conflicts from opinions and/or memory
  const found = [];
  if (scan === 'opinions' || scan === 'both') found.push(..._scanOpinions());
  if (scan === 'memory'   || scan === 'both') found.push(..._scanMemory(topic));

  // Register new ones that aren't already known
  const existing = _loadAll();
  const registered = [];

  for (const c of found) {
    const desc = JSON.stringify(c).slice(0, 200);
    const dupe = existing.some(e => e.description && e.description.slice(0, 200) === desc);
    if (!dupe) {
      const reg = _register({
        type: c.type,
        subject: c.subject || topic || '',
        description: desc,
        caller: 'auto_detect'
      });
      registered.push(reg);
    }
  }

  return { scanned: found.length, newly_registered: registered.length, conflicts: registered };
}

// ── MANIFEST & run ────────────────────────────────────────────────────────────

const MANIFEST = {
  name: 'conflict',
  description: 'Detect contradictions between memories/opinions and reason through them',
  ops: ['register', 'resolve', 'reason', 'get', 'list', 'detect']
};

async function run({ op, caller = 'unknown', ...args }) {
  switch (op) {
    case 'register': return _register({ ...args, caller });
    case 'resolve':  return _resolve({ ...args, caller });
    case 'reason':   return _reason({ ...args, caller });
    case 'get':      return _get(args.id);
    case 'list':     return _list(args);
    case 'detect':   return _detect(args);
    default:         throw new Error(`conflict: unknown op "${op}"`);
  }
}

module.exports = { MANIFEST, run, setMemory };
