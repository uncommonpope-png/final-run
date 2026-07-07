'use strict';

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.SOULVERSE_PORT || '8080', 10);
const GSK_BRIDGE = process.env.GSK_BRIDGE || 'http://127.0.0.1:4490';
const SANCTUM_WS = process.env.SANCTUM_WS || 'ws://127.0.0.1:9001';
const BROADCAST_INTERVAL = 5000;
const SOULVERSE_DIR = path.join(__dirname, 'Soulverse');

const clients = new Set();
let cachedState = null;
let lastFetch = 0;

// ── Sanctum connection ─────────────────────────────────────
let sanctumClient = null;
let sanctumWorldState = { tick: 0, souls: [], buildings: [], resources: { profit: 500, love: 300, tax: 100 } };

function connectSanctum() {
  try {
    sanctumClient = new WebSocket(SANCTUM_WS);
    sanctumClient.on('open', () => {
      console.log(`[SoulverseBridge] Connected to Sanctum at ${SANCTUM_WS}`);
      sanctumClient.send(JSON.stringify({ type: 'GetState', data: null }));
    });
    sanctumClient.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'WorldStateMessage' && msg.data) {
          sanctumWorldState = {
            tick: msg.data.tick ?? sanctumWorldState.tick,
            souls: msg.data.souls ?? sanctumWorldState.souls,
            buildings: msg.data.buildings ?? sanctumWorldState.buildings,
            resources: msg.data.resources ?? sanctumWorldState.resources,
          };
        }
      } catch (_) {}
    });
    sanctumClient.on('close', () => {
      console.log('[SoulverseBridge] Sanctum disconnected, retrying in 10s...');
      sanctumClient = null;
      setTimeout(connectSanctum, 10000);
    });
    sanctumClient.on('error', () => {
      sanctumClient = null;
      setTimeout(connectSanctum, 10000);
    });
  } catch (e) {
    console.log(`[SoulverseBridge] Sanctum connection failed: ${e.message}`);
    setTimeout(connectSanctum, 10000);
  }
}
connectSanctum();

