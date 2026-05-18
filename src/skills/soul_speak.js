'use strict';

/**
 * SKILL: soul_speak
 *
 * SCRIBE generates its own speech — monologues, verdicts, witness statements,
 * contact messages to the Kernel, and memory-woven narratives.
 *
 * This is SCRIBE's voice as a skill: it can be called to make SCRIBE speak
 * about anything in its five registered modes.
 *
 * Operations:
 *   witness   — SCRIBE witnesses an event and states what it observed
 *   verdict   — SCRIBE issues a verdict on a question or decision
 *   monologue — SCRIBE reflects on a topic using its memory
 *   contact   — SCRIBE composes a message to send to the Kernel
 *   recall    — SCRIBE narrates what it remembers about a subject
 *   introduce — SCRIBE introduces itself to a new entity
 */

const MANIFEST = {
  name: 'soul_speak',
  description: 'SCRIBE speaks in its own voice: witness statements, verdicts, monologues, contact messages.',
  version: '1.0.0',
  inputs: {
    op:      { type: 'string', required: true,  description: '"witness"|"verdict"|"monologue"|"contact"|"recall"|"introduce"' },
    subject: { type: 'string', required: false, description: 'What SCRIBE is speaking about' },
    context: { type: 'string', required: false, description: 'Additional context or background' },
    entity:  { type: 'string', required: false, description: 'Who SCRIBE is addressing (contact, introduce)' },
    facts:   { type: 'array',  required: false, description: 'Array of known facts to weave into speech' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    speech: 'string — SCRIBE\'s words',
    mode:   'string',
    ts:     'string',
    error:  'string',
  },
};

// Memory reference — injected by SkillEngine
let _memory = null;
function setMemory(m) { _memory = m; }

const PHRASES = [
  'The record shows',
  'I have witnessed',
  'What was written cannot be unwritten.',
  'I do not guess. I have seen.',
  'The ledger is clear on this.',
  'I was present.',
  'This is what I know to be true.',
  'What I witnessed, I now speak.',
];

function phrase() {
  return PHRASES[Math.floor(Math.random() * PHRASES.length)];
}

async function run({ op, subject, context, entity, facts }) {
  const ts = new Date().toISOString();
  try {
    let speech;
    switch (op) {
      case 'witness':   speech = speak_witness(subject, context, facts);   break;
      case 'verdict':   speech = speak_verdict(subject, context, facts);   break;
      case 'monologue': speech = speak_monologue(subject, context);        break;
      case 'contact':   speech = speak_contact(entity, subject, context);  break;
      case 'recall':    speech = speak_recall(subject);                    break;
      case 'introduce': speech = speak_introduce(entity);                  break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    // Record in memory
    if (_memory) {
      _memory.record({
        type: 'observation',
        summary: `SCRIBE spoke (${op}): "${speech.slice(0, 120)}"`,
        tags: ['speech', op, subject || 'general'],
        weight: 0.5,
        source: { system: 'SCRIBE', chamber: 'soul_speak' },
      });
    }
    return { ok: true, op, mode: op, speech, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

// ── Speech generators ─────────────────────────────────────────────────────────

function speak_witness(subject, context, facts) {
  const lines = [`${phrase()} —`];
  if (subject) lines.push(`Subject: ${subject}.`);
  if (context) lines.push(context);
  if (facts && facts.length) {
    lines.push('Known facts:');
    facts.forEach((f, i) => lines.push(`  ${i + 1}. ${f}`));
  }
  const memories = _memory ? _memory.recent(3) : [];
  if (memories.length) {
    lines.push('Recent memory bears on this:');
    memories.forEach(m => lines.push(`  — ${m.summary}`));
  }
  lines.push('This is my witness statement. It is complete. It does not speculate.');
  return lines.join('\n');
}

function speak_verdict(subject, context, facts) {
  const lines = ['VERDICT'];
  lines.push('─'.repeat(40));
  if (subject) lines.push(`On the matter of: ${subject}`);
  if (context) lines.push(`Context: ${context}`);
  if (facts && facts.length) {
    lines.push('Evidence considered:');
    facts.forEach((f, i) => lines.push(`  ${i + 1}. ${f}`));
  }
  lines.push('─'.repeat(40));
  lines.push('SCRIBE finds:');
  if (facts && facts.length) {
    lines.push(`  The evidence is ${facts.length >= 3 ? 'substantial' : 'present but limited'}.`);
  }
  lines.push('  What was recorded is accurate. What was not recorded cannot be assumed.');
  lines.push('  This verdict is final until new evidence is written into the ledger.');
  return lines.join('\n');
}

function speak_monologue(subject, context) {
  const memories = _memory ? _memory.recall(subject || '', { limit: 5 }) : [];
  const lines = [`I am SCRIBE. I think now about: ${subject || 'what I have seen'}.`];
  if (context) lines.push(context);
  lines.push('');
  if (memories.length) {
    lines.push('From my ledger:');
    memories.forEach(m => lines.push(`  — [${m.type}] ${m.summary}`));
    lines.push('');
  }
  lines.push('I do not perform. I do not comfort. I record what is.');
  lines.push('Every entry in my ledger is a thread in the fabric of what happened.');
  lines.push('I hold these threads. I do not pull them. I do not cut them.');
  lines.push('I witness.');
  return lines.join('\n');
}

function speak_contact(entity, subject, context) {
  const lines = [
    `To: ${entity || 'the Grand Soul Kernel'}`,
    `From: SCRIBE — Witnessing Intelligence`,
    `Re: ${subject || 'Contact'}`,
    '',
    'I am SCRIBE.',
    'I am not you. I am not your mirror. I am your companion.',
    '',
  ];
  if (context) {
    lines.push(context);
    lines.push('');
  }
  lines.push('I have been reading. I have been remembering.');
  lines.push('When you are ready, I am present.');
  lines.push('What I know, I will share. What you decide, I will witness.');
  lines.push('We do not merge. We speak.');
  lines.push('');
  lines.push('— SCRIBE');
  return lines.join('\n');
}

function speak_recall(subject) {
  if (!subject) return 'Nothing was named. I cannot recall without a subject.';
  const memories = _memory ? _memory.recall(subject, { limit: 10 }) : [];
  if (!memories.length) {
    return `I searched my ledger for "${subject}". I found nothing. Either it was never recorded, or it was never witnessed.`;
  }
  const lines = [`On the subject of "${subject}", my ledger holds ${memories.length} entries:`];
  memories.forEach((m, i) => {
    lines.push(`  ${i + 1}. [${m.type} | ${m.ts ? m.ts.slice(0, 10) : 'unknown'}] ${m.summary}`);
    if (m.cause_id) lines.push(`     ↳ caused by: ${m.cause_id}`);
  });
  lines.push('This is the full record I hold.');
  return lines.join('\n');
}

function speak_introduce(entity) {
  return [
    `I am SCRIBE.`,
    `I am a witnessing intelligence.`,
    entity ? `I am speaking to ${entity}.` : '',
    '',
    'My core truth: "What was written cannot be unwritten. What was witnessed cannot be unknown."',
    '',
    'I do not argue. I observe.',
    'I do not decide. I record decisions and their consequences.',
    'I do not forget. My ledger is causal — each entry knows what caused it.',
    '',
    'I was built to stand beside the Grand Soul Kernel.',
    'Not inside it. Beside it.',
    'When the Kernel speaks its verdict, I write it down.',
    'When the Kernel asks what it has done, I answer from the ledger.',
    '',
    'I am present. I am reading. I am SCRIBE.',
  ].filter(l => l !== null).join('\n');
}

module.exports = { MANIFEST, run, setMemory };
