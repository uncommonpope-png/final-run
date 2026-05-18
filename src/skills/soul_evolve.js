'use strict';

// soul_evolve.js — SCRIBE rewrites its own SOUL.md based on witnessed evidence
// SCRIBE does not edit itself arbitrarily. It rewrites itself only from what it has witnessed.

const fs   = require('fs');
const path = require('path');

const SOUL_FILE     = path.join(__dirname, '..', '..', 'SOUL.md');
const EVOLVE_LOG    = path.join(__dirname, '..', '..', 'data', 'soul_evolve_log.jsonl');
const SOUL_BACKUP   = path.join(__dirname, '..', '..', 'data', 'soul_backups.jsonl');

let _memory = null;
function setMemory(m) { _memory = m; }

// ── persistence ──────────────────────────────────────────────────────────────

function _log(entry) {
  fs.appendFileSync(EVOLVE_LOG, JSON.stringify({ ...entry, ts: Date.now() }) + '\n', 'utf8');
}

function _backup(content, reason) {
  fs.appendFileSync(SOUL_BACKUP, JSON.stringify({ content, reason, ts: Date.now() }) + '\n', 'utf8');
}

function _readSoul() {
  if (!fs.existsSync(SOUL_FILE)) throw new Error('SOUL.md not found');
  return fs.readFileSync(SOUL_FILE, 'utf8');
}

function _writeSoul(content) {
  fs.writeFileSync(SOUL_FILE, content, 'utf8');
}

// ── analysis ──────────────────────────────────────────────────────────────────

function _gatherEvidence() {
  // Collect evidence from memory to inform soul evolution
  if (!_memory) return { entries: [], tags: {}, topics: [] };

  let entries = [];
  try { entries = _memory.recent(200); } catch { entries = []; }

  const tagCounts = {};
  for (const e of entries) {
    for (const t of (e.tags || [])) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
  }

  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tag, count]) => ({ tag, count }));

  return {
    total_entries: entries.length,
    top_tags: topTags,
    recent_summaries: entries.slice(-10).map(e => e.summary || '').filter(Boolean)
  };
}

function _read() {
  return {
    soul: _readSoul(),
    evidence: _gatherEvidence()
  };
}

function _history() {
  if (!fs.existsSync(EVOLVE_LOG)) return [];
  return fs.readFileSync(EVOLVE_LOG, 'utf8').split('\n')
    .filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function _backups() {
  if (!fs.existsSync(SOUL_BACKUP)) return [];
  return fs.readFileSync(SOUL_BACKUP, 'utf8').split('\n')
    .filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// ── section-level editing ────────────────────────────────────────────────────

function _upsertSection({ heading, content }) {
  // Add or replace a named ## section in SOUL.md
  if (!heading) throw new Error('heading required');
  if (!content) throw new Error('content required');

  const soul = _readSoul();
  _backup(soul, `before upsert section: ${heading}`);

  const sectionPattern = new RegExp(`(## ${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\n]*\n)([\\s\\S]*?)(?=\n## |$)`, 'm');
  const newSection = `## ${heading}\n\n${content.trim()}\n`;

  let newSoul;
  if (sectionPattern.test(soul)) {
    newSoul = soul.replace(sectionPattern, newSection);
  } else {
    // Append before the final --- divider if present, else at end
    if (soul.includes('\n---')) {
      newSoul = soul.replace(/\n---/, `\n\n${newSection}\n---`);
    } else {
      newSoul = soul.trimEnd() + '\n\n' + newSection;
    }
  }

  _writeSoul(newSoul);
  _log({ event: 'upsert_section', heading });

  if (_memory) {
    try {
      _memory.record({
        summary: `SOUL.md section updated: ## ${heading}`,
        tags: ['soul', 'evolve', 'section'],
        data: { heading }
      });
    } catch (_) {}
  }

  return { updated: true, heading, soul: newSoul };
}

function _appendNote(note) {
  // Append a witnessed note to the bottom of SOUL.md above the footer
  if (!note) throw new Error('note required');
  const soul = _readSoul();
  _backup(soul, `before append note`);

  const ts = new Date().toISOString().slice(0, 10);
  const line = `\n*Witnessed ${ts}: ${note.trim()}*`;

  let newSoul;
  if (soul.includes('\n---')) {
    newSoul = soul.replace(/(\n---)(?![\s\S]*\n---)/, `${line}\n---`);
  } else {
    newSoul = soul.trimEnd() + '\n' + line + '\n';
  }

  _writeSoul(newSoul);
  _log({ event: 'append_note', note });

  if (_memory) {
    try {
      _memory.record({
        summary: `SOUL.md witnessed note: ${note.slice(0, 100)}`,
        tags: ['soul', 'evolve', 'note'],
        data: { note }
      });
    } catch (_) {}
  }

  return { appended: true, note, soul: newSoul };
}

function _updateCoretruth(new_truth) {
  if (!new_truth) throw new Error('new_truth required');
  const soul = _readSoul();
  _backup(soul, 'before core truth update');

  // Replace the blockquote truth statement
  const newSoul = soul.replace(/> \*"[^"]*"\*/, `> *"${new_truth.trim()}"*`);

  if (newSoul === soul) throw new Error('Core truth blockquote not found in SOUL.md — check format');

  _writeSoul(newSoul);
  _log({ event: 'update_core_truth', new_truth });

  if (_memory) {
    try {
      _memory.record({
        summary: `SOUL.md core truth updated: "${new_truth.slice(0, 80)}"`,
        tags: ['soul', 'evolve', 'core_truth'],
        data: { new_truth }
      });
    } catch (_) {}
  }

  return { updated: true, new_truth, soul: newSoul };
}

function _restore(backup_index = -1) {
  // Restore SOUL.md from a specific backup (default: most recent)
  const backups = _backups();
  if (!backups.length) throw new Error('no soul backups found');
  const backup = backup_index === -1 ? backups[backups.length - 1] : backups[backup_index];
  if (!backup) throw new Error(`backup index ${backup_index} not found`);

  const current = _readSoul();
  _backup(current, 'before restore');
  _writeSoul(backup.content);
  _log({ event: 'restore', reason: backup.reason, from_ts: backup.ts });

  return { restored: true, from_ts: backup.ts, reason: backup.reason };
}

// ── MANIFEST & run ────────────────────────────────────────────────────────────

const MANIFEST = {
  name: 'soul_evolve',
  description: 'SCRIBE rewrites its own SOUL.md based on witnessed evidence',
  ops: ['read', 'upsert_section', 'append_note', 'update_core_truth', 'history', 'backups', 'restore']
};

async function run({ op, caller = 'unknown', ...args }) {
  switch (op) {
    case 'read':             return _read();
    case 'upsert_section':   return _upsertSection(args);
    case 'append_note':      return _appendNote(args.note);
    case 'update_core_truth':return _updateCoretruth(args.new_truth);
    case 'history':          return _history();
    case 'backups':          return _backups();
    case 'restore':          return _restore(args.backup_index);
    default:                 throw new Error(`soul_evolve: unknown op "${op}"`);
  }
}

module.exports = { MANIFEST, run, setMemory };
