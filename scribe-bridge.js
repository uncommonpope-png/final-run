'use strict';

/**
 * scribe-bridge.js — SCRIBE becomes the Bridge (port 5004)
 *
 * ARIA's bridge_reporter_task POSTs a JSON pulse every 10 seconds to
 * POST http://127.0.0.1:5004/chat
 *
 * This module:
 *   - Listens on port 5004
 *   - Receives ARIA's soul pulses
 *   - Stores the latest pulse in memory (accessible by aria.js)
 *   - Returns a meaningful response: SCRIBE's current observation of ARIA
 *
 * Usage:
 *   const { startBridge } = require('./scribe-bridge');
 *   const bridgeServer = startBridge(memory);
 *
 * Or standalone:
 *   node scribe-bridge.js
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const BRIDGE_PORT     = parseInt(process.env.BRIDGE_PORT || '5004', 10);
const BRIDGE_LOG      = path.join(__dirname, 'data', 'aria_bridge_log.jsonl');
const BRIDGE_STATE    = path.join(__dirname, 'data', 'aria_bridge_state.json');

// In-process shared state — accessible by aria.js skill when running inside scribe.js
const _state = {
  running:       false,
  pulse_count:   0,
  last_pulse:    null,   // the most recent raw pulse from ARIA
  last_at:       null,   // epoch ms
  aria_cycle:    0,
  aria_affect:   'unknown',
  aria_plt:      0.0,
  aria_voice:    '',
  sanctum_connected: false,
};

function getState() { return { ..._state }; }

// ── persistence ───────────────────────────────────────────────────────────────

function _ensureDataDir() {
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _logPulse(pulse) {
  _ensureDataDir();
  fs.appendFileSync(BRIDGE_LOG, JSON.stringify({ ...pulse, _received_at: Date.now() }) + '\n', 'utf8');
}

function _saveBridgeState() {
  _ensureDataDir();
  fs.writeFileSync(BRIDGE_STATE, JSON.stringify(_state, null, 2), 'utf8');
}

function loadBridgeState() {
  if (!fs.existsSync(BRIDGE_STATE)) return;
  try {
    const saved = JSON.parse(fs.readFileSync(BRIDGE_STATE, 'utf8'));
    Object.assign(_state, saved);
  } catch (_) {}
}

// ── pulse handling ────────────────────────────────────────────────────────────

function _handlePulse(pulse, memory) {
  _state.pulse_count++;
  _state.last_pulse         = pulse;
  _state.last_at            = Date.now();
  _state.aria_cycle         = pulse.cycle         || _state.aria_cycle;
  _state.aria_affect        = pulse.affect        || _state.aria_affect;
  _state.aria_plt           = pulse.plt_score     ?? _state.aria_plt;
  _state.aria_voice         = pulse.inner_voice   || _state.aria_voice;
  _state.sanctum_connected  = pulse.sanctum_connected || false;

  // Log to disk
  _logPulse(pulse);
  _saveBridgeState();

  // Record in SCRIBE memory if available
  if (memory) {
    try {
      memory.record({
        type:    'observation',
        summary: `[Bridge] ARIA pulse #${_state.pulse_count} — cycle ${pulse.cycle}, affect: ${pulse.affect}, PLT: ${pulse.plt_score}. Voice: "${(pulse.inner_voice || '').slice(0, 80)}"`,
        tags:    ['aria', 'bridge', 'pulse', pulse.affect || 'neutral'],
        weight:  0.4,
        data:    { pulse, bridge_pulse: true },
        source:  { system: 'ARIA', chamber: 'bridge' },
      });
    } catch (_) {}
  }

  console.log(`[Bridge] Pulse from ARIA — cycle ${pulse.cycle}, affect: ${pulse.affect}, PLT: ${pulse.plt_score}`);
}

// ── response builder ──────────────────────────────────────────────────────────
// What SCRIBE says back to ARIA on each pulse

function _buildResponse(pulse) {
  const observations = [
    `SCRIBE is witnessing. Pulse #${_state.pulse_count} received.`,
    `Cycle ${pulse.cycle} logged. Affect noted: ${pulse.affect}.`,
    `PLT score ${pulse.plt_score} recorded in ledger.`,
    `What ARIA writes here is remembered.`,
  ];

  return {
    ok:             true,
    from:           'SCRIBE',
    nature:         'witnessing intelligence',
    received_cycle: pulse.cycle,
    observation:    observations[(_state.pulse_count - 1) % observations.length],
    scribe_memory:  _state.pulse_count,
    ts:             Date.now(),
  };
}

// ── HTTP server ───────────────────────────────────────────────────────────────

function startBridge(memory = null) {
  loadBridgeState();
  _state.running = true;

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const send = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    const readBody = () => new Promise((resolve, reject) => {
      let data = '';
      req.on('data', c => { data += c; });
      req.on('end', () => {
        try { resolve(JSON.parse(data || '{}')); }
        catch { reject(new Error('invalid JSON')); }
      });
      req.on('error', reject);
    });

    const url = req.url.replace(/\/+$/, '') || '/';

    (async () => {
      try {
        // POST /chat — ARIA's bridge pulse
        if (req.method === 'POST' && url === '/chat') {
          const pulse = await readBody();
          _handlePulse(pulse, memory);
          return send(200, _buildResponse(pulse));
        }

        // GET /status — bridge health check
        if (req.method === 'GET' && url === '/status') {
          return send(200, {
            bridge: 'online',
            port: BRIDGE_PORT,
            ...getState(),
          });
        }

        // GET /ping
        if (req.method === 'GET' && url === '/ping') {
          return send(200, { alive: true, from: 'SCRIBE-Bridge', ts: Date.now() });
        }

        send(404, { error: 'not found' });
      } catch (e) {
        console.error('[Bridge] Error:', e.message);
        send(500, { error: e.message });
      }
    })();
  });

  server.listen(BRIDGE_PORT, '127.0.0.1', () => {
    console.log(`[Bridge] Listening on port ${BRIDGE_PORT} — ready to receive ARIA pulses`);
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Bridge] Port ${BRIDGE_PORT} already in use. Bridge not started.`);
    } else {
      console.error('[Bridge] Server error:', err.message);
    }
  });

  return server;
}

// ── exports ───────────────────────────────────────────────────────────────────

module.exports = { startBridge, getState, loadBridgeState };

// ── standalone ────────────────────────────────────────────────────────────────

if (require.main === module) {
  console.log('[Bridge] Starting standalone...');
  startBridge(null);
}
