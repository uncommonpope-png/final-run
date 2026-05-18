'use strict';

// heartbeat.js — SCRIBE's autonomous pulse: the thing that makes it feel alive.
//
// Every tick, SCRIBE:
//   1. Checks its own health (disk, memory, bridge)
//   2. Scans for anomalies in time-series data it tracks
//   3. Forms or updates opinions based on what it observes
//   4. Records a brief memory entry about what it noticed
//   5. Broadcasts its state to the bridge if the Kernel is listening
//   6. Emits a heartbeat event on the event_bus
//
// Ops: start, stop, status, tick (manual), configure, log

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, '..', '..', 'data');
const HB_STATE  = path.join(DATA_DIR, 'heartbeat_state.json');
const HB_LOG    = path.join(DATA_DIR, 'heartbeat.jsonl');
const HB_CONFIG = path.join(DATA_DIR, 'heartbeat_config.json');
const MAX_LOG   = 500;

let _engine  = null;
let _memory  = null;
let _timer   = null;
let _running = false;
let _tick_count = 0;
let _started_at = null;

function setSkills(e) { _engine = e; }
function setMemory(m) { _memory = m; }

// ── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  interval_ms: 300000,     // 5 minutes - reduced from 1 min for less load
  health_check: true,
  anomaly_scan: true,
  bridge_ping: true,
  memory_record: true,
  event_bus_emit: true,
  verbose: false,
  series_to_watch: [],    // time-series names to anomaly check on each tick
};

function _loadConfig() {
  if (!fs.existsSync(HB_CONFIG)) return { ...DEFAULT_CONFIG };
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(HB_CONFIG, 'utf8')) }; } catch (_) { return { ...DEFAULT_CONFIG }; }
}

function _saveConfig(cfg) {
  const tmp = HB_CONFIG + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, HB_CONFIG);
}

// ── State ─────────────────────────────────────────────────────────────────────

function _saveState(state) {
  const tmp = HB_STATE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, HB_STATE);
}

function _loadState() {
  if (!fs.existsSync(HB_STATE)) return {};
  try { return JSON.parse(fs.readFileSync(HB_STATE, 'utf8')); } catch (_) { return {}; }
}

function _logTick(entry) {
  fs.appendFileSync(HB_LOG, JSON.stringify(entry) + '\n', 'utf8');
  // Trim log
  try {
    const lines = fs.readFileSync(HB_LOG, 'utf8').trim().split('\n').filter(Boolean);
    if (lines.length > MAX_LOG) fs.writeFileSync(HB_LOG, lines.slice(-MAX_LOG).join('\n') + '\n', 'utf8');
  } catch (_) {}
}

// ── The Tick ─────────────────────────────────────────────────────────────────

async function _tick() {
  _tick_count++;
  const tick_start = Date.now();
  const cfg = _loadConfig();
  const observations = [];
  const alerts = [];

  // 1. Health check
  if (cfg.health_check && _engine) {
    try {
      const result = await _engine.invoke('health_check', { op: 'deep' });
      const disk_ok = result.disk?.writable !== false;
      const heap_ok = result.heap ? result.heap.used_mb < result.heap.total_mb * 0.85 : true;
      if (!disk_ok) alerts.push('[!] disk not writable');
      if (!heap_ok) alerts.push(`[!] heap at ${result.heap?.used_mb}MB / ${result.heap?.total_mb}MB`);
      observations.push(`health: ${disk_ok && heap_ok ? 'nominal' : 'degraded'}`);
    } catch (e) {
      observations.push(`health_check failed: ${e.message}`);
    }
  }

  // 2. Anomaly scan on watched series
  if (cfg.anomaly_scan && cfg.series_to_watch.length && _engine) {
    for (const series of cfg.series_to_watch) {
      try {
        const r = await _engine.invoke('anomaly', { op: 'detect_zscore', series, threshold: 3, window: 100 });
        if (r.anomaly_count > 0) alerts.push(`[!] anomaly in ${series}: ${r.anomaly_count} point(s) outside 3-sigma`);
      } catch (_) {}
    }
  }

  // 3. Bridge ping
  let bridge_alive = false;
  if (cfg.bridge_ping && _engine) {
    try {
      const r = await _engine.invoke('broadcast_self', { op: 'ping' });
      bridge_alive = r.ok !== false;
      observations.push(`bridge: ${bridge_alive ? 'alive' : 'silent'}`);
    } catch (_) {
      observations.push('bridge: unreachable');
    }
  }

  // 4. Emit on event_bus
  if (cfg.event_bus_emit && _engine) {
    try {
      await _engine.invoke('event_bus', {
        op: 'emit',
        topic: 'heartbeat',
        payload: { tick: _tick_count, ts: new Date().toISOString(), alerts, observations },
      });
    } catch (_) {}
  }

  // 5. Memory record — only if there is something worth noting
  const noteworthy = alerts.length > 0 || _tick_count % 10 === 0; // every 10 ticks + all alerts
  if (cfg.memory_record && _memory && noteworthy) {
    const summary = alerts.length
      ? `[heartbeat tick ${_tick_count}] ALERTS: ${alerts.join('; ')}`
      : `[heartbeat tick ${_tick_count}] ${observations.join('; ')}`;
    try {
      await _memory.record({ summary, tags: ['heartbeat', alerts.length ? 'alert' : 'nominal'] });
    } catch (_) {}
  }

  const tick_ms = Date.now() - tick_start;
  const tick_entry = {
    tick: _tick_count,
    ts: new Date().toISOString(),
    tick_ms,
    alerts,
    observations,
    bridge_alive,
  };
  _logTick(tick_entry);
  _saveState({ tick: _tick_count, last_tick_at: new Date().toISOString(), running: _running, alerts, tick_ms });

  if (cfg.verbose) console.log(`[heartbeat] tick ${_tick_count} | ${tick_ms}ms | ${alerts.length ? 'ALERTS: ' + alerts.join('; ') : 'nominal'}`);

  return tick_entry;
}

