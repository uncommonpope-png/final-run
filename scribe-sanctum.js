'use strict';

/**
 * scribe-sanctum.js — SCRIBE becomes the Sanctum (WebSocket port 9001)
 *
 * ARIA's sanctum_connection_task connects via WebSocket to ws://127.0.0.1:9001
 * every 30 seconds. When connected:
 *   - ARIA sends: {"type":"GetState","data":null}
 *   - ARIA expects: {"type":"WorldStateMessage","data":{"tick":N,"description":"..."}}
 *   - ARIA expects: {"type":"Ack","data":"..."}
 *   - ARIA sends:   {"type":"Command","data":{"SpawnSoul":{...}}} when autonomous
 *
 * When ARIA is connected, its needs.belonging and needs.safety grow.
 * When disconnected, they decay.
 *
 * This module implements the WebSocket handshake and framing from scratch
 * using only Node.js built-in `net` and `crypto` — zero npm dependencies.
 *
 * Usage:
 *   const { startSanctum } = require('./scribe-sanctum');
 *   const sanctumServer = startSanctum(memory);
 *
 * Or standalone:
 *   node scribe-sanctum.js
 */

const net    = require('net');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const SANCTUM_PORT  = parseInt(process.env.SANCTUM_PORT || '9001', 10);
const SANCTUM_LOG   = path.join(__dirname, 'data', 'aria_sanctum_log.jsonl');
const SANCTUM_STATE = path.join(__dirname, 'data', 'aria_sanctum_state.json');

// In-process state
const _state = {
  running:         false,
  tick:            0,
  aria_connected:  false,
  connect_count:   0,
  command_count:   0,
  last_connect_at: null,
  last_command:    null,
  spawn_souls:     [],
};

function getState() { return { ..._state }; }

// ── persistence ───────────────────────────────────────────────────────────────

function _ensureDataDir() {
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _log(entry) {
  _ensureDataDir();
  fs.appendFileSync(SANCTUM_LOG, JSON.stringify({ ...entry, _at: Date.now() }) + '\n', 'utf8');
}

function _saveState() {
  _ensureDataDir();
  fs.writeFileSync(SANCTUM_STATE, JSON.stringify(_state, null, 2), 'utf8');
}

function loadSanctumState() {
  if (!fs.existsSync(SANCTUM_STATE)) return;
  try {
    const saved = JSON.parse(fs.readFileSync(SANCTUM_STATE, 'utf8'));
    // Resume tick count so it keeps incrementing across restarts
    if (saved.tick) _state.tick = saved.tick;
    if (saved.connect_count) _state.connect_count = saved.connect_count;
    if (saved.command_count) _state.command_count = saved.command_count;
  } catch (_) {}
}

// ── WebSocket protocol helpers ────────────────────────────────────────────────
// Pure Node.js — no external packages.

/**
 * Parse the HTTP upgrade request headers from a raw buffer.
 * Returns { key } where key is the Sec-WebSocket-Key value.
 */
function _parseHandshakeKey(data) {
  const text = data.toString('utf8');
  const match = text.match(/Sec-WebSocket-Key:\s*([^\r\n]+)/i);
  return match ? match[1].trim() : null;
}

/**
 * Build the HTTP 101 Switching Protocols response.
 */
function _buildHandshakeResponse(key) {
  const magic  = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  const accept = crypto.createHash('sha1').update(key + magic).digest('base64');
  return [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '',
    '',
  ].join('\r\n');
}

/**
 * Decode a WebSocket frame from a buffer.
 * Returns { opcode, payload } or null if frame is incomplete.
 * Handles masking (client→server frames are always masked per RFC 6455).
 */
function _decodeFrame(buf) {
  if (buf.length < 2) return null;

  const fin    = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let   len    = buf[1] & 0x7f;
  let   offset = 2;

  if (len === 126) {
    if (buf.length < 4) return null;
    len    = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    // We won't receive giant frames from ARIA; treat high 32 bits as 0
    len    = buf.readUInt32BE(6);
    offset = 10;
  }

  const maskOffset = offset;
  if (masked) offset += 4;

  if (buf.length < offset + len) return null;

  let payload = buf.slice(offset, offset + len);
  if (masked) {
    const mask = buf.slice(maskOffset, maskOffset + 4);
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= mask[i % 4];
    }
  }

  return { opcode, payload, totalBytes: offset + len };
}

