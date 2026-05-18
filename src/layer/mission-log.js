'use strict';

const fs = require('fs');
const path = require('path');

const LAYER_DIR = path.join(__dirname, '..', '..', 'data', 'layer');
const LOG_FILE = path.join(LAYER_DIR, 'mission_updates.jsonl');

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function appendUpdate({ type = 'update', title = '', detail = '', tags = [] }) {
  fs.mkdirSync(LAYER_DIR, { recursive: true });
  const row = {
    id: `u_${nowTs()}_${Math.random().toString(36).slice(2, 6)}`,
    ts: nowTs(),
    iso: new Date().toISOString(),
    type,
    title: String(title || '').trim(),
    detail: String(detail || '').trim(),
    tags: Array.isArray(tags) ? tags : [],
  };
  fs.appendFileSync(LOG_FILE, `${JSON.stringify(row)}\n`, 'utf8');
  return row;
}

function listUpdates(limit = 50) {
  try {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
    return lines
      .map(l => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean)
      .slice(-Math.max(1, Math.min(500, Number(limit) || 50)))
      .reverse();
  } catch {
    return [];
  }
}

module.exports = { appendUpdate, listUpdates };
