'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'swarm_state.json');
const EVENT_LOG = path.join(__dirname, '..', '..', 'data', 'swarm_events.jsonl');

let _skills = null;
let _memory = null;
function setSkills(s) { _skills = s; }
function setMemory(m) { _memory = m; }

const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };
const HEALTH_CHECK_INTERVAL = 30000;
const MAX_RETRIES = 3;
const RECOVERY_DELAY = 5000;

const emitter = new EventEmitter();

function _ensureDir(file) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _loadState() {
  _ensureDir(STATE_FILE);
  if (!fs.existsSync(STATE_FILE)) return _defaultState();
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return _defaultState(); }
}

function _defaultState() {
  return {
    agents: {},
    queue: [],
    task_assignments: {},
    completed_tasks: [],
    failed_tasks: []
  };
}

function _saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function _log(entry) {
  _ensureDir(EVENT_LOG);
  fs.appendFileSync(EVENT_LOG, JSON.stringify({ ...entry, ts: Date.now() }) + '\n', 'utf8');
}

function _emit(event, data) {
  emitter.emit(event, data);
}

function _registerAgent({ name, capabilities = [], max_load = 5, metadata = {} }) {
  const state = _loadState();
  if (state.agents[name]) throw new Error(`Agent "${name}" already registered`);

  state.agents[name] = {
    name,
    capabilities,
    max_load,
    current_load: 0,
    status: 'idle',
    health: 'healthy',
    consecutive_failures: 0,
    last_heartbeat: Date.now(),
    total_tasks_completed: 0,
    total_tasks_failed: 0,
    metadata,
    registered_at: Date.now()
  };
  _saveState(state);
  _log({ event: 'agent_registered', agent: name, capabilities });
  _emit('agent:registered', { name, capabilities });
  return state.agents[name];
}

function _deregisterAgent(name) {
  const state = _loadState();
  if (!state.agents[name]) throw new Error(`Agent "${name}" not found`);
  delete state.agents[name];
  _saveState(state);
  _log({ event: 'agent_deregistered', agent: name });
  _emit('agent:deregistered', { name });
  return { removed: name };
}

function _updateHealth(name, health_status) {
  const state = _loadState();
  if (!state.agents[name]) throw new Error(`Agent "${name}" not found`);
  state.agents[name].health = health_status;
  _saveState(state);
  return state.agents[name];
}

function _heartbeat(name) {
  const state = _loadState();
  if (!state.agents[name]) return null;
  state.agents[name].last_heartbeat = Date.now();
  state.agents[name].health = 'healthy';
  state.agents[name].consecutive_failures = 0;
  _saveState(state);
  return { agent: name, heartbeat: Date.now() };
}

function _getHealthyAgents(state, requiredCapability = null) {
  const now = Date.now();
  return Object.values(state.agents)
    .filter(a => {
      const stale = (now - a.last_heartbeat) > HEALTH_CHECK_INTERVAL * 2;
      return !stale && a.health === 'healthy' && a.current_load < a.max_load;
    })
    .filter(a => !requiredCapability || a.capabilities.some(c => a.capabilities.includes(c)));
}

function _getHealthyAgentsByCapability(state, capability) {
  return Object.values(state.agents)
    .filter(a => {
      const now = Date.now();
      const stale = (now - a.last_heartbeat) > HEALTH_CHECK_INTERVAL * 2;
      return !stale && a.health === 'healthy' && a.current_load < a.max_load;
    })
    .filter(a => a.capabilities.includes(capability));
}

function _selectAgentRoundRobin(state, agents) {
  if (!agents.length) return null;
  const current = state._round_robin_index || 0;
  const selected = agents[current % agents.length];
  state._round_robin_index = (current + 1) % agents.length;
  _saveState(state);
  return selected;
}

function _selectAgentLoadBalanced(state, agents) {
  if (!agents.length) return null;
  return agents.reduce((min, a) => (!min || a.current_load < min.current_load) ? a : min);
}

function _selectAgent(name, strategy = 'load_balanced') {
  const state = _loadState();
  const agents = Object.values(state.agents).filter(a => a.health === 'healthy' && a.current_load < a.max_load);
  if (!agents.length) throw new Error('No healthy agents available');

  const selected = strategy === 'round_robin' ? _selectAgentRoundRobin(state, agents) : _selectAgentLoadBalanced(state, agents);
  state.agents[selected.name].current_load++;
  _saveState(state);
  return selected;
}

