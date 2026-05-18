'use strict';

/**
 * SKILL: chamber_scan
 *
 * Scan any GitHub repo, raw URL, or local path as a new chamber on demand.
 * SCRIBE can discover new rooms in the ecosystem at runtime — not just the
 * 10 pre-registered on boot.
 *
 * Operations:
 *   scan_github  — scan a GitHub repo by owner/repo
 *   scan_url     — fetch and parse any URL as a chamber
 *   scan_local   — scan a local directory
 *   scan_jsonl   — read a JSONL file as a ledger chamber
 *   register     — register a newly scanned chamber into SCRIBE's reader
 *   list         — list all chambers currently known (registered + scanned)
 */

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { URL } = require('url');

const MANIFEST = {
  name: 'chamber_scan',
  description: 'Scan any GitHub repo, URL, or local path as a new chamber at runtime.',
  version: '1.0.0',
  inputs: {
    op:     { type: 'string', required: true,  description: '"scan_github"|"scan_url"|"scan_local"|"scan_jsonl"|"register"|"list"' },
    owner:  { type: 'string', required: false, description: 'GitHub repo owner (scan_github)' },
    repo:   { type: 'string', required: false, description: 'GitHub repo name (scan_github)' },
    url:    { type: 'string', required: false, description: 'URL to scan (scan_url)' },
    dir:    { type: 'string', required: false, description: 'Local directory path (scan_local)' },
    file:   { type: 'string', required: false, description: 'JSONL file path (scan_jsonl)' },
    key:    { type: 'string', required: false, description: 'Chamber key for registration (register)' },
    label:  { type: 'string', required: false, description: 'Human label for the chamber' },
    data:   { type: 'any',   required: false, description: 'Chamber data to register (register op)' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any',
    error:  'string',
    ts:     'string',
  },
};

// Runtime chamber registry (survives only as long as SCRIBE process runs)
const _scanned = new Map();
let _memory = null;
function setMemory(m) { _memory = m; }

async function run({ op, owner, repo, url, dir, file, key, label, data }) {
  const ts = new Date().toISOString();
  try {
    let result;
    switch (op) {
      case 'scan_github': result = await op_scan_github(owner, repo);    break;
      case 'scan_url':    result = await op_scan_url(url);               break;
      case 'scan_local':  result = op_scan_local(dir);                   break;
      case 'scan_jsonl':  result = op_scan_jsonl(file);                  break;
      case 'register':    result = op_register(key, label, data);        break;
      case 'list':        result = op_list();                            break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }

    // Record scan in memory
    if (_memory && op !== 'list') {
      _memory.record({
        type: 'reading',
        summary: `Chamber scan (${op}): ${key || owner || url || dir || file || 'unknown'}`,
        tags: ['chamber_scan', op],
        weight: 0.5,
        source: { system: 'SCRIBE', chamber: 'chamber_scan' },
      });
    }

    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

// ── Operations ────────────────────────────────────────────────────────────────

async function op_scan_github(owner, repo) {
  if (!owner || !repo) throw new Error('owner and repo are required');
  const token = process.env.GITHUB_TOKEN || '';
  const headers = { 'User-Agent': 'SCRIBE/1.0', 'Accept': 'application/vnd.github.v3+json' };
  if (token) headers['Authorization'] = `token ${token}`;

  const [repoInfo, contents] = await Promise.all([
    gh_get(`https://api.github.com/repos/${owner}/${repo}`, headers),
    gh_get(`https://api.github.com/repos/${owner}/${repo}/contents`, headers),
  ]);

  const files = Array.isArray(contents) ? contents.map(f => ({ name: f.name, type: f.type, size: f.size })) : [];
  const summary = {
    owner, repo,
    description: repoInfo.description,
    default_branch: repoInfo.default_branch,
    stars: repoInfo.stargazers_count,
    language: repoInfo.language,
    updated_at: repoInfo.updated_at,
    file_count: files.length,
    files,
  };

  const chamberId = `scan_${owner}_${repo}_${Date.now()}`;
  _scanned.set(chamberId, { id: chamberId, type: 'github', owner, repo, summary, scanned_at: new Date().toISOString() });
  return { chamber_id: chamberId, ...summary };
}

async function op_scan_url(url) {
  if (!url) throw new Error('url is required');
  const body = await fetch_text(url);
  const isJson = body.trim().startsWith('{') || body.trim().startsWith('[');
  const isJsonl = !isJson && body.split('\n').every(l => { try { JSON.parse(l); return true; } catch { return !l.trim(); } });
  const summary = {
    url,
    length: body.length,
    is_json: isJson,
    is_jsonl: isJsonl,
    preview: body.slice(0, 500),
  };
  const chamberId = `scan_url_${Date.now()}`;
  _scanned.set(chamberId, { id: chamberId, type: 'url', url, summary, scanned_at: new Date().toISOString() });
  return { chamber_id: chamberId, ...summary };
}

function op_scan_local(dir) {
  if (!dir) throw new Error('dir is required');
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved)) throw new Error(`Directory not found: ${resolved}`);
  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  const files = entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
  const summary = { path: resolved, entry_count: files.length, files };
  const chamberId = `scan_local_${Date.now()}`;
  _scanned.set(chamberId, { id: chamberId, type: 'local', path: resolved, summary, scanned_at: new Date().toISOString() });
  return { chamber_id: chamberId, ...summary };
}

function op_scan_jsonl(file) {
  if (!file) throw new Error('file is required');
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  const raw = fs.readFileSync(resolved, 'utf-8').trim();
  const lines = raw.split('\n').filter(Boolean);
  const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const types = {};
  for (const e of entries) { const t = e.type || 'unknown'; types[t] = (types[t] || 0) + 1; }
  const dates = entries.map(e => e.ts || e.timestamp).filter(Boolean).sort();
  const summary = {
    file: resolved,
    total: entries.length,
    types,
    earliest: dates[0] || null,
    latest: dates[dates.length - 1] || null,
    sample: entries.slice(0, 3),
  };
  const chamberId = `scan_jsonl_${Date.now()}`;
  _scanned.set(chamberId, { id: chamberId, type: 'jsonl', file: resolved, summary, scanned_at: new Date().toISOString() });
  return { chamber_id: chamberId, ...summary };
}

function op_register(key, label, data) {
  if (!key) throw new Error('key is required');
  const chamberId = key;
  _scanned.set(chamberId, { id: chamberId, type: 'manual', label: label || key, data, scanned_at: new Date().toISOString() });
  return { chamber_id: chamberId, key, label };
}

function op_list() {
  const chambers = [];
  for (const c of _scanned.values()) {
    chambers.push({ id: c.id, type: c.type, label: c.label || c.repo || c.url || c.path || c.file || c.id, scanned_at: c.scanned_at });
  }
  return { count: chambers.length, chambers };
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function gh_get(url, headers) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers, timeout: 15000 }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
      res.on('error', reject);
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

function fetch_text(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { timeout: 15000, headers: { 'User-Agent': 'SCRIBE/1.0' } }, res => {
      let data = '';
      res.on('data', c => { data += c; if (data.length > 200000) { res.destroy(); } });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

module.exports = { MANIFEST, run, setMemory };
