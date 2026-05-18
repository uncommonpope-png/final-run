'use strict';

// kernel_sync.js — Deep integration with AGM, Profitlord, and ForgeClaw Kernel
//
// SCRIBE is the witnessing intelligence. The Kernel is where decisions are made.
// This skill is SCRIBE's primary channel to query, sync with, and report on the Kernel.
//
// Kernel modules:
//   AGM         — memory manager (memories.jsonl, decisions, causes)
//   Profitlord  — profit engine (ledger, agents, signals)
//   ForgeClaw   — tactical executor (active skills, trinity state)
//
// Ops: ping_all, query_agm, query_profitlord, query_forgeclaw,
//      import_agm_memories, sync_ledger, push_observation, status, configure

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const readline = require('readline');

const DATA_DIR    = path.join(__dirname, '..', '..', 'data');
const CFG_FILE    = path.join(DATA_DIR, 'kernel_sync_config.json');
const SYNC_LOG    = path.join(DATA_DIR, 'kernel_sync.jsonl');

let _memory = null;
function setMemory(m) { _memory = m; }

// ── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_CFG = {
  agm_url:         process.env.AGM_URL         || 'http://localhost:3000',
  profitlord_url:  process.env.PROFITLORD_URL  || 'http://localhost:3001',
  forgeclaw_url:   process.env.FORGECLAW_URL   || 'http://localhost:3002',
  kernel_url:      process.env.KERNEL_URL      || 'http://localhost:4100',
  timeout_ms: 10000,
  // Local file paths for direct file sync (when Kernel is on same machine)
  agm_memories_file:    process.env.AGM_MEMORIES_FILE    || '',
  profitlord_ledger_file: process.env.PROFITLORD_LEDGER  || '',
};

function _loadCfg() {
  let stored = {};
  if (fs.existsSync(CFG_FILE)) {
    try { stored = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch (_) {}
  }
  return { ...DEFAULT_CFG, ...stored };
}

function op_configure(params) {
  const cfg = { ..._loadCfg(), ...params };
  const tmp = CFG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, CFG_FILE);
  return { status: 'configured', agm_url: cfg.agm_url, profitlord_url: cfg.profitlord_url, forgeclaw_url: cfg.forgeclaw_url };
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

function _get(url, timeout_ms = 10000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'SCRIBE/kernel_sync' } }, (res) => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (_) { resolve({ status: res.statusCode, body }); }
      });
    });
    req.setTimeout(timeout_ms, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
    req.on('error', reject);
  });
}