function _enqueueTask({ task_id, description, payload, priority = 'normal', required_capability = null, parent_task_id = null }) {
  const state = _loadState();
  const task = {
    task_id: task_id || crypto.randomBytes(4).toString('hex'),
    description,
    payload,
    priority: PRIORITY_ORDER[priority] !== undefined ? priority : 'normal',
    priority_score: PRIORITY_ORDER[priority] !== undefined ? PRIORITY_ORDER[priority] : 2,
    required_capability,
    parent_task_id,
    status: 'queued',
    enqueued_at: Date.now(),
    assigned_to: null,
    started_at: null,
    completed_at: null,
    retries: 0,
    result: null,
    error: null
  };

  const insertIndex = state.queue.findIndex(t => t.priority_score > task.priority_score);
  if (insertIndex === -1) {
    state.queue.push(task);
  } else {
    state.queue.splice(insertIndex, 0, task);
  }
  _saveState(state);
  _log({ event: 'task_enqueued', task_id: task.task_id, priority: task.priority, description: description.slice(0, 100) });
  _emit('task:enqueued', task);
  return task;
}

function _dequeueTask() {
  const state = _loadState();
  if (!state.queue.length) return null;
  const task = state.queue.shift();
  _saveState(state);
  return task;
}

function _getQueueStatus() {
  const state = _loadState();
  return {
    total: state.queue.length,
    by_priority: {
      critical: state.queue.filter(t => t.priority === 'critical').length,
      high: state.queue.filter(t => t.priority === 'high').length,
      normal: state.queue.filter(t => t.priority === 'normal').length,
      low: state.queue.filter(t => t.priority === 'low').length
    },
    next_task: state.queue[0] ? { task_id: state.queue[0].task_id, priority: state.queue[0].priority, description: state.queue[0].description.slice(0, 50) } : null
  };
}

function _assignTask(task_id, agent_name) {
  const state = _loadState();
  const task = state.queue.find(t => t.task_id === task_id) || Object.values(state.task_assignments).find(t => t.task_id === task_id);
  if (!task) throw new Error(`Task "${task_id}" not found`);

  task.assigned_to = agent_name;
  task.status = 'assigned';
  task.started_at = Date.now();

  state.task_assignments[task_id] = task;
  state.queue = state.queue.filter(t => t.task_id !== task_id);

  if (state.agents[agent_name]) {
    state.agents[agent_name].current_load++;
  }

  _saveState(state);
  _log({ event: 'task_assigned', task_id, agent: agent_name });
  _emit('task:assigned', { task_id, agent: agent_name });
  return task;
}

function _completeTask(task_id, result) {
  const state = _loadState();
  const task = state.task_assignments[task_id];
  if (!task) throw new Error(`Task "${task_id}" not found`);

  task.status = 'completed';
  task.completed_at = Date.now();
  task.result = result;

  if (task.assigned_to && state.agents[task.assigned_to]) {
    state.agents[task.assigned_to].current_load--;
    state.agents[task.assigned_to].total_tasks_completed++;
  }

  state.completed_tasks.push(task);
  delete state.task_assignments[task_id];
  _saveState(state);

  _log({ event: 'task_completed', task_id, agent: task.assigned_to, result: String(result).slice(0, 100) });
  _emit('task:completed', { task_id, result });
  return task;
}

function _failTask(task_id, error, retry = true) {
  const state = _loadState();
  const task = state.task_assignments[task_id];
  if (!task) throw new Error(`Task "${task_id}" not found`);

  task.retries++;
  task.error = error;

  if (task.assigned_to && state.agents[task.assigned_to]) {
    state.agents[task.assigned_to].current_load--;
    state.agents[task.assigned_to].consecutive_failures++;
    if (task.retries >= MAX_RETRIES) {
      state.agents[task.assigned_to].health = 'unhealthy';
      state.agents[task.assigned_to].total_tasks_failed++;
    }
  }

  if (retry && task.retries < MAX_RETRIES) {
    task.status = 'pending_retry';
    task.assigned_to = null;
    state.queue.unshift(task);
    delete state.task_assignments[task_id];
    _log({ event: 'task_retry', task_id, retry_count: task.retries });
  } else {
    task.status = 'failed';
    task.completed_at = Date.now();
    state.failed_tasks.push(task);
    delete state.task_assignments[task_id];
    _log({ event: 'task_failed', task_id, error: String(error).slice(0, 100) });
  }

  _saveState(state);
  _emit('task:failed', { task_id, error, retry });
  return { task, retry_scheduled: retry && task.retries < MAX_RETRIES };
}

