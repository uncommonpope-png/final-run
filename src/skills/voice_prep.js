'use strict';

// voice_prep.js — format output for TTS with cadence markers and emphasis tags
// SCRIBE's voice is precise. This skill prepares it for the spoken word.

const MANIFEST = {
  name: 'voice_prep',
  description: 'Format text for TTS with cadence markers, emphasis, and spoken-word structure',
  ops: ['prepare', 'strip', 'emphasize', 'segment', 'ssml', 'preview']
};

// ── cadence rules ─────────────────────────────────────────────────────────────

// Pause weights in milliseconds for SSML break tags
const PAUSE = {
  sentence: 400,
  clause:   200,
  list_item: 150,
  heading:   600,
  emphasis:   0
};

// Words/phrases that should always be spoken with emphasis
const EMPHASIS_PATTERNS = [
  /\b(never|always|critical|immediately|confirmed|failed|success|warning|alert|profit|loss|signal|breach|resolved|open|closed)\b/gi,
  /\[!]/g,
  /\[\*]/g
];

// ── core transforms ───────────────────────────────────────────────────────────

function _clean(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')         // strip markdown bold
    .replace(/\*(.*?)\*/g, '$1')             // strip markdown italic
    .replace(/`([^`]+)`/g, '$1')             // strip code spans
    .replace(/#{1,6}\s*/g, '')               // strip markdown headings
    .replace(/\[!\]/g, 'ALERT:')             // [!] -> ALERT:
    .replace(/\[\*\]/g, 'NOTE:')             // [*] -> NOTE:
    .replace(/https?:\/\/\S+/g, '[link]')    // URLs -> [link]
    .replace(/\n{3,}/g, '\n\n')              // collapse excess blank lines
    .trim();
}

function _segment(text) {
  // Split into TTS segments: headings, sentences, list items
  const lines = _clean(text).split('\n').filter(l => l.trim());
  const segments = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect list items
    if (/^[-*•]\s+/.test(trimmed)) {
      segments.push({ type: 'list_item', text: trimmed.replace(/^[-*•]\s+/, ''), pause_after: PAUSE.list_item });
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      segments.push({ type: 'list_item', text: trimmed.replace(/^\d+\.\s+/, ''), pause_after: PAUSE.list_item });
      continue;
    }

    // Split line into sentences
    const sentences = trimmed.match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g) || [trimmed];
    for (const sent of sentences) {
      const s = sent.trim();
      if (s) segments.push({ type: 'sentence', text: s, pause_after: PAUSE.sentence });
    }
  }

  return segments;
}

function _emphasize(text) {
  // Wrap emphasis words with SSML-style markers for downstream processing
  let out = text;
  for (const pat of EMPHASIS_PATTERNS) {
    out = out.replace(pat, match => `<em>${match.replace(/[<>]/g, '')}</em>`);
  }
  return out;
}

function _ssml(text, { rate = 'medium', pitch = 'medium', voice = 'default' } = {}) {
  // Produce SSML markup for TTS engines (Amazon Polly, Google TTS, Azure)
  const segments = _segment(text);
  let body = '';

  for (const seg of segments) {
    let t = _emphasize(seg.text);
    // Replace <em> with SSML emphasis
    t = t.replace(/<em>(.*?)<\/em>/g, '<emphasis level="strong">$1</emphasis>');

    if (seg.type === 'list_item') {
      body += `${t}<break time="${PAUSE.list_item}ms"/> `;
    } else {
      body += `${t}<break time="${PAUSE.sentence}ms"/> `;
    }
  }

  return `<?xml version="1.0"?>
<speak version="1.1" xmlns="http://www.w3.org/2001/10/synthesis">
  <prosody rate="${rate}" pitch="${pitch}">
    ${body.trim()}
  </prosody>
</speak>`;
}

function _prepare(text, { format = 'plain', rate = 'medium', pitch = 'medium' } = {}) {
  // Master output: clean + optionally add cadence markers
  if (!text) throw new Error('text required');

  if (format === 'ssml') return { format: 'ssml', output: _ssml(text, { rate, pitch }) };

  if (format === 'segments') {
    return { format: 'segments', output: _segment(text) };
  }

  // Plain: clean + add ... pauses at clause boundaries
  const cleaned = _clean(text)
    .replace(/([,;:])\s+/g, '$1 ... ')      // clause pauses
    .replace(/\.\s+(?=[A-Z])/g, '. ... ');   // sentence pauses

  return { format: 'plain', output: cleaned };
}

function _strip(text) {
  // Remove all TTS markup and return raw readable text
  if (!text) throw new Error('text required');
  return _clean(text)
    .replace(/<[^>]+>/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function _preview(text) {
  // Return all formats for comparison
  if (!text) throw new Error('text required');
  return {
    plain:    _prepare(text, { format: 'plain' }).output,
    segments: _segment(text),
    ssml:     _ssml(text),
    char_count: text.length,
    segment_count: _segment(text).length
  };
}

// ── MANIFEST & run ────────────────────────────────────────────────────────────

async function run({ op, ...args }) {
  switch (op) {
    case 'prepare':   return _prepare(args.text, args);
    case 'strip':     return { output: _strip(args.text) };
    case 'emphasize': return { output: _emphasize(_clean(args.text || '')) };
    case 'segment':   return _segment(args.text || '');
    case 'ssml':      return { output: _ssml(args.text || '', args) };
    case 'preview':   return _preview(args.text);
    default:          throw new Error(`voice_prep: unknown op "${op}"`);
  }
}

module.exports = { MANIFEST, run };