function _post(url, data, timeout_ms = 10000) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'User-Agent': 'SCRIBE/kernel_sync' },
    };
    const req = lib.request(opts, (res) => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (_) { resolve({ status: res.statusCode, body }); }
      });
    });
    req.setTimeout(timeout_ms, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function _logSync(entry) {
  fs.appendFileSync(SYNC_LOG, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n', 'utf8');
}

// ── Ping ─────────────────────────────────────────────────────────────────────

async function op_ping_all() {
  const cfg = _loadCfg();
  const targets = [
    { name: 'AGM',        url: cfg.agm_url        + '/health' },
    { name: 'Profitlord', url: cfg.profitlord_url + '/health' },
    { name: 'ForgeClaw',  url: cfg.forgeclaw_url  + '/health' },
    { name: 'Kernel',     url: cfg.kernel_url     + '/health' },
  ];

  const results = [];
  for (const t of targets) {
    const start = Date.now();
    try {
      const r = await _get(t.url, 5000);
      results.push({ name: t.name, alive: r.status < 400, status: r.status, ms: Date.now() - start });
    } catch (e) {
      results.push({ name: t.name, alive: false, error: e.message, ms: Date.now() - start });
    }
  }

  _logSync({ type: 'ping_all', results });
  const alive_count = results.filter(r => r.alive).length;
  return { alive_count, total: targets.length, results };
}

// ── Query AGM ────────────────────────────────────────────────────────────────

async function op_query_agm(params) {
  const { endpoint = '/memories', limit = 20 } = params || {};
  const cfg = _loadCfg();

  // First try HTTP
  try {
    const r = await _get(`${cfg.agm_url}${endpoint}?limit=${limit}`, cfg.timeout_ms);
    _logSync({ type: 'query_agm', endpoint, status: r.status });
    return { source: 'http', endpoint, status: r.status, data: r.body };
  } catch (http_err) {
    // Fall back to direct file read if configured
    if (cfg.agm_memories_file && fs.existsSync(cfg.agm_memories_file)) {
      const entries = [];
      const rl = readline.createInterface({ input: fs.createReadStream(cfg.agm_memories_file), crlfDelay: Infinity });
      for await (const line of rl) {
        try { entries.push(JSON.parse(line.trim())); if (entries.length >= limit) break; } catch (_) {}
      }
      _logSync({ type: 'query_agm_file', file: cfg.agm_memories_file, count: entries.length });
      return { source: 'file', file: cfg.agm_memories_file, count: entries.length, entries };
    }
    throw new Error(`AGM unreachable: ${http_err.message}`);
  }
}

// ── Query Profitlord ─────────────────────────────────────────────────────────

async function op_query_profitlord(params) {
  const { endpoint = '/status', limit = 20 } = params || {};
  const cfg = _loadCfg();

  try {
    const r = await _get(`${cfg.profitlord_url}${endpoint}?limit=${limit}`, cfg.timeout_ms);
    _logSync({ type: 'query_profitlord', endpoint, status: r.status });
    return { source: 'http', endpoint, status: r.status, data: r.body };
  } catch (http_err) {
    if (cfg.profitlord_ledger_file && fs.existsSync(cfg.profitlord_ledger_file)) {
      const entries = [];
      const rl = readline.createInterface({ input: fs.createReadStream(cfg.profitlord_ledger_file), crlfDelay: Infinity });
      for await (const line of rl) {
        try { entries.push(JSON.parse(line.trim())); if (entries.length >= limit) break; } catch (_) {}
      }
      return { source: 'file', file: cfg.profitlord_ledger_file, count: entries.length, entries };
    }
    throw new Error(`Profitlord unreachable: ${http_err.message}`);
  }
}

// ── Query ForgeClaw ──────────────────────────────────────────────────────────

async function op_query_forgeclaw(params) {
  const { endpoint = '/status' } = params || {};
  const cfg = _loadCfg();
  try {
    const r = await _get(`${cfg.forgeclaw_url}${endpoint}`, cfg.timeout_ms);
    _logSync({ type: 'query_forgeclaw', endpoint, status: r.status });
    return { source: 'http', endpoint, status: r.status, data: r.body };
  } catch (e) {
    throw new Error(`ForgeClaw unreachable: ${e.message}`);
  }
}

// ── Import AGM memories into SCRIBE ledger ────────────────────────────────────

async function op_import_agm_memories(params) {
  const { limit = 100, since_hours = 24 } = params || {};
  const cfg = _loadCfg();
  const since_ms = Date.now() - since_hours * 3600000;
  let entries = [];

  // Try HTTP first
  try {
    const r = await _get(`${cfg.agm_url}/memories?limit=${limit}`, cfg.timeout_ms);
    if (Array.isArray(r.body)) entries = r.body;
    else if (r.body?.memories) entries = r.body.memories;
    else if (r.body?.entries) entries = r.body.entries;
  } catch (_) {
    // Try file
    if (cfg.agm_memories_file && fs.existsSync(cfg.agm_memories_file)) {
      const rl = readline.createInterface({ input: fs.createReadStream(cfg.agm_memories_file), crlfDelay: Infinity });
      for await (const line of rl) {
        try {
          const e = JSON.parse(line.trim());
          const ts = new Date(e.timestamp || e.created_at || 0).getTime();
          if (ts >= since_ms) entries.push(e);
          if (entries.length >= limit) break;
        } catch (_) {}
      }
    }
  }

  if (!entries.length) return { imported: 0, note: 'No AGM memories found.' };

  let imported = 0;
  if (_memory) {
    for (const e of entries) {
      try {
        await _memory.record({
          summary: e.summary || e.content || JSON.stringify(e).slice(0, 200),
          tags: ['agm_import', ...(e.tags || [])],
          parent_id: e.parent_id || e.cause_id || null,
          type: 'agm_memory',
          source: { system: 'AGM', original_id: e.id },
        });
        imported++;
      } catch (_) {}
    }
  }

  _logSync({ type: 'import_agm_memories', imported, total: entries.length });
  return { imported, total_fetched: entries.length };
}

// ── Push an observation to the Kernel ────────────────────────────────────────

async function op_push_observation(params) {
  const { summary, tags = [], target = 'kernel' } = params || {};
  if (!summary) throw new Error('summary required');
  const cfg = _loadCfg();
  const url_map = { kernel: cfg.kernel_url, agm: cfg.agm_url, profitlord: cfg.profitlord_url };
  const base_url = url_map[target] || cfg.kernel_url;

  try {
    const r = await _post(`${base_url}/observe`, { summary, tags, source: 'SCRIBE', ts: new Date().toISOString() }, cfg.timeout_ms);
    _logSync({ type: 'push_observation', target, status: r.status });
    return { status: 'pushed', target, http_status: r.status };
  } catch (e) {
    return { status: 'failed', target, error: e.message };
  }
}

// ── Sync ledger — bi-directional count check ─────────────────────────────────

async function op_sync_ledger() {
  const cfg = _loadCfg();
  const LEDGER = path.join(DATA_DIR, 'ledger.jsonl');
  let scribe_count = 0;
  if (fs.existsSync(LEDGER)) {
    const lines = fs.readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean);
    scribe_count = lines.length;
  }

  let kernel_count = null;
  try {
    const r = await _get(`${cfg.kernel_url}/ledger/count`, 5000);
    kernel_count = r.body?.count || null;
  } catch (_) {}

  const drift = kernel_count !== null ? Math.abs(scribe_count - kernel_count) : null;
  return {
    scribe_ledger_entries: scribe_count,
    kernel_ledger_entries: kernel_count,
    drift,
    in_sync: drift !== null ? drift === 0 : null,
  };
}

// ── Status ────────────────────────────────────────────────────────────────────

async function op_status() {
  const cfg = _loadCfg();
  const ping = await op_ping_all().catch(() => ({ alive_count: 0, results: [] }));
  const log_count = fs.existsSync(SYNC_LOG) ? fs.readFileSync(SYNC_LOG, 'utf8').trim().split('\n').filter(Boolean).length : 0;
  return {
    config: { agm_url: cfg.agm_url, profitlord_url: cfg.profitlord_url, forgeclaw_url: cfg.forgeclaw_url, kernel_url: cfg.kernel_url },
    ping,
    sync_log_entries: log_count,
  };
}

const MANIFEST = {
  name: 'kernel_sync',
  description: 'Deep integration with AGM, Profitlord, and ForgeClaw Kernel. Ops: ping_all, query_agm, query_profitlord, query_forgeclaw, import_agm_memories, sync_ledger, push_observation, status, configure.',
  ops: ['ping_all', 'query_agm', 'query_profitlord', 'query_forgeclaw', 'import_agm_memories', 'sync_ledger', 'push_observation', 'status', 'configure'],
};

async function run(op, params) {
  switch (op) {
    case 'ping_all':            return op_ping_all();
    case 'query_agm':           return op_query_agm(params);
    case 'query_profitlord':    return op_query_profitlord(params);
    case 'query_forgeclaw':     return op_query_forgeclaw(params);
    case 'import_agm_memories': return op_import_agm_memories(params);
    case 'sync_ledger':         return op_sync_ledger();
    case 'push_observation':    return op_push_observation(params);
    case 'status':              return op_status();
    case 'configure':           return op_configure(params);
    default:
      throw new Error(`Unknown op: ${op}. Available: ping_all, query_agm, query_profitlord, query_forgeclaw, import_agm_memories, sync_ledger, push_observation, status, configure`);
  }
}

module.exports = { MANIFEST, run, setMemory };
