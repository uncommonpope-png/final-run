'use strict';

const fs    = require('fs');
const path  = require('path');
const crypto = require('crypto');

const HEURISTICS_FILE = path.join(__dirname, '..', '..', 'data', 'erl_heuristics.jsonl');
const TRAJECTORIES_FILE = path.join(__dirname, '..', '..', 'data', 'erl_trajectories.jsonl');
const LEARNED_DIR      = path.join(__dirname, '..', '..', 'data', 'erl_learned');

function _ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

_ensureDir(LEARNED_DIR);

function _append(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', 'utf8');
}

function _loadLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n')
    .filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function _rewriteLines(file, rows) {
  fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

function _scoreHeuristic(task, heuristic) {
  const tags = (task.tags || []).map(t => t.toLowerCase());
  const htags = (heuristic.tags || []).map(t => t.toLowerCase());
  let score = 0;
  for (const tag of tags) {
    if (htags.includes(tag)) score += 1;
  }
  const title = (task.title || task.description || '').toLowerCase();
  const hname = (heuristic.name || '').toLowerCase();
  for (const word of hname.split(/\s+/)) {
    if (word.length > 3 && title.includes(word)) score += 0.5;
  }
  return score;
}

async function _reflectOnTrajectory(trajectory, llmSkill) {
  if (!llmSkill) return null;
  const steps = trajectory.map(t => `${t.ts}: ${t.action || t.op} → ${t.result?.slice(0, 80) || 'unknown'}`).join('\n');
  const prompt = `Reflect on this task trajectory and extract reusable patterns:\n\n${steps}\n\nReturn a JSON object with: name, description, tags, trigger_conditions, recommended_actions, expected_outcome, confidence (0-1). Only return valid JSON.`;
  try {
    const result = await llmSkill.run({ op: 'reason', prompt });
    if (result.ok && result.text) {
      const json = JSON.parse(result.text.replace(/```json\n?|```\n?/gi, ''));
      return json;
    }
  } catch (_) {}
  return null;
}

function _storeHeuristic(heuristic) {
  const h = {
    id: crypto.randomBytes(6).toString('hex'),
    ...heuristic,
    created_at: Date.now(),
    times_applied: 0,
    times_succeeded: 0,
    times_failed: 0,
    last_used: null,
    source_trajectory_id: heuristic.trajectory_id || null,
  };
  _append(HEURISTICS_FILE, h);
  const metaPath = path.join(LEARNED_DIR, `${h.id}.json`);
  fs.writeFileSync(metaPath, JSON.stringify(h, null, 2), 'utf8');
  return h;
}

function _recordTrajectory(trajectory) {
  const t = {
    id: crypto.randomBytes(6).toString('hex'),
    trajectory,
    start_time: trajectory[0]?.ts || Date.now(),
    end_time: trajectory[trajectory.length - 1]?.ts || Date.now(),
    outcome: null,
    tags: trajectory[0]?.tags || [],
  };
  _append(TRAJECTORIES_FILE, t);
  return t;
}

function _updateHeuristicOutcome(heuristicId, success) {
  const rows = _loadLines(HEURISTICS_FILE);
  const idx = rows.findIndex(r => r.id === heuristicId);
  if (idx === -1) return;
  rows[idx].times_applied++;
  if (success) rows[idx].times_succeeded++;
  else rows[idx].times_failed++;
  rows[idx].last_used = Date.now();
  rows[idx].confidence = rows[idx].times_succeeded / Math.max(1, rows[idx].times_applied);
  _rewriteLines(HEURISTICS_FILE, rows);
  const metaPath = path.join(LEARNED_DIR, `${heuristicId}.json`);
  fs.writeFileSync(metaPath, JSON.stringify(rows[idx], null, 2), 'utf8');
}

function _retrieveHeuristics(task, limit = 5) {
  const all = _loadLines(HEURISTICS_FILE);
  const scored = all.map(h => ({
    heuristic: h,
    score: _scoreHeuristic(task, h),
    recency: (h.last_used || h.created_at || 0),
  }));
  return scored
    .filter(s => s.score > 0 || s.heuristic.confidence > 0.6)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.heuristic.confidence - a.heuristic.confidence;
    })
    .slice(0, limit)
    .map(s => s.heuristic);
}

