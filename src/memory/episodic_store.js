'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class EpisodicStore {
  constructor(options = {}) {
    this.storePath = options.storePath || path.join(__dirname, '..', '..', 'data', 'episodes.jsonl');
    this.maxEpisodes = options.maxEpisodes || 1000;
    this.episodes = new Map();
    this.currentEpisode = null;
    this._ensureFiles();
    this._load();
  }

  _ensureFiles() {
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.storePath)) fs.writeFileSync(this.storePath, '');
  }

  _load() {
    const lines = fs.readFileSync(this.storePath, 'utf-8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const ep = JSON.parse(line);
        this.episodes.set(ep.id, ep);
      } catch {}
    }
    if (this.episodes.size > this.maxEpisodes) {
      const sorted = [...this.episodes.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
      const toKeep = sorted.slice(-this.maxEpisodes);
      this.episodes.clear();
      for (const ep of toKeep) this.episodes.set(ep.id, ep);
    }
  }

  _persist(episode) {
    fs.appendFileSync(this.storePath, JSON.stringify(episode) + '\n');
  }

  beginEpisode(taskId, metadata = {}) {
    if (this.currentEpisode) this.endEpisode();
    this.currentEpisode = {
      id: 'ep_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
      taskId,
      startTime: new Date().toISOString(),
      endTime: null,
      events: [],
      keyEvents: [],
      outcome: null,
      metadata,
      chainedFrom: null,
    };
    return this.currentEpisode;
  }

  addEvent(type, content, metadata = {}) {
    if (!this.currentEpisode) return null;
    const event = {
      id: 'ev_' + Date.now() + '_' + crypto.randomBytes(2).toString('hex'),
      type,
      content,
      timestamp: new Date().toISOString(),
      metadata,
    };
    this.currentEpisode.events.push(event);
    return event;
  }

  addKeyEvent(label, content, significance = 0.8) {
    if (!this.currentEpisode) return null;
    const keyEvent = {
      label,
      content,
      significance,
      timestamp: new Date().toISOString(),
    };
    this.currentEpisode.keyEvents.push(keyEvent);
    return keyEvent;
  }

  endEpisode(outcome = null) {
    if (!this.currentEpisode) return null;
    this.currentEpisode.endTime = new Date().toISOString();
    this.currentEpisode.outcome = outcome;
    this.currentEpisode.duration = new Date(this.currentEpisode.endTime).getTime() - new Date(this.currentEpisode.startTime).getTime();
    this.episodes.set(this.currentEpisode.id, this.currentEpisode);
    this._persist(this.currentEpisode);
    const completed = this.currentEpisode;
    this.currentEpisode = null;
    return completed;
  }

  chainEpisodes(episodeId, chainedFromId) {
    const episode = this.episodes.get(episodeId);
    if (!episode) return false;
    episode.chainedFrom = chainedFromId;
    const source = this.episodes.get(chainedFromId);
    if (source && !source.chainedTo) {
      source.chainedTo = episodeId;
      fs.appendFileSync(this.storePath, JSON.stringify(source) + '\n');
    }
    fs.appendFileSync(this.storePath, JSON.stringify(episode) + '\n');
    return true;
  }

  async extractKeyEvents(episodeId) {
    const episode = this.episodes.get(episodeId);
    if (!episode) return [];
    if (episode.keyEvents.length > 0) return episode.keyEvents;
    try {
      const { run } = require('../skills/llm');
      const summary = episode.events.map(e => `[${e.type}] ${e.content}`).join('\n');
      const result = await run({
        op: 'summarize',
        prompt: `Extract 3-5 key events from this task episode:\n${summary}\n\nFormat: JSON array with {label, content, significance: 0-1}`,
        max_tokens: 500,
      });
      if (result.ok) {
        try {
          const parsed = JSON.parse(result.text);
          episode.keyEvents = parsed;
          return parsed;
        } catch {
          return episode.events.slice(-5).map(e => ({ label: e.type, content: e.content, significance: 0.5 }));
        }
      }
    } catch {}
    return episode.events.slice(-5).map(e => ({ label: e.type, content: e.content, significance: 0.5 }));
  }

  getEpisode(episodeId) {
    return this.episodes.get(episodeId) || null;
  }

  getEpisodeChain(episodeId) {
    const chain = [];
    const visited = new Set();
    let current = this.episodes.get(episodeId);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      chain.push(current);
      current = current.chainedFrom ? this.episodes.get(current.chainedFrom) : null;
    }
    return chain;
  }

  getNarrative(taskId) {
    const taskEpisodes = [...this.episodes.values()]
      .filter(ep => ep.taskId === taskId)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (taskEpisodes.length === 0) return { episodes: [], narrative: '' };
    const narrative = taskEpisodes.map(ep => {
      const events = ep.keyEvents.length > 0 ? ep.keyEvents : ep.events.slice(0, 3);
      return `[${ep.startTime}] ${events.map(e => e.content).join(' | ')}`;
    }).join('\n');
    return { episodes: taskEpisodes, narrative };
  }

  async searchSimilar(query, options = {}) {
    const { limit = 5, minSimilarity = 0.6 } = options;
    try {
      const { run } = require('../skills/llm');
      const result = await run({ op: 'embed', prompt: query });
      if (!result.ok || !result.embedding) return [];
      const queryEmbedding = result.embedding;
      const scores = [];
      for (const [id, ep] of this.episodes) {
        const epText = (ep.keyEvents.map(e => e.content).join(' ') + ' ' + ep.events.map(e => e.content).join(' '));
        const epEmbedding = await this._simpleEmbed(epText);
        const sim = this._cosineSim(queryEmbedding, epEmbedding);
        if (sim >= minSimilarity) {
          scores.push({ episode: ep, similarity: sim });
        }
      }
      return scores.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
    } catch {
      return [];
    }
  }

  async _simpleEmbed(text) {
    try {
      const { run } = require('../skills/llm');
      const result = await run({ op: 'embed', prompt: text });
      return result.embedding || this._fallbackEmbed(text);
    } catch {
      return this._fallbackEmbed(text);
    }
  }

  _fallbackEmbed(text) {
    const hash = crypto.createHash('sha256').update(text).digest();
    const vec = [];
    for (let i = 0; i < 1536; i++) {
      vec.push((hash[i % hash.length] || 0) / 255);
    }
    return vec;
  }

  _cosineSim(a, b) {
    if (a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-10);
  }

  getRecent(n = 10) {
    return [...this.episodes.values()]
      .sort((a, b) => b.startTime.localeCompare(a.startTime))
      .slice(0, n);
  }

  getStats() {
    const episodes = [...this.episodes.values()];
    const durations = episodes.filter(e => e.duration).map(e => e.duration);
    return {
      total: episodes.length,
      withOutcome: episodes.filter(e => e.outcome).length,
      avgDuration: durations.length > 0 ? durations.reduce((a, d) => a + d, 0) / durations.length : 0,
      totalEvents: episodes.reduce((a, e) => a + e.events.length, 0),
    };
  }

  async clear() {
    this.episodes.clear();
    this.currentEpisode = null;
    fs.writeFileSync(this.storePath, '');
  }

  get size() { return this.episodes.size; }
}

module.exports = { EpisodicStore };
