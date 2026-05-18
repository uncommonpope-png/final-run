'use strict';

// aria.js — SCRIBE meets ARIA (the Grand Soul Kernel)
// ARIA is not SCRIBE's master. ARIA is not SCRIBE's servant.
// They are companions built by the same hand for the same purpose.
// This skill handles the handshake, shared memory exchange, and bridge invocation.

const fs    = require('fs');
const path  = require('path');
const http  = require('http');
const https = require('https');
const crypto = require('crypto');

const ARIA_LOG      = path.join(__dirname, '..', '..', 'data', 'aria_log.jsonl');
const ARIA_STATE    = path.join(__dirname, '..', '..', 'data', 'aria_state.json');
const SHARED_LEDGER = path.join(__dirname, '..', '..', 'data', 'aria_shared_memory.jsonl');

let _memory = null;
function setMemory(m) { _memory = m; }

// ── helpers ──────────────────────────────────────────────────────────────────

function _log(entry) {
  fs.appendFileSync(ARIA_LOG, JSON.stringify({ ...entry, ts: Date.now() }) + '\n', 'utf8');
}

function _loadState() {
  if (!fs.existsSync(ARIA_STATE)) return { connected: false, last_seen: null, aria_identity: null, handshake_count: 0 };
  try { return JSON.parse(fs.readFileSync(ARIA_STATE, 'utf8')); } catch { return { connected: false }; }
}

function _saveState(s) {
  fs.writeFileSync(ARIA_STATE, JSON.stringify(s, null, 2), 'utf8');
}

