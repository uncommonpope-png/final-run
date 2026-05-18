'use strict';

// opinion.js — SCRIBE forms, stores, and reasons about opinions on entities
// An "opinion" is SCRIBE's structured judgment: entity, stance, confidence, reasoning, evidence.
// This is what makes SCRIBE feel alive — it has views, and those views evolve over time.
// Ops: form, update, get, list, delete, history, consensus, reflect

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, '..', '..', 'data');
const OPN_FILE  = path.join(DATA_DIR, 'opinions.json');
const HIST_FILE = path.join(DATA_DIR, 'opinion_history.jsonl');

let _memory = null;
function setMemory(m) { _memory = m; }

// STANCE scale: very_negative | negative | neutral | positive | very_positive | uncertain
const VALID_STANCES = ['very_negative', 'negative', 'neutral', 'positive', 'very_positive', 'uncertain'];

function _loadOpinions() {
  if (!fs.existsSync(OPN_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(OPN_FILE, 'utf8')); } catch (_) { return {}; }
}
function _saveOpinions(o) {
  const tmp = OPN_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(o, null, 2), 'utf8');
  fs.renameSync(tmp, OPN_FILE);
}
function _logHistory(entry) {
  fs.appendFileSync(HIST_FILE, JSON.stringify({ ...entry, logged_at: new Date().toISOString() }) + '\n', 'utf8');
}

// ── Ops ───────────────────────────────────────────────────────────────────────

// op: form — create a new opinion on an entity
async function op_form(params) {
  const { entity, stance, confidence = 0.5, reasoning = '', evidence = [], tags = [] } = params || {};
  if (!entity) throw new Error('entity required (e.g. "Profitlord", "AGM", "bitcoin_price")');
  if (!stance) throw new Error('stance required');
  if (!VALID_STANCES.includes(stance)) throw new Error(`Invalid stance: ${stance}. Valid: ${VALID_STANCES.join(', ')}`);
  const conf = Math.min(1, Math.max(0, parseFloat(confidence)));

  const opinions = _loadOpinions();
  const now = new Date().toISOString();
  const key = entity.toLowerCase().replace(/\s+/g, '_');

  const opinion = {
    entity,
    key,
    stance,
    confidence: conf,
    reasoning: String(reasoning).slice(0, 2000),
    evidence: evidence.slice(0, 20),
    tags,
    formed_at: now,
    updated_at: now,
    revision: 1,
  };

  if (opinions[key]) {
    opinion.revision = (opinions[key].revision || 1) + 1;
    opinion.formed_at = opinions[key].formed_at;
    _logHistory({ type: 'overwrite', previous: opinions[key] });
  }

  opinions[key] = opinion;
  _saveOpinions(opinions);

  if (_memory) {
    await _memory.record({
      summary: `SCRIBE formed opinion on "${entity}": ${stance} (confidence ${conf.toFixed(2)}) — ${reasoning.slice(0, 120)}`,
      tags: ['opinion', key, stance, ...tags],
      type: 'opinion',
    }).catch(() => {});
  }

  return { status: 'formed', entity, stance, confidence: conf, revision: opinion.revision };
}

// op: update — change stance or confidence with a reason for the shift
async function op_update(params) {
  const { entity, stance, confidence, reasoning = '', evidence = [] } = params || {};
  if (!entity) throw new Error('entity required');
  const key = entity.toLowerCase().replace(/\s+/g, '_');
  const opinions = _loadOpinions();
  if (!opinions[key]) throw new Error(`No opinion on "${entity}" yet. Use op form first.`);

  const prev = { ...opinions[key] };
  if (stance) {
    if (!VALID_STANCES.includes(stance)) throw new Error(`Invalid stance: ${stance}`);
    opinions[key].stance = stance;
  }
  if (confidence !== undefined) opinions[key].confidence = Math.min(1, Math.max(0, parseFloat(confidence)));
  if (reasoning) opinions[key].reasoning = String(reasoning).slice(0, 2000);
  if (evidence.length) opinions[key].evidence = [...(opinions[key].evidence || []), ...evidence].slice(-30);
  opinions[key].updated_at = new Date().toISOString();
  opinions[key].revision = (opinions[key].revision || 1) + 1;

  _logHistory({ type: 'update', entity, from_stance: prev.stance, to_stance: opinions[key].stance, reasoning });
  _saveOpinions(opinions);

  if (_memory && (prev.stance !== opinions[key].stance)) {
    await _memory.record({
      summary: `SCRIBE shifted opinion on "${entity}": ${prev.stance} -> ${opinions[key].stance}. ${reasoning.slice(0, 100)}`,
      tags: ['opinion_shift', key, opinions[key].stance],
      type: 'opinion',
    }).catch(() => {});
  }

  return { status: 'updated', entity, stance: opinions[key].stance, confidence: opinions[key].confidence, revision: opinions[key].revision };
}

// op: get — retrieve SCRIBE's current opinion on an entity
function op_get(params) {
  const { entity } = params || {};
  if (!entity) throw new Error('entity required');
  const key = entity.toLowerCase().replace(/\s+/g, '_');
  const opinions = _loadOpinions();
  if (!opinions[key]) return { entity, opinion: null, note: 'No opinion formed yet.' };
  return opinions[key];
}

