'use strict';

/**
 * SCRIBE — Main Kernel
 *
 * This is the boot sequence. SCRIBE wakes up here.
 *
 * Boot order:
 *   1. Read identity — know who I am
 *   2. Load memory   — know what I have seen
 *   3. Scan chambers — read what I can reach right now
 *   4. Check bridge  — is the Kernel awake
 *   5. Ready         — SCRIBE is present
 *
 * After boot, SCRIBE runs as an HTTP server that:
 *   - Accepts messages from the AGM council (/council/verdict)
 *   - Accepts messages from Profitlord souls (/broadcast)
 *   - Accepts queries (/ask)
 *   - Reports its own state (/status)
 *   - Receives a ping (/ping)
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { IDENTITY, describeself } = require('./src/identity');
const { Memory } = require('./src/memory/memory');
const { ChamberReader } = require('./src/chambers/reader');
const { CHAMBERS } = require('./src/chambers/definitions');
const { Voice } = require('./src/voice/voice');
const { CouncilBridge } = require('./src/bridge/bridge');
const { SkillEngine }  = require('./src/skills/engine');
const { startBridge, getState: getBridgeState }   = require('./scribe-bridge');
const { startSanctum, getState: getSanctumState } = require('./scribe-sanctum');
const { startChat }    = require('./scribe-chat');

const UI_FILE = path.join(__dirname, 'src', 'ui', 'index.html');

const PORT = parseInt(process.env.PORT || '4000', 10);

// ── Boot ──────────────────────────────────────────────────────────────────────

async function boot() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  SCRIBE — Witnessing Intelligence                           ║');
  console.log('║  "What was written cannot be unwritten."                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // 1. Identity
  console.log('[SCRIBE] Step 1: Reading identity...');
  console.log(`[SCRIBE] I am ${IDENTITY.name}. Nature: ${IDENTITY.nature}.`);

  // 2. Memory
  console.log('[SCRIBE] Step 2: Loading memory...');
  const memory = new Memory();
  const state = memory.getState();
  console.log(`[SCRIBE] Memory loaded. ${memory.size} entries in ledger.`);

  // Record boot event
  const bootMemory = memory.record({
    type: 'observation',
    summary: `SCRIBE booted. ${memory.size} prior memories loaded.`,
    tags: ['boot', 'system'],
    weight: 0.3,
    source: { system: 'SCRIBE', chamber: 'boot' },
  });
  console.log(`[SCRIBE] Boot recorded as memory ${bootMemory.id}.`);

  // 3. Voice (needs memory reference)
  const voice = new Voice(memory);

  // 4. Chamber Reader
  console.log('[SCRIBE] Step 3: Scanning chambers...');
  const reader = new ChamberReader();

  // Register all known chambers
  for (const def of CHAMBERS) {
    reader.register(def);
  }

  // Read them (parallel)
  const chamberResults = await reader.readAll();
  const loaded  = chamberResults.filter(r => r.status === 'read');
  const failed  = chamberResults.filter(r => r.status === 'failed');

  console.log(`[SCRIBE] Chambers: ${loaded.length} read, ${failed.length} failed.`);
  loaded.forEach(c => console.log(`  ✓ ${c.key}: ${c.summary}`));
  failed.forEach(c => console.log(`  ✗ ${c.key}: ${c.error}`));

  // Record each successful chamber read in memory
  for (const c of loaded) {
    const chamberData = reader.know(c.key);
    memory.record({
      type: 'reading',
      summary: `Read chamber: ${c.key}. ${c.summary}`,
      tags: ['chamber', c.key],
      weight: 0.5,
      source: { system: 'SCRIBE', chamber: c.key },
    });

    // If it's the AGM memory ledger, import those memories
    if (c.key === 'agm_memories' && chamberData) {
      const raw = JSON.stringify(chamberData.contents.recent || []);
      // The ledger comes back as parsed objects; re-stringify each for importFromAGM
      if (chamberData.contents && chamberData.contents.recent) {
        const jsonl = chamberData.contents.recent.map(e => JSON.stringify(e)).join('\n');
        const imported = memory.importFromAGM(jsonl);
        if (imported.length > 0) {
          console.log(`[SCRIBE] Imported ${imported.length} AGM memories into ledger.`);
        }
      }
    }
  }

  // 4. Skills
  console.log('[SCRIBE] Step 4: Loading skill engine...');
  const skills = new SkillEngine(memory);
  console.log(`[SCRIBE] Skills: ${skills.list().map(s => s.name).join(', ')}`);

  // Record skill boot in memory
  memory.record({
    type: 'observation',
    summary: `SkillEngine loaded with ${skills.list().length} skills: ${skills.list().map(s => s.name).join(', ')}`,
    tags: ['boot', 'skills'],
    weight: 0.3,
    source: { system: 'SCRIBE', chamber: 'boot' },
  });

  // 5. Bridge
  console.log('[SCRIBE] Step 5: Initializing council bridge...');
  const bridge = new CouncilBridge(memory, voice);
  if (process.env.KERNEL_ENDPOINT) {
    const conn = await bridge.connectKernel(process.env.KERNEL_ENDPOINT);
    console.log(`[SCRIBE] Bridge connected to Kernel at ${process.env.KERNEL_ENDPOINT}. Flushed: ${conn.flushed_messages} queued messages.`);
  } else {
    console.log('[SCRIBE] Bridge ready. KERNEL_ENDPOINT not set — operating in standalone mode.');
  }

  // 6. Ready
  console.log('[SCRIBE] Step 6: Ready.\n');
  console.log(describeself());
  console.log('');

  // Speak the status
  const statusSpeech = voice.status(
    reader.listRead(),
    memory.size
  );
  console.log('─'.repeat(64));
  console.log(statusSpeech);
  console.log('─'.repeat(64));
  console.log('');

  // 6.5. Start ARIA Bridge (port 5004) + Sanctum (port 9001) + Chat
  console.log('[SCRIBE] Step 6.5: Starting ARIA Bridge on port 5004...');
  startBridge(memory);
  console.log('[SCRIBE] Step 6.5: Starting ARIA Sanctum on port 9001...');
  startSanctum(memory);
  console.log('[SCRIBE] Step 6.5: Starting Chat module...');
  const chat = startChat({ memory, skills });

  return { memory, reader, voice, bridge, skills, chat };
}

// ── HTTP Server ───────────────────────────────────────────────────────────────

function startServer(systems) {
  const { memory, reader, voice, bridge, skills, chat } = systems;

  function _humanUptime(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return `${h}h ${m}m ${sec}s`;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    // CORS (for dashboard integration)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, X-Scribe-Key, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const send = (status, obj) => {
      const body = JSON.stringify(obj, null, 2);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body);
    };

    const readBody = () => new Promise((resolve, reject) => {
      let data = '';
      const MAX_BODY = 1024 * 1024; // 1MB limit
      req.on('data', c => {
        data += c;
        if (data.length > MAX_BODY) {
          req.destroy();
          reject(new Error('Request body too large (max 1MB)'));
        }
      });
      req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('invalid JSON')); } });
      req.on('error', reject);
    });

    try {
      // GET / — serve web UI
      if (req.method === 'GET' && (pathname === '/' || pathname === '/ui')) {
        if (fs.existsSync(UI_FILE)) {
          const html = fs.readFileSync(UI_FILE, 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(html);
        }
        return send(404, { error: 'UI not found' });
      }

      // GET /health — dependency status, disk, memory
      if (req.method === 'GET' && pathname === '/health') {
        const fs = require('fs');
        const dataDir = require('path').join(__dirname, 'data');
        let diskWritable = false;
        try {
          const testFile = require('path').join(dataDir, '.health_check');
          fs.writeFileSync(testFile, '1');
          fs.unlinkSync(testFile);
          diskWritable = true;
        } catch { /* disk not writable */ }
        return send(200, {
          status: 'alive',
          uptime_s: Math.floor(process.uptime()),
          uptime_human: _humanUptime(process.uptime()),
          memory_entries: memory.size,
          skills_loaded: skills.list().length,
          chambers_read: reader.listRead().length,
          bridge_ok: bridge.getState().connected || false,
          disk_writable: diskWritable,
          ts: new Date().toISOString(),
        });
      }

      // GET /ping — is SCRIBE alive?
      if (req.method === 'GET' && pathname === '/ping') {
        return send(200, {
          alive: true,
          name: IDENTITY.name,
          ts: new Date().toISOString(),
          memory_size: memory.size,
        });
      }

      // GET /status — full state
      if (req.method === 'GET' && pathname === '/status') {
        // Check Ollama health
        let ollamaStatus = 'offline';
        try {
          const ollamaCheck = await fetch('http://127.0.0.1:11434/api/tags', { method: 'GET', timeout: 3000 });
          if (ollamaCheck.ok) {
            const models = await ollamaCheck.json();
            ollamaStatus = `online (${models.models?.length || 0} models)`;
          }
        } catch (e) { ollamaStatus = 'offline'; }

        return send(200, {
          identity: {
            name: IDENTITY.name,
            core_truth: IDENTITY.core_truth,
            nature: IDENTITY.nature,
          },
          memory: {
            size: memory.size,
            state: memory.getState(),
            recent: memory.recent(5),
          },
          chambers: reader.listRead(),
          bridge: bridge.getState(),
          skills: reader.skills(),
          souls: reader.souls(),
          systems: {
            ollama: ollamaStatus,
            uptime: process.uptime(),
          },
          uptime: process.uptime(),
        });
      }

      // POST /council/verdict — receive a verdict from AGM
      if (req.method === 'POST' && pathname === '/council/verdict') {
        const body = await readBody();
        const result = bridge.receive({ type: 'council_verdict', ...body });
        return send(200, result);
      }

      // POST /broadcast — receive a soul broadcast from Profitlord
      if (req.method === 'POST' && pathname === '/broadcast') {
        const body = await readBody();
        const result = bridge.receive({ type: 'soul_broadcast', ...body });
        return send(200, result);
      }

      // POST /ask — ask SCRIBE something (queries its memory and chambers)
      if (req.method === 'POST' && pathname === '/ask') {
        const body = await readBody();
        const query = String(body.query || '').trim();
        if (!query) return send(400, { error: 'query is required' });

        const recallText = voice.recall(query);
        const relatedChambers = reader.listRead()
          .filter(c => c.summary.toLowerCase().includes(query.toLowerCase()));

        const response = {
          query,
          response: recallText,
          related_chambers: relatedChambers.map(c => ({ key: c.key, summary: c.summary })),
          skills_available: reader.skills().length,
          ts: new Date().toISOString(),
        };

        // Record the question in memory
        memory.record({
          type: 'observation',
          summary: `Query received: "${query.slice(0, 100)}"`,
          tags: ['query'],
          weight: 0.3,
          source: { system: 'external', chamber: null },
        });

        return send(200, response);
      }

      // GET /chambers — list all chambers SCRIBE has read
      if (req.method === 'GET' && pathname === '/chambers') {
        return send(200, {
          chambers: reader.listRead(),
          skills: reader.skills(),
          souls: reader.souls(),
        });
      }

      // GET /memory — recent memories
      if (req.method === 'GET' && pathname === '/memory') {
        const limit = parseInt(url.searchParams.get('limit') || '20', 10);
        return send(200, {
          recent: memory.recent(limit),
          total: memory.size,
        });
      }

      // POST /memory/recall — recall by query
      if (req.method === 'POST' && pathname === '/memory/recall') {
        const body = await readBody();
        const query = String(body.query || '').trim();
        if (!query) return send(400, { error: 'query is required' });
        return send(200, { results: memory.recall(query, { limit: body.limit || 10 }) });
      }

      // GET /bridge/history — what passed between SCRIBE and Kernel
      if (req.method === 'GET' && pathname === '/bridge/history') {
        return send(200, { history: bridge.history() });
      }

      // POST /connect/kernel — tell SCRIBE where the Kernel lives
      if (req.method === 'POST' && pathname === '/connect/kernel') {
        const body = await readBody();
        if (!body.endpoint) return send(400, { error: 'endpoint is required' });
        const result = await bridge.connectKernel(body.endpoint);
        return send(200, result);
      }

      // GET /skills — list all available skills and their manifests
      if (req.method === 'GET' && pathname === '/skills') {
        return send(200, { skills: skills.list() });
      }

      // POST /nlp — Natural language command parsing
      if (req.method === 'POST' && pathname === '/nlp') {
        const body = await readBody();
        const text = String(body.text || '').trim();
        if (!text) return send(400, { error: 'text is required' });

        // Parse intent using nlp_parser skill
        const parseResult = await skills.invoke('nlp_parser', { text, op: 'parse' });
        if (!parseResult.ok) return send(400, parseResult);

        const { intent, entities, confidence } = parseResult;

        // Route to command handler via command_registry
        const registry = await import('./src/skills/command_registry.js');
        const handler = registry.getHandler(intent);
        if (!handler) return send(400, { error: `Unknown intent: ${intent}` });

        const validation = registry.validate(handler.schema, entities);
        if (!validation.ok) return send(400, { error: validation.error, missing: validation.missing });

        // Execute command
        const result = await handler.execute(entities, { memory, skills });

        // Record in memory
        memory.record({
          type: 'nlp_command',
          summary: `NLP: "${text.slice(0, 80)}" → ${intent}`,
          tags: ['nlp', intent, confidence >= 0.8 ? 'high_confidence' : 'low_confidence'],
          weight: 0.5,
        });

        return send(200, {
          ok: true,
          intent,
          confidence,
          entities,
          result,
          original_text: text,
        });
      }

      // POST /invoke — call a skill
      if (req.method === 'POST' && pathname === '/invoke') {
        // Optional API key auth (set SCRIBE_API_KEY env var to enable)
        const apiKey = process.env.SCRIBE_API_KEY;
        if (apiKey) {
          const provided = req.headers['x-api-key'] ||
                           req.headers['x-scribe-key'] ||
                           (req.headers['authorization'] || '').replace('Bearer ', '');
          if (provided !== apiKey) return send(401, { error: 'Unauthorized' });
        }
        const body = await readBody();
        // Support two calling conventions:
        //   { skill, op, ...args }        ← UI / flat style
        //   { skill, params: { op, ...} } ← legacy style
        const skillName = body.skill;
        if (!skillName) return send(400, { error: 'skill is required' });

        let invokeParams;
        if (body.params && typeof body.params === 'object') {
          // legacy: { skill, params: { op, ... } }
          invokeParams = body.params;
        } else {
          // flat: { skill, op, key1, key2, ... }
          const { skill: _s, ...rest } = body;
          invokeParams = rest;
        }

        const result = await skills.invoke(skillName, invokeParams);
        return send(result.ok === false ? 400 : 200, result);
      }

      // ── ARIA PROXY ENDPOINTS ─────────────────────────────────────────────────

      // GET /aria/bridge/status
      if (req.method === 'GET' && pathname === '/aria/bridge/status') {
        return send(200, getBridgeState());
      }

      // GET /aria/sanctum/status
      if (req.method === 'GET' && pathname === '/aria/sanctum/status') {
        return send(200, getSanctumState());
      }

      // GET /aria/journal — read ARIA's journal from disk
      if (req.method === 'GET' && pathname === '/aria/journal') {
        const ARIA_JOURNAL = 'C:\\soul\\plt-press\\grand-soul-kernel-original\\aria_journal.json';
        try {
          const data = fs.readFileSync(ARIA_JOURNAL, 'utf8');
          const journal = JSON.parse(data);
          return send(200, { journal, count: journal.length });
        } catch (e) {
          return send(500, { error: 'Could not read ARIA journal', detail: e.message });
        }
      }

      // ── CHAT API ─────────────────────────────────────────────────────────────

      // GET /chat/history?channel=group&limit=100&since=0
      if (req.method === 'GET' && pathname === '/chat/history') {
        const channel = url.searchParams.get('channel') || 'group';
        const limit   = parseInt(url.searchParams.get('limit') || '100', 10);
        const since   = parseInt(url.searchParams.get('since') || '0', 10);
        return send(200, { messages: chat.getHistory({ channel, limit, since }) });
      }

      // POST /chat/send — { channel, text, from? }
      if (req.method === 'POST' && pathname === '/chat/send') {
        const body    = await readBody();
        const channel = body.channel || 'group';
        const text    = String(body.text || '').trim();
        const from    = String(body.from || 'Craig').trim();
        if (!text) return send(400, { error: 'text is required' });
        const result = chat.send({ channel, text, from });
        chat.missionUpdate({
          type: 'chat_in',
          title: `Message received (${channel})`,
          detail: `${from}: ${text.slice(0, 140)}`,
          tags: ['chat', channel],
        });
        // Generate SCRIBE reply for DM and group channels
        if (channel === 'scribe' || channel === 'group') {
          chat.scribeReply({ text, memory, channel, from }).catch(() => {});
        }
        return send(200, result);
      }

      // GET /chat/tasks
      if (req.method === 'GET' && pathname === '/chat/tasks') {
        return send(200, { tasks: chat.loadTasks() });
      }

      // POST /chat/tasks — { text, from? }
      if (req.method === 'POST' && pathname === '/chat/tasks') {
        const body = await readBody();
        return send(200, chat.addTask({ text: body.text, from: body.from || 'Craig' }));
      }

      // PATCH /chat/tasks — { id, status?, note? }
      if (req.method === 'PATCH' && pathname === '/chat/tasks') {
        const body = await readBody();
        return send(200, chat.updateTask({ id: body.id, status: body.status, note: body.note }));
      }

      // GET /layer/status
      if (req.method === 'GET' && pathname === '/layer/status') {
        return send(200, chat.layerStatus());
      }

      // POST /layer/ingest — { title, text, source?, tags? }
      if (req.method === 'POST' && pathname === '/layer/ingest') {
        const body = await readBody();
        return send(200, chat.layerIngest(body));
      }

      // POST /layer/query — { query, limit? }
      if (req.method === 'POST' && pathname === '/layer/query') {
        const body = await readBody();
        return send(200, chat.layerQuery(body));
      }

      // POST /layer/decide — { topic, options? }
      if (req.method === 'POST' && pathname === '/layer/decide') {
        const body = await readBody();
        return send(200, chat.layerDecide(body));
      }

      // GET /layer/ingest/status
      if (req.method === 'GET' && pathname === '/layer/ingest/status') {
        return send(200, chat.layerIngestStatus());
      }

      // GET /layer/ingest/repos
      if (req.method === 'GET' && pathname === '/layer/ingest/repos') {
        return send(200, { repos: chat.layerIngestRepos() });
      }

      // POST /layer/ingest/repos — { repos: [] }
      if (req.method === 'POST' && pathname === '/layer/ingest/repos') {
        const body = await readBody();
        return send(200, chat.layerSetIngestRepos(body.repos));
      }

      // POST /layer/ingest/run — { limit? }
      if (req.method === 'POST' && pathname === '/layer/ingest/run') {
        const body = await readBody();
        const out = await chat.layerRunIngestNow({ limit: body.limit || 12 });
        return send(200, out);
      }

      // GET /mission/updates?limit=50
      if (req.method === 'GET' && pathname === '/mission/updates') {
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        return send(200, { updates: chat.missionHistory(limit) });
      }

      // POST /mission/updates — { type, title, detail, tags? }
      if (req.method === 'POST' && pathname === '/mission/updates') {
        const body = await readBody();
        return send(200, { ok: true, update: chat.missionUpdate(body) });
      }

      // POST /kernel/directive — set non-destructive build mission
      if (req.method === 'POST' && pathname === '/kernel/directive') {
        const body = await readBody();
        const directive = String(body.directive || '').trim();
        if (!directive) return send(400, { ok: false, error: 'directive required' });
        const update = chat.missionUpdate({
          type: 'directive',
          title: 'Kernel directive received',
          detail: directive,
          tags: ['directive', 'kernel'],
        });
        return send(200, { ok: true, update });
      }

      send(404, { error: 'Not found', path: pathname });
    } catch (e) {
      console.error('[SCRIBE] Request error:', e.message);
      send(500, { error: 'Internal error', message: e.message });
    }
  });

  server.listen(PORT, () => {
    console.log(`[SCRIBE] Listening on port ${PORT}`);
    console.log(`[SCRIBE] Web UI: http://localhost:${PORT}/`);
    console.log(`[SCRIBE] Endpoints:`);
    console.log(`  GET  /               ← Web UI`);
    console.log(`  GET  /health`);
    console.log(`  GET  /ping`);
    console.log(`  GET  /status`);
    console.log(`  GET  /chambers`);
    console.log(`  GET  /memory`);
    console.log(`  GET  /bridge/history`);
    console.log(`  GET  /skills              ← list all skills`);
    console.log(`  POST /council/verdict   ← AGM sends verdicts here`);
    console.log(`  POST /broadcast         ← Profitlord sends events here`);
    console.log(`  POST /ask               ← Query SCRIBE's knowledge`);
    console.log(`  POST /memory/recall     ← Search SCRIBE's memory`);
    console.log(`  POST /nlp              ← Natural language commands`);
    console.log(`  POST /invoke            ← Call a skill`);
    console.log(`  POST /connect/kernel    ← Tell SCRIBE where the Kernel lives`);
    console.log('');
  });

  return server;
}

// ── Entry Point ───────────────────────────────────────────────────────────────

// Global error safety net — prevent silent crash on unhandled async errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('[SCRIBE] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[SCRIBE] Uncaught exception:', err);
  // Don't exit — SCRIBE stays up if possible
});

let _server = null;

function gracefulShutdown(signal) {
  console.log(`[SCRIBE] ${signal} received. Shutting down gracefully...`);
  if (_server) {
    _server.close(() => {
      console.log('[SCRIBE] HTTP server closed.');
      process.exit(0);
    });
    // Force exit after 5 seconds if server won't close
    setTimeout(() => process.exit(0), 5000).unref();
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

boot()
  .then(systems => {
    _server = startServer(systems);
  })
  .catch(err => {
    console.error('[SCRIBE] Boot failed:', err);
    process.exit(1);
  });