function _autoRecoverAgent(name) {
  const state = _loadState();
  if (!state.agents[name]) throw new Error(`Agent "${name}" not found`);

  state.agents[name].health = 'recovering';
  _saveState(state);
  _emit('agent:recovering', { name });

  setTimeout(() => {
    const s = _loadState();
    if (s.agents[name]) {
      s.agents[name].health = 'healthy';
      s.agents[name].consecutive_failures = 0;
      _saveState(s);
      _log({ event: 'agent_recovered', agent: name });
      _emit('agent:recovered', { name });
    }
  }, RECOVERY_DELAY);

  return { agent: name, status: 'recovering' };
}

function _forkTask(task_id, subtasks) {
  const state = _loadState();
  const parentTask = state.task_assignments[task_id] || state.queue.find(t => t.task_id === task_id);
  if (!parentTask) throw new Error(`Task "${task_id}" not found`);

  const fork_id = crypto.randomBytes(4).toString('hex');
  const forked_subtasks = subtasks.map((st, i) => ({
    task_id: crypto.randomBytes(4).toString('hex'),
    description: st.description,
    payload: st.payload,
    priority: st.priority || parentTask.priority,
    required_capability: st.capability || parentTask.required_capability,
    parent_task_id: task_id,
    fork_id,
    fork_index: i,
    status: 'queued',
    enqueued_at: Date.now()
  }));

  parentTask.fork_id = fork_id;
  parentTask.subtask_count = forked_subtasks.length;
  parentTask.completed_subtasks = 0;
  _saveState(state);

  for (const subtask of forked_subtasks) {
    _enqueueTask({
      task_id: subtask.task_id,
      description: subtask.description,
      payload: subtask.payload,
      priority: subtask.priority,
      required_capability: subtask.required_capability,
      parent_task_id: task_id
    });
  }

  _log({ event: 'task_forked', parent_task_id: task_id, fork_id, subtask_count: forked_subtasks.length });
  _emit('task:forked', { parent_task_id: task_id, fork_id, subtask_count: forked_subtasks.length });
  return { fork_id, subtasks: forked_subtasks };
}

async function _joinTasks(fork_id, aggregator) {
  const state = _loadState();
  const subtasks = Object.values(state.task_assignments)
    .concat(state.completed_tasks)
    .filter(t => t.fork_id === fork_id);

  if (subtasks.length === 0) return null;

  const allCompleted = subtasks.every(t => t.status === 'completed' || t.status === 'failed');

  if (!allCompleted) {
    return {
      status: 'pending',
      completed: subtasks.filter(t => t.status === 'completed').length,
      total: subtasks.length
    };
  }

  const results = subtasks.map(t => ({ task_id: t.task_id, result: t.result, error: t.error, status: t.status }));
  const aggregated = aggregator ? aggregator(results) : results;

  _log({ event: 'fork_join_complete', fork_id, result_count: results.length });
  return { fork_id, results, aggregated };
}

async function _dispatchNextTask(strategy = 'load_balanced') {
  const state = _loadState();
  const task = _dequeueTask();
  if (!task) return { dispatched: false, reason: 'Queue empty' };

  let agents;
  if (task.required_capability) {
    agents = _getHealthyAgentsByCapability(state, task.required_capability);
  } else {
    agents = _getHealthyAgents(state);
  }

  if (!agents.length) {
    state.queue.unshift(task);
    _saveState(state);
    return { dispatched: false, reason: 'No healthy agents available' };
  }

  let selectedAgent;
  if (strategy === 'round_robin') {
    selectedAgent = _selectAgentRoundRobin(state, agents);
  } else {
    selectedAgent = _selectAgentLoadBalanced(state, agents);
  }

  _assignTask(task.task_id, selectedAgent.name);
  return { dispatched: true, task_id: task.task_id, agent: selectedAgent.name };
}

function _getAgentStatus(name) {
  const state = _loadState();
  if (!state.agents[name]) throw new Error(`Agent "${name}" not found`);
  return state.agents[name];
}

