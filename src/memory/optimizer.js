'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', '..', 'data', 'mem_cache');
const CTX_FILE  = path.join(__dirname, '..', '..', 'data', 'ctx_state.json');

function _ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
_ensureDir(CACHE_DIR);

function _hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function _cachePath(key) {
  return path.join(CACHE_DIR, `${_hashKey(key)}.json`);
}

const toolCache = new Map();

function cacheResult(key, result, ttlMs = 300000) {
  toolCache.set(key, { result, expires: Date.now() + ttlMs });
  const meta = {
    key: _hashKey(key),
    result: typeof result === 'string' ? result.slice(0, 500) : JSON.stringify(result).slice(0, 500),
    cached_at: Date.now(),
    expires: Date.now() + ttlMs,
  };
  fs.writeFileSync(_cachePath(key), JSON.stringify(meta), 'utf8');
}

function getCachedResult(key) {
  const entry = toolCache.get(key);
  if (entry && entry.expires > Date.now()) return entry.result;
  const cacheFile = _cachePath(key);
  if (fs.existsSync(cacheFile)) {
    try {
      const meta = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (meta.expires > Date.now()) {
        const result = meta.result;
        toolCache.set(key, { result, expires: meta.expires });
        return result;
      }
    } catch (_) {}
  }
  return null;
}

function invalidateCache(key) {
  toolCache.delete(key);
  const fp = _cachePath(key);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

function clearExpiredCache() {
  const now = Date.now();
  const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), 'utf8'));
      if (meta.expires < now) fs.unlinkSync(path.join(CACHE_DIR, file));
    } catch (_) {}
  }
  for (const [key, entry] of toolCache.entries()) {
    if (entry.expires < now) toolCache.delete(key);
  }
}

setInterval(clearExpiredCache, 60000);

class ContextManager {
  constructor(maxTokens = 120000) {
    this.maxTokens = maxTokens;
    this.state = this._loadState();
  }

  _loadState() {
    if (fs.existsSync(CTX_FILE)) {
      try { return JSON.parse(fs.readFileSync(CTX_FILE, 'utf8')); } catch (_) {}
    }
    return { turns: [], total_tokens: 0, last_trim: null };
  }

  _saveState() {
    fs.writeFileSync(CTX_FILE, JSON.stringify(this.state, null, 2), 'utf8');
  }

  addTurn(role, content, tokens = null) {
    this.state.turns.push({
      role,
      content: typeof content === 'string' ? content.slice(0, 8000) : JSON.stringify(content).slice(0, 8000),
      ts: Date.now(),
      tokens: tokens || Math.ceil((content?.length || 0) / 4),
    });
    this.state.total_tokens = this.state.turns.reduce((a, t) => a + (t.tokens || 0), 0);
    this._maybeTrim();
    this._saveState();
  }

  _maybeTrim() {
    if (this.state.total_tokens <= this.maxTokens * 0.8) return;
    const target = Math.floor(this.maxTokens * 0.5);
    while (this.state.total_tokens > target && this.state.turns.length > 2) {
      const removed = this.state.turns.shift();
      this.state.total_tokens -= removed.tokens || 0;
      this.state.last_trim = Date.now();
    }
  }

  getContext() {
    return this.state.turns.map(t => ({ role: t.role, content: t.content }));
  }

  estimateTokens(content) {
    return Math.ceil((content?.length || 0) / 4);
  }

  reset() {
    this.state = { turns: [], total_tokens: 0, last_trim: Date.now() };
    this._saveState();
  }

  getStats() {
    return {
      turns: this.state.turns.length,
      total_tokens: this.state.total_tokens,
      max_tokens: this.maxTokens,
      utilization: Math.round(this.state.total_tokens / this.maxTokens * 1000) / 10,
      last_trim: this.state.last_trim,
    };
  }
}

class StreamingBuffer {
  constructor(onChunk) {
    this.chunks = [];
    this.onChunk = onChunk || (() => {});
    this.startTime = Date.now();
  }

  push(chunk) {
    this.chunks.push(chunk);
    this.onChunk(chunk);
  }

  finalize() {
    const text = this.chunks.join('');
    return {
      text,
      chunkCount: this.chunks.length,
      duration_ms: Date.now() - this.startTime,
    };
  }
}

module.exports = {
  cacheResult,
  getCachedResult,
  invalidateCache,
  clearExpiredCache,
  ContextManager,
  StreamingBuffer,
};