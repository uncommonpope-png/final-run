'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const LAYER_DIR = path.join(__dirname, '..', '..', 'data', 'layer');
const REPOS_FILE = path.join(LAYER_DIR, 'github_repos.json');
const STATE_FILE = path.join(LAYER_DIR, 'github_ingest_state.json');

const DEFAULT_REPOS = [
  'ggml-org/llama.cpp',
  'ollama/ollama',
  'microsoft/graphrag',
  'HKUDS/LightRAG',
  'infiniflow/ragflow',
  'deepset-ai/haystack',
  'qdrant/qdrant',
  'chroma-core/chroma',
  'run-llama/llama_index',
  'open-webui/open-webui',
  'BerriAI/litellm',
  'microsoft/TaskWeaver',
  'humanlayer/12-factor-agents',
  'openinterpreter/open-interpreter',
  'NVIDIA/ChatRTX',
  'simular-ai/Agent-S',
  'MervinPraison/PraisonAI',
  'SkyworkAI/DeepResearchAgent',
  'trigaten/Learn_Prompting',
  'Meirtz/Awesome-Context-Engineering',
];

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function apiGetJson(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers, timeout: 30000 }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}: ${String(data).slice(0, 160)}`));
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Invalid JSON from ${url}: ${e.message}`)); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('GitHub request timeout')); });
    req.on('error', reject);
    req.end();
  });
}

async function fetchReadme(repo, token) {
  const headers = {
    'User-Agent': 'SCRIBE',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `https://api.github.com/repos/${repo}/readme`;
  const payload = await apiGetJson(url, headers);
  if (!payload.content) throw new Error('README content missing');
  const b64 = String(payload.content).replace(/\n/g, '');
  return Buffer.from(b64, 'base64').toString('utf8');
}

function nowIso() { return new Date().toISOString(); }

function startGithubAutoIngest({ ingestKnowledge, logger = console, onUpdate = null }) {
  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    logger.log('[Layer] GitHub auto-ingest disabled (no GH_TOKEN/GITHUB_TOKEN).');
  }

  const state = readJSON(STATE_FILE, {
    enabled: true,
    interval_hours: 6,
    last_run: null,
    last_result: null,
  });

  const reposState = readJSON(REPOS_FILE, { repos: DEFAULT_REPOS });
  if (!Array.isArray(reposState.repos) || reposState.repos.length === 0) {
    reposState.repos = DEFAULT_REPOS.slice();
    writeJSON(REPOS_FILE, reposState);
  }

  writeJSON(STATE_FILE, state);
  writeJSON(REPOS_FILE, reposState);

  async function runOnce({ limit = 8 } = {}) {
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
    const repos = readJSON(REPOS_FILE, { repos: DEFAULT_REPOS }).repos.slice(0, limit);
    const result = {
      ts: nowIso(),
      repos_checked: repos.length,
      ingested: [],
      failed: [],
    };

    for (const repo of repos) {
      try {
        const txt = await fetchReadme(repo, token);
        const clean = txt.length > 12000 ? txt.slice(0, 12000) : txt;
        const out = ingestKnowledge({
          title: `${repo} README`,
          text: clean,
          source: `https://github.com/${repo}`,
          tags: ['github', 'auto-ingest', 'knowledge', 'sovereign-layer'],
        });
        if (out && out.ok) result.ingested.push(repo);
        else result.failed.push({ repo, error: out && out.error ? out.error : 'ingest failed' });
      } catch (e) {
        result.failed.push({ repo, error: e.message });
      }
    }

    state.last_run = nowIso();
    state.last_result = result;
    writeJSON(STATE_FILE, state);
    logger.log(`[Layer] GitHub ingest run complete. Ingested ${result.ingested.length}/${result.repos_checked}.`);
    if (typeof onUpdate === 'function') {
      onUpdate({
        type: 'ingest_run',
        title: 'GitHub ingest cycle complete',
        detail: `Checked ${result.repos_checked}, ingested ${result.ingested.length}, failed ${result.failed.length}`,
        tags: ['layer', 'github', 'ingest'],
      });
    }
    return result;
  }

  const ms = Math.max(1, Number(state.interval_hours) || 6) * 60 * 60 * 1000;
  if (state.enabled) {
    setTimeout(() => { runOnce({ limit: 12 }).catch(() => {}); }, 15000);
    setInterval(() => { runOnce({ limit: 12 }).catch(() => {}); }, ms);
    logger.log(`[Layer] GitHub auto-ingest scheduled every ${state.interval_hours || 6}h.`);
  }

  return {
    runOnce,
    getStatus: () => readJSON(STATE_FILE, state),
    getRepos: () => readJSON(REPOS_FILE, { repos: DEFAULT_REPOS }).repos,
    setRepos: (repos) => {
      if (!Array.isArray(repos) || repos.length === 0) return { ok: false, error: 'repos array required' };
      const clean = repos.map(r => String(r || '').trim()).filter(Boolean);
      writeJSON(REPOS_FILE, { repos: clean });
      return { ok: true, repos: clean };
    },
  };
}

module.exports = { startGithubAutoIngest };
