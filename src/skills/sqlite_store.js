'use strict';

// sqlite_store.js — Structured key-value + table storage backed by SQLite CLI
// Falls back to a pure JSONL store when sqlite3 binary is not available.
// Zero npm dependencies — uses child_process to call the sqlite3 CLI.
// Ops: create_table, insert, query, delete_rows, drop_table, list_tables, exec, kv_set, kv_get, kv_del, kv_list

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_FILE  = path.join(DATA_DIR, 'scribe_store.db');
const FALLBACK = path.join(DATA_DIR, 'scribe_store_fallback.jsonl');

// ── SQLite availability ───────────────────────────────────────────────────────

function _hasSqlite() {
  try {
    const r = spawnSync('sqlite3', ['--version'], { encoding: 'utf8', timeout: 3000 });
    return r.status === 0;
  } catch (_) { return false; }
}

const USE_SQLITE = _hasSqlite();

function _sql(statement) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const r = spawnSync('sqlite3', [DB_FILE, statement], { encoding: 'utf8', timeout: 10000 });
  if (r.error) throw new Error(`sqlite3 exec error: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`sqlite3 error: ${(r.stderr || '').trim()}`);
  return (r.stdout || '').trim();
}

function _sqlRows(statement) {
  const raw = _sql(statement + ' -- format json');
  // sqlite3 doesn't output JSON by default; parse pipe-separated output
  // Use .mode csv approach: re-run with csv flag
  const r = spawnSync('sqlite3', ['-csv', DB_FILE, statement], { encoding: 'utf8', timeout: 10000 });
  if (r.error) throw new Error(`sqlite3 exec error: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`sqlite3 error: ${(r.stderr || '').trim()}`);
  // Parse CSV output into rows
  const lines = (r.stdout || '').trim().split('\n').filter(Boolean);
  return lines.map(line => {
    // Simple CSV split (no embedded commas/quotes in values assumed for internal use)
    return line.split(',').map(v => v.replace(/^"|"$/g, ''));
  });
}

// ── Fallback store (JSONL) ────────────────────────────────────────────────────

function _fbLoad() {
  if (!fs.existsSync(FALLBACK)) return [];
  return fs.readFileSync(FALLBACK, 'utf8').trim().split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch (_) { return null; }
  }).filter(Boolean);
}

