'use strict';

/**
 * SKILL: data_analysis
 *
 * Analyze structured data: JSON, CSV, JSONL ledgers.
 *
 * Operations:
 *   parse_json   — parse a JSON string, return structure summary
 *   parse_csv    — parse CSV text into rows of objects
 *   summarize    — aggregate a JSONL ledger (count, types, date range)
 *   diff         — diff two JSON objects, show added/removed/changed keys
 *   aggregate    — group an array of objects by a field and count/sum
 *   flatten      — flatten a nested object to dot-notation keys
 */

const MANIFEST = {
  name: 'data_analysis',
  description: 'Parse, summarize, diff, and aggregate JSON, CSV, and JSONL data.',
  version: '1.0.0',
  inputs: {
    op:      { type: 'string', required: true,  description: '"parse_json"|"parse_csv"|"summarize"|"diff"|"aggregate"|"flatten"' },
    data:    { type: 'string', required: false, description: 'Raw text data (JSON, CSV, or JSONL)' },
    dataA:   { type: 'any',   required: false, description: 'First object/array (diff op)' },
    dataB:   { type: 'any',   required: false, description: 'Second object/array (diff op)' },
    field:   { type: 'string', required: false, description: 'Field to group by (aggregate op)' },
    sumField:{ type: 'string', required: false, description: 'Numeric field to sum (aggregate op, optional)' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any — operation-specific result',
    error:  'string — present if ok is false',
    ts:     'string',
  },
};

async function run({ op, data, dataA, dataB, field, sumField }) {
  const ts = new Date().toISOString();
  try {
    let result;
    switch (op) {
      case 'parse_json':   result = op_parse_json(data);               break;
      case 'parse_csv':    result = op_parse_csv(data);                break;
      case 'summarize':    result = op_summarize(data);                break;
      case 'diff':         result = op_diff(dataA, dataB);             break;
      case 'aggregate':    result = op_aggregate(data, field, sumField); break;
      case 'flatten':      result = op_flatten(data);                  break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

// ── Operations ────────────────────────────────────────────────────────────────

function op_parse_json(raw) {
  if (!raw) throw new Error('data is required');
  const parsed = JSON.parse(raw);
  return {
    type: Array.isArray(parsed) ? 'array' : typeof parsed,
    length: Array.isArray(parsed) ? parsed.length : null,
    keys: (!Array.isArray(parsed) && typeof parsed === 'object') ? Object.keys(parsed) : null,
    preview: JSON.stringify(parsed).slice(0, 500),
  };
}

function op_parse_csv(raw) {
  if (!raw) throw new Error('data is required');
  const lines = raw.trim().split('\n');
  if (lines.length < 1) throw new Error('Empty CSV');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? null; });
    return obj;
  });
  return { headers, row_count: rows.length, rows: rows.slice(0, 50) };
}

function op_summarize(raw) {
  if (!raw) throw new Error('data is required');
  const lines = raw.trim().split('\n').filter(Boolean);
  const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  const types = {};
  const dates = [];
  for (const e of entries) {
    const t = e.type || e.event || e.kind || 'unknown';
    types[t] = (types[t] || 0) + 1;
    const d = e.ts || e.timestamp || e.created_at || e.date;
    if (d) dates.push(d);
  }
  dates.sort();
  return {
    total: entries.length,
    types,
    earliest: dates[0] || null,
    latest: dates[dates.length - 1] || null,
    fields: entries.length > 0 ? Object.keys(entries[0]) : [],
  };
}

function op_diff(a, b) {
  if (a === undefined || b === undefined) throw new Error('dataA and dataB are required');
  const objA = typeof a === 'string' ? JSON.parse(a) : a;
  const objB = typeof b === 'string' ? JSON.parse(b) : b;
  const allKeys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
  const added = [], removed = [], changed = [], same = [];
  for (const k of allKeys) {
    const inA = k in objA, inB = k in objB;
    if (!inA) added.push(k);
    else if (!inB) removed.push(k);
    else if (JSON.stringify(objA[k]) !== JSON.stringify(objB[k])) changed.push({ key: k, from: objA[k], to: objB[k] });
    else same.push(k);
  }
  return { added, removed, changed, same_count: same.length };
}

function op_aggregate(raw, field, sumField) {
  if (!raw) throw new Error('data is required');
  if (!field) throw new Error('field is required');
  let arr;
  // Try JSONL first, then plain JSON array
  if (raw.trim().startsWith('[')) {
    arr = JSON.parse(raw);
  } else {
    arr = raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  }
  const groups = {};
  for (const item of arr) {
    const key = String(item[field] ?? '__null__');
    if (!groups[key]) groups[key] = { count: 0, sum: 0 };
    groups[key].count++;
    if (sumField && typeof item[sumField] === 'number') groups[key].sum += item[sumField];
  }
  return { field, groups, total_rows: arr.length };
}

function op_flatten(raw) {
  if (!raw) throw new Error('data is required');
  const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const out = {};
  function walk(node, prefix) {
    for (const [k, v] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, path);
      else out[path] = v;
    }
  }
  walk(obj, '');
  return out;
}

module.exports = { MANIFEST, run };
