'use strict';

// plugin.js — load skill packs from GitHub or local directory at runtime
// SCRIBE can extend itself without restarting.

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');
const crypto = require('crypto');

const PLUGINS_FILE  = path.join(__dirname, '..', '..', 'data', 'plugins.json');
const PLUGIN_DIR    = path.join(__dirname, '..', '..', 'data', 'plugins');
const PLUGIN_LOG    = path.join(__dirname, '..', '..', 'data', 'plugin_log.jsonl');

let _skills = null;
let _memory = null;
function setSkills(e) { _skills = e; }
function setMemory(m) { _memory = m; }

// ── helpers ──────────────────────────────────────────────────────────────────

function _ensureDir() {
  if (!fs.existsSync(PLUGIN_DIR)) fs.mkdirSync(PLUGIN_DIR, { recursive: true });
}

function _log(entry) {
  fs.appendFileSync(PLUGIN_LOG, JSON.stringify({ ...entry, ts: Date.now() }) + '\n', 'utf8');
}

function _loadRegistry() {
  if (!fs.existsSync(PLUGINS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(PLUGINS_FILE, 'utf8')); } catch { return {}; }
}

function _saveRegistry(r) {
  fs.writeFileSync(PLUGINS_FILE, JSON.stringify(r, null, 2), 'utf8');
}

function _fetch(url, { timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout }, res => {
      // follow redirects once
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        _fetch(res.headers.location, { timeout }).then(resolve, reject);
        return;
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('fetch timeout')); });
  });
}

// ── GitHub raw URL builder ────────────────────────────────────────────────────

function _githubRaw(repo, file, branch = 'main') {
  // repo: "owner/repo"  file: "path/to/skill.js"
  return `https://raw.githubusercontent.com/${repo}/${branch}/${file}`;
}

// ── installation ─────────────────────────────────────────────────────────────

async function _installFromGitHub({ repo, file, branch = 'main', name, caller = 'unknown' }) {
  if (!repo) throw new Error('repo required (owner/repo)');
  if (!file) throw new Error('file required (path/to/skill.js)');

  _ensureDir();

  const url  = _githubRaw(repo, file, branch);
  const res  = await _fetch(url);
  if (res.status !== 200) throw new Error(`GitHub fetch failed: HTTP ${res.status} from ${url}`);

  // Safety: reject files over 512KB
  if (res.body.length > 524288) throw new Error('plugin file exceeds 512KB limit');

  // Derive name from filename if not provided
  const pluginName = name || path.basename(file, '.js');
  const destFile   = path.join(PLUGIN_DIR, `${pluginName}.js`);

  fs.writeFileSync(destFile, res.body, 'utf8');

  const hash = crypto.createHash('sha256').update(res.body).digest('hex');
  const registry = _loadRegistry();
  registry[pluginName] = {
    name: pluginName,
    source: 'github',
    repo, file, branch,
    path: destFile,
    hash,
    installed_at: Date.now(),
    loaded: false,
    caller
  };
  _saveRegistry(registry);
  _log({ event: 'install_github', name: pluginName, repo, file });

  return registry[pluginName];
}

async function _installFromLocal({ src, name, caller = 'unknown' }) {
  if (!src) throw new Error('src path required');
  if (!fs.existsSync(src)) throw new Error(`file not found: ${src}`);

  _ensureDir();

  const content = fs.readFileSync(src, 'utf8');
  if (content.length > 524288) throw new Error('plugin file exceeds 512KB limit');

  const pluginName = name || path.basename(src, '.js');
  const destFile   = path.join(PLUGIN_DIR, `${pluginName}.js`);
  fs.copyFileSync(src, destFile);

  const hash = crypto.createHash('sha256').update(content).digest('hex');
  const registry = _loadRegistry();
  registry[pluginName] = {
    name: pluginName,
    source: 'local',
    src, path: destFile,
    hash,
    installed_at: Date.now(),
    loaded: false,
    caller
  };
  _saveRegistry(registry);
  _log({ event: 'install_local', name: pluginName, src });

  return registry[pluginName];
}

// ── load / unload ─────────────────────────────────────────────────────────────

function _load(name) {
  const registry = _loadRegistry();
  if (!registry[name]) throw new Error(`plugin "${name}" not installed`);

  const pluginPath = registry[name].path;
  if (!fs.existsSync(pluginPath)) throw new Error(`plugin file missing: ${pluginPath}`);

  // Invalidate require cache to force re-load
  delete require.cache[require.resolve(pluginPath)];
  const mod = require(pluginPath);

  if (!mod.MANIFEST || typeof mod.run !== 'function') {
    throw new Error(`plugin "${name}" missing MANIFEST or run() — not loaded`);
  }

  if (_skills) {
    _skills.register(mod);
  }

  registry[name].loaded = true;
  registry[name].loaded_at = Date.now();
  _saveRegistry(registry);
  _log({ event: 'load', name });

  if (_memory) {
    try {
      _memory.record({
        summary: `Plugin loaded: "${name}" (${mod.MANIFEST.description || ''})`,
        tags: ['plugin', 'load', name],
        data: { name, manifest: mod.MANIFEST }
      });
    } catch (_) {}
  }

  return { loaded: true, name, manifest: mod.MANIFEST };
}

function _unload(name) {
  const registry = _loadRegistry();
  if (!registry[name]) throw new Error(`plugin "${name}" not installed`);

  if (_skills) {
    try { _skills.unregister(name); } catch (_) {} // engine may not support unregister
  }

  const pluginPath = registry[name].path;
  delete require.cache[require.resolve(pluginPath)];

  registry[name].loaded = false;
  _saveRegistry(registry);
  _log({ event: 'unload', name });

  return { unloaded: true, name };
}

function _remove(name) {
  const registry = _loadRegistry();
  if (!registry[name]) throw new Error(`plugin "${name}" not installed`);

  _unload(name);

  const pluginPath = registry[name].path;
  if (fs.existsSync(pluginPath)) fs.unlinkSync(pluginPath);
  delete registry[name];
  _saveRegistry(registry);
  _log({ event: 'remove', name });

  return { removed: true, name };
}

function _list() {
  return Object.values(_loadRegistry());
}

function _get(name) {
  const registry = _loadRegistry();
  if (!registry[name]) throw new Error(`plugin "${name}" not found`);
  return registry[name];
}

// ── MANIFEST & run ────────────────────────────────────────────────────────────

const MANIFEST = {
  name: 'plugin',
  description: 'Load skill packs from GitHub or local directory at runtime',
  ops: ['install_github', 'install_local', 'load', 'unload', 'remove', 'list', 'get']
};

async function run({ op, caller = 'unknown', ...args }) {
  switch (op) {
    case 'install_github': return _installFromGitHub({ ...args, caller });
    case 'install_local':  return _installFromLocal({ ...args, caller });
    case 'load':           return _load(args.name);
    case 'unload':         return _unload(args.name);
    case 'remove':         return _remove(args.name);
    case 'list':           return _list();
    case 'get':            return _get(args.name);
    default:               throw new Error(`plugin: unknown op "${op}"`);
  }
}

module.exports = { MANIFEST, run, setMemory, setSkills };