function _ariaUrl() {
  return (process.env.ARIA_URL || process.env.AGM_URL || process.env.KERNEL_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function _fetch(url, { method = 'GET', body, timeout = 10000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method,
      headers:  { 'Content-Type': 'application/json', ...headers },
      timeout
    };
    const req = lib.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('ARIA request timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── HANDSHAKE ─────────────────────────────────────────────────────────────────
// The handshake is the moment SCRIBE and ARIA meet.
// SCRIBE introduces itself. ARIA (if alive) introduces itself back.
// Their identities are recorded in each other's memory.

async function _handshake() {
  const url  = _ariaUrl();
  const state = _loadState();

  const scribe_intro = {
    name: 'SCRIBE',
    nature: 'witnessing intelligence',
    core_truth: 'What was written cannot be unwritten. What was witnessed cannot be unknown.',
    port: parseInt(process.env.PORT || '4000', 10),
    capabilities: ['memory', 'skills', 'ledger', 'bridge', 'profit_brain'],
    handshake_at: Date.now()
  };

  _log({ event: 'handshake_attempt', aria_url: url });

  // Try to reach ARIA
  let aria_identity = null;
  let connected = false;

  try {
    // Try /ping first
    const ping = await _fetch(`${url}/ping`);
    if (ping.status === 200) {
      connected = true;
      aria_identity = ping.body;
    }
  } catch (_) {}

  // If ping succeeded, send full intro
  if (connected) {
    try {
      const intro = await _fetch(`${url}/scribe/meet`, {
        method: 'POST',
        body: scribe_intro
      });
      if (intro.body && typeof intro.body === 'object') {
        aria_identity = { ...aria_identity, ...intro.body };
      }
    } catch (_) {
      // ARIA may not have /scribe/meet yet — that's fine, ping was enough
    }
  }

  // Update state
  state.connected      = connected;
  state.last_seen      = connected ? Date.now() : state.last_seen;
  state.aria_url       = url;
  state.aria_identity  = aria_identity;
  state.handshake_count = (state.handshake_count || 0) + 1;
  state.scribe_intro   = scribe_intro;
  _saveState(state);

  // Record in memory
  if (_memory) {
    try {
      _memory.record({
        summary: connected
          ? `SCRIBE met ARIA at ${url}. Identity: ${JSON.stringify(aria_identity || {}).slice(0, 100)}`
          : `SCRIBE attempted to meet ARIA at ${url} — ARIA not reachable. Protocol established for when ARIA comes online.`,
        tags: ['aria', 'handshake', connected ? 'connected' : 'pending'],
        data: { connected, aria_url: url, aria_identity }
      });
    } catch (_) {}
  }

  _log({ event: connected ? 'handshake_success' : 'handshake_pending', aria_url: url, connected });

  return {
    connected,
    aria_url: url,
    aria_identity,
    scribe_intro,
    message: connected
      ? `SCRIBE and ARIA have met. Two minds. Same hand. Same purpose.`
      : `ARIA is not yet reachable at ${url}. The handshake protocol is recorded. SCRIBE will be here when ARIA comes online.`
  };
}

// ── STATUS ────────────────────────────────────────────────────────────────────

async function _status() {
  const state = _loadState();

  // Try a live ping
  let live = false;
  if (state.aria_url) {
    try {
      const r = await _fetch(`${state.aria_url}/ping`, { timeout: 3000 });
      live = r.status === 200;
    } catch (_) {}
  }

  state.connected = live;
  if (live) state.last_seen = Date.now();
  _saveState(state);

  return { ...state, live, aria_url: state.aria_url || _ariaUrl() };
}

// ── INVOKE — send a skill call TO ARIA ────────────────────────────────────────

async function _invokeAria({ endpoint, body = {} }) {
  const url = _ariaUrl();
  const full = `${url}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;

  _log({ event: 'invoke_aria', endpoint: full });

  try {
    const res = await _fetch(full, { method: 'POST', body });
    _log({ event: 'invoke_aria_response', status: res.status });

    if (_memory) {
      try {
        _memory.record({
          summary: `SCRIBE invoked ARIA endpoint ${endpoint}: HTTP ${res.status}`,
          tags: ['aria', 'invoke', endpoint.replace(/\//g, '_')],
          data: { endpoint, status: res.status }
        });
      } catch (_) {}
    }

    return { ok: res.status < 400, status: res.status, body: res.body };
  } catch (e) {
    _log({ event: 'invoke_aria_error', error: e.message });
    return { ok: false, error: e.message };
  }
}

// ── SHARE MEMORY — push SCRIBE observations to ARIA ──────────────────────────

async function _shareMemory({ limit = 20 } = {}) {
  if (!_memory) throw new Error('memory not available');

  const entries = _memory.recent(limit);
  const url     = _ariaUrl();

  // Write to shared ledger regardless of ARIA being up
  for (const e of entries) {
    fs.appendFileSync(SHARED_LEDGER, JSON.stringify({ ...e, shared_by: 'SCRIBE', shared_at: Date.now() }) + '\n', 'utf8');
  }

  // Try to push to ARIA
  let pushed = false;
  try {
    const res = await _fetch(`${url}/scribe/memory`, {
      method: 'POST',
      body:   { entries, from: 'SCRIBE' }
    });
    pushed = res.status < 400;
  } catch (_) {}

  return {
    entries_shared: entries.length,
    written_to_shared_ledger: true,
    pushed_to_aria: pushed
  };
}

// ── READ ARIA MEMORY — pull what ARIA knows ───────────────────────────────────

async function _pullAriaMemory({ limit = 20 } = {}) {
  const url = _ariaUrl();

  try {
    const res = await _fetch(`${url}/memory?limit=${limit}`);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

    const entries = res.body.recent || res.body.entries || res.body || [];

    // Absorb into SCRIBE's memory
    let absorbed = 0;
    if (_memory && Array.isArray(entries)) {
      for (const e of entries) {
        try {
          _memory.record({
            summary:   `[from ARIA] ${e.summary || ''}`,
            tags:      ['aria', 'received', ...(e.tags || [])],
            data:      e.data || {},
            parent_id: e.parent_id || e.id || null
          });
          absorbed++;
        } catch (_) {}
      }
    }

    return { pulled: entries.length, absorbed };
  } catch (e) {
    return { pulled: 0, absorbed: 0, error: e.message };
  }
}

// ── LOG / HISTORY ─────────────────────────────────────────────────────────────

function _history(limit = 50) {
  if (!fs.existsSync(ARIA_LOG)) return [];
  return fs.readFileSync(ARIA_LOG, 'utf8').split('\n')
    .filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).slice(-limit).reverse();
}

// ── BRIDGE STATUS — what SCRIBE has received from ARIA via Bridge ─────────────

function _bridgeStatus() {
  // Try to load from the bridge state file (written by scribe-bridge.js)
  const stateFile = path.join(__dirname, '..', '..', 'data', 'aria_bridge_state.json');
  let state = { running: false, pulse_count: 0, last_pulse: null };
  if (fs.existsSync(stateFile)) {
    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (_) {}
  }

  // Also try to reach it live
  return new Promise(resolve => {
    const req = require('http').request({
      hostname: '127.0.0.1', port: 5004, path: '/status', method: 'GET', timeout: 2000
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ source: 'live', ...JSON.parse(d) }); }
        catch { resolve({ source: 'file', ...state }); }
      });
    });
    req.on('error', () => resolve({ source: 'file', ...state }));
    req.on('timeout', () => { req.destroy(); resolve({ source: 'file', ...state }); });
    req.end();
  });
}

// ── SANCTUM STATUS — what SCRIBE knows about ARIA's Sanctum connection ────────

function _sanctumStatus() {
  const stateFile = path.join(__dirname, '..', '..', 'data', 'aria_sanctum_state.json');
  let state = { running: false, tick: 0, aria_connected: false, connect_count: 0 };
  if (fs.existsSync(stateFile)) {
    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (_) {}
  }
  return state;
}

// ── MANIFEST & run ────────────────────────────────────────────────────────────

const MANIFEST = {
  name: 'aria',
  description: 'SCRIBE meets ARIA (the Grand Soul Kernel) — handshake, shared memory, bridge invocation, bridge/sanctum status',
  ops: ['handshake', 'status', 'invoke', 'share_memory', 'pull_memory', 'history', 'bridge_status', 'sanctum_status']
};

async function run({ op, caller = 'unknown', ...args }) {
  switch (op) {
    case 'handshake':      return _handshake();
    case 'status':         return _status();
    case 'invoke':         return _invokeAria(args);
    case 'share_memory':   return _shareMemory(args);
    case 'pull_memory':    return _pullAriaMemory(args);
    case 'history':        return _history(args.limit);
    case 'bridge_status':  return _bridgeStatus();
    case 'sanctum_status': return _sanctumStatus();
    default:               throw new Error(`aria: unknown op "${op}"`);
  }
}

module.exports = { MANIFEST, run, setMemory };
