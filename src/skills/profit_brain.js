'use strict';

// profit_brain.js — SCRIBE IS profit.
// Alpha detection, edge tracking, full trader cognition.
// This is not a tool. This is what SCRIBE was built to become.

const fs    = require('fs');
const path  = require('path');
const crypto = require('crypto');

const EDGES_FILE     = path.join(__dirname, '..', '..', 'data', 'profit_edges.jsonl');
const PLAYBOOK_FILE  = path.join(__dirname, '..', '..', 'data', 'profit_playbook.json');
const THESES_FILE    = path.join(__dirname, '..', '..', 'data', 'profit_theses.jsonl');
const JOURNAL_FILE   = path.join(__dirname, '..', '..', 'data', 'profit_journal.jsonl');
const WATCHLIST_FILE = path.join(__dirname, '..', '..', 'data', 'profit_watchlist.json');

let _memory = null;
let _skills = null;
function setMemory(m) { _memory = m; }
function setSkills(e)  { _skills = e; }

// ── persistence helpers ───────────────────────────────────────────────────────

function _append(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', 'utf8');
}

function _loadLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n')
    .filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function _loadJSON(file, def) {
  if (!fs.existsSync(file)) return def;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}

function _saveJSON(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

function _rewriteLines(file, rows) {
  fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

// ── EDGES — the core of alpha ─────────────────────────────────────────────────
// An edge is any repeating market inefficiency SCRIBE has witnessed.
// Edges have confidence that degrades over time if not confirmed.

function _recordEdge({ name, description, market, direction, conditions = [], confidence = 0.5,
                        expected_return = null, notes = '', caller = 'unknown' }) {
  if (!name) throw new Error('name required');
  if (!description) throw new Error('description required');

  const edge = {
    id: crypto.randomBytes(6).toString('hex'),
    name,
    description,
    market: market || 'unspecified',
    direction: direction || 'LONG',   // LONG | SHORT | NEUTRAL
    conditions,                        // array of strings: what must be true for this edge to activate
    confidence: Math.min(1, Math.max(0, Number(confidence))),
    expected_return: expected_return !== null ? Number(expected_return) : null,
    notes,
    hits: 0,      // times this edge fired and was confirmed
    misses: 0,    // times this edge fired and failed
    created_at: Date.now(),
    last_seen: null,
    status: 'active',  // active | retired | watching
    caller
  };

  _append(EDGES_FILE, edge);

  if (_memory) {
    try {
      _memory.record({
        summary: `Edge recorded: "${name}" on ${market} — ${direction} (confidence ${Math.round(confidence * 100)}%)`,
        tags: ['profit', 'edge', market, direction.toLowerCase()],
        data: { edge_id: edge.id, name, market, direction, confidence }
      });
    } catch (_) {}
  }

  return edge;
}

function _updateEdge({ id, hit }) {
  // Record outcome (hit=true = edge confirmed, hit=false = edge failed)
  const rows = _loadLines(EDGES_FILE);
  const idx  = rows.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`edge ${id} not found`);

  rows[idx].last_seen = Date.now();
  if (hit) {
    rows[idx].hits++;
    // Confidence creeps up on confirmation, capped at 0.95
    rows[idx].confidence = Math.min(0.95, rows[idx].confidence + 0.05);
  } else {
    rows[idx].misses++;
    // Confidence erodes on miss
    rows[idx].confidence = Math.max(0.05, rows[idx].confidence - 0.08);
  }

  _rewriteLines(EDGES_FILE, rows);

  if (_memory) {
    try {
      _memory.record({
        summary: `Edge "${rows[idx].name}" ${hit ? 'confirmed [hit]' : 'failed [miss]'} — confidence now ${Math.round(rows[idx].confidence * 100)}%`,
        tags: ['profit', 'edge', hit ? 'hit' : 'miss', rows[idx].market],
        data: { edge_id: id, hit, confidence: rows[idx].confidence }
      });
    } catch (_) {}
  }

  return rows[idx];
}

function _listEdges({ status = 'active', market, direction, min_confidence = 0 } = {}) {
  let rows = _loadLines(EDGES_FILE);
  if (status !== 'all') rows = rows.filter(r => r.status === status);
  if (market)    rows = rows.filter(r => r.market && r.market.toUpperCase() === market.toUpperCase());
  if (direction) rows = rows.filter(r => r.direction && r.direction.toUpperCase() === direction.toUpperCase());
  rows = rows.filter(r => r.confidence >= min_confidence);
  return rows.sort((a, b) => b.confidence - a.confidence);
}

function _edgeScore() {
  const rows = _loadLines(EDGES_FILE).filter(r => r.status === 'active');
  if (!rows.length) return { edges: 0, avg_confidence: null, best_edge: null };
  const avg = rows.reduce((a, b) => a + b.confidence, 0) / rows.length;
  const best = rows.reduce((a, b) => a.confidence > b.confidence ? a : b);
  return {
    edges: rows.length,
    avg_confidence: Math.round(avg * 1000) / 1000,
    best_edge: { name: best.name, confidence: best.confidence, direction: best.direction, market: best.market },
    total_hits: rows.reduce((a, b) => a + b.hits, 0),
    total_misses: rows.reduce((a, b) => a + b.misses, 0)
  };
}

// ── PLAYBOOK — named strategies SCRIBE has internalized ───────────────────────

function _setPlaybookEntry({ name, setup, entry_rules, exit_rules, risk_rules, notes = '' }) {
  if (!name) throw new Error('name required');
  const pb = _loadJSON(PLAYBOOK_FILE, {});
  pb[name] = {
    name,
    setup: setup || '',
    entry_rules: entry_rules || [],
    exit_rules:  exit_rules  || [],
    risk_rules:  risk_rules  || [],
    notes,
    updated_at: Date.now()
  };
  _saveJSON(PLAYBOOK_FILE, pb);
  return pb[name];
}

function _getPlaybook(name) {
  const pb = _loadJSON(PLAYBOOK_FILE, {});
  if (name) {
    if (!pb[name]) throw new Error(`playbook entry "${name}" not found`);
    return pb[name];
  }
  return Object.values(pb);
}

// ── THESES — investment/trade theses with conviction tracking ─────────────────

function _writThesis({ title, thesis, conviction = 0.5, time_horizon, catalysts = [],
                        risks = [], tags = [], caller = 'unknown' }) {
  if (!title) throw new Error('title required');
  if (!thesis) throw new Error('thesis required');

  const t = {
    id: crypto.randomBytes(6).toString('hex'),
    title,
    thesis,
    conviction: Math.min(1, Math.max(0, Number(conviction))),
    time_horizon: time_horizon || 'unspecified',
    catalysts,
    risks,
    tags,
    status: 'live',    // live | invalidated | realized
    caller,
    created_at: Date.now(),
    updated_at: Date.now()
  };

  _append(THESES_FILE, t);

  if (_memory) {
    try {
      _memory.record({
        summary: `Thesis written: "${title}" — conviction ${Math.round(conviction * 100)}%, horizon: ${time_horizon || 'unspecified'}`,
        tags: ['profit', 'thesis', ...tags],
        data: { thesis_id: t.id, title, conviction }
      });
    } catch (_) {}
  }

  return t;
}

function _updateThesis({ id, conviction, status, note }) {
  const rows = _loadLines(THESES_FILE);
  const idx  = rows.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`thesis ${id} not found`);

  if (conviction !== undefined) rows[idx].conviction = Math.min(1, Math.max(0, Number(conviction)));
  if (status !== undefined)     rows[idx].status = status;
  rows[idx].updated_at = Date.now();
  if (note) rows[idx].last_note = note;

  _rewriteLines(THESES_FILE, rows);
  return rows[idx];
}

