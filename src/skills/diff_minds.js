'use strict';

/**
 * SKILL: diff_minds
 *
 * Compare two souls, gods, agents, or any two structured entities.
 * Reveals alignment, contradictions, missing traits, and overlap.
 *
 * This is how SCRIBE understands the Kernel's ecosystem at depth —
 * by holding two minds up to the light and describing the difference.
 *
 * Operations:
 *   compare      — compare two objects field-by-field
 *   plt_compare  — compare two entities' PLT (Profit/Love/Tax) weight vectors
 *   trait_diff   — compare trait arrays: what's shared, what's unique
 *   soul_compare — compare two soul definitions from Profitlord agents.json
 *   align_score  — compute a numeric alignment score between two minds (0-1)
 */

const MANIFEST = {
  name: 'diff_minds',
  description: 'Compare two souls, gods, agents, or any structured entities. Reveals alignment, contradictions, missing traits.',
  version: '1.0.0',
  inputs: {
    op:     { type: 'string', required: true,  description: '"compare"|"plt_compare"|"trait_diff"|"soul_compare"|"align_score"' },
    mindA:  { type: 'any',   required: false, description: 'First entity (object, JSON string, or soul name)' },
    mindB:  { type: 'any',   required: false, description: 'Second entity (object, JSON string, or soul name)' },
    souls:  { type: 'array', required: false, description: 'Array of all soul definitions (for soul_compare lookup)' },
    fields: { type: 'array', required: false, description: 'Specific fields to compare (compare op; default: all)' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any',
    error:  'string',
    ts:     'string',
  },
};

async function run({ op, mindA, mindB, souls, fields }) {
  const ts = new Date().toISOString();
  try {
    const a = parse(mindA);
    const b = parse(mindB);
    let result;
    switch (op) {
      case 'compare':      result = op_compare(a, b, fields);          break;
      case 'plt_compare':  result = op_plt_compare(a, b);              break;
      case 'trait_diff':   result = op_trait_diff(a, b);               break;
      case 'soul_compare': result = op_soul_compare(a, b, souls || []); break;
      case 'align_score':  result = op_align_score(a, b);              break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

// ── Operations ────────────────────────────────────────────────────────────────

function op_compare(a, b, fields) {
  const keys = fields || [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const shared = [], only_a = [], only_b = [], different = [], same = [];

  for (const k of keys) {
    const inA = k in a, inB = k in b;
    if (inA && inB) {
      shared.push(k);
      if (JSON.stringify(a[k]) === JSON.stringify(b[k])) same.push(k);
      else different.push({ key: k, a: a[k], b: b[k] });
    } else if (inA) only_a.push(k);
    else only_b.push(k);
  }

  return {
    keys_compared: keys.length,
    shared_keys: shared.length,
    identical: same,
    different,
    only_in_a: only_a,
    only_in_b: only_b,
    similarity_pct: keys.length ? +((same.length / keys.length) * 100).toFixed(1) : 0,
  };
}

function op_plt_compare(a, b) {
  const extract_plt = obj => ({
    profit: obj.plt?.profit ?? obj.profit_weight ?? obj.weights?.profit ?? null,
    love:   obj.plt?.love   ?? obj.love_weight   ?? obj.weights?.love   ?? null,
    tax:    obj.plt?.tax    ?? obj.tax_weight     ?? obj.weights?.tax    ?? null,
  });

  const pltA = extract_plt(a);
  const pltB = extract_plt(b);

  const diff = {};
  for (const dim of ['profit', 'love', 'tax']) {
    const vA = pltA[dim] ?? 0;
    const vB = pltB[dim] ?? 0;
    diff[dim] = { a: vA, b: vB, delta: +(vB - vA).toFixed(3), dominant: vA > vB ? 'a' : vB > vA ? 'b' : 'equal' };
  }

  // Which dimension most separates them
  const maxDelta = Object.entries(diff).sort((x, y) => Math.abs(y[1].delta) - Math.abs(x[1].delta))[0];

  return {
    a_plt: pltA,
    b_plt: pltB,
    diff,
    greatest_divergence: maxDelta[0],
    divergence_magnitude: Math.abs(maxDelta[1].delta),
  };
}

function op_trait_diff(a, b) {
  const traitsA = new Set(flatten_traits(a));
  const traitsB = new Set(flatten_traits(b));
  const shared  = [...traitsA].filter(t => traitsB.has(t));
  const only_a  = [...traitsA].filter(t => !traitsB.has(t));
  const only_b  = [...traitsB].filter(t => !traitsA.has(t));
  const jaccard = (shared.length / (traitsA.size + traitsB.size - shared.length)) || 0;

  return {
    shared_traits: shared,
    unique_to_a: only_a,
    unique_to_b: only_b,
    jaccard_similarity: +jaccard.toFixed(3),
    alignment: jaccard >= 0.7 ? 'high' : jaccard >= 0.4 ? 'moderate' : 'low',
  };
}

function op_soul_compare(nameA, nameB, souls) {
  // nameA/nameB may be strings (soul names) — look up in souls array
  const findSoul = x => {
    if (typeof x === 'object') return x;
    return souls.find(s => s.name?.toLowerCase() === String(x).toLowerCase()) || { name: x };
  };
  const soulA = findSoul(nameA);
  const soulB = findSoul(nameB);
  return {
    a: soulA.name || 'A',
    b: soulB.name || 'B',
    compare: op_compare(soulA, soulB, null),
    traits: op_trait_diff(soulA, soulB),
    plt: op_plt_compare(soulA, soulB),
    alignment_score: op_align_score(soulA, soulB).score,
  };
}

function op_align_score(a, b) {
  let total = 0, matched = 0;

  // Structural overlap
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    total++;
    if (k in a && k in b) {
      if (JSON.stringify(a[k]) === JSON.stringify(b[k])) matched++;
      else matched += 0.5; // partial credit for shared key with different value
    }
  }

  // Trait overlap
  const traitsA = new Set(flatten_traits(a));
  const traitsB = new Set(flatten_traits(b));
  if (traitsA.size || traitsB.size) {
    const shared = [...traitsA].filter(t => traitsB.has(t)).length;
    const union  = traitsA.size + traitsB.size - shared;
    total   += 10;
    matched += 10 * (shared / (union || 1));
  }

  const score = total > 0 ? +(matched / total).toFixed(3) : 0;
  return {
    score,
    interpretation: score >= 0.8 ? 'near-identical' : score >= 0.6 ? 'strongly aligned' : score >= 0.4 ? 'moderately aligned' : score >= 0.2 ? 'weakly aligned' : 'divergent',
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parse(x) {
  if (!x) return {};
  if (typeof x === 'object') return x;
  try { return JSON.parse(x); } catch { return { value: x }; }
}

function flatten_traits(obj) {
  const traits = [];
  if (Array.isArray(obj.traits)) traits.push(...obj.traits);
  if (Array.isArray(obj.skills)) traits.push(...obj.skills);
  if (Array.isArray(obj.tags))   traits.push(...obj.tags);
  if (typeof obj.nature === 'string') traits.push(obj.nature);
  if (typeof obj.role   === 'string') traits.push(obj.role);
  return traits.map(t => String(t).toLowerCase().trim());
}

module.exports = { MANIFEST, run };