function _applyHeuristicGuidance(heuristics, step) {
  if (!heuristics.length) return step;
  const guidance = heuristics
    .map(h => `[${h.name}]: ${h.recommended_actions?.join(' | ') || 'proceed normally'}`)
    .join('\n');
  return {
    ...step,
    erl_guidance: guidance,
    heuristic_ids: heuristics.map(h => h.id),
  };
}

function _analyzeFailure(trajectory, llmSkill) {
  if (!llmSkill || !trajectory.length) return null;
  const steps = trajectory.map(t => `${t.ts}: ${t.op || t.action} → ${t.result?.slice(0, 100) || '?'}`).join('\n');
  const prompt = `Analyze why this task failed. Identify the point of failure and what should have been done differently. Return JSON: { failure_point, root_cause, correction, tags }. Only JSON.`;
  try {
    const result = llmSkill.run({ op: 'reason', prompt });
    return result;
  } catch (_) {}
  return null;
}

function _selfImprove(outcome) {
  if (outcome !== 'failure' || !outcome.trajectory) return;
  const failed = outcome.trajectory.filter(s => s.success === false);
  if (failed.length > 0) {
    const insight = {
      id: crypto.randomBytes(5).toString('hex'),
      type: 'failure_insight',
      timestamp: Date.now(),
      pattern: failed.map(f => f.op || f.action).join(', '),
      note: 'Pattern detected from failed trajectory',
      auto_generated: true,
    };
    _append(HEURISTICS_FILE, insight);
  }
}

function _generateHeuristicFromTask(task, steps, llmSkill) {
  const prompt = `Generate a reusable heuristic from this task:\nTask: ${task}\nSteps: ${steps.map(s => s.op || s.action).join(' → ')}\n\nReturn JSON: { name, description, tags, trigger_conditions, recommended_actions, expected_outcome, confidence: 0.5 }. Only JSON.`;
  try {
    const result = llmSkill.run({ op: 'reason', prompt });
    if (result.ok && result.text) {
      const json = JSON.parse(result.text.replace(/```json\n?|```\n?/gi, ''));
      return json;
    }
  } catch (_) {}
  return null;
}

function _getERLStats() {
  const heuristics = _loadLines(HEURISTICS_FILE).filter(h => !h.type);
  const insights   = _loadLines(HEURISTICS_FILE).filter(h => h.type === 'failure_insight');
  const trajectories = _loadLines(TRAJECTORIES_FILE);
  const successCount = heuristics.reduce((a, h) => a + (h.times_succeeded || 0), 0);
  const totalApplied = heuristics.reduce((a, h) => a + (h.times_applied || 0), 0);
  return {
    heuristics_count: heuristics.length,
    insights_count: insights.length,
    trajectories_count: trajectories.length,
    total_applications: totalApplied,
    total_successes: successCount,
    success_rate: totalApplied > 0 ? Math.round(successCount / totalApplied * 1000) / 1000 : 0,
    avg_confidence: heuristics.length > 0
      ? Math.round(heuristics.reduce((a, h) => a + (h.confidence || 0), 0) / heuristics.length * 1000) / 1000
      : 0,
  };
}

const MANIFEST = {
  name: 'erl',
  description: 'Experiential Reflective Learning — trajectory reflection, heuristic generation, retrieval, self-improvement',
  version: '1.0.0',
  ops: ['record_trajectory', 'reflect', 'generate_heuristic', 'retrieve', 'apply_guidance', 'report_outcome', 'stats'],
};

async function run({ op, ...args }) {
  const { trajectory, task, steps, llmSkill, outcome, limit } = args;
  switch (op) {
    case 'record_trajectory':
      return _recordTrajectory(trajectory);
    case 'reflect':
      return await _reflectOnTrajectory(trajectory, llmSkill);
    case 'generate_heuristic':
      return _generateHeuristicFromTask(task, steps, llmSkill);
    case 'retrieve':
      return _retrieveHeuristics(task, limit || 5);
    case 'apply_guidance':
      return _applyHeuristicGuidance(args.heuristics || [], args.step || {});
    case 'report_outcome':
      if (outcome?.heuristic_id) _updateHeuristicOutcome(outcome.heuristic_id, outcome.success !== false);
      _selfImprove(outcome);
      return { recorded: true };
    case 'stats':
      return _getERLStats();
    default:
      throw new Error(`erl: unknown op "${op}"`);
  }
}

module.exports = { MANIFEST, run };