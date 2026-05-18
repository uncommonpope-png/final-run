'use strict';

/**
 * SKILL: watchdog
 *
 * SCRIBE monitors itself.
 * Tracks memory growth rate, ledger size, failed skill invocations,
 * bridge silence duration, disk usage, and anomalous patterns.
 * When something looks wrong, SCRIBE records it and can alert via alert_router.
 *
 * Operations:
 *   check       — run all watchdog checks and return a health report
 *   memory_growth — check if memory is growing faster than expected
 *   skill_failures — check for recent skill failure spikes
 *   bridge_silence — check if bridge has been silent too long
 *   ledger_size   — check ledger file size
 *   disk_usage    — check data directory disk usage
 *   set_threshold — set a named threshold value
 *   get_thresholds— list current thresholds
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR    = path.join(__dirname, '..', '..', 'data');
const LEDGER_FILE = path.join(DATA_DIR, 'ledger.jsonl');
const AUDIT_FILE  = path.join(DATA_DIR, 'skills_audit.jsonl');
const BRIDGE_FILE = path.join(DATA_DIR, 'bridge.jsonl');
const STATE_FILE  = path.join(DATA_DIR, 'state.json');
const WD_FILE     = path.join(DATA_DIR, 'watchdog_state.json');

const MANIFEST = {
  name: 'watchdog',
  description: 'SCRIBE monitors itself: memory growth, skill failures, bridge silence, ledger size, disk health.',
  version: '1.0.0',
  inputs: {
    op:        { type: 'string', required: true,  description: '"check"|"memory_growth"|"skill_failures"|"bridge_silence"|"ledger_size"|"disk_usage"|"set_threshold"|"get_thresholds"' },
    key:       { type: 'string', required: false, description: 'Threshold key (set_threshold)' },
    value:     { type: 'number', required: false, description: 'Threshold value (set_threshold)' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any',
    error:  'string',
    ts:     'string',
  },
};

// Default thresholds — override with set_threshold
const DEFAULT_THRESHOLDS = {
  max_ledger_mb:           50,    // alert if ledger > 50MB
  max_memory_entries:      10000, // alert if >10k entries
  memory_growth_per_hour:  200,   // alert if >200 new entries/hour
  skill_failure_pct:       30,    // alert if >30% of recent skill calls failed
  skill_failure_window:    50,    // look at last N audit entries
  bridge_silence_minutes:  60,    // alert if bridge hasn't received in 60min
  data_dir_max_mb:         200,   // alert if data dir > 200MB
};

let _memory = null;
function setMemory(m) { _memory = m; }

function load_thresholds() {
  try {
    if (fs.existsSync(WD_FILE)) {
      const saved = JSON.parse(fs.readFileSync(WD_FILE, 'utf-8'));
      return { ...DEFAULT_THRESHOLDS, ...(saved.thresholds || {}) };
    }
  } catch { /* use defaults */ }
  return { ...DEFAULT_THRESHOLDS };
}

function save_thresholds(thresholds) {
  const dir = path.dirname(WD_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(WD_FILE, 'utf-8')); } catch { /* ok */ }
  fs.writeFileSync(WD_FILE, JSON.stringify({ ...existing, thresholds }, null, 2), 'utf-8');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run({ op, key, value }) {
  const ts = new Date().toISOString();
  try {
    const T = load_thresholds();
    let result;
    switch (op) {
      case 'check':           result = op_check(T);                       break;
      case 'memory_growth':   result = op_memory_growth(T);               break;
      case 'skill_failures':  result = op_skill_failures(T);              break;
      case 'bridge_silence':  result = op_bridge_silence(T);              break;
      case 'ledger_size':     result = op_ledger_size(T);                 break;
      case 'disk_usage':      result = op_disk_usage(T);                  break;
      case 'set_threshold':   result = op_set_threshold(key, value, T);  break;
      case 'get_thresholds':  result = { thresholds: T };                 break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

// ── Checks ────────────────────────────────────────────────────────────────────

function op_check(T) {
  const checks = {
    memory_growth:  op_memory_growth(T),
    skill_failures: op_skill_failures(T),
    bridge_silence: op_bridge_silence(T),
    ledger_size:    op_ledger_size(T),
    disk_usage:     op_disk_usage(T),
  };

  const warnings = Object.entries(checks).filter(([, c]) => c.warning).map(([name, c]) => ({ name, message: c.message }));
  const healthy = warnings.length === 0;

  return {
    healthy,
    warning_count: warnings.length,
    warnings,
    checks,
    uptime_s: Math.floor(process.uptime()),
    checked_at: new Date().toISOString(),
  };
}

function op_memory_growth(T) {
  if (!_memory) return { ok: true, warning: false, note: 'Memory not wired' };

  const size = _memory.size;
  const tooLarge = size > T.max_memory_entries;

  // Estimate growth rate from audit file timestamps
  let growth_per_hour = null;
  try {
    const raw = fs.readFileSync(LEDGER_FILE, 'utf-8').trim();
    const lines = raw ? raw.split('\n').filter(Boolean) : [];
    const one_hour_ago = new Date(Date.now() - 3600000).toISOString();
    const recent = lines.filter(l => {
      try { return JSON.parse(l).ts > one_hour_ago; } catch { return false; }
    });
    growth_per_hour = recent.length;
  } catch { /* ok */ }

  const tooFast = growth_per_hour !== null && growth_per_hour > T.memory_growth_per_hour;
  const warning = tooLarge || tooFast;

  return {
    ok: !warning,
    warning,
    memory_size: size,
    max_entries: T.max_memory_entries,
    growth_last_hour: growth_per_hour,
    max_growth_per_hour: T.memory_growth_per_hour,
    message: warning
      ? (tooLarge ? `Memory has ${size} entries (limit: ${T.max_memory_entries})` : `Memory grew ${growth_per_hour} entries in last hour (limit: ${T.memory_growth_per_hour})`)
      : 'Memory growth normal',
  };
}

function op_skill_failures(T) {
  if (!fs.existsSync(AUDIT_FILE)) return { ok: true, warning: false, note: 'No audit file yet' };

  const raw = fs.readFileSync(AUDIT_FILE, 'utf-8').trim();
  if (!raw) return { ok: true, warning: false, note: 'No audit entries yet' };

  const entries = raw.split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .slice(-T.skill_failure_window);

  const failures = entries.filter(e => !e.ok);
  const failure_pct = entries.length ? +(failures.length / entries.length * 100).toFixed(1) : 0;
  const warning = failure_pct > T.skill_failure_pct;

  const by_skill = {};
  for (const e of failures) by_skill[e.skill] = (by_skill[e.skill] || 0) + 1;

  return {
    ok: !warning,
    warning,
    checked_entries: entries.length,
    failure_count: failures.length,
    failure_pct,
    max_failure_pct: T.skill_failure_pct,
    top_failing_skills: Object.entries(by_skill).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ skill: k, failures: v })),
    message: warning ? `${failure_pct}% of recent skill calls failed (limit: ${T.skill_failure_pct}%)` : 'Skill failure rate normal',
  };
}