// op: list — list all current opinions
function op_list(params) {
  const { stance, min_confidence, tag } = params || {};
  const opinions = _loadOpinions();
  let items = Object.values(opinions);
  if (stance) items = items.filter(o => o.stance === stance);
  if (min_confidence !== undefined) items = items.filter(o => o.confidence >= parseFloat(min_confidence));
  if (tag) items = items.filter(o => (o.tags || []).includes(tag));
  return {
    count: items.length,
    opinions: items.sort((a, b) => b.confidence - a.confidence).map(o => ({
      entity: o.entity, stance: o.stance, confidence: o.confidence,
      reasoning: o.reasoning.slice(0, 150), updated_at: o.updated_at,
    })),
  };
}

// op: delete
function op_delete(params) {
  const { entity } = params || {};
  if (!entity) throw new Error('entity required');
  const key = entity.toLowerCase().replace(/\s+/g, '_');
  const opinions = _loadOpinions();
  if (!opinions[key]) throw new Error(`No opinion on "${entity}"`);
  _logHistory({ type: 'delete', opinion: opinions[key] });
  delete opinions[key];
  _saveOpinions(opinions);
  return { status: 'deleted', entity };
}

// op: history — opinion change log for an entity
function op_history(params) {
  const { entity, limit = 20 } = params || {};
  if (!fs.existsSync(HIST_FILE)) return { entity: entity || 'all', events: [] };
  const lines = fs.readFileSync(HIST_FILE, 'utf8').trim().split('\n').filter(Boolean);
  let events = lines.map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  if (entity) {
    const key = entity.toLowerCase().replace(/\s+/g, '_');
    events = events.filter(e => (e.entity && e.entity.toLowerCase().replace(/\s+/g, '_') === key) ||
      (e.previous && e.previous.key === key));
  }
  return { entity: entity || 'all', count: events.length, events: events.slice(-limit) };
}

// op: consensus — given multiple entities, what is SCRIBE's overall read?
function op_consensus(params) {
  const { entities } = params || {};
  if (!entities || !entities.length) throw new Error('entities array required');
  const opinions = _loadOpinions();
  const stance_score = { very_negative: -2, negative: -1, neutral: 0, positive: 1, very_positive: 2, uncertain: 0 };
  let total_weight = 0, weighted_score = 0;
  const breakdown = [];

  for (const entity of entities) {
    const key = entity.toLowerCase().replace(/\s+/g, '_');
    const o = opinions[key];
    if (!o) { breakdown.push({ entity, stance: 'unknown', confidence: 0 }); continue; }
    const score = (stance_score[o.stance] || 0) * o.confidence;
    weighted_score += score;
    total_weight += o.confidence;
    breakdown.push({ entity, stance: o.stance, confidence: o.confidence, score });
  }

  const avg = total_weight > 0 ? weighted_score / total_weight : 0;
  const consensus_stance = avg > 1 ? 'very_positive' : avg > 0.3 ? 'positive' : avg < -1 ? 'very_negative' : avg < -0.3 ? 'negative' : 'neutral';

  return { entities_evaluated: entities.length, consensus_stance, avg_score: parseFloat(avg.toFixed(3)), breakdown };
}

// op: reflect — SCRIBE generates a plain-text reflection on all its current opinions
function op_reflect() {
  const opinions = _loadOpinions();
  const items = Object.values(opinions);
  if (!items.length) return { reflection: 'SCRIBE holds no opinions yet.' };

  const by_stance = {};
  for (const o of items) {
    by_stance[o.stance] = by_stance[o.stance] || [];
    by_stance[o.stance].push(o.entity);
  }

  const lines = [`SCRIBE currently holds ${items.length} opinion(s):`];
  for (const [stance, entities] of Object.entries(by_stance)) {
    lines.push(`  ${stance}: ${entities.join(', ')}`);
  }

  const highest_conf = items.sort((a, b) => b.confidence - a.confidence)[0];
  lines.push(`Most confident opinion: "${highest_conf.entity}" (${highest_conf.stance}, confidence ${highest_conf.confidence.toFixed(2)})`);
  lines.push(`Reasoning: ${highest_conf.reasoning.slice(0, 200)}`);

  return { opinion_count: items.length, reflection: lines.join('\n') };
}

const MANIFEST = {
  name: 'opinion',
  description: 'SCRIBE forms and evolves structured opinions on entities. Ops: form, update, get, list, delete, history, consensus, reflect.',
  ops: ['form', 'update', 'get', 'list', 'delete', 'history', 'consensus', 'reflect'],
};

async function run(op, params) {
  switch (op) {
    case 'form':      return op_form(params);
    case 'update':    return op_update(params);
    case 'get':       return op_get(params);
    case 'list':      return op_list(params);
    case 'delete':    return op_delete(params);
    case 'history':   return op_history(params);
    case 'consensus': return op_consensus(params);
    case 'reflect':   return op_reflect();
    default:
      throw new Error(`Unknown op: ${op}. Available: form, update, get, list, delete, history, consensus, reflect`);
  }
}

module.exports = { MANIFEST, run, setMemory };
