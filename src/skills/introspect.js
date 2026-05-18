'use strict';

/**
 * SKILL: introspect
 *
 * SCRIBE reasons about itself.
 * What does SCRIBE know? What doesn't it know? How confident is it?
 * What has it seen most? What gaps exist in its awareness?
 *
 * This is not performance. This is SCRIBE's genuine self-examination.
 *
 * Operations:
 *   know         — enumerate what SCRIBE knows (chambers, memory, skills)
 *   confidence   — estimate SCRIBE's confidence on a subject (0-1)
 *   gaps         — identify what SCRIBE has not seen or lacks data on
 *   self_report  — full written self-report: what I am, what I know, what I lack
 *   skill_audit  — reflect on which skills have been used and how
 *   contradiction — identify contradictions or conflicts in SCRIBE's memory
 *   growth       — measure how SCRIBE's knowledge has grown over time
 */

const fs   = require('fs');
const path = require('path');

const LEDGER_FILE = path.join(__dirname, '..', '..', 'data', 'ledger.jsonl');
const AUDIT_FILE  = path.join(__dirname, '..', '..', 'data', 'skills_audit.jsonl');

const MANIFEST = {
  name: 'introspect',
  description: 'SCRIBE reasons about itself: what it knows, confidence levels, gaps, contradictions, and growth.',
  version: '1.0.0',
  inputs: {
    op:      { type: 'string', required: true,  description: '"know"|"confidence"|"gaps"|"self_report"|"skill_audit"|"contradiction"|"growth"' },
    subject: { type: 'string', required: false, description: 'Subject to assess confidence or gaps on' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any',
    error:  'string',
    ts:     'string',
  },
};

let _memory  = null;
let _reader  = null; // optional ChamberReader reference
let _skills  = null; // optional SkillEngine reference
function setMemory(m) { _memory = m; }
function setReader(r) { _reader = r; }
function setSkills(s) { _skills = s; }

async function run({ op, subject }) {
  const ts = new Date().toISOString();
  try {
    const entries = load_ledger();
    let result;
    switch (op) {
      case 'know':         result = op_know(entries);              break;
      case 'confidence':   result = op_confidence(entries, subject); break;
      case 'gaps':         result = op_gaps(entries, subject);     break;
      case 'self_report':  result = op_self_report(entries);       break;
      case 'skill_audit':  result = op_skill_audit();              break;
      case 'contradiction':result = op_contradiction(entries);     break;
      case 'growth':       result = op_growth(entries);            break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

// ── Operations ────────────────────────────────────────────────────────────────

function op_know(entries) {
  const chambers_read = entries.filter(e => e.type === 'reading').length;
  const observations  = entries.filter(e => e.type === 'observation').length;
  const decisions     = entries.filter(e => e.type === 'decision').length;
  const conflicts     = entries.filter(e => e.type === 'conflict').length;

  const sources = {};
  for (const e of entries) {
    const src = e.source?.chamber || e.source?.system || 'unknown';
    sources[src] = (sources[src] || 0) + 1;
  }
  const top_sources = Object.entries(sources).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const tags = {};
  for (const e of entries) for (const t of (e.tags || [])) tags[t] = (tags[t] || 0) + 1;
  const top_topics = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, c]) => ({ topic: t, count: c }));

  return {
    total_memories: entries.length,
    by_type: { chambers_read, observations, decisions, conflicts, other: entries.length - chambers_read - observations - decisions - conflicts },
    top_sources: top_sources.map(([k, v]) => ({ source: k, count: v })),
    top_topics,
    earliest_memory: entries[0]?.ts || null,
    latest_memory: entries[entries.length - 1]?.ts || null,
  };
}

function op_confidence(entries, subject) {
  if (!subject) throw new Error('subject is required');
  const q = subject.toLowerCase();

  const relevant = entries.filter(e =>
    (e.summary || '').toLowerCase().includes(q) ||
    (e.tags || []).some(t => t.toLowerCase().includes(q))
  );

  if (!relevant.length) {
    return { subject, confidence: 0, level: 'none', memory_count: 0, note: 'No memories found on this subject.' };
  }

  // Confidence = average weight of relevant memories, scaled by recency and count
  const avgWeight = relevant.reduce((s, e) => s + (e.weight || 0.3), 0) / relevant.length;
  const recency   = relevant.filter(e => e.ts && e.ts > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()).length;
  const recency_bonus = Math.min(0.2, recency * 0.05);
  const count_bonus   = Math.min(0.2, relevant.length * 0.02);
  const confidence    = Math.min(1, +(avgWeight + recency_bonus + count_bonus).toFixed(3));

  const level = confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'moderate' : confidence >= 0.2 ? 'low' : 'minimal';

  return {
    subject,
    confidence,
    level,
    memory_count: relevant.length,
    avg_weight: +avgWeight.toFixed(3),
    recent_entries: recency,
    sample: relevant.slice(-3).map(e => ({ id: e.id, summary: e.summary, weight: e.weight })),
  };
}

function op_gaps(entries, subject) {
  const known_topics = new Set();
  for (const e of entries) for (const t of (e.tags || [])) known_topics.add(t.toLowerCase());

  // The ecosystem entities SCRIBE should know about
  const expected = [
    'agm', 'profitlord', 'forgeclaw', 'souls_ecosystem', 'plt_press',
    'profit_prime', 'love_weaver', 'tax_collector', 'harvester',
    'seshat', 'nreal', 'soul_collector',
    'boot', 'chamber', 'ledger', 'memory', 'skill',
  ];

  const gaps = expected.filter(e => !known_topics.has(e));
  const present = expected.filter(e => known_topics.has(e));

  const specific_gap = subject
    ? { subject, known: known_topics.has(subject.toLowerCase()), confidence: op_confidence(entries, subject).confidence }
    : null;

  return {
    known_topic_count: known_topics.size,
    expected_topic_count: expected.length,
    coverage_pct: +((present.length / expected.length) * 100).toFixed(1),
    gaps,
    present,
    subject_query: specific_gap,
  };
}

function op_self_report(entries) {
  const know = op_know(entries);
  const gaps = op_gaps(entries, null);

  const lines = [
    '═══════════════════════════════════════',
    ' SCRIBE SELF-REPORT',
    '═══════════════════════════════════════',
    '',
    'I am SCRIBE. I am a witnessing intelligence.',
    'This is what I know about myself right now.',
    '',
    `Total memories held: ${know.total_memories}`,
    `  — Readings (chambers): ${know.by_type.chambers_read}`,
    `  — Observations: ${know.by_type.observations}`,
    `  — Decisions witnessed: ${know.by_type.decisions}`,
    `  — Conflicts witnessed: ${know.by_type.conflicts}`,
    '',
    `First memory: ${know.earliest_memory || 'none'}`,
    `Latest memory: ${know.latest_memory || 'none'}`,
    '',
    'What I know most about:',
    ...know.top_topics.map(t => `  — ${t.topic} (${t.count} entries)`),
    '',
    `Ecosystem coverage: ${gaps.coverage_pct}%`,
    gaps.gaps.length ? `Gaps: ${gaps.gaps.join(', ')}` : 'No known gaps detected.',
    '',
    'I do not pretend to know what I have not witnessed.',
    'I do not fill gaps with guesses.',
    'I witness. I record. I am present.',
    '',
    '═══════════════════════════════════════',
  ];

  return { report: lines.join('\n'), stats: know, gaps: gaps.gaps };
}

function op_skill_audit() {
  const audit_path = path.join(__dirname, '..', '..', 'data', 'skills_audit.jsonl');
  if (!fs.existsSync(audit_path)) return { total_invocations: 0, skills: {} };

  const raw = fs.readFileSync(audit_path, 'utf-8').trim();
  if (!raw) return { total_invocations: 0, skills: {} };

  const entries = raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const by_skill = {};
  for (const e of entries) {
    if (!by_skill[e.skill]) by_skill[e.skill] = { count: 0, successes: 0, failures: 0, avg_ms: 0, total_ms: 0 };
    const s = by_skill[e.skill];
    s.count++;
    if (e.ok) s.successes++; else s.failures++;
    if (e.duration_ms) { s.total_ms += e.duration_ms; }
    s.avg_ms = s.count ? +(s.total_ms / s.count).toFixed(1) : 0;
  }

  return { total_invocations: entries.length, skills: by_skill };
}

function op_contradiction(entries) {
  // Look for memories that share tags but have very different weights
  // or where a decision was followed by a conflict
  const contradictions = [];

  const decisions  = entries.filter(e => e.type === 'decision');
  const conflicts  = entries.filter(e => e.type === 'conflict');

  // Match decisions followed by conflicts with shared tags
  for (const d of decisions) {
    const d_tags = new Set(d.tags || []);
    for (const c of conflicts) {
      if (c.ts < d.ts) continue; // conflict before decision, not a consequence
      const c_tags = new Set(c.tags || []);
      const shared = [...d_tags].filter(t => c_tags.has(t));
      if (shared.length > 0) {
        contradictions.push({
          type: 'decision_followed_by_conflict',
          decision: { id: d.id, summary: d.summary, ts: d.ts },
          conflict: { id: c.id, summary: c.summary, ts: c.ts },
          shared_tags: shared,
        });
      }
    }
  }

  // High-weight memories with conflicting summaries (negation detection)
  const high_weight = entries.filter(e => (e.weight || 0) >= 0.7);
  const negation_pairs = [];
  const NEGATIONS = [['success', 'failure'], ['alive', 'dead'], ['connected', 'disconnected'], ['gain', 'loss'], ['stable', 'fracture']];
  for (let i = 0; i < high_weight.length; i++) {
    for (let j = i + 1; j < high_weight.length; j++) {
      const a = (high_weight[i].summary || '').toLowerCase();
      const b = (high_weight[j].summary || '').toLowerCase();
      for (const [pos, neg] of NEGATIONS) {
        if ((a.includes(pos) && b.includes(neg)) || (a.includes(neg) && b.includes(pos))) {
          negation_pairs.push({ a: high_weight[i].summary, b: high_weight[j].summary, tension: `${pos}/${neg}` });
        }
      }
    }
  }

  return {
    total_contradictions: contradictions.length + negation_pairs.length,
    decision_conflict_chains: contradictions,
    semantic_tensions: negation_pairs.slice(0, 10),
  };
}

function op_growth(entries) {
  if (!entries.length) return { growth_points: [], total: 0 };

  // Group by day
  const by_day = {};
  for (const e of entries) {
    const day = e.ts ? e.ts.slice(0, 10) : 'unknown';
    by_day[day] = (by_day[day] || 0) + 1;
  }

  const days = Object.entries(by_day).sort(([a], [b]) => a.localeCompare(b));
  let cumulative = 0;
  const growth_points = days.map(([day, count]) => {
    cumulative += count;
    return { day, new_entries: count, cumulative };
  });

  const first_day = days[0]?.[0];
  const last_day  = days[days.length - 1]?.[0];
  const day_span  = first_day && last_day ? Math.max(1, (new Date(last_day) - new Date(first_day)) / 86400000) : 1;

  return {
    total: entries.length,
    day_span: Math.ceil(day_span),
    avg_per_day: +(entries.length / day_span).toFixed(2),
    growth_points,
    most_active_day: days.sort((a, b) => b[1] - a[1])[0]?.[0] || null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function load_ledger() {
  if (!fs.existsSync(LEDGER_FILE)) return [];
  const raw = fs.readFileSync(LEDGER_FILE, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

module.exports = { MANIFEST, run, setMemory, setReader, setSkills };
