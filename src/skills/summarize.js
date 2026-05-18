'use strict';

/**
 * SKILL: summarize
 *
 * Compress batches of SCRIBE's memory into high-level summaries.
 * Produces daily briefings, topic digests, period roll-ups, and
 * compressed overviews of what happened across a time range.
 *
 * No external dependencies. Pure text analysis over the JSONL ledger.
 *
 * Operations:
 *   daily_briefing  — summarize today's (or a given date's) memory entries
 *   period_rollup   — summarize entries over a from/to date range
 *   topic_digest    — summarize all entries relating to a topic/tag
 *   compress        — reduce N entries to a compact bullet-point overview
 *   latest          — natural-language summary of the last N entries
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const LEDGER_FILE = path.join(__dirname, '..', '..', 'data', 'ledger.jsonl');

const MANIFEST = {
  name: 'summarize',
  description: 'Compress SCRIBE memory into daily briefings, topic digests, period roll-ups, and compact overviews.',
  version: '1.0.0',
  inputs: {
    op:      { type: 'string', required: true,  description: '"daily_briefing"|"period_rollup"|"topic_digest"|"compress"|"latest"' },
    date:    { type: 'string', required: false, description: 'ISO date YYYY-MM-DD (daily_briefing)' },
    from:    { type: 'string', required: false, description: 'ISO start date (period_rollup)' },
    to:      { type: 'string', required: false, description: 'ISO end date (period_rollup)' },
    topic:   { type: 'string', required: false, description: 'Tag or keyword (topic_digest)' },
    entries: { type: 'array',  required: false, description: 'Explicit array of memory entries to compress (compress op)' },
    limit:   { type: 'number', required: false, description: 'Max entries to consider (latest op, default 20)' },
    format:  { type: 'string', required: false, description: '"text" (default) or "markdown"' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any',
    error:  'string',
    ts:     'string',
  },
};

// ── Loader ────────────────────────────────────────────────────────────────────

function load_ledger() {
  if (!fs.existsSync(LEDGER_FILE)) return [];
  const raw = fs.readFileSync(LEDGER_FILE, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run({ op, date, from, to, topic, entries: given_entries, limit = 20, format = 'text' }) {
  const ts = new Date().toISOString();
  try {
    const all = load_ledger();
    let result;
    switch (op) {
      case 'daily_briefing': result = op_daily_briefing(all, date || ts.slice(0, 10), format); break;
      case 'period_rollup':  result = op_period_rollup(all, from, to, format);                 break;
      case 'topic_digest':   result = op_topic_digest(all, topic, format);                     break;
      case 'compress':       result = op_compress(given_entries || all.slice(-limit), format); break;
      case 'latest':         result = op_latest(all, limit, format);                           break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

// ── Operations ────────────────────────────────────────────────────────────────

function op_daily_briefing(all, date, format) {
  const entries = all.filter(e => e.ts && e.ts.startsWith(date));
  if (!entries.length) return { date, entry_count: 0, briefing: `No memories recorded on ${date}.` };

  const by_type = bucket_by_type(entries);
  const top = entries.filter(e => (e.weight || 0) >= 0.7);
  const tags = top_tags(entries, 5);
  const causal = entries.filter(e => e.cause_id || e.parent_id).length;

  const lines = format === 'markdown'
    ? build_md_briefing(date, entries, by_type, top, tags, causal)
    : build_text_briefing(date, entries, by_type, top, tags, causal);

  return { date, entry_count: entries.length, high_weight_count: top.length, top_tags: tags, briefing: lines };
}

function op_period_rollup(all, from, to, format) {
  if (!from) throw new Error('from is required');
  const entries = all.filter(e => {
    if (!e.ts) return false;
    if (from && e.ts < from) return false;
    if (to   && e.ts > to + 'T23:59:59') return false;
    return true;
  });
  if (!entries.length) return { from, to, entry_count: 0, rollup: `No memories in range ${from} — ${to || 'now'}.` };

  const days = new Set(entries.map(e => e.ts?.slice(0, 10))).size;
  const by_type = bucket_by_type(entries);
  const top = entries.filter(e => (e.weight || 0) >= 0.7).slice(0, 10);
  const tags = top_tags(entries, 8);
  const sources = top_sources(entries, 5);

  const rollup = format === 'markdown'
    ? build_md_rollup(from, to, entries, days, by_type, top, tags, sources)
    : build_text_rollup(from, to, entries, days, by_type, top, tags, sources);

  return { from, to: to || 'now', entry_count: entries.length, days_covered: days, top_tags: tags, rollup };
}

function op_topic_digest(all, topic, format) {
  if (!topic) throw new Error('topic is required');
  const q = topic.toLowerCase();
  const entries = all.filter(e =>
    (e.tags || []).some(t => t.toLowerCase().includes(q)) ||
    (e.summary || '').toLowerCase().includes(q)
  );
  if (!entries.length) return { topic, entry_count: 0, digest: `No memories found for topic: ${topic}` };

  const first_seen = entries[0]?.ts;
  const last_seen  = entries[entries.length - 1]?.ts;
  const avg_weight = +(entries.reduce((s, e) => s + (e.weight || 0), 0) / entries.length).toFixed(3);
  const by_type    = bucket_by_type(entries);

  const digest = format === 'markdown'
    ? build_md_digest(topic, entries, first_seen, last_seen, avg_weight, by_type)
    : build_text_digest(topic, entries, first_seen, last_seen, avg_weight, by_type);

  return { topic, entry_count: entries.length, first_seen, last_seen, avg_weight, digest };
}

function op_compress(entries, format) {
  if (!entries || !entries.length) return { entry_count: 0, summary: 'No entries to compress.' };

  // Group by type
  const by_type = bucket_by_type(entries);
  const top     = entries.filter(e => (e.weight || 0) >= 0.7).sort((a, b) => (b.weight || 0) - (a.weight || 0)).slice(0, 5);
  const tags    = top_tags(entries, 6);

  const lines = [];
  if (format === 'markdown') {
    lines.push(`**${entries.length} entries compressed.**`);
    lines.push('');
    lines.push(`**By type:** ${Object.entries(by_type).map(([t, c]) => `${t}: ${c}`).join(', ')}`);
    lines.push(`**Top tags:** ${tags.map(t => `\`${t}\``).join(', ')}`);
    if (top.length) {
      lines.push('');
      lines.push('**Key events:**');
      for (const e of top) lines.push(`- [${e.type}] ${e.summary} *(weight: ${e.weight})*`);
    }
  } else {
    lines.push(`${entries.length} entries compressed.`);
    lines.push(`By type: ${Object.entries(by_type).map(([t, c]) => `${t}(${c})`).join(', ')}`);
    lines.push(`Top tags: ${tags.join(', ')}`);
    if (top.length) {
      lines.push('Key events:');
      for (const e of top) lines.push(`  [${e.type}] (w:${e.weight}) ${e.summary}`);
    }
  }

  return { entry_count: entries.length, by_type, top_tags: tags, summary: lines.join('\n') };
}

function op_latest(all, limit, format) {
  const entries = all.slice(-limit);
  return op_compress(entries, format);
}

// ── Builders ──────────────────────────────────────────────────────────────────

function build_text_briefing(date, entries, by_type, top, tags, causal) {
  const lines = [
    `SCRIBE DAILY BRIEFING — ${date}`,
    '═'.repeat(42),
    `Total entries: ${entries.length}  |  High-weight: ${top.length}  |  Causal links: ${causal}`,
    `By type: ${Object.entries(by_type).map(([t, c]) => `${t}(${c})`).join(', ')}`,
    `Top topics: ${tags.join(', ')}`,
    '',
    'Notable events:',
  ];
  for (const e of top) lines.push(`  [${e.type}] ${e.summary}`);
  if (!top.length) lines.push('  (none above weight 0.7)');
  return lines.join('\n');
}

function build_md_briefing(date, entries, by_type, top, tags, causal) {
  const lines = [
    `# SCRIBE Daily Briefing — ${date}`,
    '',
    `| Metric | Value |`,
    `|---|---|`,
    `| Total entries | ${entries.length} |`,
    `| High-weight (>=0.7) | ${top.length} |`,
    `| Causal links | ${causal} |`,
    `| Top topics | ${tags.join(', ')} |`,
    '',
    '## Notable Events',
  ];
  for (const e of top) lines.push(`- **[${e.type}]** ${e.summary} *(w: ${e.weight})*`);
  if (!top.length) lines.push('_None above weight 0.7._');
  return lines.join('\n');
}

function build_text_rollup(from, to, entries, days, by_type, top, tags, sources) {
  const lines = [
    `SCRIBE PERIOD ROLL-UP — ${from} to ${to || 'now'}`,
    '═'.repeat(42),
    `${entries.length} entries across ${days} day(s)`,
    `By type: ${Object.entries(by_type).map(([t, c]) => `${t}(${c})`).join(', ')}`,
    `Top topics: ${tags.join(', ')}`,
    `Top sources: ${sources.join(', ')}`,
    '',
    'Highest-weight events:',
  ];
  for (const e of top) lines.push(`  [${e.type}] ${e.summary?.slice(0, 100)}`);
  return lines.join('\n');
}

function build_md_rollup(from, to, entries, days, by_type, top, tags, sources) {
  const lines = [
    `# SCRIBE Period Roll-Up`,
    `**${from}** to **${to || 'now'}** — ${entries.length} entries over ${days} day(s)`,
    '',
    `**By type:** ${Object.entries(by_type).map(([t, c]) => `${t}: ${c}`).join(', ')}`,
    `**Top topics:** ${tags.join(', ')}`,
    `**Top sources:** ${sources.join(', ')}`,
    '',
    '## Highest-Weight Events',
  ];
  for (const e of top) lines.push(`- **[${e.type}]** ${e.summary?.slice(0, 100)} *(${e.ts?.slice(0, 10)})*`);
  return lines.join('\n');
}

function build_text_digest(topic, entries, first_seen, last_seen, avg_weight, by_type) {
  const lines = [
    `SCRIBE TOPIC DIGEST — "${topic}"`,
    '═'.repeat(42),
    `${entries.length} entries  |  avg weight: ${avg_weight}`,
    `First seen: ${first_seen?.slice(0, 19) || '?'}  |  Last seen: ${last_seen?.slice(0, 19) || '?'}`,
    `By type: ${Object.entries(by_type).map(([t, c]) => `${t}(${c})`).join(', ')}`,
    '',
    'Recent entries:',
  ];
  for (const e of entries.slice(-5)) lines.push(`  [${e.ts?.slice(0, 19)}] ${e.summary?.slice(0, 100)}`);
  return lines.join('\n');
}

function build_md_digest(topic, entries, first_seen, last_seen, avg_weight, by_type) {
  const lines = [
    `# SCRIBE Topic Digest — "${topic}"`,
    '',
    `**${entries.length} entries** | avg weight: ${avg_weight}`,
    `First seen: \`${first_seen?.slice(0, 10)}\` | Last seen: \`${last_seen?.slice(0, 10)}\``,
    '',
    '## Recent Entries',
  ];
  for (const e of entries.slice(-5)) lines.push(`- \`${e.ts?.slice(0, 19)}\` [${e.type}] ${e.summary?.slice(0, 100)}`);
  return lines.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function bucket_by_type(entries) {
  const out = {};
  for (const e of entries) out[e.type || 'unknown'] = (out[e.type || 'unknown'] || 0) + 1;
  return out;
}

function top_tags(entries, n) {
  const counts = {};
  for (const e of entries) for (const t of (e.tags || [])) counts[t] = (counts[t] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

function top_sources(entries, n) {
  const counts = {};
  for (const e of entries) {
    const src = e.source?.system || e.source?.chamber || 'unknown';
    counts[src] = (counts[src] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([s]) => s);
}

module.exports = { MANIFEST, run };
