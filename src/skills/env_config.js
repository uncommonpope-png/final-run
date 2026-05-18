'use strict';

/**
 * SKILL: env_config
 *
 * Read and validate environment variables.
 * Reports what is set, what is missing, and what SCRIBE needs to operate fully.
 *
 * Operations:
 *   read     — read a specific env var (value redacted if it looks like a secret)
 *   list     — list all SCRIBE-relevant env vars and their status
 *   validate — check that required vars are present; return missing list
 */

const MANIFEST = {
  name: 'env_config',
  description: 'Read and validate environment variables. Report missing required config.',
  version: '1.0.0',
  inputs: {
    op:   { type: 'string', required: true,  description: '"read"|"list"|"validate"' },
    key:  { type: 'string', required: false, description: 'Env var name (read op)' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any',
    error:  'string',
    ts:     'string',
  },
};

// Known SCRIBE env vars and whether they're required
const KNOWN_VARS = [
  { key: 'PORT',             required: false, secret: false, description: 'HTTP port (default 4000)' },
  { key: 'KERNEL_ENDPOINT',  required: false, secret: false, description: 'AGM/Kernel HTTP endpoint' },
  { key: 'SCRIBE_API_KEY',   required: false, secret: true,  description: 'API key to protect /invoke' },
  { key: 'GH_TOKEN',         required: false, secret: true,  description: 'GitHub token (read access)' },
  { key: 'GITHUB_TOKEN',     required: false, secret: true,  description: 'GitHub token (alternate name)' },
  { key: 'TELEGRAM_BOT_TOKEN', required: false, secret: true, description: 'Telegram bot token' },
  { key: 'TELEGRAM_CHAT_ID', required: false, secret: false, description: 'Telegram default chat ID' },
];

function redact(val) {
  if (!val) return null;
  if (val.length <= 6) return '***';
  return val.slice(0, 3) + '***' + val.slice(-3);
}

async function run({ op, key }) {
  const ts = new Date().toISOString();
  try {
    let result;
    switch (op) {
      case 'read':     result = op_read(key);     break;
      case 'list':     result = op_list();        break;
      case 'validate': result = op_validate();    break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

function op_read(key) {
  if (!key) throw new Error('key is required');
  const val = process.env[key];
  const known = KNOWN_VARS.find(v => v.key === key);
  const isSecret = known?.secret || key.toLowerCase().includes('token') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('key');
  return {
    key,
    set: val !== undefined,
    value: isSecret ? redact(val) : (val || null),
    description: known?.description || 'Unknown var',
  };
}

function op_list() {
  return {
    vars: KNOWN_VARS.map(v => {
      const val = process.env[v.key];
      return {
        key: v.key,
        required: v.required,
        set: val !== undefined,
        value: v.secret ? redact(val) : (val || null),
        description: v.description,
      };
    }),
  };
}

function op_validate() {
  const required = KNOWN_VARS.filter(v => v.required);
  const missing = required.filter(v => !process.env[v.key]);
  const present = required.filter(v => !!process.env[v.key]);
  return {
    valid: missing.length === 0,
    required_count: required.length,
    present: present.map(v => v.key),
    missing: missing.map(v => ({ key: v.key, description: v.description })),
  };
}

module.exports = { MANIFEST, run };
