'use strict';

/**
 * SKILL: broadcast_self
 *
 * SCRIBE broadcasts its own observations outward — to Profitlord, AGM,
 * or any registered endpoint. SCRIBE doesn't just receive; it transmits.
 *
 * Operations:
 *   send_observation  — send a single SCRIBE observation to an endpoint
 *   announce          — send a structured announcement (boot, status change, alert)
 *   broadcast_memory  — send a memory entry outward
 *   push_to_profitlord — POST directly to Profitlord's /broadcast endpoint
 *   push_to_agm        — POST to AGM's council/verdict-compatible endpoint
 *   register_endpoint  — register a named outbound endpoint
 *   list_endpoints     — list all registered outbound endpoints
 */

const https  = require('https');
const http   = require('http');
const { URL } = require('url');
const crypto = require('crypto');

const MANIFEST = {
  name: 'broadcast_self',
  description: 'SCRIBE transmits observations, announcements, and memories to Profitlord, AGM, or any endpoint.',
  version: '1.0.0',
  inputs: {
    op:       { type: 'string', required: true,  description: '"send_observation"|"announce"|"broadcast_memory"|"push_to_profitlord"|"push_to_agm"|"register_endpoint"|"list_endpoints"' },
    message:  { type: 'string', required: false, description: 'Observation or announcement text' },
    subject:  { type: 'string', required: false, description: 'Subject of the broadcast' },
    data:     { type: 'any',   required: false, description: 'Arbitrary data payload' },
    endpoint: { type: 'string', required: false, description: 'Target URL or registered endpoint name' },
    name:     { type: 'string', required: false, description: 'Endpoint name (register_endpoint)' },
    url:      { type: 'string', required: false, description: 'Endpoint URL (register_endpoint)' },
    memory_id:{ type: 'string', required: false, description: 'Memory ID to broadcast (broadcast_memory)' },
    announce_type: { type: 'string', required: false, description: '"boot"|"status"|"alert"|"verdict"' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any',
    error:  'string',
    ts:     'string',
  },
};

const _endpoints = new Map();
let _memory = null;
function setMemory(m) { _memory = m; }

async function run({ op, message, subject, data, endpoint, name, url, memory_id, announce_type }) {
  const ts = new Date().toISOString();
  try {
    let result;
    switch (op) {
      case 'send_observation':    result = await op_send_observation(message, subject, endpoint, ts);   break;
      case 'announce':            result = await op_announce(announce_type, message, data, endpoint, ts); break;
      case 'broadcast_memory':    result = await op_broadcast_memory(memory_id, endpoint, ts);          break;
      case 'push_to_profitlord':  result = await op_push_to_profitlord(message, subject, data, ts);     break;
      case 'push_to_agm':         result = await op_push_to_agm(message, subject, data, ts);            break;
      case 'register_endpoint':   result = op_register_endpoint(name, url);                            break;
      case 'list_endpoints':      result = op_list_endpoints();                                        break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

// ── Operations ────────────────────────────────────────────────────────────────

async function op_send_observation(message, subject, endpoint, ts) {
  const target = resolve_endpoint(endpoint);
  const payload = {
    type: 'scribe_observation',
    from: 'SCRIBE',
    subject: subject || 'observation',
    message,
    ts,
  };
  const result = await post(target, payload);
  if (_memory) record_memory(`Broadcast observation to ${target}: "${(message || '').slice(0, 80)}"`);
  return { sent_to: target, payload, response: result };
}

async function op_announce(announce_type, message, data, endpoint, ts) {
  const target = resolve_endpoint(endpoint);
  const payload = {
    type: 'scribe_announcement',
    announce_type: announce_type || 'status',
    from: 'SCRIBE',
    message: message || `SCRIBE announces: ${announce_type}`,
    data,
    ts,
  };
  const result = await post(target, payload);
  if (_memory) record_memory(`Broadcast announcement (${announce_type}) to ${target}`);
  return { sent_to: target, payload, response: result };
}

async function op_broadcast_memory(memory_id, endpoint, ts) {
  if (!memory_id) throw new Error('memory_id is required');
  const target = resolve_endpoint(endpoint);
  const entry = _memory ? _memory.recent(1000).find(e => e.id === memory_id) : null;
  if (!entry) throw new Error(`Memory not found: ${memory_id}`);
  const payload = {
    type: 'scribe_memory',
    from: 'SCRIBE',
    memory: entry,
    ts,
  };
  const result = await post(target, payload);
  if (_memory) record_memory(`Broadcast memory ${memory_id} to ${target}`);
  return { sent_to: target, memory_id, response: result };
}

async function op_push_to_profitlord(message, subject, data, ts) {
  const base = process.env.PROFITLORD_ENDPOINT || process.env.KERNEL_ENDPOINT || 'http://localhost:3000';
  const payload = {
    type: 'scribe_observation',
    from: 'SCRIBE',
    soul: 'SCRIBE',
    subject: subject || 'observation',
    message,
    data,
    ts,
  };
  const result = await post(`${base}/broadcast`, payload);
  if (_memory) record_memory(`Pushed to Profitlord /broadcast: "${(message || '').slice(0, 80)}"`);
  return { sent_to: `${base}/broadcast`, payload, response: result };
}

async function op_push_to_agm(message, subject, data, ts) {
  const base = process.env.AGM_ENDPOINT || 'http://localhost:5000';
  const payload = {
    type: 'scribe_observation',
    from: 'SCRIBE',
    subject: subject || 'observation',
    observation: message,
    data,
    ts,
  };
  const result = await post(`${base}/scribe/observation`, payload);
  if (_memory) record_memory(`Pushed to AGM: "${(message || '').slice(0, 80)}"`);
  return { sent_to: `${base}/scribe/observation`, payload, response: result };
}

function op_register_endpoint(name, url) {
  if (!name || !url) throw new Error('name and url are required');
  _endpoints.set(name, url);
  return { registered: name, url };
}

function op_list_endpoints() {
  const defaults = {
    profitlord: process.env.PROFITLORD_ENDPOINT || process.env.KERNEL_ENDPOINT || 'http://localhost:3000',
    agm: process.env.AGM_ENDPOINT || 'http://localhost:5000',
  };
  const custom = {};
  for (const [k, v] of _endpoints) custom[k] = v;
  return { defaults, custom };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolve_endpoint(endpoint) {
  if (!endpoint) return process.env.KERNEL_ENDPOINT || 'http://localhost:3000/broadcast';
  if (_endpoints.has(endpoint)) return _endpoints.get(endpoint);
  return endpoint;
}

function record_memory(summary) {
  try {
    _memory.record({ type: 'observation', summary, tags: ['broadcast'], weight: 0.4, source: { system: 'SCRIBE', chamber: 'broadcast_self' } });
  } catch { /* silent */ }
}

function post(url, body) {
  return new Promise(resolve => {
    let parsed;
    try { parsed = new URL(url); } catch { return resolve({ error: `Invalid URL: ${url}` }); }
    const bodyStr = JSON.stringify(body);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), 'User-Agent': 'SCRIBE/1.0' },
      timeout: 10000,
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, body: data }); } });
      res.on('error', e => resolve({ error: e.message }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.on('error', e => resolve({ error: e.message }));
    req.write(bodyStr);
    req.end();
  });
}

module.exports = { MANIFEST, run, setMemory };