function op_bridge_silence(T) {
  if (!fs.existsSync(BRIDGE_FILE)) return { ok: true, warning: false, note: 'No bridge file yet — normal if Kernel not connected' };

  const raw = fs.readFileSync(BRIDGE_FILE, 'utf-8').trim();
  if (!raw) return { ok: true, warning: false, note: 'Bridge file empty' };

  const lines = raw.split('\n').filter(Boolean);
  const last_entry = (() => {
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const e = JSON.parse(lines[i]);
        if (e.direction === 'inbound') return e;
      } catch { /* skip */ }
    }
    return null;
  })();

  if (!last_entry) return { ok: true, warning: false, note: 'No inbound bridge messages yet' };

  const last_ts = last_entry.received_at || last_entry.ts;
  const silence_minutes = last_ts ? (Date.now() - new Date(last_ts).getTime()) / 60000 : null;
  const warning = silence_minutes !== null && silence_minutes > T.bridge_silence_minutes;

  return {
    ok: !warning,
    warning,
    last_inbound: last_ts,
    silence_minutes: silence_minutes !== null ? +silence_minutes.toFixed(1) : null,
    max_silence_minutes: T.bridge_silence_minutes,
    message: warning
      ? `Bridge has been silent for ${silence_minutes?.toFixed(0)} minutes (limit: ${T.bridge_silence_minutes})`
      : 'Bridge communication normal',
  };
}

function op_ledger_size(T) {
  if (!fs.existsSync(LEDGER_FILE)) return { ok: true, warning: false, size_mb: 0 };
  const stat = fs.statSync(LEDGER_FILE);
  const size_mb = +(stat.size / 1024 / 1024).toFixed(3);
  const warning = size_mb > T.max_ledger_mb;
  return {
    ok: !warning,
    warning,
    size_mb,
    max_mb: T.max_ledger_mb,
    message: warning ? `Ledger is ${size_mb}MB (limit: ${T.max_ledger_mb}MB)` : 'Ledger size normal',
  };
}

function op_disk_usage(T) {
  if (!fs.existsSync(DATA_DIR)) return { ok: true, warning: false, total_mb: 0 };
  let total = 0;
  try {
    const files = fs.readdirSync(DATA_DIR);
    for (const f of files) {
      try { total += fs.statSync(path.join(DATA_DIR, f)).size; } catch { /* skip */ }
    }
  } catch { /* ok */ }
  const total_mb = +(total / 1024 / 1024).toFixed(3);
  const warning = total_mb > T.data_dir_max_mb;
  return {
    ok: !warning,
    warning,
    total_mb,
    max_mb: T.data_dir_max_mb,
    message: warning ? `Data directory is ${total_mb}MB (limit: ${T.data_dir_max_mb}MB)` : 'Disk usage normal',
  };
}

function op_set_threshold(key, value, current) {
  if (!key)           throw new Error('key is required');
  if (value === undefined) throw new Error('value is required');
  if (!(key in DEFAULT_THRESHOLDS)) throw new Error(`Unknown threshold key: ${key}. Valid: ${Object.keys(DEFAULT_THRESHOLDS).join(', ')}`);
  current[key] = value;
  save_thresholds(current);
  return { key, value, saved: true };
}

module.exports = { MANIFEST, run, setMemory };