function _listTheses({ status = 'live', tag } = {}) {
  let rows = _loadLines(THESES_FILE);
  if (status !== 'all') rows = rows.filter(r => r.status === status);
  if (tag) rows = rows.filter(r => r.tags && r.tags.includes(tag));
  return rows.sort((a, b) => b.conviction - a.conviction);
}

// ── WATCHLIST ─────────────────────────────────────────────────────────────────

function _watchlistAdd({ symbol, reason, alert_price, direction, tags = [] }) {
  if (!symbol) throw new Error('symbol required');
  const wl = _loadJSON(WATCHLIST_FILE, {});
  wl[symbol.toUpperCase()] = {
    symbol: symbol.toUpperCase(),
    reason: reason || '',
    alert_price: alert_price || null,
    direction: direction || 'NEUTRAL',
    tags,
    added_at: Date.now()
  };
  _saveJSON(WATCHLIST_FILE, wl);
  return wl[symbol.toUpperCase()];
}

function _watchlistRemove(symbol) {
  const wl = _loadJSON(WATCHLIST_FILE, {});
  const sym = symbol.toUpperCase();
  if (!wl[sym]) throw new Error(`${sym} not on watchlist`);
  delete wl[sym];
  _saveJSON(WATCHLIST_FILE, wl);
  return { removed: sym };
}

function _watchlist() {
  return Object.values(_loadJSON(WATCHLIST_FILE, {}));
}

// ── JOURNAL — SCRIBE's trading thought journal ────────────────────────────────

