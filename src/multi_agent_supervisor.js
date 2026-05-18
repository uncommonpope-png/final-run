'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SUPERVISOR_STATE = path.join(__dirname, '..', '..', 'data', 'supervisor_state.json');
const AGENT_COMM_LOG = path.join(__dirname, '..', '..', 'data', 'agent_comm_log.jsonl');
const EXECUTION_LOG = path.join(__dirname, '..', '..', 'data', 'execution_log.jsonl');

let _skills = null;
let _memory = null;
function setSkills(s) { _skills = s; }
function setMemory(m) { _memory = m; }

const HIGH_RISK_OPS = new Set([
  'delete', 'remove', 'drop', 'truncate', 'purge',
  'exec', 'run', 'bash', 'shell',
  'send_email', 'http_post', 'telegram_send',
  'billing', 'payment', 'charge', 'refund'
]);

function _ensureDir(file) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _loadState() {
  _ensureDir(SUPERVISOR_STATE);
  if (!fs.existsSync(SUPERVISOR_STATE)) return {};
  try { return JSON.parse(fs.readFileSync(SUPERVISOR_STATE, 'utf8')); } catch { return {}; }
}

function _saveState(state) {
  fs.writeFileSync(SUPERVISOR_STATE, JSON.stringify(state, null, 2), 'utf8');
}

function _logComm(entry) {
  _ensureDir(AGENT_COMM_LOG);
  fs.appendFileSync(AGENT_COMM_LOG, JSON.stringify({ ...entry, ts: Date.now() }) + '\n', 'utf8');
}

function _logExec(entry) {
  _ensureDir(EXECUTION_LOG);
  fs.appendFileSync(EXECUTION_LOG, JSON.stringify({ ...entry, ts: Date.now() }) + '\n', 'utf8');
}

function _createSupervisor({ name, planning_agent, execution_agent, max_rounds = 5 }) {
  const state = _loadState();
  if (state[name]) throw new Error(`Supervisor "${name}" already exists`);
  
  state[name] = {
    id: crypto.randomBytes(6).toString('hex'),
    name,
    planning_agent,
    execution_agent,
    max_rounds,
    current_round: 0,
    status: 'idle',
    task_queue: [],
    completed_tasks: [],
    failed_tasks: [],
    handoffs: [],
    created_at: Date.now()
  };
  _saveState(state);
  return state[name];
}

async function _submitTask(supervisor, task, context = {}) {
  const state = _loadState();
  const sup = state[supervisor];
  if (!sup) throw new Error(`Supervisor "${supervisor}" not found`);
  
  sup.task_queue.push({
    id: crypto.randomBytes(4).toString('hex'),
    task,
    context,
    submitted_at: Date.now(),
    status: 'pending'
  });
  sup.status = 'running';
  _saveState(state);
  
  _logComm({ event: 'task_submitted', supervisor, task: task.slice(0, 100) });
  return sup.task_queue[sup.task_queue.length - 1];
}

async function _runPlanningRound(supervisor, task_id) {
  const state = _loadState();
  const sup = state[supervisor];
  const task = sup.task_queue.find(t => t.id === task_id);
  if (!task) throw new Error(`Task "${task_id}" not found`);
  
  task.status = 'planning';
  _saveState(state);
  
  _logExec({ event: 'planning_start', supervisor, task_id, round: sup.current_round + 1 });
  
  const planningResult = await _skills.run(sup.planning_agent, {
    op: 'execute',
    task: task.task,
    context: task.context,
    history: sup.completed_tasks.slice(-5)
  });
  
  const plan = planningResult.text || planningResult.result;
  task.plan = plan;
  task.status = 'planned';
  
  _logExec({ event: 'planning_complete', supervisor, task_id, plan: plan.slice(0, 200) });
  return { plan, confidence: planningResult.confidence || 0.7 };
}

async function _runExecutionRound(supervisor, task_id, plan, execution_context = {}) {
  const state = _loadState();
  const sup = state[supervisor];
  const task = sup.task_queue.find(t => t.id === task_id);
  
  task.status = 'executing';
  _saveState(state);
  
  _logExec({ event: 'execution_start', supervisor, task_id, plan: plan.slice(0, 100) });
  
  const execResult = await _skills.run(sup.execution_agent, {
    op: 'execute',
    plan,
    context: { ...task.context, ...execution_context }
  });
  
  task.execution_result = execResult;
  task.status = execResult.ok ? 'completed' : 'failed';
  
  if (execResult.ok) {
    sup.completed_tasks.push({ task_id, task: task.task, result: execResult, round: sup.current_round });
  } else {
    sup.failed_tasks.push({ task_id, task: task.task, error: execResult.error, round: sup.current_round });
  }
  
  sup.current_round++;
  _saveState(state);
  
  _logExec({ event: 'execution_complete', supervisor, task_id, ok: execResult.ok });
  return execResult;
}

