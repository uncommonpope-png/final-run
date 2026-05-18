'use strict';

/**
 * SKILL: health_check
 *
 * Deep health check for SCRIBE and its dependencies.
 * Checks: disk writability, ledger integrity, memory size, uptime,
 * bridge connectivity, GitHub reachability.
 *
 * Operations:
 *   full      — run all checks and return a combined report
 *   disk      — check data directory is writable
 *   ledger    — check ledger.jsonl is valid JSONL
 *   network   — probe a URL (default GitHub API)
 *   memory    — report memory module stats
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

const DATA_DIR   = path.join(__dirname, '..', '..', 'data');
const LEDGER     = path.join(DATA_DIR, 'ledger.jsonl');

const MANIFEST = {
  name: 'health_check',
  description: 'Deep health check: disk, ledger, network, memory stats, uptime.',
  version: '1.0.0',
  inputs: {
    op:  { type: 'string', required: true,  description: '"full"|"disk"|"ledger"|"network"|"memory"' },
    url: { type: 'string', required: false, description: 'URL to probe (network op, default GitHub API)' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any',
    error:  'string',
    ts:     'string',
  },
};

let _memory = null;
function setMemory(m) { _memory = m; }

async function run({ op, url }) {
  const ts = new Date().toISOString();
  try {
    let result;
    switch (op) {
      case 'full':    result = await op_full(url);  break;
      case 'disk':    result = op_disk();           break;
      case 'ledger':  result = op_ledger();         break;
      case 'network': result = await op_network(url || 'https://api.github.com'); break;
      case 'memory':  result = op_memory_check();  break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

async function op_full(url) {
  const [disk, ledger, network, memory_check] = await Promise.allSettled([
    Promise.resolve(op_disk()),
    Promise.resolve(op_ledger()),
    op_network(url || 'https://api.github.com'),
    Promise.resolve(op_memory_check()),
  ]);

  const checks = {
    disk:    disk.status === 'fulfilled'    ? disk.value    : { ok: false, error: disk.reason?.message },
    ledger:  ledger.status === 'fulfilled'  ? ledger.value  : { ok: false, error: ledger.reason?.message },
    network: network.status === 'fulfilled' ? network.value : { ok: false, error: network.reason?.message },
    memory:  memory_check.status === 'fulfilled' ? memory_check.value : { ok: false },
  };

  const all_ok = Object.values(checks).every(c => c.ok !== false);
  return { healthy: all_ok, uptime_s: Math.floor(process.uptime()), checks };
}

function op_disk() {
  const testFile = path.join(DATA_DIR, '.health');
  let writable = false;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(testFile, '1', 'utf-8');
    fs.unlinkSync(testFile);
    writable = true;
  } catch (e) {
    return { ok: false, writable: false, error: e.message };
  }
  return { ok: true, writable, data_dir: DATA_DIR };
}

function op_ledger() {
  if (!fs.existsSync(LEDGER)) return { ok: true, exists: false, entries: 0 };
  const raw = fs.readFileSync(LEDGER, 'utf-8').trim();
  const lines = raw ? raw.split('\n').filter(Boolean) : [];
  let corrupt = 0;
  for (const line of lines) {
    try { JSON.parse(line); } catch { corrupt++; }
  }
  return { ok: corrupt === 0, exists: true, entries: lines.length, corrupt_lines: corrupt };
}

function op_network(url) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = https.get(url, { headers: { 'User-Agent': 'SCRIBE/1.0' }, timeout: 5000 }, res => {
      res.resume(); // drain
      resolve({ ok: true, url, status: res.statusCode, latency_ms: Date.now() - start });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, url, error: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, url, error: e.message }));
  });
}

function op_memory_check() {
  const proc = process.memoryUsage();
  return {
    ok: true,
    scribe_entries: _memory ? _memory.size : null,
    heap_used_mb: +(proc.heapUsed / 1024 / 1024).toFixed(2),
    heap_total_mb: +(proc.heapTotal / 1024 / 1024).toFixed(2),
    rss_mb: +(proc.rss / 1024 / 1024).toFixed(2),
  };
}

module.exports = { MANIFEST, run, setMemory };