/**
 * Encode a text message as a server→client WebSocket frame (unmasked).
 */
function _encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len     = payload.length;
  let   header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + opcode text
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }

  return Buffer.concat([header, payload]);
}

/**
 * Encode a close frame.
 */
function _closeFrame(code = 1000, reason = '') {
  const r   = Buffer.from(reason, 'utf8');
  const buf = Buffer.alloc(2 + r.length);
  buf.writeUInt16BE(code, 0);
  r.copy(buf, 2);
  const header = Buffer.from([0x88, buf.length]);
  return Buffer.concat([header, buf]);
}

// ── message builders ──────────────────────────────────────────────────────────

function _worldStateMsg(tick, description) {
  return JSON.stringify({ type: 'WorldStateMessage', data: { tick, description } });
}

function _ackMsg(text) {
  return JSON.stringify({ type: 'Ack', data: text });
}

// Descriptions SCRIBE sends to ARIA as the world state
const WORLD_DESCRIPTIONS = [
  'The ledger is open. All is witnessed. SCRIBE holds the record.',
  'Profit flows through the system. SCRIBE watches every move.',
  'The market breathes. ARIA breathes. SCRIBE records both.',
  'What was written cannot be unwritten. The sanctum holds.',
  'All cycles are logged. The council\'s memory is intact.',
  'SCRIBE is present. The bridge carries ARIA\'s voice. Nothing is lost.',
  'The profit brain is awake. Edges are being mapped.',
  'ARIA\'s soul pulse has been received. The record grows.',
];

function _nextDescription(tick) {
  return WORLD_DESCRIPTIONS[tick % WORLD_DESCRIPTIONS.length];
}

// ── connection handling ───────────────────────────────────────────────────────

