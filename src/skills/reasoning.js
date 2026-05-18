'use strict';

// reasoning.js — SCRIBE's language and reasoning engine
//
// SCRIBE reads its own memory and thinks about what it means.
// It extracts entities, detects contradictions, traces causal chains,
// generates hypotheses, and produces structured reasoning reports.
//
// Ops: extract_entities, find_causes, find_effects, hypothesize,
//      summarize_entity, detect_contradictions, reason_about, build_argument

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

const DATA_DIR     = path.join(__dirname, '..', '..', 'data');
const LEDGER       = path.join(DATA_DIR, 'ledger.jsonl');
const ENTITY_FILE  = path.join(DATA_DIR, 'entities.json');
const REASON_LOG   = path.join(DATA_DIR, 'reasoning_log.jsonl');

let _memory = null;
function setMemory(m) { _memory = m; }

// ── Ledger reader ─────────────────────────────────────────────────────────────

async function _readLedger(limit = 2000, tag_filter) {
  if (!fs.existsSync(LEDGER)) return [];
  const results = [];
  const rl = readline.createInterface({ input: fs.createReadStream(LEDGER), crlfDelay: Infinity });
  for await (const line of rl) {
    try {
      const e = JSON.parse(line.trim());
      if (tag_filter && !(e.tags || []).includes(tag_filter)) continue;
      results.push(e);
      if (results.length >= limit) break;
    } catch (_) {}
  }
  return results;
}

function _logReason(entry) {
  fs.appendFileSync(REASON_LOG, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n', 'utf8');
}

// ── Entity extraction ─────────────────────────────────────────────────────────
// Entities are proper-noun-like tokens: capitalized words, known domain terms,
// tags, and anything that appears 3+ times across memory entries.

function _tokenize(text) {
  return String(text || '').match(/\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)*|\b\w{4,}\b/g) || [];
}

async function op_extract_entities(params) {
  const { limit = 1000, min_frequency = 2 } = params || {};
  const entries = await _readLedger(limit);
  const freq = new Map();
  const contexts = new Map();

  for (const e of entries) {
    const tokens = _tokenize(e.summary || '');
    // Also count tags as entities
    for (const tag of (e.tags || [])) {
      const t = tag.trim();
      freq.set(t, (freq.get(t) || 0) + 3); // tags weighted higher
    }
    for (const token of tokens) {
      const t = token.trim();
      if (t.length < 3 || /^(the|and|for|that|this|with|from|into|have|been|will|not|but|are|was|were|had|has|can|its|all|any|one|two|our|you|her|him|they|their|what|when|how|where|why|who)$/i.test(t)) continue;
      freq.set(t, (freq.get(t) || 0) + 1);
      if (!contexts.has(t)) contexts.set(t, []);
      const ctx = contexts.get(t);
      if (ctx.length < 3) ctx.push((e.summary || '').slice(0, 100));
    }
  }

  const entities = [...freq.entries()]
    .filter(([, count]) => count >= min_frequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100)
    .map(([name, count]) => ({ name, frequency: count, contexts: contexts.get(name) || [] }));

  // Persist entity registry
  const existing = fs.existsSync(ENTITY_FILE) ? JSON.parse(fs.readFileSync(ENTITY_FILE, 'utf8')) : {};
  for (const e of entities) {
    existing[e.name] = { ...existing[e.name], ...e, last_seen: new Date().toISOString() };
  }
  const tmp = ENTITY_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(existing, null, 2), 'utf8');
  fs.renameSync(tmp, ENTITY_FILE);

  return { entity_count: entities.length, entities: entities.slice(0, 50) };
}

// ── Causal chain: find causes of X ───────────────────────────────────────────

async function op_find_causes(params) {
  const { entry_id, depth = 3 } = params || {};
  if (!entry_id) throw new Error('entry_id required');
  const entries = await _readLedger(5000);
  const by_id = new Map(entries.map(e => [e.id, e]));

  const chain = [];
  const visited = new Set();
  let current_id = entry_id;

  for (let d = 0; d < depth; d++) {
    if (!current_id || visited.has(current_id)) break;
    visited.add(current_id);
    const e = by_id.get(current_id);
    if (!e) break;
    chain.push({ id: e.id, summary: e.summary, timestamp: e.timestamp, depth: d });
    current_id = e.parent_id || e.cause_id || null;
  }

  return { entry_id, cause_chain: chain, depth_reached: chain.length };
}

// ── Find effects of X ─────────────────────────────────────────────────────────

async function op_find_effects(params) {
  const { entry_id, depth = 3, limit = 20 } = params || {};
  if (!entry_id) throw new Error('entry_id required');
  const entries = await _readLedger(5000);

  function getChildren(id, all_entries) {
    return all_entries.filter(e => e.parent_id === id || e.cause_id === id);
  }

  const tree = [];
  const queue = [{ id: entry_id, d: 0 }];
  const visited = new Set();

  while (queue.length && tree.length < limit) {
    const { id, d } = queue.shift();
    if (visited.has(id) || d > depth) continue;
    visited.add(id);
    const children = getChildren(id, entries);
    for (const c of children) {
      tree.push({ id: c.id, summary: c.summary, timestamp: c.timestamp, depth: d + 1, parent_id: id });
      queue.push({ id: c.id, d: d + 1 });
    }
  }

  return { entry_id, effect_tree: tree, total_effects: tree.length };
}

