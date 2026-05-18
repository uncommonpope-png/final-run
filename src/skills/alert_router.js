'use strict';

/**
 * SKILL: alert_router
 *
 * Active delivery of pattern_watch alerts and any SCRIBE-generated alert.
 * Routes alerts to one or more destinations: Telegram, HTTP webhook, bridge
 * (to the Kernel), local file, or memory record.
 *
 * This is the missing link between pattern_watch detecting something and
 * someone actually being notified about it.
 *
 * Operations:
 *   route       — route a single alert payload to configured destinations
 *   add_route   — register a named route (destination config)
 *   remove_route— remove a named route
 *   list_routes — list all registered routes
 *   flush       — read undelivered alerts from pattern_alerts.jsonl and route them all
 *   test        — send a test alert through a named route
 */

'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');

const ALERTS_FILE  = path.join(__dirname, '..', '..', 'data', 'pattern_alerts.jsonl');
const ROUTED_FILE  = path.join(__dirname, '..', '..', 'data', 'routed_alerts.jsonl');
const ROUTES_FILE  = path.join(__dirname, '..', '..', 'data', 'alert_routes.json');

const MANIFEST = {
  name: 'alert_router',
  description: 'Route SCRIBE alerts to Telegram, webhooks, the Kernel bridge, or memory. Flush undelivered alerts.',
  version: '1.0.0',
  inputs: {
    op:          { type: 'string', required: true,  description: '"route"|"add_route"|"remove_route"|"list_routes"|"flush"|"test"' },
    alert:       { type: 'object', required: false, description: 'Alert payload to route (route op)' },
    route_name:  { type: 'string', required: false, description: 'Named route to use/remove/test' },
    destination: { type: 'object', required: false, description: 'Destination config: { type, ...params }' },
    limit:       { type: 'number', required: false, description: 'Max alerts to flush (flush op, default 50)' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any',
    error:  'string',
    ts:     'string',
  },
};

// In-memory route registry (also persisted to disk)
let _routes = null;
let _memory = null;

function setMemory(m) { _memory = m; }

function load_routes() {
  if (_routes) return _routes;
  try {
    if (fs.existsSync(ROUTES_FILE)) {
      _routes = JSON.parse(fs.readFileSync(ROUTES_FILE, 'utf-8'));
    } else {
      _routes = {};
    }
  } catch { _routes = {}; }
  return _routes;
}

function save_routes() {
  const dir = path.dirname(ROUTES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ROUTES_FILE, JSON.stringify(_routes, null, 2), 'utf-8');
}

function ensure_routed_file() {
  const dir = path.dirname(ROUTED_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(ROUTED_FILE)) fs.writeFileSync(ROUTED_FILE, '', 'utf-8');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run({ op, alert: alertPayload, route_name, destination, limit = 50 }) {
  const ts = new Date().toISOString();
  load_routes();
  ensure_routed_file();
  try {
    let result;
    switch (op) {
      case 'route':        result = await op_route(alertPayload);                  break;
      case 'add_route':    result = op_add_route(route_name, destination);         break;
      case 'remove_route': result = op_remove_route(route_name);                   break;
      case 'list_routes':  result = op_list_routes();                              break;
      case 'flush':        result = await op_flush(limit);                         break;
      case 'test':         result = await op_test(route_name);                     break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

// ── Operations ────────────────────────────────────────────────────────────────

async function op_route(alertPayload) {
  if (!alertPayload) throw new Error('alert is required');
  const routes = Object.values(_routes);
  if (!routes.length) return { routed: 0, note: 'No routes configured. Use add_route to register destinations.' };

  const results = [];
  for (const route of routes) {
    const r = await deliver(route, alertPayload);
    results.push({ route: route.name, ...r });
  }

  // Record delivery in routed_alerts.jsonl
  const entry = { ts: new Date().toISOString(), alert: alertPayload, deliveries: results };
  fs.appendFileSync(ROUTED_FILE, JSON.stringify(entry) + '\n', 'utf-8');

  return { routed: results.filter(r => r.ok).length, total_routes: routes.length, results };
}

function op_add_route(name, destination) {
  if (!name)        throw new Error('route_name is required');
  if (!destination) throw new Error('destination is required');
  if (!destination.type) throw new Error('destination.type is required (telegram|webhook|bridge|memory|file)');
  _routes[name] = { name, ...destination, added_at: new Date().toISOString() };
  save_routes();
  return { added: name, destination: _routes[name] };
}

function op_remove_route(name) {
  if (!name) throw new Error('route_name is required');
  if (!_routes[name]) throw new Error(`Route not found: ${name}`);
  delete _routes[name];
  save_routes();
  return { removed: name };
}

function op_list_routes() {
  const routes = Object.values(_routes);
  return { count: routes.length, routes: routes.map(r => ({ name: r.name, type: r.type, added_at: r.added_at })) };
}

async function op_flush(limit) {
  if (!fs.existsSync(ALERTS_FILE)) return { flushed: 0, note: 'No alerts file found' };

  const raw = fs.readFileSync(ALERTS_FILE, 'utf-8').trim();
  if (!raw) return { flushed: 0, note: 'No alerts to flush' };

  const alerts = raw.split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .slice(-limit);

  let routed = 0;
  for (const alert of alerts) {
    const r = await op_route(alert);
    if (r.routed > 0) routed++;
  }

  return { flushed: alerts.length, successfully_routed: routed };
}

async function op_test(route_name) {
  const test_alert = {
    id: `test_${Date.now()}`,
    watcher_name: 'test',
    pattern: 'test',
    memory_summary: 'This is a test alert from SCRIBE alert_router.',
    fired_at: new Date().toISOString(),
    is_test: true,
  };

  if (route_name) {
    const route = _routes[route_name];
    if (!route) throw new Error(`Route not found: ${route_name}`);
    const r = await deliver(route, test_alert);
    return { route: route_name, ...r };
  }

  // Test all routes
  const results = [];
  for (const route of Object.values(_routes)) {
    const r = await deliver(route, test_alert);
    results.push({ route: route.name, ...r });
  }
  return { tested: results.length, results };
}

// ── Delivery ──────────────────────────────────────────────────────────────────

async function deliver(route, alert) {
  try {
    switch (route.type) {
      case 'telegram': return await deliver_telegram(route, alert);
      case 'webhook':  return await deliver_webhook(route, alert);
      case 'bridge':   return await deliver_bridge(route, alert);
      case 'memory':   return deliver_memory(route, alert);
      case 'file':     return deliver_file(route, alert);
      default: return { ok: false, error: `Unknown destination type: ${route.type}` };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function deliver_telegram(route, alert) {
  const token = route.token || process.env.TELEGRAM_BOT_TOKEN;
  const chat_id = route.chat_id || process.env.TELEGRAM_CHAT_ID;
  if (!token) throw new Error('telegram route requires token or TELEGRAM_BOT_TOKEN env var');
  if (!chat_id) throw new Error('telegram route requires chat_id or TELEGRAM_CHAT_ID env var');

  const text = [
    `[SCRIBE ALERT]`,
    `Pattern: ${alert.pattern || alert.watcher_name || 'unknown'}`,
    `Match: ${(alert.memory_summary || '').slice(0, 200)}`,
    `Time: ${alert.fired_at || new Date().toISOString()}`,
  ].join('\n');

  return await http_post_json(
    `https://api.telegram.org/bot${token}/sendMessage`,
    { chat_id: String(chat_id), text, parse_mode: 'HTML' }
  );
}

async function deliver_webhook(route, alert) {
  if (!route.url) throw new Error('webhook route requires url');
  return await http_post_json(route.url, {
    source: 'SCRIBE',
    alert,
    ts: new Date().toISOString(),
  });
}

async function deliver_bridge(route, alert) {
  const endpoint = route.endpoint || process.env.KERNEL_ENDPOINT;
  if (!endpoint) throw new Error('bridge route requires endpoint or KERNEL_ENDPOINT env var');
  return await http_post_json(endpoint + '/scribe/alert', {
    type: 'scribe_alert',
    source: 'SCRIBE',
    alert,
    ts: new Date().toISOString(),
  });
}

function deliver_memory(route, alert) {
  if (!_memory) return { ok: false, error: 'Memory not available — setMemory() not called' };
  _memory.record({
    type: 'observation',
    summary: `Alert routed to memory: pattern "${alert.pattern || alert.watcher_name}" matched — "${(alert.memory_summary || '').slice(0, 100)}"`,
    tags: ['alert', 'routed', alert.watcher_id || 'unknown'],
    weight: 0.7,
    source: { system: 'SCRIBE', chamber: 'alert_router' },
  });
  return { ok: true };
}

function deliver_file(route, alert) {
  const filePath = route.file || path.join(__dirname, '..', '..', 'data', 'delivered_alerts.jsonl');
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify({ ...alert, routed_at: new Date().toISOString() }) + '\n', 'utf-8');
  return { ok: true, file: filePath };
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

function http_post_json(url, body) {
  return new Promise((resolve) => {
    try {
      const data = JSON.stringify(body);
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + (parsed.search || ''),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'User-Agent': 'SCRIBE/1.0' },
        timeout: 10000,
      }, res => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode }));
      });
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.on('error', e => resolve({ ok: false, error: e.message }));
      req.write(data);
      req.end();
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

module.exports = { MANIFEST, run, setMemory };
