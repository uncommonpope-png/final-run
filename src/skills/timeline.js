'use strict';

/**
 * SKILL: timeline
 *
 * Reconstruct a causal timeline from SCRIBE's memory entries.
 * The timeline is not just a list — it's a narrative of cause and effect,
 * showing how one event led to another.
 *
 * Operations:
 *   build        — build a full timeline from memory (sorted, causal links shown)
 *   narrative    — generate a written narrative from the timeline
 *   pivot        — build a timeline centered on a specific memory or topic
 *   compress     — compress timeline to key events only (high-weight entries)
 *   export_md    — export the timeline as Markdown
 *   export_json  — export the timeline as clean JSON
 */

const fs   = require('fs');
const path = require('path');

const LEDGER_FILE = path.join(__dirname, '..', '..', 'data', 'ledger.jsonl');

const MANIFEST = {
  name: 'timeline',
  description: 'Reconstruct a causal timeline from SCRIBE\'s memory. Build narratives of cause and effect.',
  version: '1.0.0',
  inputs: {
    op:        { type: 'string', required: true,  description: '"build"|"narrative"|"pivot"|"compress"|"export_md"|"export_json"' },
    query:     { type: 'string', required: false, description: 'Topic to focus on (pivot op)' },
    memory_id: { type: 'string', required: false, description: 'Central memory ID (pivot op)' },
    min_weight:{ type: 'number', required: false, description: 'Min weight for compress op (default 0.6)' },
    limit:     { type: 'number', required: false, description: 'Max entries (default 50)' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any',
    error:  'string',
    ts:     'string',
  },
};

function load() {
  if (!fs.existsSync(LEDGER_FILE)) return [];
  const raw = fs.readFileSync(LEDGER_FILE, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
}

async function run({ op, query, memory_id, min_weight = 0.6, limit = 50 }) {
  const ts = new Date().toISOString();
  try {
    const entries = load();
    let result;
    switch (op) {
      case 'build':       result = op_build(entries, limit);                     break;
      case 'narrative':   result = op_narrative(entries, limit);                 break;
      case 'pivot':       result = op_pivot(entries, memory_id, query, limit);   break;
      case 'compress':    result = op_compress(entries, min_weight, limit);      break;
      case 'export_md':   result = op_export_md(entries, limit);                 break;
      case 'export_json': result = op_export_json(entries, limit);               break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

// ── Operations ────────────────────────────────────────────────────────────────

function op_build(entries, limit) {
  const index = {};
  for (const e of entries) index[e.id] = e;

  const timeline = entries.slice(-limit).map(e => ({
    id: e.id,
    ts: e.ts,
    type: e.type,
    summary: e.summary,
    weight: e.weight || 0,
    tags: e.tags || [],
    cause_id: e.cause_id || e.parent_id || null,
    cause_summary: (e.cause_id || e.parent_id) && index[e.cause_id || e.parent_id] ? index[e.cause_id || e.parent_id].summary : null,
    effects: entries.filter(x => (x.cause_id || x.parent_id) === e.id).map(x => x.id),
  }));

  return {
    entry_count: timeline.length,
    causal_links: timeline.filter(e => e.cause_id).length,
    timeline,
  };
}

function op_narrative(entries, limit) {
  const recent = entries.slice(-limit);
  const index = {};
  for (const e of entries) index[e.id] = e;

  const lines = ['# SCRIBE Timeline Narrative', ''];
  let prev_date = null;

  for (const e of recent) {
    const date = e.ts ? e.ts.slice(0, 10) : 'unknown date';
    if (date !== prev_date) {
      lines.push(`## ${date}`);
      prev_date = date;
    }
    const weight_marker = e.weight >= 0.8 ? '[!] ' : e.weight >= 0.5 ? '[*] ' : '    ';
    lines.push(`${weight_marker}[${e.type || '?'}] ${e.summary}`);
    const pid = e.cause_id || e.parent_id;
    if (pid && index[pid]) {
      lines.push(`    -> caused by: "${index[pid].summary?.slice(0, 80)}"`);
    }
  }

  return { narrative: lines.join('\n'), entry_count: recent.length };
}

function op_pivot(entries, memory_id, query, limit) {
  let center = null;
  if (memory_id) {
    center = entries.find(e => e.id === memory_id);
  } else if (query) {
    const q = query.toLowerCase();
    center = entries.find(e => e.summary?.toLowerCase().includes(q));
  }
  if (!center) return { error: 'No central memory found', center: null, before: [], after: [] };

  const centerIdx = entries.indexOf(center);
  const half = Math.floor(limit / 2);
  const before = entries.slice(Math.max(0, centerIdx - half), centerIdx);
  const after  = entries.slice(centerIdx + 1, centerIdx + 1 + half);

  return { center, before, after, total: before.length + 1 + after.length };
}

function op_compress(entries, min_weight, limit) {
  const key_events = entries
    .filter(e => (e.weight || 0) >= min_weight)
    .slice(-limit);
  return {
    min_weight,
    key_event_count: key_events.length,
    of_total: entries.length,
    key_events,
  };
}

function op_export_md(entries, limit) {
  const rows = entries.slice(-limit).map(e =>
    `| ${e.ts?.slice(0, 19) || '?'} | ${e.type || '?'} | ${(e.summary || '').replace(/\|/g, '\\|').slice(0, 80)} | ${(e.weight || 0).toFixed(2)} | ${e.cause_id || ''} |`
  );
  const md = [
    '| Timestamp | Type | Summary | Weight | Caused By |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n');
  return { markdown: md, entry_count: rows.length };
}

function op_export_json(entries, limit) {
  return {
    exported_at: new Date().toISOString(),
    entry_count: Math.min(entries.length, limit),
    entries: entries.slice(-limit),
  };
}

module.exports = { MANIFEST, run };