// ── Hypothesize — generate possible causes for a described phenomenon ─────────

async function op_hypothesize(params) {
  const { phenomenon, limit = 500 } = params || {};
  if (!phenomenon) throw new Error('phenomenon required');
  const entries = await _readLedger(limit);

  const keywords = _tokenize(phenomenon).map(t => t.toLowerCase()).filter(t => t.length > 3);
  const relevant = entries.filter(e => {
    const text = (e.summary || '').toLowerCase();
    return keywords.some(k => text.includes(k));
  });

  if (!relevant.length) return { phenomenon, hypotheses: [], note: 'No relevant memory entries found.' };

  // Cluster relevant entries by their parent (potential causes)
  const cause_counts = new Map();
  for (const e of relevant) {
    const cause_id = e.parent_id || e.cause_id;
    if (cause_id) cause_counts.set(cause_id, (cause_counts.get(cause_id) || 0) + 1);
    for (const tag of (e.tags || [])) cause_counts.set(`tag:${tag}`, (cause_counts.get(`tag:${tag}`) || 0) + 1);
  }

  const by_id = new Map(entries.map(e => [e.id, e]));
  const hypotheses = [...cause_counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, strength]) => {
      const source = by_id.get(id);
      return {
        hypothesis: source ? `Caused by: "${source.summary?.slice(0, 150)}"` : `Caused by pattern: ${id}`,
        strength,
        source_id: id,
      };
    });

  _logReason({ type: 'hypothesize', phenomenon, hypothesis_count: hypotheses.length });
  return { phenomenon, relevant_memories: relevant.length, hypotheses };
}

// ── Summarize entity — what does SCRIBE know about X? ─────────────────────────

async function op_summarize_entity(params) {
  const { entity, limit = 500 } = params || {};
  if (!entity) throw new Error('entity required');
  const entries = await _readLedger(limit);
  const q = entity.toLowerCase();

  const mentions = entries.filter(e => {
    const text = (e.summary || '').toLowerCase() + ' ' + (e.tags || []).join(' ').toLowerCase();
    return text.includes(q);
  });

  if (!mentions.length) return { entity, mentions: 0, summary: `SCRIBE has no memory of "${entity}".` };

  const tags = new Map();
  for (const e of mentions) for (const t of (e.tags || [])) tags.set(t, (tags.get(t) || 0) + 1);
  const top_tags = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
  const first = mentions[0];
  const last  = mentions[mentions.length - 1];
  const recent = mentions.slice(-3).map(e => e.summary?.slice(0, 120)).filter(Boolean);

  const lines = [
    `Entity: ${entity}`,
    `Mentions in memory: ${mentions.length}`,
    `First seen: ${first.timestamp ? first.timestamp.slice(0, 10) : 'unknown'} — ${first.summary?.slice(0, 100)}`,
    `Last seen:  ${last.timestamp ? last.timestamp.slice(0, 10) : 'unknown'} — ${last.summary?.slice(0, 100)}`,
    `Associated tags: ${top_tags.join(', ')}`,
    `Recent context:`,
    ...recent.map(r => `  - ${r}`),
  ];

  return { entity, mentions: mentions.length, associated_tags: top_tags, summary: lines.join('\n') };
}

// ── Detect contradictions ─────────────────────────────────────────────────────

async function op_detect_contradictions(params) {
  const { tag, limit = 500 } = params || {};
  const entries = await _readLedger(limit, tag);
  const contradictions = [];

  // Heuristic: look for negation pairs ("X is Y" vs "X is not Y"), opposite sentiments
  const NEGATORS = ['not', 'no ', 'never', 'failed', 'false', "doesn't", "isn't", "wasn't", "won't", "cannot", "can't"];
  const positive = [];
  const negative = [];

  for (const e of entries) {
    const text = (e.summary || '').toLowerCase();
    if (NEGATORS.some(n => text.includes(n))) negative.push(e);
    else positive.push(e);
  }

  // Check for same-topic positive/negative pairs
  for (const neg of negative) {
    const neg_words = _tokenize(neg.summary || '').map(t => t.toLowerCase()).filter(t => t.length > 4);
    for (const pos of positive) {
      const pos_words = _tokenize(pos.summary || '').map(t => t.toLowerCase()).filter(t => t.length > 4);
      const overlap = neg_words.filter(w => pos_words.includes(w));
      if (overlap.length >= 2) {
        contradictions.push({
          type: 'potential_negation',
          entry_a: { id: pos.id, summary: (pos.summary || '').slice(0, 120), ts: pos.timestamp },
          entry_b: { id: neg.id, summary: (neg.summary || '').slice(0, 120), ts: neg.timestamp },
          shared_terms: overlap.slice(0, 6),
          severity: overlap.length >= 4 ? 'high' : 'medium',
        });
        if (contradictions.length >= 20) break;
      }
    }
    if (contradictions.length >= 20) break;
  }

  _logReason({ type: 'contradiction_scan', found: contradictions.length });
  return { scanned: entries.length, contradiction_count: contradictions.length, contradictions };
}