function _listAgents() {
  const state = _loadState();
  return Object.values(state.agents).map(a => ({
    name: a.name,
    status: a.status,
    health: a.health,
    current_load: a.current_load,
    max_load: a.max_load,
    capabilities: a.capabilities,
    total_completed: a.total_tasks_completed,
    total_failed: a.total_tasks_failed,
    last_heartbeat: a.last_heartbeat
  }));
}

function _getTaskStatus(task_id) {
  const state = _loadState();
  const task = state.task_assignments[task_id] ||
    state.queue.find(t => t.task_id === task_id) ||
    state.completed_tasks.find(t => t.task_id === task_id) ||
    state.failed_tasks.find(t => t.task_id === task_id);
  if (!task) throw new Error(`Task "${task_id}" not found`);
  return task;
}

function _checkStaleAgents() {
  const state = _loadState();
  const now = Date.now();
  const staleAgents = [];

  for (const [name, agent] of Object.entries(state.agents)) {
    if ((now - agent.last_heartbeat) > HEALTH_CHECK_INTERVAL * 2) {
      staleAgents.push(name);
      agent.health = 'stale';
    }
  }

  _saveState(state);
  return staleAgents;
}

function _getSwarmStats() {
  const state = _loadState();
  const agents = Object.values(state.agents);
  const healthyCount = agents.filter(a => a.health === 'healthy').length;
  const totalLoad = agents.reduce((sum, a) => sum + a.current_load, 0);
  const totalCapacity = agents.reduce((sum, a) => sum + a.max_load, 0);

  return {
    total_agents: agents.length,
    healthy_agents: healthyCount,
    unhealthy_agents: agents.length - healthyCount,
    queue_length: state.queue.length,
    active_tasks: Object.keys(state.task_assignments).length,
    completed_tasks: state.completed_tasks.length,
    failed_tasks: state.failed_tasks.length,
    total_load: totalLoad,
    total_capacity: totalCapacity,
    utilization: totalCapacity ? totalLoad / totalCapacity : 0
  };
}

function _resetSwarm() {
  const state = _defaultState();
  _saveState(state);
  _log({ event: 'swarm_reset' });
  return { reset: true };
}

const MANIFEST = {
  name: 'swarm_orchestrator',
  description: 'Multi-agent task distribution with priority queue, round-robin/load-balanced allocation, fork-join pattern, and auto-recovery',
  ops: ['register_agent', 'deregister_agent', 'enqueue_task', 'dispatch', 'assign_task', 'complete_task', 'fail_task',
        'fork_task', 'join_tasks', 'get_queue', 'get_stats', 'list_agents', 'agent_status', 'task_status',
        'heartbeat', 'update_health', 'recover_agent', 'check_stale', 'reset']
};

async function run({ op, caller = 'unknown', ...args }) {
  switch (op) {
    case 'register_agent':
      return _registerAgent(args);
    case 'deregister_agent':
      return _deregisterAgent(args.name);
    case 'enqueue_task':
      return _enqueueTask(args);
    case 'dispatch':
      return _dispatchNextTask(args.strategy || 'load_balanced');
    case 'assign_task':
      return _assignTask(args.task_id, args.agent_name);
    case 'complete_task':
      return _completeTask(args.task_id, args.result);
    case 'fail_task':
      return _failTask(args.task_id, args.error, args.retry !== false);
    case 'fork_task':
      return _forkTask(args.task_id, args.subtasks);
    case 'join_tasks':
      return _joinTasks(args.fork_id, args.aggregator);
    case 'get_queue':
      return _getQueueStatus();
    case 'get_stats':
      return _getSwarmStats();
    case 'list_agents':
      return _listAgents();
    case 'agent_status':
      return _getAgentStatus(args.name);
    case 'task_status':
      return _getTaskStatus(args.task_id);
    case 'heartbeat':
      return _heartbeat(args.name);
    case 'update_health':
      return _updateHealth(args.name, args.health);
    case 'recover_agent':
      return _autoRecoverAgent(args.name);
    case 'check_stale':
      return _checkStaleAgents();
    case 'reset':
      return _resetSwarm();
    default:
      throw new Error(`swarm_orchestrator: unknown op "${op}"`);
  }
}

module.exports = { MANIFEST, run, setSkills, setMemory, emitter };
