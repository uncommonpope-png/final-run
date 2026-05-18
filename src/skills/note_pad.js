'use strict';

// note_pad.js — Ephemeral named scratch-pad, separate from causal memory ledger
// Notes live in data/notepad.json (persisted to disk but NOT part of the ledger)
// Ops: set, get, append, delete, list, clear, search

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const PAD_FILE = path.join(DATA_DIR, 'notepad.json');
const MAX_NOTE_SIZE = 64 * 1024; // 64KB per note
const MAX_NOTES = 500;

function _load() {
  if (!fs.existsSync(PAD_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(PAD_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
}

function _save(notes) {
  const tmp = PAD_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(notes, null, 2), 'utf8');
  fs.renameSync(tmp, PAD_FILE);
}

// op: set — create or overwrite a note
function op_set(params) {
  const { key, value, tags = [] } = params || {};
  if (!key) throw new Error('key required');
  if (value === undefined) throw new Error('value required');
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length > MAX_NOTE_SIZE) throw new Error(`Note too large (${text.length} chars). Max: ${MAX_NOTE_SIZE}.`);

  const notes = _load();
  const now = new Date().toISOString();
  if (Object.keys(notes).length >= MAX_NOTES && !notes[key]) {
    throw new Error(`Notepad full (${MAX_NOTES} notes max). Delete some first.`);
  }
  notes[key] = { key, value: text, tags, created_at: notes[key]?.created_at || now, updated_at: now };
  _save(notes);
  return { status: 'set', key, size: text.length };
}

// op: get — retrieve a note by key
function op_get(params) {
  const { key } = params || {};
  if (!key) throw new Error('key required');
  const notes = _load();
  if (!notes[key]) throw new Error(`Note not found: ${key}`);
  return notes[key];
}

// op: append — append text to an existing note (creates if absent)
function op_append(params) {
  const { key, value, separator = '\n' } = params || {};
  if (!key) throw new Error('key required');
  if (value === undefined) throw new Error('value required');
  const notes = _load();
  const existing = notes[key]?.value || '';
  const appended = existing ? existing + separator + String(value) : String(value);
  if (appended.length > MAX_NOTE_SIZE) throw new Error(`Note would exceed max size (${MAX_NOTE_SIZE} chars) after append.`);
  const now = new Date().toISOString();
  notes[key] = {
    key,
    value: appended,
    tags: notes[key]?.tags || [],
    created_at: notes[key]?.created_at || now,
    updated_at: now,
  };
  _save(notes);
  return { status: 'appended', key, total_size: appended.length };
}

// op: delete
function op_delete(params) {
  const { key } = params || {};
  if (!key) throw new Error('key required');
  const notes = _load();
  if (!notes[key]) throw new Error(`Note not found: ${key}`);
  delete notes[key];
  _save(notes);
  return { status: 'deleted', key };
}

// op: list
function op_list(params) {
  const { tag } = params || {};
  const notes = _load();
  let items = Object.values(notes);
  if (tag) items = items.filter(n => (n.tags || []).includes(tag));
  return {
    count: items.length,
    notes: items.map(n => ({
      key: n.key,
      size: (n.value || '').length,
      tags: n.tags || [],
      updated_at: n.updated_at,
    })).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
  };
}

// op: search — substring search across note values
function op_search(params) {
  const { query, limit = 20 } = params || {};
  if (!query) throw new Error('query required');
  const notes = _load();
  const q = query.toLowerCase();
  const matches = Object.values(notes)
    .filter(n => (n.value || '').toLowerCase().includes(q) || n.key.toLowerCase().includes(q))
    .slice(0, limit);
  return {
    query,
    count: matches.length,
    results: matches.map(n => {
      const idx = n.value.toLowerCase().indexOf(q);
      const snippet = idx >= 0 ? n.value.slice(Math.max(0, idx - 30), idx + query.length + 30) : '';
      return { key: n.key, snippet, tags: n.tags || [], updated_at: n.updated_at };
    }),
  };
}

// op: clear — wipe all notes
function op_clear() {
  const notes = _load();
  const count = Object.keys(notes).length;
  _save({});
  return { status: 'cleared', deleted: count };
}

async function run(op, params) {
  switch (op) {
    case 'set':    return op_set(params);
    case 'get':    return op_get(params);
    case 'append': return op_append(params);
    case 'delete': return op_delete(params);
    case 'list':   return op_list(params);
    case 'search': return op_search(params);
    case 'clear':  return op_clear();
    default:
      throw new Error(`Unknown op: ${op}. Available: set, get, append, delete, list, search, clear`);
  }
}

const MANIFEST = {
  name: 'note_pad',
  description: 'Ephemeral named scratch-pad separate from causal memory ledger. Ops: set, get, append, delete, list, search, clear.',
  ops: ['set', 'get', 'append', 'delete', 'list', 'search', 'clear'],
};

module.exports = { MANIFEST, run };
