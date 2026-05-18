'use strict';

const fs = require('fs');
const path = require('path');

const HITL_STATE = path.join(__dirname, '..', '..', 'data', 'hitl_state.json');
const ESCALATION_LOG = path.join(__dirname, '..', '..', 'data', 'escalation_log.jsonl');
const FEEDBACK_LOG = path.join(__dirname, '..', '..', 'data', 'feedback_log.jsonl');
const HUMAN_CORRECTIONS = path.join(__dirname, '..', '..', 'data', 'human_corrections.jsonl');

let _skills = null;
let _memory = null;
function setSkills(s) { _skills = s; }
function setMemory(m) { _memory = m; }

const DEFAULT_THRESHOLDS = {
  confidence_low: 0.3,
  confidence_medium: 0.6,
  confidence_high: 0.85,
  auto_escalate_below: 0.25,
  require_approval_below: 0.5
};

const HIGH_RISK_PATTERNS = [
  { pattern: /delete|remove|drop|truncate|purge/i, risk: 0.95, label: 'data_deletion' },
  { pattern: /exec|run|bash|shell|command/i, risk: 0.9, label: 'command_execution' },
  { pattern: /send.*email|email.*send|smtp/i, risk: 0.85, label: 'external_communication' },
  { pattern: /payment|billing|charge|refund|invoice|credit/i, risk: 0.95, label: 'billing_change' },
  { pattern: /sudo|admin|root|privilege/i, risk: 0.9, label: 'privilege_escalation' },
  { pattern: /http_post|webhook|callback/i, risk: 0.7, label: 'external_api_call' },
  { pattern: /modify.*config|change.*setting|update.*system/i, risk: 0.8, label: 'system_modification' }
];

const RISK_ACTIONS = new Set(['delete', 'remove', 'drop', 'exec', 'run', 'send_email', 'payment', 'billing', 'sudo', 'admin']);

function _loadState() {
  if (!fs.existsSync(HITL_STATE)) return { thresholds: DEFAULT_THRESHOLDS, escalations: [], pending_approvals: [] };
  try { return JSON.parse(fs.readFileSync(HITL_STATE, 'utf8')); } catch { return {}; }
}

function _saveState(state) {
  fs.writeFileSync(HITL_STATE, JSON.stringify(state, null, 2), 'utf8');
}

function _logEscalation(entry) {
  fs.appendFileSync(ESCALATION_LOG, JSON.stringify({ ...entry, ts: Date.now() }) + '\n', 'utf8');
}

function _logFeedback(entry) {
  fs.appendFileSync(FEEDBACK_LOG, JSON.stringify({ ...entry, ts: Date.now() }) + '\n', 'utf8');
}

function _logCorrection(entry) {
  fs.appendFileSync(HUMAN_CORRECTIONS, JSON.stringify({ ...entry, ts: Date.now() }) + '\n', 'utf8');
}

function _assessRisk(action, params = {}) {
  let maxRisk = 0;
  let matchedPattern = null;
  
  for (const p of HIGH_RISK_PATTERNS) {
    const actionStr = JSON.stringify({ action, params });
    if (p.pattern.test(actionStr)) {
      if (p.risk > maxRisk) {
        maxRisk = p.risk;
        matchedPattern = p.label;
      }
    }
  }
  
  if (RISK_ACTIONS.has(action.toLowerCase()) && maxRisk < 0.5) {
    maxRisk = Math.max(maxRisk, 0.6);
  }
  
  return { risk: maxRisk, label: matchedPattern || 'standard', requires_escalation: maxRisk >= 0.8 };
}

function _classifyConfidence(score) {
  if (score >= DEFAULT_THRESHOLDS.confidence_high) return 'high';
  if (score >= DEFAULT_THRESHOLDS.confidence_medium) return 'medium';
  if (score >= DEFAULT_THRESHOLDS.confidence_low) return 'low';
  return 'critical';
}

function _shouldEscalate(action, confidence, params = {}) {
  const risk = _assessRisk(action, params);
  
  if (risk.requires_escalation) return { escalate: true, reason: `high_risk_action:${risk.label}`, risk: risk.risk };
  if (confidence < DEFAULT_THRESHOLDS.auto_escalate_below) return { escalate: true, reason: 'low_confidence', confidence };
  if (confidence < DEFAULT_THRESHOLDS.require_approval_below && risk.risk > 0.5) return { escalate: true, reason: 'medium_confidence_high_risk', confidence, risk: risk.risk };
  
  return { escalate: false };
}

