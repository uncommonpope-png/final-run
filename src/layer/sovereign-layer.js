'use strict';

const fs = require('fs');
const path = require('path');

const LAYER_DIR = path.join(__dirname, '..', '..', 'data', 'layer');
const STATE_FILE = path.join(LAYER_DIR, 'state.json');
const MEMORY_FILE = path.join(LAYER_DIR, 'memory.json');
const KNOWLEDGE_FILE = path.join(LAYER_DIR, 'knowledge.json');
const DECISIONS_FILE = path.join(LAYER_DIR, 'decisions.json');

const DEFAULT_STATE = {
  name: 'Sovereign Layer',
  version: '0.1.0',
  mode: 'offline-first',
  principles: [
    'Never go silent',
    'Preserve continuity',
    'Prefer evidence over guessing',
    'Convert intent into actionable plans',
  ],
  started_at: new Date().toISOString(),
  counters: {
    turns: 0,
    tasks_created: 0,
    decisions: 0,
    knowledge_items: 0,
  },
};

function ensureDir() {
  fs.mkdirSync(LAYER_DIR, { recursive: true });
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJSON(file, data) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function scoreText(query, text) {
  const q = tokenize(query);
  if (!q.length) return 0;
  const t = tokenize(text);
  if (!t.length) return 0;
  const set = new Set(t);
  let score = 0;
  for (const w of q) if (set.has(w)) score += 1;
  return score / q.length;
}

function classifyIntent(text) {
  const s = String(text || '').toLowerCase();
  if (/\b(build|create|implement|ship|fix|patch|code)\b/.test(s)) return 'build';
  if (/\b(task|todo|plan|steps|roadmap|next)\b/.test(s)) return 'task';
  if (/\b(why|compare|tradeoff|best|decide|decision)\b/.test(s)) return 'decision';
  if (/\b(search|find|research|look up|what is|explain)\b/.test(s)) return 'research';
  return 'chat';
}

function generatePlan(text) {
  return [
    `Clarify desired outcome for: ${String(text).slice(0, 90)}`,
    'Identify required inputs, constraints, and risks',
    'Execute smallest useful step first',
    'Validate output and record result into memory',
  ];
}

function synthResponse({ intent, text, evidence, recentFacts }) {
  const lines = [];
  lines.push('[Sovereign Layer] I hear you. I am running in offline-first mode.');

  if (intent === 'task' || intent === 'build') {
    lines.push('Proposed plan:');
    const plan = generatePlan(text);
    for (let i = 0; i < plan.length; i += 1) lines.push(`${i + 1}. ${plan[i]}`);
  } else if (intent === 'decision') {
    lines.push('Decision frame: define options, evaluate impact/risk, choose smallest reversible move.');
  } else if (intent === 'research') {
    lines.push('Research mode: I will answer from local knowledge and prior memory evidence.');
  } else {
    lines.push('Conversation mode: I will stay consistent, concise, and grounded in memory.');
  }

  if (evidence.length) {
    lines.push('Evidence used:');
    for (const e of evidence.slice(0, 3)) lines.push(`- ${e.title} (${e.source || 'local'})`);
  }

  if (recentFacts.length) {
    lines.push('Relevant memory:');
    for (const f of recentFacts.slice(0, 2)) lines.push(`- ${f.text.slice(0, 120)}`);
  }

  lines.push('I will not go silent. If cloud AI is unavailable, I continue with local logic, memory, and tasks.');
  return lines.join('\n');
}

function createLayer() {
  ensureDir();
  const state = readJSON(STATE_FILE, DEFAULT_STATE);
  const memory = readJSON(MEMORY_FILE, []);
  const knowledge = readJSON(KNOWLEDGE_FILE, []);
  const decisions = readJSON(DECISIONS_FILE, []);

  function persist() {
    writeJSON(STATE_FILE, state);
    writeJSON(MEMORY_FILE, memory);
    writeJSON(KNOWLEDGE_FILE, knowledge);
    writeJSON(DECISIONS_FILE, decisions);
  }

  function addMemory(item) {
    memory.push({
      id: `mem_${nowTs()}_${Math.random().toString(36).slice(2, 6)}`,
      ts: nowTs(),
      ...item,
    });
    if (memory.length > 2000) memory.splice(0, memory.length - 2000);
    persist();
  }

  function ingestKnowledge({ title, text, source = 'manual', tags = [] }) {
    if (!title || !text) return { ok: false, error: 'title and text are required' };
    const item = {
      id: `k_${nowTs()}_${Math.random().toString(36).slice(2, 6)}`,
      ts: nowTs(),
      title: String(title),
      text: String(text),
      source: String(source),
      tags: Array.isArray(tags) ? tags : [],
    };
    knowledge.push(item);
    state.counters.knowledge_items = knowledge.length;
    persist();
    return { ok: true, item };
  }

  function queryKnowledge({ query, limit = 5 }) {
    const q = String(query || '').trim();
    if (!q) return { ok: false, error: 'query required' };
    const ranked = knowledge
      .map(k => ({ k, score: scoreText(q, `${k.title} ${k.text} ${(k.tags || []).join(' ')}`) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(x => ({ ...x.k, score: x.score }));
    return { ok: true, query: q, results: ranked };
  }

  function decide({ topic, options = [] }) {
    if (!topic) return { ok: false, error: 'topic is required' };
    const safeOptions = Array.isArray(options) ? options.filter(Boolean) : [];
    const chosen = safeOptions.length ? safeOptions[0] : 'Gather more evidence before choosing';
    const decision = {
      id: `d_${nowTs()}_${Math.random().toString(36).slice(2, 6)}`,
      ts: nowTs(),
      topic,
      options: safeOptions,
      chosen,
      rationale: 'Offline-first policy: pick smallest reversible step with highest evidence.',
    };
    decisions.push(decision);
    state.counters.decisions += 1;
    persist();
    return { ok: true, decision };
  }

  function processTurn({ from = 'Craig', text = '', channel = 'group' }) {
    const clean = String(text || '').trim();
    if (!clean) return { ok: false, error: 'text required' };
    const intent = classifyIntent(clean);

    const evidence = queryKnowledge({ query: clean, limit: 3 }).results || [];
    const recentFacts = memory.slice(-40)
      .map(m => ({ ...m, score: scoreText(clean, m.text || m.summary || '') }))
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const reply = synthResponse({ intent, text: clean, evidence, recentFacts });

    addMemory({
      type: 'turn',
      from,
      channel,
      intent,
      text: clean,
      summary: `${from} -> ${intent}: ${clean.slice(0, 120)}`,
    });

    state.counters.turns += 1;
    persist();

    return {
      ok: true,
      intent,
      reply,
      evidence_count: evidence.length,
      memory_hits: recentFacts.length,
    };
  }

  function getStatus() {
    return {
      ...state,
      memory_items: memory.length,
      knowledge_items: knowledge.length,
      decisions: decisions.length,
    };
  }

  persist();

  return {
    processTurn,
    ingestKnowledge,
    queryKnowledge,
    decide,
    addMemory,
    getStatus,
  };
}

module.exports = { createLayer };
