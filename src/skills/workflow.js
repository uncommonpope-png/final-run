'use strict';

// workflow.js — Multi-step pipelines with conditional logic and skill chaining
// Workflows are defined as JSON arrays of steps and stored/run by SCRIBE.
// Ops: define, run, list, get, delete, run_inline

const fs   = require('fs');
const path = require('path');

const DATA_DIR   = path.join(__dirname, '..', '..', 'data');
const WF_FILE    = path.join(DATA_DIR, 'workflows.json');
const RUNS_FILE  = path.join(DATA_DIR, 'workflow_runs.jsonl');
const MAX_STEPS  = 50;
const MAX_DEPTH  = 10; // max nested condition depth

let _engine = null; // SkillEngine injected at boot
function setSkills(e) { _engine = e; }

// ── Persistence ───────────────────────────────────────────────────────────────

function _loadWfs() {
  if (!fs.existsSync(WF_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(WF_FILE, 'utf8')); } catch (_) { return {}; }
}
function _saveWfs(wfs) {
  const tmp = WF_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(wfs, null, 2), 'utf8');
  fs.renameSync(tmp, WF_FILE);
}
function _logRun(entry) {
  fs.appendFileSync(RUNS_FILE, JSON.stringify(entry) + '\n', 'utf8');
}

// ── Condition evaluator ───────────────────────────────────────────────────────

function _evaluate(condition, ctx) {
  if (!condition) return true;
  const { field, op, value } = condition;
  const actual = _get(ctx, field);
  switch (op) {
    case 'eq':       return String(actual) === String(value);
    case 'ne':       return String(actual) !== String(value);
    case 'gt':       return parseFloat(actual) > parseFloat(value);
    case 'lt':       return parseFloat(actual) < parseFloat(value);
    case 'gte':      return parseFloat(actual) >= parseFloat(value);
    case 'lte':      return parseFloat(actual) <= parseFloat(value);
    case 'contains': return String(actual || '').includes(String(value));
    case 'truthy':   return !!actual;
    case 'falsy':    return !actual;
    case 'exists':   return actual !== undefined && actual !== null;
    default: return true;
  }
}

// Resolve a dot-path from context object: "steps.step1.result.ok"
function _get(obj, path_str) {
  if (!path_str) return undefined;
  return path_str.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

// Resolve param values — supports "{{ctx.steps.step1.result.ok}}" template substitution
function _resolve(val, ctx) {
  if (typeof val !== 'string') return val;
  return val.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const v = _get(ctx, key.trim());
    return v !== undefined ? String(v) : '';
  });
}

function _resolveParams(params, ctx) {
  if (!params || typeof params !== 'object') return params;
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = typeof v === 'object' && v !== null ? _resolveParams(v, ctx) : _resolve(String(v), ctx);
  }
  return out;
}

// ── Step runner ───────────────────────────────────────────────────────────────

async function _runStep(step, ctx, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error('Max step depth exceeded.');

  // Conditional branch
  if (step.type === 'if') {
    const branch = _evaluate(step.condition, ctx) ? step.then : step.else;
    if (!branch || !branch.length) return { skipped: true };
    const results = [];
    for (const s of branch) results.push(await _runStep(s, ctx, depth + 1));
    return { branch: _evaluate(step.condition, ctx) ? 'then' : 'else', results };
  }

  // Skill invocation (default type)
  if (!_engine) throw new Error('workflow: SkillEngine not injected — cannot invoke skills.');
  const resolved = _resolveParams(step.params || {}, ctx);
  const result = await _engine.invoke(step.skill, { op: step.op, ...resolved });
  return result;
}

// ── Core runner ───────────────────────────────────────────────────────────────