function _fbSave(records) {
  const tmp = FALLBACK + '.tmp';
  fs.writeFileSync(tmp, records.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  fs.renameSync(tmp, FALLBACK);
}

// ── KV ops (both backends) ────────────────────────────────────────────────────

function _kvInit() {
  if (USE_SQLITE) {
    _sql(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`);
  }
}

function op_kv_set(params) {
  const { key, value } = params || {};
  if (!key) throw new Error('key required');
  const val = typeof value === 'string' ? value : JSON.stringify(value);
  const now = new Date().toISOString();

  if (USE_SQLITE) {
    _kvInit();
    _sql(`INSERT INTO kv(key,value,updated_at) VALUES('${_esc(key)}','${_esc(val)}','${now}') ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`);
    return { status: 'set', key, backend: 'sqlite' };
  }
  const records = _fbLoad().filter(r => r.table !== 'kv' || r.key !== key);
  records.push({ table: 'kv', key, value: val, updated_at: now });
  _fbSave(records);
  return { status: 'set', key, backend: 'jsonl' };
}

function op_kv_get(params) {
  const { key } = params || {};
  if (!key) throw new Error('key required');
  if (USE_SQLITE) {
    _kvInit();
    const rows = _sqlRows(`SELECT value, updated_at FROM kv WHERE key='${_esc(key)}'`);
    if (!rows.length || !rows[0][0]) throw new Error(`Key not found: ${key}`);
    return { key, value: rows[0][0], updated_at: rows[0][1] };
  }
  const rec = _fbLoad().find(r => r.table === 'kv' && r.key === key);
  if (!rec) throw new Error(`Key not found: ${key}`);
  return { key, value: rec.value, updated_at: rec.updated_at };
}

function op_kv_del(params) {
  const { key } = params || {};
  if (!key) throw new Error('key required');
  if (USE_SQLITE) {
    _kvInit();
    _sql(`DELETE FROM kv WHERE key='${_esc(key)}'`);
    return { status: 'deleted', key };
  }
  const before = _fbLoad();
  _fbSave(before.filter(r => !(r.table === 'kv' && r.key === key)));
  return { status: 'deleted', key };
}

function op_kv_list(params) {
  const { prefix } = params || {};
  if (USE_SQLITE) {
    _kvInit();
    const where = prefix ? `WHERE key LIKE '${_esc(prefix)}%'` : '';
    const rows = _sqlRows(`SELECT key, updated_at FROM kv ${where}`);
    return { backend: 'sqlite', count: rows.length, keys: rows.map(r => ({ key: r[0], updated_at: r[1] })) };
  }
  let recs = _fbLoad().filter(r => r.table === 'kv');
  if (prefix) recs = recs.filter(r => r.key.startsWith(prefix));
  return { backend: 'jsonl', count: recs.length, keys: recs.map(r => ({ key: r.key, updated_at: r.updated_at })) };
}

// ── Table ops (SQLite only; graceful message if no SQLite) ────────────────────

function _requireSqlite() {
  if (!USE_SQLITE) throw new Error('sqlite3 binary not found. Table ops require sqlite3 CLI installed. KV ops use JSONL fallback.');
}

function _esc(s) { return String(s).replace(/'/g, "''"); }

function op_create_table(params) {
  _requireSqlite();
  const { table, columns } = params || {};
  if (!table) throw new Error('table required');
  if (!columns || !columns.length) throw new Error('columns array required e.g. [{ name: "id", type: "INTEGER PRIMARY KEY" }]');
  const col_defs = columns.map(c => `${c.name} ${c.type || 'TEXT'}`).join(', ');
  _sql(`CREATE TABLE IF NOT EXISTS ${_esc(table)} (${col_defs})`);
  return { status: 'created', table };
}

function op_insert(params) {
  _requireSqlite();
  const { table, row } = params || {};
  if (!table) throw new Error('table required');
  if (!row || typeof row !== 'object') throw new Error('row object required');
  const keys = Object.keys(row);
  const vals = keys.map(k => `'${_esc(row[k])}'`).join(', ');
  _sql(`INSERT INTO ${_esc(table)} (${keys.join(', ')}) VALUES (${vals})`);
  return { status: 'inserted', table };
}

function op_query(params) {
  _requireSqlite();
  const { table, where, limit = 100 } = params || {};
  if (!table) throw new Error('table required');
  const w = where ? `WHERE ${where}` : '';
  // Get column names first
  const cols_raw = spawnSync('sqlite3', [DB_FILE, `.headers on\nSELECT * FROM ${_esc(table)} ${w} LIMIT 1`], { encoding: 'utf8', timeout: 5000 });
  const header_line = (cols_raw.stdout || '').split('\n')[0];
  const col_names = header_line ? header_line.split('|') : [];

  const rows = _sqlRows(`SELECT * FROM ${_esc(table)} ${w} LIMIT ${limit}`);
  const mapped = rows.map(r => {
    const obj = {};
    col_names.forEach((c, i) => { obj[c] = r[i]; });
    return obj;
  });
  return { table, count: mapped.length, rows: mapped };
}

function op_delete_rows(params) {
  _requireSqlite();
  const { table, where } = params || {};
  if (!table) throw new Error('table required');
  if (!where) throw new Error('where clause required (safety — use "1=1" to delete all)');
  _sql(`DELETE FROM ${_esc(table)} WHERE ${where}`);
  return { status: 'deleted', table, where };
}

function op_drop_table(params) {
  _requireSqlite();
  const { table } = params || {};
  if (!table) throw new Error('table required');
  _sql(`DROP TABLE IF EXISTS ${_esc(table)}`);
  return { status: 'dropped', table };
}

function op_list_tables() {
  if (!USE_SQLITE) return { backend: 'jsonl', tables: ['kv (fallback)'] };
  const rows = _sqlRows(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
  return { backend: 'sqlite', tables: rows.map(r => r[0]).filter(Boolean) };
}

function op_exec(params) {
  _requireSqlite();
  const { sql } = params || {};
  if (!sql) throw new Error('sql required');
  // Safety: block destructive top-level statements unless explicitly passing table name
  const forbidden = /^\s*(DROP\s+DATABASE|ATTACH|DETACH|PRAGMA\s+key)/i;
  if (forbidden.test(sql)) throw new Error('Forbidden SQL statement.');
  const result = _sql(sql);
  return { status: 'executed', result };
}

// ── MANIFEST + entry ──────────────────────────────────────────────────────────

const MANIFEST = {
  name: 'sqlite_store',
  description: 'Structured SQLite-backed storage with KV and table ops. Falls back to JSONL if sqlite3 CLI absent. Ops: kv_set, kv_get, kv_del, kv_list, create_table, insert, query, delete_rows, drop_table, list_tables, exec.',
  ops: ['kv_set', 'kv_get', 'kv_del', 'kv_list', 'create_table', 'insert', 'query', 'delete_rows', 'drop_table', 'list_tables', 'exec'],
  backend: USE_SQLITE ? 'sqlite' : 'jsonl_fallback',
};

async function run(op, params) {
  switch (op) {
    case 'kv_set':       return op_kv_set(params);
    case 'kv_get':       return op_kv_get(params);
    case 'kv_del':       return op_kv_del(params);
    case 'kv_list':      return op_kv_list(params);
    case 'create_table': return op_create_table(params);
    case 'insert':       return op_insert(params);
    case 'query':        return op_query(params);
    case 'delete_rows':  return op_delete_rows(params);
    case 'drop_table':   return op_drop_table(params);
    case 'list_tables':  return op_list_tables();
    case 'exec':         return op_exec(params);
    default:
      throw new Error(`Unknown op: ${op}. Available: kv_set, kv_get, kv_del, kv_list, create_table, insert, query, delete_rows, drop_table, list_tables, exec`);
  }
}

module.exports = { MANIFEST, run };
