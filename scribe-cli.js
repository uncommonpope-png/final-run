#!/usr/bin/env node
'use strict';

/**
 * scribe-cli.js — Command-line client for SCRIBE
 *
 * Usage:
 *   node scribe-cli.js [host] [command]
 *
 * Examples:
 *   node scribe-cli.js                              # interactive REPL
 *   node scribe-cli.js health                       # health check
 *   node scribe-cli.js profit_brain.status          # invoke a skill
 *   node scribe-cli.js market.fetch_price '{"symbol":"BTC"}'
 *   node scribe-cli.js aria.handshake
 *
 * Environment:
 *   SCRIBE_URL     — default http://localhost:4000
 *   SCRIBE_API_KEY — optional API key
 */

const http    = require('http');
const https   = require('https');
const readline = require('readline');

const BASE_URL = process.env.SCRIBE_URL || 'http://localhost:4000';
const API_KEY  = process.env.SCRIBE_API_KEY || '';

// ── colors (no deps) ─────────────────────────────────────────────────────────
const C = {
  pink:   s => `\x1b[35m${s}\x1b[0m`,
  pink2:  s => `\x1b[95m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  amber:  s => `\x1b[33m${s}\x1b[0m`,
  dim:    s => `\x1b[90m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  reset:  s => `\x1b[0m${s}\x1b[0m`
};

// ── HTTP ─────────────────────────────────────────────────────────────────────
function request(method, path, body, { timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const url  = new URL(BASE_URL + path);
    const lib  = url.protocol === 'https:' ? https : http;
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (API_KEY) headers['X-API-Key'] = API_KEY;
    if (data)   headers['Content-Length'] = Buffer.byteLength(data);

    const req = lib.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method, headers, timeout
    }, res => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(out) }); }
        catch { resolve({ status: res.statusCode, body: out }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

async function invoke(skill, op, args = {}) {
  return request('POST', '/invoke', { skill, op, ...args });
}

// ── output ───────────────────────────────────────────────────────────────────
function print(data) {
  if (typeof data === 'object') {
    console.log(C.pink2(JSON.stringify(data, null, 2)));
  } else {
    console.log(data);
  }
}

function ts() {
  return C.dim(new Date().toTimeString().slice(0,8));
}

// ── parse command ─────────────────────────────────────────────────────────────
async function runCommand(input) {
  const raw = input.trim();
  if (!raw || raw.startsWith('#')) return;

  // Slash commands
  if (raw.startsWith('/')) {
    const parts = raw.slice(1).split(' ');
    switch (parts[0]) {
      case 'help':
        console.log(C.pink('\nSCRIBE CLI'));
        console.log(C.dim('─'.repeat(40)));
        console.log('skill.op {json}        invoke any skill');
        console.log('/health                SCRIBE health');
        console.log('/skills                list all skills');
        console.log('/memory [n]            recent memory entries');
        console.log('/market SYMBOL         auto-signal');
        console.log('/profit                profit_brain status');
        console.log('/aria                  handshake with ARIA');
        console.log('/ping                  ping SCRIBE');
        console.log('/exit                  quit');
        console.log(C.dim('─'.repeat(40)));
        return;
      case 'health': {
        const r = await request('GET', '/health');
        print(r.body); return;
      }
      case 'ping': {
        const r = await request('GET', '/ping');
        print(r.body); return;
      }
      case 'skills': {
        const r = await request('GET', '/skills');
        const list = (r.body.skills || []);
        list.forEach(s => console.log(`  ${C.pink(s.name.padEnd(20))} ${C.dim(s.description || '')}`));
        console.log(C.dim(`\n${list.length} skills`));
        return;
      }
      case 'memory': {
        const n = parseInt(parts[1]) || 20;
        const r = await invoke('memory_query', 'recent', { limit: n });
        print(r.body); return;
      }
      case 'market': {
        if (!parts[1]) { console.log(C.red('/market SYMBOL required')); return; }
        const r = await invoke('market', 'auto_signal', { symbol: parts[1].toUpperCase() });
        print(r.body); return;
      }
      case 'profit': {
        const r = await invoke('profit_brain', 'status', {});
        print(r.body); return;
      }
      case 'aria': {
        const r = await invoke('aria', 'handshake', {});
        print(r.body); return;
      }
      case 'exit': case 'quit':
        console.log(C.pink('\nSCRIBE — signing off.\n'));
        process.exit(0);
        return;
      default:
        console.log(C.red(`Unknown command: ${raw}`));
        return;
    }
  }

  // skill.op {json}
  const match = raw.match(/^(\w+)\.(\w+)\s*([\s\S]*)$/);
  if (!match) {
    console.log(C.red('Format: skill.op {"key":"val"}  or  /help'));
    return;
  }
  const [, skill, op, argStr] = match;
  let args = {};
  if (argStr.trim()) {
    try { args = JSON.parse(argStr.trim()); }
    catch { console.log(C.red('JSON parse error')); return; }
  }

  process.stdout.write(C.dim(`${ts()} ${skill}.${op} ... `));
  try {
    const r = await invoke(skill, op, args);
    process.stdout.write('\n');
    if (r.body && r.body.error) {
      console.log(C.red(`[ERROR] ${r.body.error}`));
    } else {
      print(r.body);
    }
  } catch (e) {
    process.stdout.write('\n');
    console.log(C.red(`Request failed: ${e.message}`));
  }
}

// ── REPL ─────────────────────────────────────────────────────────────────────
async function repl() {
  // Check SCRIBE is up
  try {
    await request('GET', '/ping', null, { timeout: 3000 });
  } catch {
    console.log(C.red(`\n[!] SCRIBE not reachable at ${BASE_URL}`));
    console.log(C.dim('    Start SCRIBE with: node scribe.js\n'));
    process.exit(1);
  }

  console.log('');
  console.log(C.pink('╔═══════════════════════════════════╗'));
  console.log(C.pink('║  SCRIBE  CLI                      ║'));
  console.log(C.pink('╚═══════════════════════════════════╝'));
  console.log(C.dim(`   ${BASE_URL}   /help for commands`));
  console.log('');

  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
    prompt: C.pink('SCRIBE> ')
  });

  rl.prompt();
  rl.on('line', async line => {
    await runCommand(line);
    rl.prompt();
  });
  rl.on('close', () => {
    console.log(C.pink('\nSCRIBE — signing off.\n'));
    process.exit(0);
  });
}

// ── ENTRY ────────────────────────────────────────────────────────────────────
(async () => {
  const args = process.argv.slice(2);

  // Single command mode: node scribe-cli.js skill.op '{"k":"v"}'
  if (args.length) {
    const cmd  = args[0];
    const json = args[1] || '{}';

    // bare commands
    if (cmd === 'health') {
      const r = await request('GET', '/health').catch(e => ({ body: { error: e.message } }));
      print(r.body); process.exit(0);
    }
    if (cmd === 'ping') {
      const r = await request('GET', '/ping').catch(e => ({ body: { error: e.message } }));
      print(r.body); process.exit(0);
    }
    if (cmd === 'skills') {
      const r = await request('GET', '/skills').catch(e => ({ body: { error: e.message } }));
      (r.body.skills || []).forEach(s => console.log(`${s.name.padEnd(20)} ${s.description || ''}`));
      process.exit(0);
    }

    // skill.op
    const match = cmd.match(/^(\w+)\.(\w+)$/);
    if (match) {
      const [, skill, op] = match;
      let invokeArgs = {};
      try { invokeArgs = JSON.parse(json); } catch { console.error('Invalid JSON args'); process.exit(1); }
      const r = await invoke(skill, op, invokeArgs).catch(e => ({ body: { error: e.message } }));
      print(r.body);
      process.exit(r.body && r.body.error ? 1 : 0);
    }

    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
  }

  // Interactive mode
  await repl();
})();
