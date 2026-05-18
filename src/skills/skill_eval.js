'use strict';

// skill_eval.js — SCRIBE evaluates and scores its own skills based on audit history
// Reads skills_audit.jsonl to compute reliability, speed, and usage metrics.
// Ops: evaluate, rank, report, flag, unflag, flags

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

const DATA_DIR   = path.join(__dirname, '..', '..', 'data');
const AUDIT_FILE = path.join(DATA_DIR, 'skills_audit.jsonl');
const FLAGS_FILE = path.join(DATA_DIR, 'skill_flags.json');

// ── Audit reader ──────────────────────────────────────────────────────────────

async function _readAudit(since_ms) {
  if (!fs.existsSync(AUDIT_FILE)) return [];
  const entries = [];
  const rl = readline.createInterface({ input: fs.createReadStream(AUDIT_FILE), crlfDelay: Infinity });
  for await (const line of rl) {
    try {
      const e = JSON.parse(line.trim());
      const ts = new Date(e.ts || 0).getTime();
      if (since_ms && ts < since_ms) continue;
      entries.push(e);
    } catch (_) {}
  }
  return entries;
}

function _computeStats(entries) {
  // Group by skill
  const skills = {};
  for (const e of entries) {
    const s = e.skill || 'unknown';
    if (!skills[s]) skills[s] = { invocations: 0, successes: 0, failures: 0, durations: [], errors: {} };
    skills[s].invocations++;
    if (e.ok !== false) { skills[s].successes++; }
    else {
      skills[s].failures++;
      const err = e.error || 'unknown_error';
      skills[s].errors[err] = (skills[s].errors[err] || 0) + 1;
    }
    if (e.duration_ms) skills[s].durations.push(e.duration_ms);
  }

  const results = [];
  for (const [name, s] of Object.entries(skills)) {
    const success_rate = s.invocations > 0 ? s.successes / s.invocations : 0;
    const durations = s.durations.sort((a, b) => a - b);
    const mean_ms = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
    const p95_ms  = durations.length > 1 ? durations[Math.floor(durations.length * 0.95)] : mean_ms;
    const top_errors = Object.entries(s.errors).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e, c]) => ({ error: e.slice(0, 80), count: c }));

    // Score: weighted combo of success rate (60%) + speed score (40%)
    const speed_score = mean_ms !== null ? Math.max(0, 1 - mean_ms / 30000) : 0.5;
    const score = parseFloat((success_rate * 0.6 + speed_score * 0.4).toFixed(3));

    results.push({
      skill: name,
      invocations: s.invocations,
      success_rate: parseFloat(success_rate.toFixed(3)),
      failures: s.failures,
      mean_ms: mean_ms !== null ? Math.round(mean_ms) : null,
      p95_ms: p95_ms !== null ? Math.round(p95_ms) : null,
      score,
      top_errors,
    });
  }
  return results;
}

// ── Flags ─────────────────────────────────────────────────────────────────────

function _loadFlags() {
  if (!fs.existsSync(FLAGS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(FLAGS_FILE, 'utf8')); } catch (_) { return {}; }
}
function _saveFlags(f) {
  const tmp = FLAGS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(f, null, 2), 'utf8');
  fs.renameSync(tmp, FLAGS_FILE);
}

// ── Ops ───────────────────────────────────────────────────────────────────────

async function op_evaluate(params) {
  const { skill, since_hours = 24 } = params || {};
  const since_ms = Date.now() - since_hours * 3600000;
  const entries = await _readAudit(since_ms);
  const stats = _computeStats(entries);
  const flags = _loadFlags();

  if (skill) {
    const s = stats.find(x => x.skill === skill);
    if (!s) return { skill, note: 'No invocations in the given time window.' };
    return { ...s, flagged: !!flags[skill], flag_reason: flags[skill]?.reason || null, since_hours };
  }

  return {
    since_hours,
    skills_evaluated: stats.length,
    skills: stats.map(s => ({ ...s, flagged: !!flags[s.skill] })),
  };
}

async function op_rank(params) {
  const { since_hours = 168, limit = 20 } = params || {}; // default 1 week
  const since_ms = Date.now() - since_hours * 3600000;
  const entries = await _readAudit(since_ms);
  const stats = _computeStats(entries).sort((a, b) => b.score - a.score);
  const flags = _loadFlags();

  return {
    since_hours,
    ranked: stats.slice(0, limit).map((s, i) => ({
      rank: i + 1,
      skill: s.skill,
      score: s.score,
      success_rate: s.success_rate,
      invocations: s.invocations,
      mean_ms: s.mean_ms,
      flagged: !!flags[s.skill],
    })),
  };
}

async function op_report(params) {
  const { since_hours = 24 } = params || {};
  const since_ms = Date.now() - since_hours * 3600000;
  const entries = await _readAudit(since_ms);
  const stats = _computeStats(entries);
  const flags = _loadFlags();

  const total_calls = entries.length;
  const failed_calls = entries.filter(e => e.ok === false).length;
  const unique_skills = stats.length;
  const worst = [...stats].sort((a, b) => a.score - b.score).slice(0, 3);
  const best  = [...stats].sort((a, b) => b.score - a.score).slice(0, 3);
  const flagged = Object.keys(flags);

  const lines = [
    `SKILL EVALUATION REPORT — last ${since_hours}h`,
    `${'='.repeat(50)}`,
    `Total calls: ${total_calls}  |  Failures: ${failed_calls}  |  Skills used: ${unique_skills}`,
    '',
    `Top performers:`,
    ...best.map(s => `  ${s.skill.padEnd(28)} score=${s.score}  success=${(s.success_rate * 100).toFixed(1)}%`),
    '',
    `Needs attention:`,
    ...worst.map(s => `  ${s.skill.padEnd(28)} score=${s.score}  failures=${s.failures}`),
    '',
    flagged.length ? `Flagged skills: ${flagged.join(', ')}` : 'No skills currently flagged.',
  ];

  return { since_hours, total_calls, failed_calls, report: lines.join('\n') };
}

function op_flag(params) {
  const { skill, reason = '' } = params || {};
  if (!skill) throw new Error('skill required');
  const flags = _loadFlags();
  flags[skill] = { skill, reason, flagged_at: new Date().toISOString() };
  _saveFlags(flags);
  return { status: 'flagged', skill, reason };
}

function op_unflag(params) {
  const { skill } = params || {};
  if (!skill) throw new Error('skill required');
  const flags = _loadFlags();
  if (!flags[skill]) return { status: 'not_flagged', skill };
  delete flags[skill];
  _saveFlags(flags);
  return { status: 'unflagged', skill };
}

function op_flags() {
  const flags = _loadFlags();
  return { count: Object.keys(flags).length, flags: Object.values(flags) };
}

const MANIFEST = {
  name: 'skill_eval',
  description: 'SCRIBE evaluates and scores its own skills via audit history. Ops: evaluate, rank, report, flag, unflag, flags.',
  ops: ['evaluate', 'rank', 'report', 'flag', 'unflag', 'flags'],
};

async function run(op, params) {
  switch (op) {
    case 'evaluate': return op_evaluate(params);
    case 'rank':     return op_rank(params);
    case 'report':   return op_report(params);
    case 'flag':     return op_flag(params);
    case 'unflag':   return op_unflag(params);
    case 'flags':    return op_flags();
    default:
      throw new Error(`Unknown op: ${op}. Available: evaluate, rank, report, flag, unflag, flags`);
  }
}

module.exports = { MANIFEST, run };
