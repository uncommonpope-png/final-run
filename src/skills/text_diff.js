'use strict';

// text_diff.js — Line-by-line diff between two text strings or file versions
// Ops: diff_strings, diff_files, patch_apply
// Pure Node.js — implements Myers diff algorithm (O(ND))

const fs = require('fs');
const path = require('path');

const MAX_SIZE = 512 * 1024; // 512KB per input

// Myers shortest-edit-script diff
function _myersDiff(a, b) {
  const N = a.length, M = b.length;
  const MAX = N + M;
  if (MAX === 0) return [];

  const V = new Array(2 * MAX + 1).fill(0);
  const trace = [];

  for (let d = 0; d <= MAX; d++) {
    trace.push(V.slice());
    for (let k = -d; k <= d; k += 2) {
      let x;
      const idx = k + MAX;
      if (k === -d || (k !== d && V[idx - 1] < V[idx + 1])) {
        x = V[idx + 1];
      } else {
        x = V[idx - 1] + 1;
      }
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) { x++; y++; }
      V[idx] = x;
      if (x >= N && y >= M) {
        return _backtrack(trace, a, b, MAX);
      }
    }
  }
  return _backtrack(trace, a, b, MAX);
}

function _backtrack(trace, a, b, MAX) {
  const ops = [];
  let x = a.length, y = b.length;
  for (let d = trace.length - 1; d >= 0; d--) {
    const V = trace[d];
    const k = x - y;
    const idx = k + MAX;
    let prev_k;
    if (k === -d || (k !== d && V[idx - 1] < V[idx + 1])) {
      prev_k = k + 1;
    } else {
      prev_k = k - 1;
    }
    const prev_x = V[prev_k + MAX];
    const prev_y = prev_x - prev_k;
    while (x > prev_x && y > prev_y) { ops.push({ op: '=', x: x - 1, y: y - 1 }); x--; y--; }
    if (d > 0) {
      if (x === prev_x) { ops.push({ op: '+', x: prev_x, y: prev_y }); }
      else               { ops.push({ op: '-', x: prev_x, y: prev_y }); }
    }
    x = prev_x; y = prev_y;
  }
  return ops.reverse();
}

function _buildHunks(a, b, context = 3) {
  const edits = _myersDiff(a, b);
  const changes = [];
  let ai = 0, bi = 0;

  for (const e of edits) {
    if (e.op === '=') { ai++; bi++; continue; }
    if (e.op === '-') { changes.push({ type: 'remove', a_line: e.x, b_line: null, text: a[e.x] }); ai++; }
    if (e.op === '+') { changes.push({ type: 'add', a_line: null, b_line: e.y, text: b[e.y] }); bi++; }
  }

  // Build unified-style hunks with context lines
  const hunks = [];
  let i = 0;
  while (i < changes.length) {
    const hunk_changes = [changes[i]];
    let j = i + 1;
    while (j < changes.length) {
      const prev = hunk_changes[hunk_changes.length - 1];
      const curr = changes[j];
      const gap = Math.max(
        curr.a_line != null ? curr.a_line : curr.b_line,
        prev.a_line != null ? prev.a_line : prev.b_line
      ) - Math.min(
        curr.a_line != null ? curr.a_line : curr.b_line,
        prev.a_line != null ? prev.a_line : prev.b_line
      );
      if (gap <= context * 2) { hunk_changes.push(curr); j++; }
      else break;
    }

    const first = hunk_changes[0];
    const last = hunk_changes[hunk_changes.length - 1];
    const a_start = Math.max(0, (first.a_line != null ? first.a_line : first.b_line) - context);
    const a_end   = Math.min(a.length, (last.a_line  != null ? last.a_line  : last.b_line)  + context + 1);

    const lines = [];
    const change_set = new Set(hunk_changes);
    for (let li = a_start; li < a_end; li++) {
      const c = hunk_changes.find(ch => ch.a_line === li && ch.type === 'remove');
      if (c) { lines.push(`- ${a[li]}`); continue; }
      lines.push(`  ${a[li]}`);
    }
    // Insert additions at appropriate points
    for (const ch of hunk_changes.filter(c => c.type === 'add')) {
      lines.push(`+ ${b[ch.b_line]}`);
    }

    hunks.push({
      a_start: a_start + 1,
      a_count: a_end - a_start,
      adds: hunk_changes.filter(c => c.type === 'add').length,
      removes: hunk_changes.filter(c => c.type === 'remove').length,
      lines,
    });
    i = j;
  }

  return { hunks, total_adds: changes.filter(c => c.type === 'add').length, total_removes: changes.filter(c => c.type === 'remove').length };
}

function _readSafe(file_path) {
  const abs = path.resolve(file_path);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);
  const stat = fs.statSync(abs);
  if (stat.size > MAX_SIZE) throw new Error(`File too large (${stat.size} bytes). Max: ${MAX_SIZE}.`);
  return fs.readFileSync(abs, 'utf8');
}

// op: diff_strings
function op_diff_strings(params) {
  const { text_a, text_b, context = 3, label_a = 'a', label_b = 'b' } = params || {};
  if (text_a === undefined || text_b === undefined) throw new Error('text_a and text_b required');
  const a = String(text_a).split('\n');
  const b = String(text_b).split('\n');
  const result = _buildHunks(a, b, context);
  return { label_a, label_b, a_lines: a.length, b_lines: b.length, ...result };
}

// op: diff_files
function op_diff_files(params) {
  const { file_a, file_b, context = 3 } = params || {};
  if (!file_a || !file_b) throw new Error('file_a and file_b required');
  const ta = _readSafe(file_a);
  const tb = _readSafe(file_b);
  const a = ta.split('\n');
  const b = tb.split('\n');
  const result = _buildHunks(a, b, context);
  return { file_a, file_b, a_lines: a.length, b_lines: b.length, ...result };
}

async function run(op, params) {
  switch (op) {
    case 'diff_strings': return op_diff_strings(params);
    case 'diff_files':   return op_diff_files(params);
    default:
      throw new Error(`Unknown op: ${op}. Available: diff_strings, diff_files`);
  }
}

const MANIFEST = {
  name: 'text_diff',
  description: 'Line-by-line diff between two text strings or files (Myers algorithm). Ops: diff_strings, diff_files.',
  ops: ['diff_strings', 'diff_files'],
};

module.exports = { MANIFEST, run };