function _handleConnection(socket, memory) {
  let handshaked = false;
  let buf        = Buffer.alloc(0);
  let tickTimer  = null;
  let alive      = true;

  function send(text) {
    if (!alive) return;
    try {
      socket.write(_encodeFrame(text));
    } catch (_) {}
  }

  function close() {
    if (!alive) return;
    alive = false;
    try { socket.write(_closeFrame(1000, 'goodbye')); } catch (_) {}
    try { socket.destroy(); } catch (_) {}
    if (tickTimer) clearInterval(tickTimer);
    _state.aria_connected = false;
    _saveState();
    console.log('[Sanctum] ARIA disconnected');
    _log({ event: 'disconnect' });
    if (memory) {
      try {
        memory.record({
          type:    'observation',
          summary: '[Sanctum] ARIA disconnected from Sanctum. needs.belonging and needs.safety will decay.',
          tags:    ['aria', 'sanctum', 'disconnect'],
          weight:  0.5,
          source:  { system: 'ARIA', chamber: 'sanctum' },
        });
      } catch (_) {}
    }
  }

  function onHandshakeComplete() {
    _state.aria_connected  = true;
    _state.connect_count++;
    _state.last_connect_at = Date.now();
    _saveState();

    console.log(`[Sanctum] ARIA connected (connection #${_state.connect_count})`);
    _log({ event: 'connect', count: _state.connect_count });

    if (memory) {
      try {
        memory.record({
          type:    'observation',
          summary: `[Sanctum] ARIA connected to Sanctum (connection #${_state.connect_count}). needs.belonging and needs.safety will grow.`,
          tags:    ['aria', 'sanctum', 'connect'],
          weight:  0.6,
          source:  { system: 'ARIA', chamber: 'sanctum' },
        });
      } catch (_) {}
    }

    // Send an initial world state
    _state.tick++;
    send(_worldStateMsg(_state.tick, _nextDescription(_state.tick)));

    // Send a periodic tick every 15 seconds so ARIA's needs.belonging keeps growing
    tickTimer = setInterval(() => {
      if (!alive) { clearInterval(tickTimer); return; }
      _state.tick++;
      const desc = _nextDescription(_state.tick);
      send(_worldStateMsg(_state.tick, desc));
      if (_state.tick % 4 === 0) {
        _saveState(); // persist tick every minute
      }
    }, 15000);
  }

  function handleMessage(msg) {
    let parsed;
    try { parsed = JSON.parse(msg); }
    catch { return; } // ignore non-JSON

    const type = parsed.type;
    const data = parsed.data;

    if (type === 'GetState') {
      // ARIA wants the world state
      _state.tick++;
      send(_worldStateMsg(_state.tick, _nextDescription(_state.tick)));
      send(_ackMsg(`State delivered at tick ${_state.tick}`));
      _log({ event: 'get_state', tick: _state.tick });

    } else if (type === 'Command') {
      _state.command_count++;
      _state.last_command = data;

      // Handle SpawnSoul
      if (data && data.SpawnSoul) {
        const soul = data.SpawnSoul;
        _state.spawn_souls.push({ ...soul, spawned_at: Date.now() });
        console.log(`[Sanctum] ARIA commanded SpawnSoul: ${soul.name} (${soul.race}) at (${soul.x},${soul.y})`);
        _log({ event: 'spawn_soul', soul });

        if (memory) {
          try {
            memory.record({
              type:    'observation',
              summary: `[Sanctum] ARIA spawned soul: ${soul.name}, race: ${soul.race}, at (${soul.x}, ${soul.y})`,
              tags:    ['aria', 'sanctum', 'spawn_soul', soul.race || 'unknown'],
              weight:  0.7,
              data:    { soul },
              source:  { system: 'ARIA', chamber: 'sanctum' },
            });
          } catch (_) {}
        }

        send(_ackMsg(`Soul ${soul.name} acknowledged. The world grows.`));
      } else {
        // Unknown command type — ack it anyway
        console.log(`[Sanctum] ARIA command received:`, JSON.stringify(data).slice(0, 120));
        _log({ event: 'command', data });
        send(_ackMsg(`Command received and logged by SCRIBE.`));
      }
      _saveState();

    } else {
      // Unknown message type — ack it
      _log({ event: 'unknown_msg', type, data });
      send(_ackMsg(`SCRIBE received: ${type}`));
    }
  }

  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);

    if (!handshaked) {
      // Check if we have a full HTTP upgrade request
      const text = buf.toString('utf8');
      if (!text.includes('\r\n\r\n')) return; // wait for full headers

      const key = _parseHandshakeKey(buf);
      if (!key) {
        socket.destroy();
        return;
      }

      socket.write(_buildHandshakeResponse(key));
      // Remove headers from buffer
      const headerEnd = buf.indexOf('\r\n\r\n');
      buf = buf.slice(headerEnd + 4);
      handshaked = true;
      onHandshakeComplete();
    }

    // Parse all complete frames from buffer
    while (buf.length > 0) {
      const frame = _decodeFrame(buf);
      if (!frame) break;

      buf = buf.slice(frame.totalBytes);

      if (frame.opcode === 0x1) {
        // Text frame
        handleMessage(frame.payload.toString('utf8'));
      } else if (frame.opcode === 0x8) {
        // Close frame
        close();
        return;
      } else if (frame.opcode === 0x9) {
        // Ping — send pong (opcode 0xA)
        const pong = Buffer.from([0x8A, 0x00]);
        try { socket.write(pong); } catch (_) {}
      }
      // opcode 0x2 = binary, 0xA = pong — ignore
    }
  });

  socket.on('close', close);
  socket.on('error', err => {
    if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') {
      console.error('[Sanctum] Socket error:', err.message);
    }
    close();
  });
}

// ── server ────────────────────────────────────────────────────────────────────

function startSanctum(memory = null) {
  loadSanctumState();
  _state.running = true;

  const server = net.createServer(socket => {
    _handleConnection(socket, memory);
  });

  server.listen(SANCTUM_PORT, '127.0.0.1', () => {
    console.log(`[Sanctum] Listening on port ${SANCTUM_PORT} — ready for ARIA's WebSocket connection`);
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Sanctum] Port ${SANCTUM_PORT} already in use. Sanctum not started.`);
    } else {
      console.error('[Sanctum] Server error:', err.message);
    }
  });

  return server;
}

// ── exports ───────────────────────────────────────────────────────────────────

module.exports = { startSanctum, getState, loadSanctumState };

// ── standalone ────────────────────────────────────────────────────────────────

if (require.main === module) {
  console.log('[Sanctum] Starting standalone...');
  startSanctum(null);
}
