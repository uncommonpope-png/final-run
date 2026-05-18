'use strict';

// chart.js — ASCII charts and graphs for SCRIBE reports (pure Node.js, no deps)
// Ops: bar, line, sparkline, histogram, scatter, pie

const MANIFEST = {
  name: 'chart',
  description: 'ASCII charts and graphs embeddable in SCRIBE reports. Ops: bar, line, sparkline, histogram, scatter, pie.',
  ops: ['bar', 'line', 'sparkline', 'histogram', 'scatter', 'pie'],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function _pad(s, n, right = false) {
  const str = String(s);
  const pad = ' '.repeat(Math.max(0, n - str.length));
  return right ? str + pad : pad + str;
}

function _scale(val, min, max, height) {
  if (max === min) return Math.floor(height / 2);
  return Math.round(((val - min) / (max - min)) * (height - 1));
}

function _fmt(v, decimals = 2) {
  if (v === null || v === undefined) return '?';
  return parseFloat(v).toFixed(decimals);
}

// ── Bar chart ─────────────────────────────────────────────────────────────────

function op_bar(params) {
  const { data, title = '', width = 40, show_values = true } = params || {};
  // data: [{ label, value }] or [value, ...]
  if (!data || !data.length) throw new Error('data required');

  const items = data.map((d, i) => ({
    label: typeof d === 'object' ? String(d.label || i) : String(i),
    value: typeof d === 'object' ? parseFloat(d.value) : parseFloat(d),
  }));

  const max_val = Math.max(...items.map(x => x.value));
  const max_label = Math.max(...items.map(x => x.label.length));
  const lines = [];

  if (title) lines.push(title, '-'.repeat(title.length));

  for (const item of items) {
    const bar_len = max_val > 0 ? Math.round((item.value / max_val) * width) : 0;
    const bar = '#'.repeat(bar_len);
    const val_str = show_values ? ` ${_fmt(item.value)}` : '';
    lines.push(`${_pad(item.label, max_label)} | ${bar}${val_str}`);
  }

  return { chart: lines.join('\n'), type: 'bar' };
}

// ── Line chart ────────────────────────────────────────────────────────────────

function op_line(params) {
  const { data, title = '', width = 60, height = 15, x_labels } = params || {};
  if (!data || !data.length) throw new Error('data required');

  const vals = data.map((d) => typeof d === 'object' ? parseFloat(d.value ?? d.y ?? d) : parseFloat(d));
  const min_v = Math.min(...vals);
  const max_v = Math.max(...vals);
  const step = width > 1 ? (vals.length - 1) / (width - 1) : 0;

  // Build height x width grid
  const grid = Array.from({ length: height }, () => Array(width).fill(' '));

  for (let x = 0; x < width; x++) {
    const idx = Math.min(Math.round(x * step), vals.length - 1);
    const y = _scale(vals[idx], min_v, max_v, height);
    grid[height - 1 - y][x] = '*';
  }

  const y_label_width = Math.max(_fmt(max_v).length, _fmt(min_v).length) + 1;
  const lines = [];
  if (title) lines.push(title);

  for (let r = 0; r < height; r++) {
    const y_val = min_v + ((max_v - min_v) * (height - 1 - r) / Math.max(1, height - 1));
    const label = r === 0 ? _pad(_fmt(max_v), y_label_width) : r === height - 1 ? _pad(_fmt(min_v), y_label_width) : _pad('', y_label_width);
    lines.push(`${label} |${grid[r].join('')}`);
  }

  lines.push(`${_pad('', y_label_width)} +${'-'.repeat(width)}`);
  if (x_labels && x_labels.length) {
    lines.push(`${_pad('', y_label_width + 2)}${x_labels[0]}${_pad(x_labels[x_labels.length - 1] || '', width - (x_labels[0] || '').length)}`);
  }

  return { chart: lines.join('\n'), type: 'line', min: min_v, max: max_v };
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function op_sparkline(params) {
  const { data, label = '' } = params || {};
  if (!data || !data.length) throw new Error('data required');
  const BLOCKS = '▁▂▃▄▅▆▇█';
  const vals = data.map(d => typeof d === 'object' ? parseFloat(d.value ?? d) : parseFloat(d));
  const min_v = Math.min(...vals);
  const max_v = Math.max(...vals);
  const spark = vals.map(v => {
    const idx = max_v === min_v ? 4 : Math.round(((v - min_v) / (max_v - min_v)) * (BLOCKS.length - 1));
    return BLOCKS[idx];
  }).join('');
  const prefix = label ? `${label}: ` : '';
  return { chart: `${prefix}${spark}  min=${_fmt(min_v)} max=${_fmt(max_v)}`, type: 'sparkline' };
}

// ── Histogram ─────────────────────────────────────────────────────────────────

function op_histogram(params) {
  const { data, bins = 10, title = '', width = 40 } = params || {};
  if (!data || !data.length) throw new Error('data required');
  const vals = data.map(d => typeof d === 'object' ? parseFloat(d.value ?? d) : parseFloat(d)).filter(v => !isNaN(v));
  const min_v = Math.min(...vals);
  const max_v = Math.max(...vals);
  const range = max_v - min_v || 1;
  const bin_size = range / bins;

  const counts = new Array(bins).fill(0);
  for (const v of vals) {
    const idx = Math.min(bins - 1, Math.floor((v - min_v) / bin_size));
    counts[idx]++;
  }
  const max_count = Math.max(...counts);

  const lines = [];
  if (title) lines.push(title, '-'.repeat(title.length));

  for (let i = 0; i < bins; i++) {
    const lo = _fmt(min_v + i * bin_size, 1);
    const hi = _fmt(min_v + (i + 1) * bin_size, 1);
    const bar_len = max_count > 0 ? Math.round((counts[i] / max_count) * width) : 0;
    lines.push(`[${_pad(lo, 7)}-${_pad(hi, 7)}] ${'#'.repeat(bar_len)} ${counts[i]}`);
  }

  return { chart: lines.join('\n'), type: 'histogram', bins: counts };
}

// ── Scatter (ASCII) ───────────────────────────────────────────────────────────

function op_scatter(params) {
  const { data, title = '', width = 50, height = 20 } = params || {};
  if (!data || !data.length) throw new Error('data: [{x, y}] required');

  const xs = data.map(d => parseFloat(d.x));
  const ys = data.map(d => parseFloat(d.y));
  const min_x = Math.min(...xs), max_x = Math.max(...xs);
  const min_y = Math.min(...ys), max_y = Math.max(...ys);

  const grid = Array.from({ length: height }, () => Array(width).fill(' '));
  for (let i = 0; i < data.length; i++) {
    const gx = max_x === min_x ? Math.floor(width / 2) : Math.round(((xs[i] - min_x) / (max_x - min_x)) * (width - 1));
    const gy = max_y === min_y ? Math.floor(height / 2) : Math.round(((ys[i] - min_y) / (max_y - min_y)) * (height - 1));
    grid[height - 1 - gy][gx] = data[i].label ? data[i].label[0] : '.';
  }

  const y_w = 8;
  const lines = [];
  if (title) lines.push(title);
  for (let r = 0; r < height; r++) {
    const yv = min_y + ((max_y - min_y) * (height - 1 - r) / Math.max(1, height - 1));
    const yl = r === 0 || r === height - 1 ? _pad(_fmt(yv, 1), y_w) : _pad('', y_w);
    lines.push(`${yl} |${grid[r].join('')}`);
  }
  lines.push(`${_pad('', y_w)} +${'-'.repeat(width)}`);
  lines.push(`${_pad(_fmt(min_x, 1), y_w + 2)}${_pad(_fmt(max_x, 1), width - _fmt(min_x, 1).length)}`);

  return { chart: lines.join('\n'), type: 'scatter' };
}

// ── Pie chart (ASCII text-based) ─────────────────────────────────────────────

function op_pie(params) {
  const { data, title = '' } = params || {};
  if (!data || !data.length) throw new Error('data: [{label, value}] required');
  const FILLS = ['#', '*', '+', 'o', 'x', '-', '=', '@', '&', '%'];

  const items = data.map((d, i) => ({ label: String(d.label || i), value: parseFloat(d.value) }));
  const total = items.reduce((a, b) => a + b.value, 0);
  const lines = [];
  if (title) lines.push(title, '-'.repeat(title.length));

  for (let i = 0; i < items.length; i++) {
    const pct = total > 0 ? (items[i].value / total * 100).toFixed(1) : '0.0';
    const bar_len = total > 0 ? Math.round((items[i].value / total) * 40) : 0;
    const fill = FILLS[i % FILLS.length];
    lines.push(`  ${fill.repeat(bar_len)}  ${items[i].label}: ${items[i].value} (${pct}%)`);
  }
  lines.push(`  Total: ${total}`);

  return { chart: lines.join('\n'), type: 'pie', total };
}

// ── Entry ─────────────────────────────────────────────────────────────────────

async function run(op, params) {
  switch (op) {
    case 'bar':       return op_bar(params);
    case 'line':      return op_line(params);
    case 'sparkline': return op_sparkline(params);
    case 'histogram': return op_histogram(params);
    case 'scatter':   return op_scatter(params);
    case 'pie':       return op_pie(params);
    default:
      throw new Error(`Unknown op: ${op}. Available: bar, line, sparkline, histogram, scatter, pie`);
  }
}

module.exports = { MANIFEST, run };
