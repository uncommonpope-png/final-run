'use strict';

/**
 * SKILL: doc_convert
 *
 * Document conversion and text extraction using only Node built-ins.
 *
 * Operations:
 *   md_to_html      — convert Markdown to HTML
 *   html_to_text    — strip HTML tags, return plain text
 *   extract_text    — read a local file and return its text content
 *   md_to_sections  — parse Markdown into a structured array of sections (heading + body)
 *   json_to_md      — convert an array of objects to a Markdown table
 *   word_count      — count words, lines, chars in a text
 */

const fs   = require('fs');
const path = require('path');

const MANIFEST = {
  name: 'doc_convert',
  description: 'Convert Markdown to HTML, extract text, parse document structure, build Markdown tables.',
  version: '1.0.0',
  inputs: {
    op:       { type: 'string', required: true,  description: '"md_to_html"|"html_to_text"|"extract_text"|"md_to_sections"|"json_to_md"|"word_count"' },
    text:     { type: 'string', required: false, description: 'Input text (md_to_html, html_to_text, md_to_sections, word_count)' },
    filePath: { type: 'string', required: false, description: 'Local file path (extract_text)' },
    data:     { type: 'any',   required: false, description: 'Array of objects (json_to_md)' },
    columns:  { type: 'array', required: false, description: 'Column order for json_to_md (optional)' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any',
    error:  'string',
    ts:     'string',
  },
};

async function run({ op, text, filePath, data, columns }) {
  const ts = new Date().toISOString();
  try {
    let result;
    switch (op) {
      case 'md_to_html':     result = op_md_to_html(text);            break;
      case 'html_to_text':   result = op_html_to_text(text);          break;
      case 'extract_text':   result = op_extract_text(filePath);      break;
      case 'md_to_sections': result = op_md_to_sections(text);        break;
      case 'json_to_md':     result = op_json_to_md(data, columns);   break;
      case 'word_count':     result = op_word_count(text);            break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

// ── Operations ────────────────────────────────────────────────────────────────

function op_md_to_html(md) {
  if (!md) throw new Error('text is required');
  let html = md
    // Headings
    .replace(/^###### (.+)$/gm, '<h6>$1</h6>')
    .replace(/^##### (.+)$/gm, '<h5>$1</h5>')
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold / italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // HR
    .replace(/^---+$/gm, '<hr />')
    // Blockquote
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Unordered list items
    .replace(/^[*\-] (.+)$/gm, '<li>$1</li>')
    // Ordered list items
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Paragraphs (double newline)
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br />');

  return `<p>${html}</p>`;
}

function op_html_to_text(html) {
  if (!html) throw new Error('text is required');
  const text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li>/gi, '\n• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, length: text.length };
}

function op_extract_text(filePath) {
  if (!filePath) throw new Error('filePath is required');
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  const content = fs.readFileSync(resolved, 'utf-8');
  const ext = path.extname(resolved).toLowerCase();
  // Strip HTML tags if it's an HTML file
  const text = ['.html', '.htm'].includes(ext)
    ? op_html_to_text(content).text
    : content;
  return { file: resolved, ext, length: text.length, lines: text.split('\n').length, text: text.slice(0, 50000) };
}

function op_md_to_sections(md) {
  if (!md) throw new Error('text is required');
  const lines = md.split('\n');
  const sections = [];
  let current = null;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6}) (.+)$/);
    if (headingMatch) {
      if (current) sections.push(current);
      current = { level: headingMatch[1].length, heading: headingMatch[2], body: '' };
    } else if (current) {
      current.body += (current.body ? '\n' : '') + line;
    } else {
      if (!sections.length || sections[0].heading !== '__preamble__') {
        sections.unshift({ level: 0, heading: '__preamble__', body: '' });
      }
      sections[0].body += (sections[0].body ? '\n' : '') + line;
    }
  }
  if (current) sections.push(current);
  return { section_count: sections.length, sections };
}

function op_json_to_md(data, columns) {
  if (!data) throw new Error('data is required');
  const arr = typeof data === 'string' ? JSON.parse(data) : data;
  if (!Array.isArray(arr) || arr.length === 0) throw new Error('data must be a non-empty array');

  const cols = columns || Object.keys(arr[0]);
  const header = `| ${cols.join(' | ')} |`;
  const divider = `| ${cols.map(() => '---').join(' | ')} |`;
  const rows = arr.map(row =>
    `| ${cols.map(c => String(row[c] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`
  );
  const table = [header, divider, ...rows].join('\n');
  return { table, rows: arr.length, columns: cols.length };
}

function op_word_count(text) {
  if (!text) throw new Error('text is required');
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const lines = text.split('\n').length;
  const chars = text.length;
  const chars_no_space = text.replace(/\s/g, '').length;
  return { words, lines, chars, chars_no_space };
}

module.exports = { MANIFEST, run };