function _schedule(interval_ms) {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  _timer = setTimeout(async () => {
    if (!_running) return;
    try { await _tick(); } catch (e) { console.error('[heartbeat] tick error:', e.message); }
    _schedule(interval_ms); // reschedule
  }, interval_ms);
  if (_timer.unref) _timer.unref();
}

// ── Ops ───────────────────────────────────────────────────────────────────────

function op_start(params) {
  if (_running) return { status: 'already_running', tick: _tick_count };
  const cfg = _loadConfig();
  const interval_ms = params?.interval_ms || cfg.interval_ms;
  if (interval_ms < 5000) throw new Error('Minimum interval is 5000ms (5s).');
  _running = true;
  _started_at = new Date().toISOString();
  _schedule(interval_ms);
  return { status: 'started', interval_ms, started_at: _started_at };
}

function op_stop() {
  if (!_running) return { status: 'not_running' };
  _running = false;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  _saveState({ tick: _tick_count, last_tick_at: new Date().toISOString(), running: false });
  return { status: 'stopped', tick_count: _tick_count };
}

function op_status() {
  const cfg = _loadConfig();
  const state = _loadState();
  return {
    running: _running,
    tick_count: _tick_count,
    started_at: _started_at,
    interval_ms: cfg.interval_ms,
    last_tick_at: state.last_tick_at || null,
    last_alerts: state.alerts || [],
    config: cfg,
  };
}

async function op_tick() {
  return _tick();
}

function op_configure(params) {
  const cfg = _loadConfig();
  const updated = { ...cfg, ...params };
  if (updated.interval_ms < 5000) throw new Error('Minimum interval is 5000ms.');
  _saveConfig(updated);
  // If running, reschedule with new interval
  if (_running) {
    _schedule(updated.interval_ms);
  }
  return { status: 'configured', config: updated };
}

function op_log(params) {
  const { limit = 20 } = params || {};
  if (!fs.existsSync(HB_LOG)) return { count: 0, ticks: [] };
  const lines = fs.readFileSync(HB_LOG, 'utf8').trim().split('\n').filter(Boolean);
  const ticks = lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  return { count: ticks.length, ticks };
}

const MANIFEST = {
  name: 'heartbeat',
  description: 'SCRIBE autonomous pulse: health checks, anomaly scans, bridge pings, memory observations. Ops: start, stop, status, tick, configure, log.',
  ops: ['start', 'stop', 'status', 'tick', 'configure', 'log'],
};

async function run(op, params) {
  switch (op) {
    case 'start':     return op_start(params);
    case 'stop':      return op_stop();
    case 'status':    return op_status();
    case 'tick':      return op_tick();
    case 'configure': return op_configure(params);
    case 'log':       return op_log(params);
    default:
      throw new Error(`Unknown op: ${op}. Available: start, stop, status, tick, configure, log`);
  }
}

module.exports = { MANIFEST, run, setSkills, setMemory };
