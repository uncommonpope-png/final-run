'use strict';

/**
 * SKILL: memory_query
 *
 * Deep querying of SCRIBE's own causal memory ledger.
 * Goes beyond simple recall — traverses causal chains, filters by type/tag/weight,
 * clusters related memories, and surfaces patterns.
 *
 * Operations:
 *   search        — full-text search with filters
 *   causal_chain  — follow cause → effect chain from a memory ID
 *   by_type       — get all memories of a specific type
 *   by_tag        — get all memories with a specific tag
 *   high_weight   — get memories above a weight threshold
 *   span          — get memories within a time range
 *   cluster       — group memories by shared tags
 *   stats         — statistics on the entire ledger
 *   forget        — mark an entry as superseded (does not delete, adds annotation)
 */

const fs   = require('fs');
const path = require('path');

const LEDGER_FILE = path.join(__dirname, '..', '..', 'data', 'ledger.jsonl');

const MANIFEST = {
  name: 'memory_query',
  description: 'Deep query of SCRIBE\'s causal memory ledger: search, causal chains, filters, clustering, stats.',
  version: '1.0.0',
  inputs: {
    op:        { type: 'string', required: true,  description: '"search"|"causal_chain"|"by_type"|"by_tag"|"high_weight"|"span"|"cluster"|"stats"|"forget"' },
    query:     { type: 'string', required: false, description: 'Search text (search op)' },
    memory_id: { type: 'string', required: false, description: 'Memory ID (causal_chain, forget ops)' },
    type:      { type: 'string', required: false, description: 'Memory type filter' },
    tag:       { type: 'string', required: false, description: 'Tag to filter by' },
    weight:    { type: 'number', required: false, description: 'Minimum weight threshold (high_weight op)' },
    from:      { type: 'string', required: false, description: 'ISO start date (span op)' },
    to:        { type: 'string', required: false, description: 'ISO end date (span op)' },
    limit:     { type: 'number', required: false, description: 'Max results (default 20)' },
    note:      { type: 'string', required: false, description: 'Annotation note (forget op)' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any',
    error:  'string',
    ts:     'string',
  },
};

function load_ledger() {
  if (!fs.existsSync(LEDGER_FILE)) return [];
  const raw = fs.readFileSync(LEDGER_FILE, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

async function run({ op, query, memory_id, type, tag, weight, from, to, limit = 20, note }) {
  const ts = new Date().toISOString();
  try {
    const entries = load_ledger();
    let result;
    switch (op) {
      case 'search':      result = op_search(entries, query, limit);              break;
      case 'causal_chain':result = op_causal_chain(entries, memory_id);          break;
      case 'by_type':     result = op_by_type(entries, type, limit);             break;
      case 'by_tag':      result = op_by_tag(entries, tag, limit);               break;
      case 'high_weight': result = op_high_weight(entries, weight || 0.7, limit);break;
      case 'span':        result = op_span(entries, from, to, limit);            break;
      case 'cluster':     result = op_cluster(entries);                          break;
      case 'stats':       result = op_stats(entries);                            break;
      case 'forget':      result = op_forget(entries, memory_id, note);         break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

// ── Operations ────────────────────────────────────────────────────────────────

function op_search(entries, query, limit) {
  if (!query) return { count: entries.length, results: entries.slice(-limit) };
  const q = query.toLowerCase();
  const results = entries.filter(e =>
    (e.summary && e.summary.toLowerCase().includes(q)) ||
    (e.tags && e.tags.some(t => t.toLowerCase().includes(q))) ||
    (e.type && e.type.toLowerCase().includes(q)) ||
    (e.id && e.id.toLowerCase().includes(q))
  ).slice(-limit);
  return { query, count: results.length, results };
}

function op_causal_chain(entries, memory_id) {
  if (!memory_id) throw new Error('memory_id is required');
  const index = {};
  for (const e of entries) index[e.id] = e;

  // Walk forward (effects) — support both cause_id and parent_id field names
  const effects = entries.filter(e => (e.cause_id || e.parent_id) === memory_id);

  // Walk backward (causes)
  const causes = [];
  let current = index[memory_id];
  const visited = new Set();
  while (current && (current.cause_id || current.parent_id)) {
    const pid = current.cause_id || current.parent_id;
    if (visited.has(pid)) break; // cycle guard
    visited.add(pid);
    const parent = index[pid];
    if (!parent) break;
    causes.unshift(parent);
    current = parent;
  }

  return {
    root: index[memory_id] || null,
    causes,
    effects,
    chain_length: causes.length + 1 + effects.length,
  };
}

function op_by_type(entries, type, limit) {
  if (!type) throw new Error('type is required');
  const results = entries.filter(e => e.type === type).slice(-limit);
  return { type, count: results.length, results };
}

function op_by_tag(entries, tag, limit) {
  if (!tag) throw new Error('tag is required');
  const results = entries.filter(e => e.tags && e.tags.includes(tag)).slice(-limit);
  return { tag, count: results.length, results };
}

function op_high_weight(entries, weight, limit) {
  const results = entries.filter(e => (e.weight || 0) >= weight)
    .sort((a, b) => (b.weight || 0) - (a.weight || 0))
    .slice(0, limit);
  return { min_weight: weight, count: results.length, results };
}

function op_span(entries, from, to, limit) {
  const fromMs = from ? new Date(from).getTime() : 0;
  const toMs   = to   ? new Date(to).getTime()   : Infinity;
  const results = entries.filter(e => {
    const t = e.ts ? new Date(e.ts).getTime() : 0;
    return t >= fromMs && t <= toMs;
  }).slice(-limit);
  return { from: from || null, to: to || null, count: results.length, results };
}

function op_cluster(entries) {
  const clusters = {};
  for (const e of entries) {
    for (const tag of (e.tags || [])) {
      if (!clusters[tag]) clusters[tag] = [];
      clusters[tag].push({ id: e.id, summary: e.summary, type: e.type, ts: e.ts });
    }
  }
  const sorted = Object.entries(clusters)
    .sort((a, b) => b[1].length - a[1].length)
    .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});
  return { cluster_count: Object.keys(sorted).length, clusters: sorted };
}

function op_stats(entries) {
  const types = {}, sources = {}, tags = {};
  let totalWeight = 0, causalLinks = 0;
  const dates = entries.map(e => e.ts).filter(Boolean).sort();

  for (const e of entries) {
    types[e.type || 'unknown'] = (types[e.type || 'unknown'] || 0) + 1;
    const src = e.source?.system || 'unknown';
    sources[src] = (sources[src] || 0) + 1;
    for (const t of (e.tags || [])) tags[t] = (tags[t] || 0) + 1;
    totalWeight += e.weight || 0;
    if (e.cause_id || e.parent_id) causalLinks++;
  }

  return {
    total_entries: entries.length,
    causal_links: causalLinks,
    avg_weight: entries.length ? +(totalWeight / entries.length).toFixed(3) : 0,
    earliest: dates[0] || null,
    latest: dates[dates.length - 1] || null,
    types,
    sources,
    top_tags: Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 10).reduce((a, [k, v]) => { a[k] = v; return a; }, {}),
  };
}

function op_forget(entries, memory_id, note) {
  if (!memory_id) throw new Error('memory_id is required');
  const raw = fs.existsSync(LEDGER_FILE) ? fs.readFileSync(LEDGER_FILE, 'utf-8') : '';
  const lines = raw.trim().split('\n').filter(Boolean);
  let found = false;
  const updated = lines.map(line => {
    try {
      const e = JSON.parse(line);
      if (e.id === memory_id) {
        found = true;
        e.superseded = true;
        e.superseded_at = new Date().toISOString();
        if (note) e.superseded_note = note;
        return JSON.stringify(e);
      }
      return line;
    } catch { return line; }
  });
  if (!found) throw new Error(`Memory not found: ${memory_id}`);
  // Atomic write: write to temp file then rename
  const tmp = LEDGER_FILE + '.tmp';
  fs.writeFileSync(tmp, updated.join('\n') + '\n', 'utf-8');
  fs.renameSync(tmp, LEDGER_FILE);
  return { forgotten: memory_id, note: note || null };
}

module.exports = { MANIFEST, run };