async function _createEscalation({ task_id, action, confidence, risk, reason, context = {} }) {
  const state = _loadState();
  
  const escalation = {
    id: `esc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    task_id,
    action,
    confidence,
    risk,
    reason,
    context,
    status: 'pending',
    created_at: Date.now(),
    resolved_at: null,
    human_decision: null
  };
  
  state.escalations.push(escalation);
  state.pending_approvals.push(escalation.id);
  _saveState(state);
  
  _logEscalation({ event: 'escalation_created', task_id, action, confidence, risk, reason });
  
  if (_memory) {
    try {
      _memory.record({
        summary: `Escalation created for task "${task_id}": ${reason}`,
        tags: ['hitl', 'escalation', reason],
        data: { task_id, action, confidence, risk }
      });
    } catch {}
  }
  
  return escalation;
}

async function _resolveEscalation({ escalation_id, decision, reason, human_feedback }) {
  const state = _loadState();
  
  const esc = state.escalations.find(e => e.id === escalation_id);
  if (!esc) throw new Error(`Escalation "${escalation_id}" not found`);
  
  esc.status = decision === 'approved' ? 'approved' : 'rejected';
  esc.resolved_at = Date.now();
  esc.human_decision = decision;
  esc.human_reason = reason;
  esc.human_feedback = human_feedback;
  
  state.pending_approvals = state.pending_approvals.filter(id => id !== escalation_id);
  _saveState(state);
  
  _logEscalation({ event: 'escalation_resolved', escalation_id, decision, reason });
  
  if (human_feedback) {
    _storeCorrection(esc, human_feedback);
  }
  
  return esc;
}

function _storeCorrection(escalation, feedback) {
  const correction = {
    escalation_id: escalation.id,
    task_id: escalation.task_id,
    action: escalation.action,
    original_confidence: escalation.confidence,
    original_risk: escalation.risk,
    human_feedback: feedback,
    captured_at: Date.now()
  };
  
  _logCorrection(correction);
  
  if (_memory) {
    try {
      _memory.record({
        summary: `Human correction applied: ${feedback}`,
        tags: ['hitl', 'correction', escalation.action],
        data: correction
      });
    } catch {}
  }
}

async function _applyLearning(correction_patterns) {
  const state = _loadState();
  
  state.correction_patterns = state.correction_patterns || [];
  state.correction_patterns.push(...correction_patterns);
  
  if (state.correction_patterns.length > 100) {
    state.correction_patterns = state.correction_patterns.slice(-100);
  }
  
  _saveState(state);
  
  return { patterns_count: correction_patterns.length, total_patterns: state.correction_patterns.length };
}

function _getPendingEscalations() {
  const state = _loadState();
  return state.pending_approvals.map(id => state.escalations.find(e => e.id === id)).filter(Boolean);
}

function _getEscalationStats() {
  const state = _loadState();
  const escs = state.escalations || [];
  
  return {
    total: escs.length,
    pending: escs.filter(e => e.status === 'pending').length,
    approved: escs.filter(e => e.status === 'approved').length,
    rejected: escs.filter(e => e.status === 'rejected').length,
    by_reason: escs.reduce((acc, e) => {
      acc[e.reason] = (acc[e.reason] || 0) + 1;
      return acc;
    }, {})
  };
}

function _updateThresholds(newThresholds) {
  const state = _loadState();
  state.thresholds = { ...DEFAULT_THRESHOLDS, ...newThresholds };
  _saveState(state);
  return state.thresholds;
}

async function _preFlightCheck({ action, params = {}, confidence = 0.5 }) {
  const risk = _assessRisk(action, params);
  const shouldEscalate = _shouldEscalate(action, confidence, params);
  
  const result = {
    action,
    confidence,
    confidence_level: _classifyConfidence(confidence),
    risk: risk.risk,
    risk_label: risk.label,
    should_escalate: shouldEscalate.escalate,
    esculate_reason: shouldEscalate.reason || null,
    can_proceed: !shouldEscalate.escalate && risk.risk < 0.7
  };
  
  if (shouldEscalate.escalate && risk.requires_escalation) {
    const escalation = await _createEscalation({
      task_id: `preflight_${Date.now()}`,
      action,
      confidence,
      risk: risk.risk,
      reason: shouldEscalate.reason,
      context: params
    });
    result.escalation_id = escalation.id;
  }
  
  return result;
}

const MANIFEST = {
  name: 'hitl_controller',
  description: 'Human-in-the-Loop patterns with confidence thresholds, risk flagging, and feedback loops',
  ops: ['preflight_check', 'create_escalation', 'resolve_escalation', 'pending', 'stats', 'update_thresholds', 'apply_learning', 'assess_risk']
};

async function run({ op, caller = 'unknown', ...args }) {
  switch (op) {
    case 'preflight_check':
      return _preFlightCheck(args);
    case 'create_escalation':
      return _createEscalation(args);
    case 'resolve_escalation':
      return _resolveEscalation(args);
    case 'pending':
      return _getPendingEscalations();
    case 'stats':
      return _getEscalationStats();
    case 'update_thresholds':
      return _updateThresholds(args.thresholds);
    case 'apply_learning':
      return _applyLearning(args.patterns);
    case 'assess_risk':
      return _assessRisk(args.action, args.params || {});
    default:
      throw new Error(`hitl_controller: unknown op "${op}"`);
  }
}

module.exports = { MANIFEST, run, setSkills, setMemory, DEFAULT_THRESHOLDS, HIGH_RISK_PATTERNS };