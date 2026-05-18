'use strict';

const fs = require('fs');
const path = require('path');

class WorkingMemory {
  constructor(options = {}) {
    this.capacityMin = options.capacityMin || 5;
    this.capacityMax = options.capacityMax || 9;
    this.capacity = Math.floor(Math.random() * (this.capacityMax - this.capacityMin + 1)) + this.capacityMin;
    this.items = [];
    this.listeners = new Set();
    this.transferCallbacks = [];
    this.lastUpdate = Date.now();
    this.accessLog = [];
    this.maxAccessLog = 100;
  }

  _newId() {
    return 'wm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  }

  push(content, priority = 0.5, metadata = {}) {
    this.lastUpdate = Date.now();
    const item = {
      id: this._newId(),
      content,
      priority: Math.max(0, Math.min(1, priority)),
      metadata,
      createdAt: this.lastUpdate,
      accessedAt: this.lastUpdate,
      accessCount: 0,
      chunkId: metadata.chunkId || null,
      age: 0,
    };
    this.items.push(item);
    this._logAccess(item.id);
    this._enforceCapacity();
    this._notify('push', item);
    return item;
  }

  pushChunk(contents, basePriority = 0.5, metadata = {}) {
    const chunkId = 'chunk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const items = contents.map((content, i) => ({
      id: this._newId(),
      content,
      priority: basePriority - (i * 0.05),
      metadata: { ...metadata, chunkId, chunkIndex: i, chunkSize: contents.length },
      createdAt: Date.now(),
      accessedAt: Date.now(),
      accessCount: 0,
      chunkId,
      age: 0,
    }));
    items.forEach(item => {
      this.items.push(item);
      this._logAccess(item.id);
    });
    this._enforceCapacity();
    this._notify('pushChunk', { chunkId, items });
    return { chunkId, items };
  }

  retrieve(id) {
    const item = this.items.find(i => i.id === id);
    if (item) {
      item.accessedAt = Date.now();
      item.accessCount++;
      this._logAccess(id);
    }
    return item || null;
  }

  retrieveByContent(content) {
    const item = this.items.find(i => i.content === content);
    if (item) {
      item.accessedAt = Date.now();
      item.accessCount++;
      this._logAccess(item.id);
    }
    return item || null;
  }

  updatePriority(id, newPriority) {
    const item = this.items.find(i => i.id === id);
    if (item) {
      item.priority = Math.max(0, Math.min(1, newPriority));
      this._notify('updatePriority', item);
    }
    return item;
  }

  remove(id) {
    const idx = this.items.findIndex(i => i.id === id);
    if (idx !== -1) {
      const removed = this.items.splice(idx, 1)[0];
      this._notify('remove', removed);
      return removed;
    }
    return null;
  }

  _enforceCapacity() {
    while (this.items.length > this.capacity) {
      const lowest = this._findLowestPriority();
      if (lowest) this.remove(lowest.id);
    }
  }

  _findLowestPriority() {
    if (this.items.length === 0) return null;
    return this.items.reduce((lowest, item) => {
      const score = item.priority * (1 - item.age * 0.1) - item.accessCount * 0.05;
      const lowestScore = lowest.priority * (1 - lowest.age * 0.1) - lowest.accessCount * 0.05;
      return score < lowestScore ? item : lowest;
    }, this.items[0]);
  }

  _ageItems() {
    const now = Date.now();
    for (const item of this.items) {
      item.age = (now - item.createdAt) / (1000 * 60);
    }
  }

  refresh(id) {
    const item = this.items.find(i => i.id === id);
    if (item) {
      item.age = 0;
      item.priority = Math.min(1, item.priority + 0.1);
    }
    return item;
  }

  promote(id, boost = 0.2) {
    return this.updatePriority(id, Math.min(1, (this.items.find(i => i.id === id)?.priority || 0) + boost));
  }

  demote(id, reduction = 0.1) {
    return this.updatePriority(id, Math.max(0, (this.items.find(i => i.id === id)?.priority || 0) - reduction));
  }

  getAll() {
    return [...this.items].sort((a, b) => b.priority - a.priority);
  }

  getByChunk(chunkId) {
    return this.items.filter(i => i.chunkId === chunkId);
  }

  transferToLongTerm(itemId, storage) {
    const item = this.items.find(i => i.id === itemId);
    if (!item) return null;
    if (storage && typeof storage.store === 'function') {
      storage.store(item.content, { ...item.metadata, source: 'working_memory', transferredAt: new Date().toISOString() });
    }
    this.remove(item.id);
    this._notify('transfer', item);
    for (const cb of this.transferCallbacks) {
      try { cb(item); } catch {}
    }
    return item;
  }

  transferAllToLongTerm(storage) {
    const transferred = [];
    for (const item of [...this.items]) {
      const result = this.transferToLongTerm(item.id, storage);
      if (result) transferred.push(result);
    }
    return transferred;
  }

  onTransfer(callback) {
    this.transferCallbacks.push(callback);
  }

  _logAccess(id) {
    this.accessLog.unshift({ id, ts: Date.now() });
    if (this.accessLog.length > this.maxAccessLog) {
      this.accessLog = this.accessLog.slice(0, this.maxAccessLog);
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _notify(event, data) {
    for (const listener of this.listeners) {
      try { listener(event, data, this.items); } catch {}
    }
  }

  clear() {
    const items = [...this.items];
    this.items = [];
    this.accessLog = [];
    this._notify('clear', items);
    return items;
  }

  dump() {
    return {
      capacity: this.capacity,
      used: this.items.length,
      items: this.getAll(),
      accessLog: this.accessLog,
      lastUpdate: this.lastUpdate,
    };
  }

  load(dump) {
    this.clear();
    if (dump.capacity) this.capacity = dump.capacity;
    for (const item of dump.items || []) {
      this.items.push({ ...item, accessedAt: Date.now() });
    }
    this.accessLog = dump.accessLog || [];
    this.lastUpdate = dump.lastUpdate || Date.now();
  }

  get size() { return this.items.length; }
  get available() { return this.capacity - this.items.length; }
}

module.exports = { WorkingMemory };
