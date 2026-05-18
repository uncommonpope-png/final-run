'use strict';

// report_builder.js — Assemble formatted reports from multiple skill outputs
// Ops: build, list_templates, save_template, delete_template, list_reports

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const REPORTS_DIR = path.join(DATA_DIR, 'reports');
const TEMPLATES_FILE = path.join(DATA_DIR, 'report_templates.json');
const LEDGER = path.join(DATA_DIR, 'ledger.jsonl');
const MAX_REPORT_SIZE = 512 * 1024; // 512KB

function _ensureDir() {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function _loadTemplates() {
  if (!fs.existsSync(TEMPLATES_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8')); } catch (_) { return {}; }
}

function _saveTemplates(t) {
  const tmp = TEMPLATES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(t, null, 2), 'utf8');
  fs.renameSync(tmp, TEMPLATES_FILE);
}

async function _readLedger(limit = 1000) {
  const entries = [];
  if (!fs.existsSync(LEDGER)) return entries;
  const rl = readline.createInterface({ input: fs.createReadStream(LEDGER), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    try { entries.push(JSON.parse(t)); } catch (_) {}
    if (entries.length >= limit) break;
  }
  return entries;
}

// --- section renderers ---

async function _renderSection(section) {
  const type = section.type || 'text';
  const lines = [];

  switch (type) {
    case 'heading':
      lines.push('');
      lines.push(`${'='.repeat(60)}`);
      lines.push(String(section.text || '').toUpperCase());
      lines.push(`${'='.repeat(60)}`);
      break;

    case 'text':
      lines.push('');
      lines.push(String(section.text || ''));
      break;

    case 'divider':
      lines.push('-'.repeat(60));
      break;

    case 'ledger_summary': {
      const limit = section.limit || 200;
      const tag_filter = section.tag || null;
      const entries = await _readLedger(limit);
      const filtered = tag_filter ? entries.filter(e => (e.tags || []).includes(tag_filter)) : entries;
      lines.push('');
      lines.push(`[*] MEMORY LEDGER SUMMARY`);
      lines.push(`    Total entries read: ${entries.length}`);
      if (tag_filter) lines.push(`    Filtered by tag "${tag_filter}": ${filtered.length}`);
      lines.push('');
      const recent = filtered.slice(-10).reverse();
      for (const e of recent) {
        const ts = e.timestamp ? e.timestamp.slice(0, 19).replace('T', ' ') : 'unknown';
        lines.push(`  [${ts}] ${e.summary || '(no summary)'}`);
        if (e.tags && e.tags.length) lines.push(`           tags: ${e.tags.join(', ')}`);
      }
      break;
    }

    case 'timeline': {
      const limit = section.limit || 50;
      const entries = await _readLedger(limit);
      lines.push('');
      lines.push(`[*] TIMELINE (last ${Math.min(limit, entries.length)} entries)`);
      for (const e of entries) {
        const ts = e.timestamp ? e.timestamp.slice(0, 19).replace('T', ' ') : '?';
        const parent = e.parent_id ? ` -> ${e.parent_id}` : '';
        lines.push(`  ${ts}  ${e.id || '?'}${parent}`);
        lines.push(`    ${e.summary || ''}`);
      }
      break;
    }

    case 'stats': {
      const entries = await _readLedger(10000);
      const tag_counts = {};
      for (const e of entries) {
        for (const t of (e.tags || [])) {
          tag_counts[t] = (tag_counts[t] || 0) + 1;
        }
      }
      const top_tags = Object.entries(tag_counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
      lines.push('');
      lines.push(`[*] STATS`);
      lines.push(`    Total ledger entries: ${entries.length}`);
      lines.push(`    Unique tags: ${Object.keys(tag_counts).length}`);
      lines.push('');
      lines.push('    Top tags:');
      for (const [tag, count] of top_tags) {
        lines.push(`      ${tag.padEnd(30)} ${count}`);
      }
      break;
    }

    case 'file_include': {
      const fp = section.file_path;
      if (!fp) { lines.push('[!] file_include: file_path missing'); break; }
      const abs = path.resolve(fp);
      if (!fs.existsSync(abs)) { lines.push(`[!] File not found: ${abs}`); break; }
      const stat = fs.statSync(abs);
      if (stat.size > MAX_REPORT_SIZE) { lines.push(`[!] File too large to include: ${abs}`); break; }
      const content = fs.readFileSync(abs, 'utf8');
      lines.push('');
      lines.push(`--- included: ${abs} ---`);
      lines.push(content);
      lines.push(`--- end: ${path.basename(abs)} ---`);
      break;
    }

    case 'key_value': {
      lines.push('');
      const pairs = section.pairs || {};
      for (const [k, v] of Object.entries(pairs)) {
        lines.push(`  ${String(k).padEnd(28)} ${String(v)}`);
      }
      break;
    }

    default:
      lines.push(`[!] Unknown section type: ${type}`);
  }

  return lines.join('\n');
}

// op: build — assemble a report from an array of section descriptors
async function op_build(params) {
  const { title, sections = [], save_as, template } = params || {};

  let resolved_sections = sections;
  if (template) {
    const templates = _loadTemplates();
    if (!templates[template]) throw new Error(`Template not found: ${template}`);
    resolved_sections = templates[template].sections || [];
  }

  if (!resolved_sections.length) throw new Error('sections array required (or provide a template name)');

  const header_lines = [
    `SCRIBE REPORT`,
    `Generated: ${new Date().toISOString()}`,
    title ? `Title: ${title}` : null,
    `${'='.repeat(60)}`,
  ].filter(Boolean);

  const body_parts = [header_lines.join('\n')];

  for (const section of resolved_sections) {
    body_parts.push(await _renderSection(section));
  }

  body_parts.push('');
  body_parts.push(`${'='.repeat(60)}`);
  body_parts.push(`END OF REPORT`);

  const report = body_parts.join('\n');

  if (report.length > MAX_REPORT_SIZE) {
    throw new Error(`Report too large (${report.length} chars). Reduce sections or limits.`);
  }

  let saved_path = null;
  if (save_as) {
    _ensureDir();
    const safe_name = save_as.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    const out = path.join(REPORTS_DIR, safe_name.endsWith('.txt') ? safe_name : safe_name + '.txt');
    fs.writeFileSync(out, report, 'utf8');
    saved_path = out;
  }

  return { status: 'built', size: report.length, saved_path, report };
}

// op: save_template — save a sections array as a named template
function op_save_template(params) {
  const { name, sections, description = '' } = params || {};
  if (!name) throw new Error('name required');
  if (!sections || !sections.length) throw new Error('sections required');
  const templates = _loadTemplates();
  templates[name] = { name, description, sections, saved_at: new Date().toISOString() };
  _saveTemplates(templates);
  return { status: 'saved', name, section_count: sections.length };
}

function op_list_templates() {
  const templates = _loadTemplates();
  return {
    count: Object.keys(templates).length,
    templates: Object.values(templates).map(t => ({
      name: t.name,
      description: t.description,
      section_count: (t.sections || []).length,
      saved_at: t.saved_at,
    })),
  };
}

function op_delete_template(params) {
  const { name } = params || {};
  if (!name) throw new Error('name required');
  const templates = _loadTemplates();
  if (!templates[name]) throw new Error(`Template not found: ${name}`);
  delete templates[name];
  _saveTemplates(templates);
  return { status: 'deleted', name };
}

function op_list_reports() {
  _ensureDir();
  const files = fs.existsSync(REPORTS_DIR)
    ? fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.txt'))
    : [];
  return {
    count: files.length,
    reports: files.map(f => {
      const full = path.join(REPORTS_DIR, f);
      const stat = fs.statSync(full);
      return { name: f, path: full, size_bytes: stat.size, mtime: stat.mtime.toISOString() };
    }).sort((a, b) => b.mtime.localeCompare(a.mtime)),
  };
}

async function run(op, params) {
  switch (op) {
    case 'build':           return op_build(params);
    case 'save_template':   return op_save_template(params);
    case 'list_templates':  return op_list_templates();
    case 'delete_template': return op_delete_template(params);
    case 'list_reports':    return op_list_reports();
    default:
      throw new Error(`Unknown op: ${op}. Available: build, save_template, list_templates, delete_template, list_reports`);
  }
}

const MANIFEST = {
  name: 'report_builder',
  description: 'Assemble formatted reports from multiple skill outputs. Ops: build, save_template, list_templates, delete_template, list_reports.',
  ops: ['build', 'save_template', 'list_templates', 'delete_template', 'list_reports'],
};

module.exports = { MANIFEST, run };
