'use strict';

/**
 * SKILL: soul_ledger
 *
 * Read, write, and query the Profitlord soul ledger directly.
 * Also works with any JSONL ledger on disk or via GitHub.
 *
 * Operations:
 *   read_local   — read a local JSONL ledger file
 *   append       — append a new entry to a local JSONL ledger
 *   query        — search/filter entries in a ledger
 *   read_github  — read Profitlord's docs/ledger.jsonl from GitHub
 *   soul_state   — read Profitlord's docs/state.json (current soul states)
 *   write_github — write an entry to a GitHub-hosted ledger via API (requires token with write access)
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const MANIFEST = {
  name: 'soul_ledger',
  description: 'Read, write, and query the Profitlord soul ledger and any JSONL ledger on disk or GitHub.',
  version: '1.0.0',
  inputs: {
    op:      { type: 'string', required: true,  description: '"read_local"|"append"|"query"|"read_github"|"soul_state"|"write_github"' },
    file:    { type: 'string', required: false, description: 'Local JSONL file path' },
    entry:   { type: 'any',   required: false, description: 'Entry to append (object)' },
    filter:  { type: 'object',required: false, description: 'Filter criteria: { type, source, from, to, query }' },
    owner:   { type: 'string', required: false, description: 'GitHub repo owner (default: uncommonpope-png)' },
    repo:    { type: 'string', required: false, description: 'GitHub repo name (default: Profitlord)' },
    gh_path: { type: 'string', required: false, description: 'File path within repo (default: docs/ledger.jsonl)' },
    token:   { type: 'string', required: false, description: 'GitHub token (overrides GITHUB_TOKEN env)' },
    limit:   { type: 'number', required: false, description: 'Max entries to return (default 50)' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any',
    error:  'string',
    ts:     'string',
  },
};

async function run({ op, file, entry, filter, owner = 'uncommonpope-png', repo = 'Profitlord', gh_path = 'docs/ledger.jsonl', branch = 'main', token, limit = 50 }) {
  const ts = new Date().toISOString();
  const ghToken = token || process.env.GITHUB_TOKEN || '';

  try {
    let result;
    switch (op) {
      case 'read_local':   result = op_read_local(file, limit);                          break;
      case 'append':       result = op_append(file, entry);                              break;
      case 'query':        result = op_query(file, filter, limit);                       break;
      case 'read_github':  result = await op_read_github(owner, repo, gh_path, branch, ghToken, limit); break;
      case 'soul_state':   result = await op_soul_state(owner, repo, branch, ghToken);           break;
      case 'write_github': result = await op_write_github(owner, repo, gh_path, entry, ghToken); break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

// ── Operations ────────────────────────────────────────────────────────────────

function load_jsonl(file, limit) {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  const raw = fs.readFileSync(resolved, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .slice(-limit);
}

function op_read_local(file, limit) {
  if (!file) throw new Error('file is required');
  const entries = load_jsonl(file, limit);
  const types = {};
  for (const e of entries) { const t = e.type || 'unknown'; types[t] = (types[t] || 0) + 1; }
  return { file: path.resolve(file), count: entries.length, types, entries };
}

function op_append(file, entry) {
  if (!file)  throw new Error('file is required');
  if (!entry) throw new Error('entry is required');
  const resolved = path.resolve(file);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const stamped = { ...entry, ts: entry.ts || new Date().toISOString() };
  fs.appendFileSync(resolved, JSON.stringify(stamped) + '\n', 'utf-8');
  return { appended: true, file: resolved, entry: stamped };
}

function op_query(file, filter = {}, limit) {
  if (!file) throw new Error('file is required');
  let entries = load_jsonl(file, 100000);
  if (filter.type)   entries = entries.filter(e => e.type === filter.type);
  if (filter.source) entries = entries.filter(e => JSON.stringify(e.source || '').includes(filter.source));
  if (filter.from)   entries = entries.filter(e => e.ts && e.ts >= filter.from);
  if (filter.to)     entries = entries.filter(e => e.ts && e.ts <= filter.to);
  if (filter.query) {
    const q = filter.query.toLowerCase();
    entries = entries.filter(e => JSON.stringify(e).toLowerCase().includes(q));
  }
  return { count: entries.length, filter, entries: entries.slice(-limit) };
}

async function op_read_github(owner, repo, ghPath, branch, token, limit) {
  const raw = await gh_raw(owner, repo, ghPath, branch, token);
  const entries = raw.trim().split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .slice(-limit);
  const types = {};
  for (const e of entries) { const t = e.type || e.event || 'unknown'; types[t] = (types[t] || 0) + 1; }
  return { owner, repo, path: ghPath, count: entries.length, types, entries };
}

async function op_soul_state(owner, repo, branch, token) {
  const raw = await gh_raw(owner, repo, 'docs/state.json', branch, token);
  let state;
  try { state = JSON.parse(raw); } catch { state = { raw: raw.slice(0, 500) }; }
  return { owner, repo, state };
}

async function op_write_github(owner, repo, ghPath, entry, token) {
  if (!token) throw new Error('GitHub token required to write');
  if (!entry) throw new Error('entry is required');

  // Get current file to obtain sha
  const current = await gh_api_get(`/repos/${owner}/${repo}/contents/${ghPath}`, token);
  const existingContent = Buffer.from(current.content || '', 'base64').toString('utf-8');
  const newContent = existingContent + JSON.stringify({ ...entry, ts: entry.ts || new Date().toISOString() }) + '\n';
  const encoded = Buffer.from(newContent, 'utf-8').toString('base64');

  const body = {
    message: `[SCRIBE] append entry to ${ghPath}`,
    content: encoded,
    sha: current.sha,
  };

  const result = await gh_api_put(`/repos/${owner}/${repo}/contents/${ghPath}`, token, body);
  return { written: true, owner, repo, path: ghPath, commit: result.commit?.sha };
}

// ── GitHub helpers ────────────────────────────────────────────────────────────

function gh_raw(owner, repo, filePath, branch, token) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'SCRIBE/1.0' };
    if (token) headers['Authorization'] = `token ${token}`;
    https.get(url, { headers, timeout: 15000 }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function gh_api_get(path_, token) {
  return new Promise((resolve, reject) => {
    const options = { hostname: 'api.github.com', path: path_, headers: { 'User-Agent': 'SCRIBE/1.0', 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }, timeout: 15000 };
    const req = https.get(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON from GitHub')); } });
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('gh_api_get timed out')); });
    req.on('error', reject);
  });
}

function gh_api_put(path_, token, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname: 'api.github.com', path: path_, method: 'PUT',
      headers: { 'User-Agent': 'SCRIBE/1.0', 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
      timeout: 15000,
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON from GitHub')); } });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

module.exports = { MANIFEST, run };
