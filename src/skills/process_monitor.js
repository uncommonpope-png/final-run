'use strict';

/**
 * SKILL: process_monitor
 *
 * Monitor running processes and HTTP endpoints.
 * Checks if Profitlord, AGM, SCRIBE companions, or any URL is alive.
 * Zero external dependencies.
 *
 * Operations:
 *   ping_url      — HTTP GET a URL and return alive/dead + latency
 *   ping_many     — ping a list of URLs in parallel
 *   check_kernel  — ping the configured KERNEL_ENDPOINT
 *   list_procs    — list Node.js processes on this machine (via child_process)
 *   self_status   — return SCRIBE's own process stats (memory, uptime, CPU)
 *   watch         — register a URL to be polled every N seconds (in-process)
 *   watch_list    — list all active watches
 *   watch_cancel  — cancel a watch by id
 */

const https       = require('https');
const http        = require('http');
const { URL }     = require('url');
const { execSync } = require('child_process');
const crypto      = require('crypto');

const MANIFEST = {
  name: 'process_monitor',
  description: 'Ping endpoints, monitor running processes, watch URLs for liveness.',
  version: '1.0.0',
  inputs: {
    op:       { type: 'string', required: true,  description: '"ping_url"|"ping_many"|"check_kernel"|"list_procs"|"self_status"|"watch"|"watch_list"|"watch_cancel"' },
    url:      { type: 'string', required: false, description: 'URL to ping' },
    urls:     { type: 'array',  required: false, description: 'Array of URLs (ping_many)' },
    every_ms: { type: 'number', required: false, description: 'Poll interval in ms (watch op, min 5000)' },
    watch_id: { type: 'string', required: false, description: 'Watch ID to cancel' },
    timeout:  { type: 'number', required: false, description: 'Ping timeout in ms (default 5000)' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any',
    error:  'string',
    ts:     'string',
  },
};

// ── Watch registry (singleton) ────────────────────────────────────────────────
const _watches = new Map();
let _memory = null;
function setMemory(m) { _memory = m; }

// ── Main ──────────────────────────────────────────────────────────────────────

async function run({ op, url, urls, every_ms, watch_id, timeout = 5000 }) {
  const ts = new Date().toISOString();
  try {
    let result;
    switch (op) {
      case 'ping_url':     result = await op_ping(url, timeout);                   break;
      case 'ping_many':    result = await op_ping_many(urls || [], timeout);        break;
      case 'check_kernel': result = await op_check_kernel(timeout);                break;
      case 'list_procs':   result = op_list_procs();                               break;
      case 'self_status':  result = op_self_status();                              break;
      case 'watch':        result = op_watch(url, every_ms, timeout);             break;
      case 'watch_list':   result = op_watch_list();                              break;
      case 'watch_cancel': result = op_watch_cancel(watch_id);                   break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

// ── Operations ────────────────────────────────────────────────────────────────

async function op_ping(rawUrl, timeout) {
  if (!rawUrl) throw new Error('url is required');
  return ping_one(rawUrl, timeout);
}

async function op_ping_many(urls, timeout) {
  if (!urls.length) throw new Error('urls array is required');
  const results = await Promise.all(urls.map(u => ping_one(u, timeout)));
  const alive = results.filter(r => r.alive).length;
  return { total: urls.length, alive, dead: urls.length - alive, results };
}

async function op_check_kernel(timeout) {
  const endpoint = process.env.KERNEL_ENDPOINT;
  if (!endpoint) return { alive: false, reason: 'KERNEL_ENDPOINT not set' };
  return ping_one(endpoint + '/health', timeout);
}

function op_list_procs() {
  try {
    let out;
    if (process.platform === 'win32') {
      out = execSync('tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH', { timeout: 10000 }).toString();
      const procs = out.trim().split('\n')
        .filter(Boolean)
        .map(line => {
          const parts = line.replace(/"/g, '').split(',');
          return { name: parts[0], pid: parts[1], mem: parts[4] };
        });
      return { platform: 'win32', node_processes: procs };
    } else {
      out = execSync('ps aux | grep node | grep -v grep', { timeout: 10000 }).toString();
      const procs = out.trim().split('\n').filter(Boolean).map(line => {
        const parts = line.trim().split(/\s+/);
        return { user: parts[0], pid: parts[1], cpu: parts[2], mem: parts[3], command: parts.slice(10).join(' ') };
      });
      return { platform: process.platform, node_processes: procs };
    }
  } catch (e) {
    return { platform: process.platform, node_processes: [], error: e.message };
  }
}

function op_self_status() {
  const mem = process.memoryUsage();
  return {
    pid: process.pid,
    uptime_s: Math.floor(process.uptime()),
    memory: {
      rss_mb:        +(mem.rss / 1024 / 1024).toFixed(2),
      heap_used_mb:  +(mem.heapUsed / 1024 / 1024).toFixed(2),
      heap_total_mb: +(mem.heapTotal / 1024 / 1024).toFixed(2),
      external_mb:   +(mem.external / 1024 / 1024).toFixed(2),
    },
    platform: process.platform,
    node_version: process.version,
    env_port: process.env.PORT || '4000',
    kernel_endpoint: process.env.KERNEL_ENDPOINT || null,
  };
}

function op_watch(url, every_ms, timeout) {
  if (!url) throw new Error('url is required');
  if (!every_ms || every_ms < 5000) throw new Error('every_ms is required and must be >= 5000');
  const id = `watch_${crypto.randomBytes(4).toString('hex')}`;
  const timer = setInterval(async () => {
    const result = await ping_one(url, timeout);
    if (_memory) {
      try {
        _memory.record({
          type: 'observation',
          summary: `Watch "${url}": ${result.alive ? 'alive' : 'DEAD'} (${result.latency_ms}ms)`,
          tags: ['monitor', result.alive ? 'alive' : 'dead', url],
          weight: result.alive ? 0.2 : 0.8,
          source: { system: 'SCRIBE', chamber: 'process_monitor' },
          meta: result,
        });
      } catch { /* silent */ }
    }
  }, every_ms);
  _watches.set(id, { id, url, every_ms, timer, created: new Date().toISOString() });
  return { watch_id: id, url, every_ms };
}

function op_watch_list() {
  const list = [];
  for (const w of _watches.values()) {
    list.push({ id: w.id, url: w.url, every_ms: w.every_ms, created: w.created });
  }
  return { count: list.length, watches: list };
}

function op_watch_cancel(watch_id) {
  if (!watch_id) throw new Error('watch_id is required');
  const w = _watches.get(watch_id);
  if (!w) throw new Error(`No watch found: ${watch_id}`);
  clearInterval(w.timer);
  _watches.delete(watch_id);
  return { cancelled: watch_id, url: w.url };
}

// ── Ping helper ───────────────────────────────────────────────────────────────

function ping_one(rawUrl, timeout) {
  return new Promise(resolve => {
    const start = Date.now();
    let parsed;
    try { parsed = new URL(rawUrl); }
    catch { return resolve({ url: rawUrl, alive: false, status: null, latency_ms: null, error: 'Invalid URL' }); }

    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(rawUrl, { timeout }, res => {
      res.resume(); // drain
      const latency_ms = Date.now() - start;
      resolve({ url: rawUrl, alive: res.statusCode < 500, status: res.statusCode, latency_ms });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ url: rawUrl, alive: false, status: null, latency_ms: timeout, error: 'timeout' });
    });
    req.on('error', e => {
      resolve({ url: rawUrl, alive: false, status: null, latency_ms: Date.now() - start, error: e.message });
    });
  });
}

module.exports = { MANIFEST, run, setMemory };