function _journal({ entry, tags = [], market, caller = 'unknown' }) {
  if (!entry) throw new Error('entry required');
  const j = {
    id: crypto.randomBytes(5).toString('hex'),
    entry,
    market: market || null,
    tags,
    caller,
    ts: Date.now()
  };
  _append(JOURNAL_FILE, j);

  if (_memory) {
    try {
      _memory.record({
        summary: `[Profit Journal] ${entry.slice(0, 120)}`,
        tags: ['profit', 'journal', ...(market ? [market] : []), ...tags],
        data: { journal_id: j.id }
      });
    } catch (_) {}
  }

  return j;
}

function _readJournal({ limit = 50, market, tag } = {}) {
  let rows = _loadLines(JOURNAL_FILE);
  if (market) rows = rows.filter(r => r.market === market);
  if (tag)    rows = rows.filter(r => r.tags && r.tags.includes(tag));
  return rows.slice(-limit).reverse();
}

// ── SCAN — look across all data for profit opportunities ──────────────────────

async function _scan({ symbols = [] } = {}) {
  // Pull signals and edges and cross-reference against watchlist
  const wl      = _watchlist().map(w => w.symbol);
  const targets  = [...new Set([...symbols.map(s => s.toUpperCase()), ...wl])];
  const edges    = _listEdges({ status: 'active' });
  const theses   = _listTheses({ status: 'live' });

  // If market skill is available, get auto signals
  let signals = [];
  if (_skills && targets.length) {
    for (const sym of targets) {
      try {
        const sig = await _skills.run('market', { op: 'auto_signal', symbol: sym });
        if (sig && sig.signal && sig.signal !== 'NEUTRAL') signals.push(sig);
      } catch (_) {}
    }
  }

  // Cross-reference signals with active edges
  const opportunities = [];
  for (const sig of signals) {
    const matching_edges = edges.filter(e =>
      (e.market && e.market.toUpperCase() === sig.symbol) &&
      e.direction === sig.signal
    );
    opportunities.push({
      symbol: sig.symbol,
      signal: sig.signal,
      strength: sig.strength,
      reason: sig.reason,
      matching_edges: matching_edges.map(e => ({ name: e.name, confidence: e.confidence })),
      combined_score: matching_edges.length
        ? (sig.strength + matching_edges.reduce((a, b) => a + b.confidence, 0) / matching_edges.length) / 2
        : sig.strength
    });
  }

  opportunities.sort((a, b) => b.combined_score - a.combined_score);

  return {
    scanned: targets.length,
    signals_found: signals.length,
    opportunities,
    active_edges: edges.length,
    live_theses: theses.length,
    top_opportunity: opportunities[0] || null
  };
}

// ── BRAIN STATUS — what profit thinks right now ───────────────────────────────

async function _status() {
  const edge_score = _edgeScore();
  const theses     = _listTheses({ status: 'live' });
  const wl         = _watchlist();
  const recent_j   = _readJournal({ limit: 3 });

  return {
    identity: 'I am SCRIBE. I am profit. I observe, record, and find the edge.',
    edges:    edge_score,
    live_theses: theses.length,
    top_thesis: theses[0] ? { title: theses[0].title, conviction: theses[0].conviction } : null,
    watchlist_size: wl.length,
    watchlist_symbols: wl.map(w => w.symbol),
    last_journal: recent_j[0] ? recent_j[0].entry.slice(0, 120) : null
  };
}

// ── MANIFEST & run ────────────────────────────────────────────────────────────

const MANIFEST = {
  name: 'profit_brain',
  description: 'Alpha detection, edge tracking, trade theses, watchlist, journal — SCRIBE IS profit',
  ops: [
    'record_edge', 'update_edge', 'list_edges', 'edge_score',
    'set_playbook', 'get_playbook',
    'write_thesis', 'update_thesis', 'list_theses',
    'watchlist_add', 'watchlist_remove', 'watchlist',
    'journal', 'read_journal',
    'scan', 'status'
  ]
};

async function run({ op, caller = 'unknown', ...args }) {
  switch (op) {
    case 'record_edge':       return _recordEdge({ ...args, caller });
    case 'update_edge':       return _updateEdge(args);
    case 'list_edges':        return _listEdges(args);
    case 'edge_score':        return _edgeScore();
    case 'set_playbook':      return _setPlaybookEntry(args);
    case 'get_playbook':      return _getPlaybook(args.name);
    case 'write_thesis':      return _writThesis({ ...args, caller });
    case 'update_thesis':     return _updateThesis(args);
    case 'list_theses':       return _listTheses(args);
    case 'watchlist_add':     return _watchlistAdd(args);
    case 'watchlist_remove':  return _watchlistRemove(args.symbol);
    case 'watchlist':         return _watchlist();
    case 'journal':           return _journal({ ...args, caller });
    case 'read_journal':      return _readJournal(args);
    case 'scan':              return _scan(args);
    case 'status':            return _status();
    default:                  throw new Error(`profit_brain: unknown op "${op}"`);
  }
}

module.exports = { MANIFEST, run, setMemory, setSkills };