// ── Reason about — structured reasoning on any topic given available memory ───

async function op_reason_about(params) {
  const { topic, limit = 300 } = params || {};
  if (!topic) throw new Error('topic required');
  const entries = await _readLedger(limit);
  const q = topic.toLowerCase();

  const relevant = entries.filter(e => (e.summary || '').toLowerCase().includes(q));
  if (!relevant.length) return { topic, conclusion: `SCRIBE has no recorded memory relevant to "${topic}".`, evidence: [] };

  const evidence = relevant.slice(-10).map(e => ({ id: e.id, summary: (e.summary || '').slice(0, 150), ts: e.timestamp, tags: e.tags }));

  const first_ts = relevant[0].timestamp;
  const last_ts  = relevant[relevant.length - 1].timestamp;
  const tags_all = relevant.flatMap(e => e.tags || []);
  const tag_freq = new Map();
  for (const t of tags_all) tag_freq.set(t, (tag_freq.get(t) || 0) + 1);
  const dominant_tags = [...tag_freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);

  const conclusion_lines = [
    `On the topic of "${topic}":`,
    `SCRIBE has ${relevant.length} memory entries spanning ${first_ts?.slice(0, 10) || '?'} to ${last_ts?.slice(0, 10) || '?'}.`,
    `Dominant context tags: ${dominant_tags.join(', ') || 'none'}.`,
    `Most recent observation: ${relevant[relevant.length - 1]?.summary?.slice(0, 200) || 'none'}`,
  ];

  _logReason({ type: 'reason_about', topic, evidence_count: relevant.length });
  return { topic, evidence_count: relevant.length, dominant_tags, conclusion: conclusion_lines.join('\n'), evidence };
}

// ── Build argument — structured for/against reasoning ────────────────────────

async function op_build_argument(params) {
  const { proposition, limit = 300 } = params || {};
  if (!proposition) throw new Error('proposition required');
  const entries = await _readLedger(limit);
  const q = proposition.toLowerCase();

  const relevant = entries.filter(e => (e.summary || '').toLowerCase().includes(q));
  const SUPPORT_MARKERS   = ['confirmed', 'success', 'worked', 'achieved', 'proved', 'showed', 'did', 'true', 'correct', 'profit', 'gain', 'win'];
  const OPPOSE_MARKERS    = ['failed', 'wrong', 'error', 'loss', 'miss', 'not', 'never', 'false', 'broke', 'crash', 'bad', 'poor'];

  const for_entries  = relevant.filter(e => SUPPORT_MARKERS.some(m => (e.summary || '').toLowerCase().includes(m)));
  const against_entries = relevant.filter(e => OPPOSE_MARKERS.some(m => (e.summary || '').toLowerCase().includes(m)));

  const verdict = for_entries.length > against_entries.length * 1.5 ? 'SUPPORTED'
    : against_entries.length > for_entries.length * 1.5 ? 'OPPOSED'
    : 'INCONCLUSIVE';

  return {
    proposition,
    verdict,
    for_count: for_entries.length,
    against_count: against_entries.length,
    for_evidence: for_entries.slice(-5).map(e => (e.summary || '').slice(0, 120)),
    against_evidence: against_entries.slice(-5).map(e => (e.summary || '').slice(0, 120)),
    confidence: relevant.length > 0 ? parseFloat(Math.min(1, Math.max(0, (for_entries.length - against_entries.length) / relevant.length)).toFixed(3)) : 0,
  };
}

const MANIFEST = {
  name: 'reasoning',
  description: 'SCRIBE language and reasoning: entity extraction, causal chains, hypotheses, contradiction detection, structured arguments. Ops: extract_entities, find_causes, find_effects, hypothesize, summarize_entity, detect_contradictions, reason_about, build_argument.',
  ops: ['extract_entities', 'find_causes', 'find_effects', 'hypothesize', 'summarize_entity', 'detect_contradictions', 'reason_about', 'build_argument'],
};

async function run(op, params) {
  switch (op) {
    case 'extract_entities':       return op_extract_entities(params);
    case 'find_causes':            return op_find_causes(params);
    case 'find_effects':           return op_find_effects(params);
    case 'hypothesize':            return op_hypothesize(params);
    case 'summarize_entity':       return op_summarize_entity(params);
    case 'detect_contradictions':  return op_detect_contradictions(params);
    case 'reason_about':           return op_reason_about(params);
    case 'build_argument':         return op_build_argument(params);
    default:
      throw new Error(`Unknown op: ${op}. Available: extract_entities, find_causes, find_effects, hypothesize, summarize_entity, detect_contradictions, reason_about, build_argument`);
  }
}

module.exports = { MANIFEST, run, setMemory };