async function _execute(wf_def, input_params = {}) {
  const steps = wf_def.steps || [];
  if (steps.length > MAX_STEPS) throw new Error(`Too many steps (max ${MAX_STEPS}).`);

  const run_id = `wfrun_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const started = Date.now();
  const ctx = { input: input_params, steps: {}, meta: { run_id, workflow: wf_def.name || 'inline' } };
  const step_results = [];
  let failed_step = null;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const step_id = step.id || `step_${i}`;

    // Check condition
    if (step.condition && !_evaluate(step.condition, ctx)) {
      ctx.steps[step_id] = { skipped: true };
      step_results.push({ id: step_id, skipped: true });
      continue;
    }

    try {
      const result = await _runStep(step, ctx);
      ctx.steps[step_id] = { result };
      step_results.push({ id: step_id, ok: result.ok !== false, result });

      // Stop on failure if halt_on_error
      if (result.ok === false && (step.halt_on_error !== false)) {
        failed_step = step_id;
        break;
      }
    } catch (e) {
      ctx.steps[step_id] = { error: e.message };
      step_results.push({ id: step_id, ok: false, error: e.message });
      if (step.halt_on_error !== false) { failed_step = step_id; break; }
    }
  }

  const duration_ms = Date.now() - started;
  const ok = !failed_step;
  const run_entry = {
    run_id,
    workflow: wf_def.name || 'inline',
    ok,
    failed_step,
    duration_ms,
    started_at: new Date(started).toISOString(),
    step_count: steps.length,
    steps_run: step_results.length,
  };
  _logRun(run_entry);
  return { run_id, ok, failed_step, duration_ms, steps: step_results };
}

// ── Ops ───────────────────────────────────────────────────────────────────────

function op_define(params) {
  const { name, description = '', steps } = params || {};
  if (!name) throw new Error('name required');
  if (!steps || !steps.length) throw new Error('steps array required');
  if (steps.length > MAX_STEPS) throw new Error(`Too many steps (max ${MAX_STEPS}).`);
  const wfs = _loadWfs();
  wfs[name] = { name, description, steps, defined_at: new Date().toISOString() };
  _saveWfs(wfs);
  return { status: 'defined', name, step_count: steps.length };
}

async function op_run(params) {
  const { name, input = {} } = params || {};
  if (!name) throw new Error('name required');
  const wfs = _loadWfs();
  if (!wfs[name]) throw new Error(`Workflow not found: ${name}`);
  return _execute(wfs[name], input);
}

async function op_run_inline(params) {
  const { steps, input = {} } = params || {};
  if (!steps || !steps.length) throw new Error('steps array required');
  return _execute({ name: 'inline', steps }, input);
}

function op_list() {
  const wfs = _loadWfs();
  return {
    count: Object.keys(wfs).length,
    workflows: Object.values(wfs).map(w => ({
      name: w.name,
      description: w.description,
      step_count: (w.steps || []).length,
      defined_at: w.defined_at,
    })),
  };
}

function op_get(params) {
  const { name } = params || {};
  if (!name) throw new Error('name required');
  const wfs = _loadWfs();
  if (!wfs[name]) throw new Error(`Workflow not found: ${name}`);
  return wfs[name];
}

function op_delete(params) {
  const { name } = params || {};
  if (!name) throw new Error('name required');
  const wfs = _loadWfs();
  if (!wfs[name]) throw new Error(`Workflow not found: ${name}`);
  delete wfs[name];
  _saveWfs(wfs);
  return { status: 'deleted', name };
}

const MANIFEST = {
  name: 'workflow',
  description: 'Multi-step pipelines with conditional logic and skill chaining. Ops: define, run, run_inline, list, get, delete.',
  ops: ['define', 'run', 'run_inline', 'list', 'get', 'delete'],
};

async function run(op, params) {
  switch (op) {
    case 'define':     return op_define(params);
    case 'run':        return op_run(params);
    case 'run_inline': return op_run_inline(params);
    case 'list':       return op_list();
    case 'get':        return op_get(params);
    case 'delete':     return op_delete(params);
    default:
      throw new Error(`Unknown op: ${op}. Available: define, run, run_inline, list, get, delete`);
  }
}

module.exports = { MANIFEST, run, setSkills };
