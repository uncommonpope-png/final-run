'use strict';

/**
 * SKILL: retry
 *
 * Wrap any skill call with retry and exponential backoff logic.
 * SCRIBE uses this when calling unstable external resources.
 *
 * Operations:
 *   invoke  — invoke a skill with retry logic
 *   policy  — describe a retry policy without executing
 */

const MANIFEST = {
  name: 'retry',
  description: 'Wrap a skill invocation with retry and exponential backoff.',
  version: '1.0.0',
  inputs: {
    op:           { type: 'string', required: true,  description: '"invoke"|"policy"' },
    skill:        { type: 'string', required: false, description: 'Skill name to invoke (invoke op)' },
    params:       { type: 'object', required: false, description: 'Parameters for the skill (invoke op)' },
    max_attempts: { type: 'number', required: false, description: 'Max attempts (default 3)' },
    base_delay_ms:{ type: 'number', required: false, description: 'Base delay in ms (default 500)' },
    max_delay_ms: { type: 'number', required: false, description: 'Max delay between retries (default 10000)' },
  },
  output: {
    ok:       'boolean',
    op:       'string',
    result:   'any',
    attempts: 'number',
    error:    'string',
    ts:       'string',
  },
};

let _skills = null;
function setSkills(s) { _skills = s; }

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run({ op, skill, params = {}, max_attempts = 3, base_delay_ms = 500, max_delay_ms = 10000 }) {
  const ts = new Date().toISOString();
  try {
    switch (op) {
      case 'policy':
        return { ok: true, op, result: { max_attempts, base_delay_ms, max_delay_ms, strategy: 'exponential_backoff' }, ts };

      case 'invoke': {
        if (!skill) return { ok: false, op, error: 'skill is required', attempts: 0, ts };
        if (!_skills) return { ok: false, op, error: 'SkillEngine not wired — setSkills() not called', attempts: 0, ts };

        let lastError = null;
        for (let attempt = 1; attempt <= max_attempts; attempt++) {
          try {
            const result = await _skills.invoke(skill, params);
            if (result.ok) {
              return { ok: true, op, result, attempts: attempt, ts };
            }
            lastError = result.error || 'skill returned ok=false';
          } catch (e) {
            lastError = e.message;
          }

          if (attempt < max_attempts) {
            const delay = Math.min(base_delay_ms * Math.pow(2, attempt - 1), max_delay_ms);
            await sleep(delay);
          }
        }

        return { ok: false, op, error: `Failed after ${max_attempts} attempts: ${lastError}`, attempts: max_attempts, ts };
      }

      default:
        return { ok: false, op, error: `Unknown op: ${op}`, attempts: 0, ts };
    }
  } catch (e) {
    return { ok: false, op, error: e.message, attempts: 0, ts };
  }
}

module.exports = { MANIFEST, run, setSkills };