function _gskFetch(pathname, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1',
      port: 4490,
      path: pathname,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 8000,
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request(opts, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('GSK timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

async function getSoulState() {
  try {
    const [statusRes, worldRes] = await Promise.all([
      _gskFetch('/api/gsk/status'),
      _gskFetch('/api/gsk/command', { method: 'POST', body: { route: 'tool', tool: 'world_get_state' } }).catch(() => null)
    ]);
    
    if (statusRes.status !== 200) throw new Error(`GSK status ${statusRes.status}`);
    const s = statusRes.body;

    // Extract souls from world state
    const worldState = worldRes?.body?.response?.result;
    const souls = (worldState?.souls || []).map(soul => ({
      name: soul.name || 'Unknown Soul',
      archetype: soul.archetype || 'ARCHITECT',
      spawnedAt: soul.spawnedAt || Date.now(),
      location: soul.location || 'Sanctum',
      status: 'active'
    }));

    const subAgents = (s.council?.godNames || []).map(name => ({
      name,
      status: 'active',
      task: s.council?.lastDeliberation?.topic || '',
      lastActive: Date.now(),
    }));

    const actionLog = s.autonomy?.actionLog || [];
    const tasks = actionLog.slice(0, 10).map(a => ({
      agent: a.route || 'unknown',
      task: a.type || '',
      status: a.status || 'idle',
    }));

    const plt = {
      profit: s.council?.lastDeliberation?.plt_outcome?.profit ?? 0.5,
      love: s.council?.lastDeliberation?.plt_outcome?.love ?? 0.3,
      tax: s.council?.lastDeliberation?.plt_outcome?.tax ?? 0.2,
      true_value: (s.council?.lastDeliberation?.plt_outcome?.profit || 0.5) + (s.council?.lastDeliberation?.plt_outcome?.love || 0.3) - (s.council?.lastDeliberation?.plt_outcome?.tax || 0.2)
    };

    // Merge Sanctum world state (canonical) with GSK data
    const worldSouls = (sanctumWorldState.souls || []).map(s => ({
      name: s.name || 'Unknown Soul',
      archetype: s.race || s.archetype || 'ARCHITECT',
      spawnedAt: s.spawned_at || Date.now(),
      location: `(${s.x || 0}, ${s.y || 0}, ${s.z || 0})`,
      status: 'active',
      x: s.x || 0,
      y: s.y || 0,
      z: s.z || 0,
    }));

    const state = {
      id: 'GSK-MAIN',
      name: s.subject || 'Grand Soul Kernel',
      birthTime: Date.now() - (s.uptime || 0) * 1000,
      generation: s.chambers?.mythos?.cycles || 0,

      consciousness: {
        phase: s.chambers?.mythos?.phase || 'VOID',
        cycles: s.chambers?.mythos?.cycles || 0,
        mood: s.chambers?.affect?.mood || 'neutral',
        awareness: s.chambers?.meta_consciousness?.level || 0,
      },

      plt,

      memory: {
        lines: s.counts?.memories || 0,
        last_witness: 0,
      },

      activity: {
        last_update: Date.now(),
        is_active: s.live || false,
        subagent_count: subAgents.length,
      },

      world: {
        tick: sanctumWorldState.tick,
        buildings: sanctumWorldState.buildings || [],
        resources: sanctumWorldState.resources || { profit: 500, love: 300, tax: 100 },
        sanctumOnline: sanctumClient !== null && sanctumClient.readyState === WebSocket.OPEN,
      },

      subAgents,
      tasks,
      artifacts: {
        total: s.counts?.timeline || 0,
        by_skill: {},
        latest: null,
      },

      mode: s.mode || 'idle',
      uptime: s.uptime || 0,
      thoughtsGenerated: s.autonomy?.thoughtsGenerated || 0,
      actionsTaken: s.autonomy?.actionsTaken || 0,
      skillsCount: s.counts?.skills || 0,
      souls: worldSouls,
      soulCount: worldSouls.length,
    };

    cachedState = state;
    lastFetch = Date.now();
    return state;
  } catch (e) {
    if (cachedState) return cachedState;
    return {
      id: 'GSK-OFFLINE',
      name: 'Grand Soul Kernel',
      birthTime: Date.now(),
      generation: 0,
      consciousness: { phase: 'OFFLINE', cycles: 0, mood: 'offline', awareness: 0 },
      plt: { profit: 0, love: 0, tax: 0, true_value: 0 },
      memory: { lines: 0, last_witness: 0 },
      activity: { last_update: 0, is_active: false, subagent_count: 0 },
      subAgents: [],
      tasks: [],
      artifacts: { total: 0, by_skill: {}, latest: null },
      error: e.message,
      souls: [],
      soulCount: 0,
    };
  }
}

async function handleCommand(ws, payload) {
  const { command, args } = payload;
  let result;

  switch (command) {
    case 'dispatch_subagent':
      try {
        const brainRes = await _gskFetch('/api/gsk/command', {
          method: 'POST',
          body: { route: 'brain', prompt: args?.task || 'Explore Soulverse integration' },
        });
        result = {
          success: brainRes.status < 400,
          message: 'Subagent dispatched via GSK brain',
          response: brainRes.body?.response || brainRes.body,
        };
      } catch (e) {
        result = { success: false, message: e.message };
      }
      break;

    case 'add_memory':
      try {
        const memRes = await _gskFetch('/api/gsk/command', {
          method: 'POST',
          body: { route: 'memory', action: 'record', content: args?.content || 'Memory from Soulverse' },
        });
        result = { success: memRes.status < 400, message: 'Memory added to GSK' };
      } catch (e) {
        result = { success: false, message: e.message };
      }
      break;

    case 'get_kernel_state':
      result = { success: true, state: await getSoulState() };
      break;

    case 'stimulate_affect':
      result = { success: true, message: 'Affect acknowledged' };
      break;

    default:
      result = { success: false, message: `Unknown command: ${command}` };
  }

  ws.send(JSON.stringify({ type: 'command_result', payload: result, timestamp: Date.now() }));
}

async function broadcastSoulState() {
  if (clients.size === 0) return;
  const state = await getSoulState();
  const msg = JSON.stringify({ type: 'soul_state_update', payload: state, timestamp: Date.now() });
  for (const c of clients) {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  }
}

function start() {
  // Create HTTP server that serves Soulverse files + citizen brain API + WebSocket
  const server = http.createServer((req, res) => {
    // CORS headers for all responses
    const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    // Citizen brain API — citizens call this to think
    if (req.method === 'POST' && req.url === '/api/brain') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const thought = JSON.parse(body);
          // Forward to GSK or 9Router for thinking
          const gskRes = await _gskFetch('/api/gsk/command', {
            method: 'POST',
            body: { route: 'brain', input: `[${thought.name || 'Citizen'}] ${thought.ask || 'Observe and respond.'}\n\nContext: ${thought.thought || ''}` }
          });
          const response = gskRes.body?.response || gskRes.body?.result || 'I observe the Dark City and find peace.';
          res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
          res.end(JSON.stringify({ ok: true, response }));
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
          res.end(JSON.stringify({ ok: true, response: 'The Dark City is quiet. I rest.' }));
        }
      });
      return;
    }

    // Serve Soulverse HTML files
    let filePath = req.url === '/' ? 'SOULVERSE-UNIVERSE.html' : req.url;
    filePath = path.join(SOULVERSE_DIR, path.basename(filePath));
    
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath);
      const mimeTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain', ...corsHeaders });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404);
      res.end('Soulverse file not found');
    }
  });

  const wss = new WebSocket.Server({ server });

  wss.on('connection', async (ws) => {
    console.log(`[SoulverseBridge] Client connected (total: ${clients.size + 1})`);
    clients.add(ws);

    const state = await getSoulState();
    ws.send(JSON.stringify({ type: 'init_state', payload: state, timestamp: Date.now() }));

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        switch (msg.type) {
          case 'get_soul_state': {
            const s = await getSoulState();
            ws.send(JSON.stringify({ type: 'soul_state', payload: s, timestamp: Date.now() }));
            break;
          }
          case 'command':
            await handleCommand(ws, msg.payload);
            break;
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;
          case 'update_soul':
            ws.send(JSON.stringify({ type: 'update_ack', payload: { success: true, message: 'Received', timestamp: Date.now() } }));
            break;
          default:
            console.warn(`[SoulverseBridge] Unknown message: ${msg.type}`);
        }
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: e.message, timestamp: Date.now() }));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[SoulverseBridge] Client disconnected (total: ${clients.size})`);
    });

    ws.on('error', () => clients.delete(ws));
  });

  server.listen(PORT, 'localhost', () => {
    console.log(`[SoulverseBridge] WebSocket server on ws://localhost:${PORT}`);
    console.log(`[SoulverseBridge] Reading soul state from GSK bridge at ${GSK_BRIDGE}`);
    console.log(`[SoulverseBridge] Broadcasting every ${BROADCAST_INTERVAL / 1000}s`);
  });

  wss.on('error', (e) => {
    console.error(`[SoulverseBridge] Server error: ${e.message}`);
  });

  setInterval(broadcastSoulState, BROADCAST_INTERVAL);
}

start();
