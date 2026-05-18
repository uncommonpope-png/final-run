'use strict';

// event_bus.js — In-process pub/sub so skills can emit and subscribe to events
// Ops: subscribe, unsubscribe, emit, list_topics, history, clear_history

const { EventEmitter } = require('events');

const _emitter = new EventEmitter();
_emitter.setMaxListeners(100);

// topic -> [{ sub_id, handler, created_at }]
const SUBS = new Map();
// topic -> [{ event_id, payload, timestamp }] — rolling history per topic
const HISTORY = new Map();
const HISTORY_MAX = 200; // max events stored per topic
let _sub_counter = 0;
let _event_counter = 0;

function _historyPush(topic, entry) {
  if (!HISTORY.has(topic)) HISTORY.set(topic, []);
  const h = HISTORY.get(topic);
  h.push(entry);
  if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX);
}

// op: subscribe — register a named handler function (as serialized string for invoke API)
// For programmatic use, pass handler as a function; for /invoke, handler is ignored and
// events are stored in history only (retrievable via op_history).
function op_subscribe(params) {
  const { topic, sub_id: requested_id } = params || {};
  if (!topic) throw new Error('topic required');

  const sub_id = requested_id || `sub_${++_sub_counter}`;
  if (!SUBS.has(topic)) SUBS.set(topic, []);
  const existing = SUBS.get(topic).find(s => s.sub_id === sub_id);
  if (existing) return { status: 'already_subscribed', sub_id, topic };

  // The handler stores events in history (accessible via op_history)
  const handler = (payload) => {
    _historyPush(topic, {
      event_id: `evt_${++_event_counter}`,
      topic,
      payload,
      timestamp: new Date().toISOString(),
      sub_id,
    });
  };

  SUBS.get(topic).push({ sub_id, handler, created_at: new Date().toISOString() });
  _emitter.on(topic, handler);
  return { status: 'subscribed', sub_id, topic };
}

function op_unsubscribe(params) {
  const { topic, sub_id } = params || {};
  if (!topic) throw new Error('topic required');
  if (!sub_id) throw new Error('sub_id required');
  const subs = SUBS.get(topic) || [];
  const idx = subs.findIndex(s => s.sub_id === sub_id);
  if (idx === -1) throw new Error(`Subscription not found: ${sub_id} on topic ${topic}`);
  _emitter.removeListener(topic, subs[idx].handler);
  subs.splice(idx, 1);
  if (subs.length === 0) SUBS.delete(topic);
  return { status: 'unsubscribed', sub_id, topic };
}

function op_emit(params) {
  const { topic, payload } = params || {};
  if (!topic) throw new Error('topic required');
  const event_id = `evt_${++_event_counter}`;
  const entry = { event_id, topic, payload: payload || null, timestamp: new Date().toISOString() };

  // Always push to history regardless of subscribers
  _historyPush(topic, entry);

  const listener_count = _emitter.listenerCount(topic);
  _emitter.emit(topic, payload || null);
  return { status: 'emitted', event_id, topic, listeners_notified: listener_count };
}

function op_list_topics() {
  const topics = [];
  for (const [topic, subs] of SUBS.entries()) {
    topics.push({ topic, subscriber_count: subs.length, subscribers: subs.map(s => ({ sub_id: s.sub_id, created_at: s.created_at })) });
  }
  // Also include topics that have history but no current subscribers
  for (const [topic] of HISTORY.entries()) {
    if (!SUBS.has(topic)) topics.push({ topic, subscriber_count: 0, subscribers: [] });
  }
  return { topic_count: topics.length, topics };
}

function op_history(params) {
  const { topic, limit = 50 } = params || {};
  if (topic) {
    const h = HISTORY.get(topic) || [];
    return { topic, count: h.length, events: h.slice(-limit) };
  }
  // All topics
  const all = [];
  for (const [t, h] of HISTORY.entries()) {
    all.push({ topic: t, count: h.length, recent: h.slice(-5) });
  }
  return { topics: all };
}

function op_clear_history(params) {
  const { topic } = params || {};
  if (topic) {
    const had = HISTORY.has(topic);
    HISTORY.delete(topic);
    return { status: 'cleared', topic, was_present: had };
  }
  const count = HISTORY.size;
  HISTORY.clear();
  return { status: 'all_cleared', topics_cleared: count };
}

async function run(op, params) {
  switch (op) {
    case 'subscribe':     return op_subscribe(params);
    case 'unsubscribe':   return op_unsubscribe(params);
    case 'emit':          return op_emit(params);
    case 'list_topics':   return op_list_topics();
    case 'history':       return op_history(params);
    case 'clear_history': return op_clear_history(params);
    default:
      throw new Error(`Unknown op: ${op}. Available: subscribe, unsubscribe, emit, list_topics, history, clear_history`);
  }
}

const MANIFEST = {
  name: 'event_bus',
  description: 'In-process pub/sub for skill-to-skill events. Ops: subscribe, unsubscribe, emit, list_topics, history, clear_history.',
  ops: ['subscribe', 'unsubscribe', 'emit', 'list_topics', 'history', 'clear_history'],
};

module.exports = { MANIFEST, run };