async function _handoff(supervisor, from_agent, to_agent, task_id, reason) {
  const state = _loadState();
  const sup = state[supervisor];
  
  const handoff = {
    id: crypto.randomBytes(4).toString('hex'),
    from_agent,
    to_agent,
    task_id,
    reason,
    timestamp: Date.now(),
    completed: false
  };
  
  sup.handoffs.push(handoff);
  _saveState(state);
  
  _logComm({ event: 'handoff', supervisor, from: from_agent, to: to_agent, task_id, reason });
  
  return handoff;
}

async function _completeHandoff(supervisor, handoff_id, result) {
  const state = _loadState();
  const sup = state[supervisor];
  const handoff = sup.handoffs.find(h => h.id === handoff_id);
  if (!handoff) throw new Error(`Handoff "${handoff_id}" not found`);
  
  handoff.completed = true;
  handoff.result = result;
  _saveState(state);
  
  _logComm({ event: 'handoff_complete', supervisor, handoff_id });
  return handoff;
}

function _listSupervisors() {
  const state = _loadState();
  return Object.values(state).map(s => ({
    name: s.name,
    status: s.status,
    pending_tasks: s.task_queue.filter(t => t.status === 'pending').length,
    completed_tasks: s.completed_tasks.length,
    failed_tasks: s.failed_tasks.length,
    current_round: s.current_round
  }));
}

function _getSupervisorStatus(name) {
  const state = _loadState();
  const sup = state[name];
  if (!sup) throw new Error(`Supervisor "${name}" not found`);
  return sup;
}

async function _broadcastMessage(supervisor, message, from_agent, to_agents = []) {
  const state = _loadState();
  const sup = state[supervisor];
  if (!sup) throw new Error(`Supervisor "${supervisor}" not found`);
  
  const targets = to_agents.length ? to_agents : [sup.planning_agent, sup.execution_agent];
  
  for (const target of targets) {
    _logComm({
      event: 'message',
      supervisor,
      from: from_agent,
      to: target,
      message: message.slice(0, 100)
    });
  }
  
  return { broadcast: true, targets, message: message.slice(0, 50) };
}

function _checkInterAgentProtocol(msg) {
  const validProtocols = ['request', 'response', 'handoff', 'status_update', 'error', 'coordination'];
  const type = msg.type || 'request';
  return validProtocols.includes(type);
}

function _parseAgentMessage(msg) {
  try {
    if (typeof msg === 'string') {
      return JSON.parse(msg);
    }
    return msg;
  } catch {
    return { type: 'raw', content: msg };
  }
}

const MANIFEST = {
  name: 'multi_agent_supervisor',
  description: 'Supervisor pattern for multi-agent orchestration with planning/execution separation and inter-agent communication',
  ops: ['create_supervisor', 'submit_task', 'run_cycle', 'handoff', 'complete_handoff', 'list', 'status', 'broadcast', 'check_protocol']
};

async function run({ op, caller = 'unknown', ...args }) {
  switch (op) {
    case 'create_supervisor':
      return _createSupervisor(args);
    case 'submit_task':
      return _submitTask(args.supervisor, args.task, args.context || {});
    case 'run_cycle':
      const plan = await _runPlanningRound(args.supervisor, args.task_id);
      const result = await _runExecutionRound(args.supervisor, args.task_id, plan.plan, args.exec_context || {});
      return { plan: plan.plan, execution: result, confidence: plan.confidence };
    case 'handoff':
      return _handoff(args.supervisor, args.from_agent, args.to_agent, args.task_id, args.reason);
    case 'complete_handoff':
      return _completeHandoff(args.supervisor, args.handoff_id, args.result);
    case 'list':
      return _listSupervisors();
    case 'status':
      return _getSupervisorStatus(args.name);
    case 'broadcast':
      return _broadcastMessage(args.supervisor, args.message, args.from_agent, args.to_agents || []);
    case 'check_protocol':
      return { valid: _checkInterAgentProtocol(args.message) };
    default:
      throw new Error(`multi_agent_supervisor: unknown op "${op}"`);
  }
}

module.exports = { MANIFEST, run, setSkills, setMemory, HIGH_RISK_OPS };