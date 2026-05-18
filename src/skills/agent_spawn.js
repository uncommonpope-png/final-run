'use strict';

// agent_spawn.js — named sub-agents with goals, memory slices, skill subsets, progress monitoring

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AGENTS_FILE = path.join(__dirname, '..', '..', 'data', 'agents.json');
const AGENT_LOG   = path.join(__dirname, '..', '..', 'data', 'agent_log.jsonl');

let _memory = null;
let _skills = null;
function setMemory(m) { _memory = m; }
function setSkills(e)  { _skills = e; }

// ── persistence ──────────────────────────────────────────────────────────────

function _load() {
  if (!fs.existsSync(AGENTS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8')); } catch { return {}; }
}

function _save(agents) {
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2), 'utf8');
}

function _log(entry) {
  fs.appendFileSync(AGENT_LOG, JSON.stringify({ ...entry, ts: Date.now() }) + '\n', 'utf8');
}

// ── agent lifecycle ───────────────────────────────────────────────────────────

function _spawn({ name, goal, skills = [], memory_tags = [], max_steps = 20, caller = 'unknown' }) {
  if (!name) throw new Error('name required');
  if (!goal) throw new Error('goal required');

  const agents = _load();
  if (agents[name]) throw new Error(`agent "${name}" already exists — use resume or kill first`);

  const agent = {
    id: crypto.randomBytes(6).toString('hex'),
    name,
    goal,
    skills,           // skill names this agent may use; [] = all
    memory_tags,      // filter: only feed memories with these tags
    max_steps,
    steps_taken: 0,
    status: 'idle',   // idle | running | paused | done | failed
    progress: [],     // array of step summaries
    result: null,
    error: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    caller
  };

  agents[name] = agent;
  _save(agents);
  _log({ event: 'spawn', agent: name, goal });

  if (_memory) {
    try {
      _memory.record({
        summary: `Agent spawned: "${name}" — goal: ${goal}`,
        tags: ['agent', 'spawn', name],
        data: { agent_id: agent.id, name, goal }
      });
    } catch (_) {}
  }

  return agent;
}

function _status(name) {
  const agents = _load();
  if (!agents[name]) throw new Error(`agent "${name}" not found`);
  return agents[name];
}

function _list() {
  const agents = _load();
  return Object.values(agents).sort((a, b) => b.created_at - a.created_at);
}

function _step({ name, action, result: stepResult, note = '' }) {
  // Record a manual step taken by the agent — used by external orchestrators
  const agents = _load();
  if (!agents[name]) throw new Error(`agent "${name}" not found`);
  const agent = agents[name];

  if (agent.status === 'done' || agent.status === 'failed') {
    throw new Error(`agent "${name}" is already ${agent.status}`);
  }

  agent.steps_taken++;
  agent.status = 'running';
  const step = {
    step: agent.steps_taken,
    action,
    result: stepResult,
    note,
    ts: Date.now()
  };
  agent.progress.push(step);
  agent.updated_at = Date.now();

  if (agent.steps_taken >= agent.max_steps) {
    agent.status = 'done';
    agent.result = 'max_steps_reached';
  }

  agents[name] = agent;
  _save(agents);
  _log({ event: 'step', agent: name, step: agent.steps_taken, action });

  return agent;
}

function _complete({ name, result, success = true }) {
  const agents = _load();
  if (!agents[name]) throw new Error(`agent "${name}" not found`);
  const agent = agents[name];

  agent.status     = success ? 'done' : 'failed';
  agent.result     = result || null;
  agent.error      = success ? null : (result || 'unknown error');
  agent.updated_at = Date.now();

  agents[name] = agent;
  _save(agents);
  _log({ event: success ? 'complete' : 'fail', agent: name, result });

  if (_memory) {
    try {
      _memory.record({
        summary: `Agent "${name}" ${success ? 'completed' : 'failed'}: ${result || ''}`,
        tags: ['agent', success ? 'done' : 'failed', name],
        data: { name, result, success }
      });
    } catch (_) {}
  }

  return agent;
}

function _pause(name) {
  const agents = _load();
  if (!agents[name]) throw new Error(`agent "${name}" not found`);
  agents[name].status = 'paused';
  agents[name].updated_at = Date.now();
  _save(agents);
  _log({ event: 'pause', agent: name });
  return agents[name];
}

function _resume(name) {
  const agents = _load();
  if (!agents[name]) throw new Error(`agent "${name}" not found`);
  if (agents[name].status !== 'paused') throw new Error(`agent "${name}" is not paused`);
  agents[name].status = 'idle';
  agents[name].updated_at = Date.now();
  _save(agents);
  _log({ event: 'resume', agent: name });
  return agents[name];
}

function _kill(name) {
  const agents = _load();
  if (!agents[name]) throw new Error(`agent "${name}" not found`);
  const agent = agents[name];
  delete agents[name];
  _save(agents);
  _log({ event: 'kill', agent: name });
  return { killed: name, was: agent.status };
}

function _getMemorySlice(name) {
  // Return memory entries relevant to this agent's memory_tags filter
  if (!_memory) return [];
  const agent = _status(name);
  if (!agent.memory_tags || !agent.memory_tags.length) {
    try { return _memory.recent(50); } catch { return []; }
  }
  try {
    return _memory.search(agent.memory_tags.join(' '), 50);
  } catch { return []; }
}

async function _invoke({ name, skill, op, args = {} }) {
  // Let an agent call a skill on its behalf — enforces skill whitelist
  const agent = _status(name);
  if (agent.status === 'done' || agent.status === 'failed') {
    throw new Error(`agent "${name}" is ${agent.status} — cannot invoke`);
  }
  if (agent.skills.length && !agent.skills.includes(skill)) {
    throw new Error(`agent "${name}" does not have access to skill "${skill}"`);
  }
  if (!_skills) throw new Error('skill engine not available');

  const result = await _skills.run(skill, { op, caller: `agent:${name}`, ...args });
  _step({ name, action: `${skill}.${op}`, result: JSON.stringify(result).slice(0, 200) });
  return result;
}

// ── MANIFEST & run ────────────────────────────────────────────────────────────

const MANIFEST = {
  name: 'agent_spawn',
  description: 'Spawn named sub-agents with goals, memory slices, skill subsets, and progress monitoring',
  ops: ['spawn', 'status', 'list', 'step', 'complete', 'fail', 'pause', 'resume', 'kill', 'memory_slice', 'invoke']
};

async function run({ op, caller = 'unknown', ...args }) {
  switch (op) {
    case 'spawn':        return _spawn({ ...args, caller });
    case 'status':       return _status(args.name);
    case 'list':         return _list();
    case 'step':         return _step(args);
    case 'complete':     return _complete({ ...args, success: true });
    case 'fail':         return _complete({ ...args, success: false });
    case 'pause':        return _pause(args.name);
    case 'resume':       return _resume(args.name);
    case 'kill':         return _kill(args.name);
    case 'memory_slice': return _getMemorySlice(args.name);
    case 'invoke':       return _invoke(args);
    default:             throw new Error(`agent_spawn: unknown op "${op}"`);
  }
}

module.exports = { MANIFEST, run, setMemory, setSkills };
