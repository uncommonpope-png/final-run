'use strict';

// conversation.js — multi-turn conversation threads with causal linking and full context recall

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const THREADS_FILE = path.join(__dirname, '..', '..', 'data', 'conversations.json');
const MSGS_FILE    = path.join(__dirname, '..', '..', 'data', 'conversation_messages.jsonl');

let _memory = null;
function setMemory(m) { _memory = m; }

// ── persistence ──────────────────────────────────────────────────────────────

function _loadThreads() {
  if (!fs.existsSync(THREADS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(THREADS_FILE, 'utf8')); } catch { return {}; }
}

function _saveThreads(t) {
  fs.writeFileSync(THREADS_FILE, JSON.stringify(t, null, 2), 'utf8');
}

function _appendMsg(msg) {
  fs.appendFileSync(MSGS_FILE, JSON.stringify(msg) + '\n', 'utf8');
}

function _loadMsgs(thread_id) {
  if (!fs.existsSync(MSGS_FILE)) return [];
  return fs.readFileSync(MSGS_FILE, 'utf8').split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(m => m && m.thread_id === thread_id);
}

// ── threads ───────────────────────────────────────────────────────────────────

function _open({ title = '', tags = [], caller = 'unknown' }) {
  const threads = _loadThreads();
  const id = crypto.randomBytes(6).toString('hex');
  const thread = {
    id,
    title: title || `Thread ${id}`,
    tags,
    caller,
    created_at: Date.now(),
    updated_at: Date.now(),
    message_count: 0,
    status: 'open'
  };
  threads[id] = thread;
  _saveThreads(threads);
  return thread;
}

function _close(thread_id) {
  const threads = _loadThreads();
  if (!threads[thread_id]) throw new Error(`thread ${thread_id} not found`);
  threads[thread_id].status = 'closed';
  threads[thread_id].updated_at = Date.now();
  _saveThreads(threads);
  return threads[thread_id];
}

function _getThread(thread_id) {
  const threads = _loadThreads();
  if (!threads[thread_id]) throw new Error(`thread ${thread_id} not found`);
  return threads[thread_id];
}

function _listThreads({ status = 'all', tag, limit = 30 } = {}) {
  let threads = Object.values(_loadThreads());
  if (status !== 'all') threads = threads.filter(t => t.status === status);
  if (tag) threads = threads.filter(t => t.tags && t.tags.includes(tag));
  return threads.sort((a, b) => b.updated_at - a.updated_at).slice(0, limit);
}

// ── messages ─────────────────────────────────────────────────────────────────

function _say({ thread_id, role = 'user', content, parent_msg_id = null, meta = {} }) {
  if (!thread_id) throw new Error('thread_id required');
  if (!content)   throw new Error('content required');

  const threads = _loadThreads();
  if (!threads[thread_id]) throw new Error(`thread ${thread_id} not found`);
  if (threads[thread_id].status === 'closed') throw new Error(`thread ${thread_id} is closed`);

  const msg = {
    id: crypto.randomBytes(6).toString('hex'),
    thread_id,
    role,           // user | assistant | system | tool
    content,
    parent_msg_id,  // causal link to prior message
    meta,
    ts: Date.now()
  };

  _appendMsg(msg);
  threads[thread_id].message_count++;
  threads[thread_id].updated_at = Date.now();
  _saveThreads(threads);

  if (_memory) {
    try {
      _memory.record({
        summary: `[${role}] in thread ${thread_id}: ${content.slice(0, 120)}`,
        tags: ['conversation', 'message', role, thread_id],
        data: { thread_id, msg_id: msg.id, role },
        parent_id: parent_msg_id || undefined
      });
    } catch (_) {}
  }

  return msg;
}

function _history(thread_id, { limit = 100 } = {}) {
  _getThread(thread_id); // validate
  const msgs = _loadMsgs(thread_id);
  return msgs.slice(-limit);
}

function _context(thread_id, { limit = 10, system_prompt = '' } = {}) {
  // Return messages formatted as a context array for feeding to an LLM or skill
  const msgs = _history(thread_id, { limit });
  const result = [];
  if (system_prompt) result.push({ role: 'system', content: system_prompt });
  for (const m of msgs) result.push({ role: m.role, content: m.content });
  return result;
}

function _search_messages({ query, thread_id, limit = 20 }) {
  if (!query) throw new Error('query required');
  const q = query.toLowerCase();

  if (!fs.existsSync(MSGS_FILE)) return [];
  let msgs = fs.readFileSync(MSGS_FILE, 'utf8').split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(m => m && m.content && m.content.toLowerCase().includes(q));

  if (thread_id) msgs = msgs.filter(m => m.thread_id === thread_id);
  return msgs.slice(-limit).reverse();
}

function _causal_chain(msg_id, thread_id) {
  // Walk parent_msg_id links upward to reconstruct causal chain
  const msgs = _loadMsgs(thread_id);
  const byId = {};
  for (const m of msgs) byId[m.id] = m;

  const chain = [];
  let cur = byId[msg_id];
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parent_msg_id ? byId[cur.parent_msg_id] : null;
  }
  return chain;
}

function _summarize_thread(thread_id) {
  const msgs = _history(thread_id, { limit: 200 });
  if (!msgs.length) return { thread_id, summary: 'No messages.', turns: 0 };

  const turns = msgs.length;
  const roles  = {};
  for (const m of msgs) roles[m.role] = (roles[m.role] || 0) + 1;
  const first = msgs[0];
  const last  = msgs[msgs.length - 1];
  const snippet = last.content.slice(0, 200);

  return {
    thread_id,
    turns,
    roles,
    first_ts: first.ts,
    last_ts: last.ts,
    last_message: snippet,
    duration_ms: last.ts - first.ts
  };
}

// ── MANIFEST & run ────────────────────────────────────────────────────────────

const MANIFEST = {
  name: 'conversation',
  description: 'Multi-turn conversation threads with causal linking and full context recall',
  ops: ['open', 'close', 'get', 'list', 'say', 'history', 'context', 'search', 'causal_chain', 'summarize']
};

async function run({ op, caller = 'unknown', ...args }) {
  switch (op) {
    case 'open':         return _open({ ...args, caller });
    case 'close':        return _close(args.thread_id);
    case 'get':          return _getThread(args.thread_id);
    case 'list':         return _listThreads(args);
    case 'say':          return _say(args);
    case 'history':      return _history(args.thread_id, args);
    case 'context':      return _context(args.thread_id, args);
    case 'search':       return _search_messages(args);
    case 'causal_chain': return _causal_chain(args.msg_id, args.thread_id);
    case 'summarize':    return _summarize_thread(args.thread_id);
    default:             throw new Error(`conversation: unknown op "${op}"`);
  }
}

module.exports = { MANIFEST, run, setMemory };
