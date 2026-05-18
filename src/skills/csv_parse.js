'use strict';

// csv_parse.js — Read and query CSV files (no external deps)
// Ops: parse, query, columns, stats, to_jsonl

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB cap

function _parseLine(line, delimiter = ',') {
  // RFC 4180-compliant CSV line parser (handles quoted fields with commas/newlines)
  const fields = [];
  let field = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuote = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === delimiter) { fields.push(field); field = ''; }
      else { field += ch; }
    }
  }
  fields.push(field);
  return fields;
}

async function _loadCSV(file_path, delimiter = ',') {
  const abs = path.resolve(file_path);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);
  const stat = fs.statSync(abs);
  if (stat.size > MAX_FILE_SIZE) throw new Error(`File too large (${stat.size} bytes). Max: ${MAX_FILE_SIZE}.`);

  const rl = readline.createInterface({ input: fs.createReadStream(abs), crlfDelay: Infinity });
  const rows = [];
  let headers = null;
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    const fields = _parseLine(t, delimiter);
    if (!headers) { headers = fields; continue; }
    const row = {};
    headers.forEach((h, i) => { row[h] = fields[i] !== undefined ? fields[i] : ''; });
    rows.push(row);
  }
  return { headers: headers || [], rows };
}

// op: parse — load and return rows (with optional row limit)
async function op_parse(params) {
  const { file_path, delimiter = ',', limit = 100 } = params || {};
  if (!file_path) throw new Error('file_path required');
  const { headers, rows } = await _loadCSV(file_path, delimiter);
  return {
    file_path,
    total_rows: rows.length,
    columns: headers,
    rows: rows.slice(0, limit),
    truncated: rows.length > limit,
  };
}

// op: columns — return column names and sample values
async function op_columns(params) {
  const { file_path, delimiter = ',' } = params || {};
  if (!file_path) throw new Error('file_path required');
  const { headers, rows } = await _loadCSV(file_path, delimiter);
  const samples = {};
  for (const h of headers) {
    samples[h] = rows.slice(0, 3).map(r => r[h]).filter(v => v !== undefined);
  }
  return { file_path, columns: headers, sample_values: samples, total_rows: rows.length };
}

// op: query — filter rows by column value conditions
// params.filters: [{ column, op, value }]  op: eq, ne, contains, gt, lt, gte, lte
async function op_query(params) {
  const { file_path, delimiter = ',', filters = [], limit = 200, columns: select_cols } = params || {};
  if (!file_path) throw new Error('file_path required');
  const { headers, rows } = await _loadCSV(file_path, delimiter);

  function match(row, f) {
    const cell = String(row[f.column] || '');
    const val = String(f.value || '');
    switch (f.op) {
      case 'eq':       return cell === val;
      case 'ne':       return cell !== val;
      case 'contains': return cell.toLowerCase().includes(val.toLowerCase());
      case 'gt':       return parseFloat(cell) > parseFloat(val);
      case 'lt':       return parseFloat(cell) < parseFloat(val);
      case 'gte':      return parseFloat(cell) >= parseFloat(val);
      case 'lte':      return parseFloat(cell) <= parseFloat(val);
      default: throw new Error(`Unknown filter op: ${f.op}. Use: eq, ne, contains, gt, lt, gte, lte`);
    }
  }

  let result = rows;
  for (const f of filters) {
    if (!f.column) throw new Error('Each filter needs a column field.');
    if (!headers.includes(f.column)) throw new Error(`Column not found: ${f.column}`);
    result = result.filter(row => match(row, f));
  }

  // Project columns
  if (select_cols && select_cols.length) {
    result = result.map(row => {
      const out = {};
      for (const c of select_cols) out[c] = row[c];
      return out;
    });
  }

  return {
    file_path,
    filters_applied: filters.length,
    total_matched: result.length,
    rows: result.slice(0, limit),
    truncated: result.length > limit,
  };
}

// op: stats — numeric column statistics
async function op_stats(params) {
  const { file_path, delimiter = ',', column } = params || {};
  if (!file_path) throw new Error('file_path required');
  const { headers, rows } = await _loadCSV(file_path, delimiter);

  function colStats(col) {
    const vals = rows.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
    if (!vals.length) return { column: col, count: 0, note: 'no numeric values' };
    vals.sort((a, b) => a - b);
    const sum = vals.reduce((a, b) => a + b, 0);
    const mean = sum / vals.length;
    const mid = Math.floor(vals.length / 2);
    const median = vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
    const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
    return {
      column: col,
      count: vals.length,
      min: vals[0],
      max: vals[vals.length - 1],
      sum: parseFloat(sum.toFixed(6)),
      mean: parseFloat(mean.toFixed(6)),
      median: parseFloat(median.toFixed(6)),
      std_dev: parseFloat(Math.sqrt(variance).toFixed(6)),
    };
  }

  if (column) {
    if (!headers.includes(column)) throw new Error(`Column not found: ${column}`);
    return colStats(column);
  }

  // All columns
  return { file_path, stats: headers.map(colStats) };
}

// op: to_jsonl — write CSV rows as JSONL to output_path
async function op_to_jsonl(params) {
  const { file_path, output_path, delimiter = ',' } = params || {};
  if (!file_path) throw new Error('file_path required');
  if (!output_path) throw new Error('output_path required');
  const { rows } = await _loadCSV(file_path, delimiter);
  const abs_out = path.resolve(output_path);
  fs.writeFileSync(abs_out, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return { status: 'written', output_path: abs_out, rows_written: rows.length };
}

async function run(op, params) {
  switch (op) {
    case 'parse':    return op_parse(params);
    case 'columns':  return op_columns(params);
    case 'query':    return op_query(params);
    case 'stats':    return op_stats(params);
    case 'to_jsonl': return op_to_jsonl(params);
    default:
      throw new Error(`Unknown op: ${op}. Available: parse, columns, query, stats, to_jsonl`);
  }
}

const MANIFEST = {
  name: 'csv_parse',
  description: 'Read and query CSV files. Ops: parse, columns, query, stats, to_jsonl.',
  ops: ['parse', 'columns', 'query', 'stats', 'to_jsonl'],
};

module.exports = { MANIFEST, run };
