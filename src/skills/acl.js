'use strict';

// acl.js — Access control lists for SCRIBE skill invocations
// Callers present a caller_id; ACL rules grant or deny skill/op combinations.
// Ops: grant, revoke, check, list, clear, audit_log

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const DATA_DIR  = path.join(__dirname, '..', '..', 'data');
const ACL_FILE  = path.join(DATA_DIR, 'acl.json');
const ALOG_FILE = path.join(DATA_DIR, 'acl_audit.jsonl');

// Rule format: { caller_id, skill, op, effect: 'allow'|'deny', granted_at, note }
// skill and op can be '*' for wildcard

function _load() {
  if (!fs.existsSync(ACL_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(ACL_FILE, 'utf8')); } catch (_) { return []; }
}
function _save(rules) {
  const tmp = ACL_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rules, null, 2), 'utf8');
  fs.renameSync(tmp, ACL_FILE);
}
function _audit(entry) {
  fs.appendFileSync(ALOG_FILE, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n', 'utf8');
}

function _matches(rule, caller_id, skill, op) {
  const cid = rule.caller_id === '*' || rule.caller_id === caller_id;
  const sk  = rule.skill    === '*' || rule.skill    === skill;
  const o   = rule.op       === '*' || rule.op       === op;
  return cid && sk && o;
}

// op: grant
function op_grant(params) {
  const { caller_id, skill = '*', op = '*', note = '' } = params || {};
  if (!caller_id) throw new Error('caller_id required');
  const rules = _load();
  // Avoid duplicate
  const exists = rules.find(r => r.caller_id === caller_id && r.skill === skill && r.op === op && r.effect === 'allow');
  if (exists) return { status: 'already_exists', caller_id, skill, op };
  const rule = { id: crypto.randomBytes(4).toString('hex'), caller_id, skill, op, effect: 'allow', note, granted_at: new Date().toISOString() };
  rules.push(rule);
  _save(rules);
  _audit({ action: 'grant', ...rule });
  return { status: 'granted', rule };
}

// op: revoke
function op_revoke(params) {
  const { caller_id, skill = '*', op = '*' } = params || {};
  if (!caller_id) throw new Error('caller_id required');
  const rules = _load();
  const before = rules.length;
  const after = rules.filter(r => !(r.caller_id === caller_id && r.skill === skill && r.op === op));
  if (after.length === before) return { status: 'not_found', caller_id, skill, op };
  _save(after);
  _audit({ action: 'revoke', caller_id, skill, op });
  return { status: 'revoked', removed: before - after.length };
}

// op: check — return allow/deny for a given caller+skill+op
function op_check(params) {
  const { caller_id, skill, op } = params || {};
  if (!caller_id) throw new Error('caller_id required');
  if (!skill) throw new Error('skill required');
  const rules = _load();

  // If no rules at all, default allow (open system)
  if (!rules.length) return { decision: 'allow', reason: 'no_rules_open' };

  // Deny rules take priority
  const deny = rules.find(r => r.effect === 'deny' && _matches(r, caller_id, skill, op || '*'));
  if (deny) {
    _audit({ action: 'deny', caller_id, skill, op, rule_id: deny.id });
    return { decision: 'deny', rule_id: deny.id };
  }

  const allow = rules.find(r => r.effect === 'allow' && _matches(r, caller_id, skill, op || '*'));
  if (allow) {
    return { decision: 'allow', rule_id: allow.id };
  }

  // Default deny if rules exist but no match
  _audit({ action: 'deny_default', caller_id, skill, op });
  return { decision: 'deny', reason: 'no_matching_rule' };
}

// op: deny (explicit deny rule)
function op_deny(params) {
  const { caller_id, skill = '*', op = '*', note = '' } = params || {};
  if (!caller_id) throw new Error('caller_id required');
  const rules = _load();
  const rule = { id: crypto.randomBytes(4).toString('hex'), caller_id, skill, op, effect: 'deny', note, granted_at: new Date().toISOString() };
  rules.push(rule);
  _save(rules);
  _audit({ action: 'deny_rule_added', ...rule });
  return { status: 'deny_added', rule };
}

// op: list
function op_list(params) {
  const { caller_id } = params || {};
  let rules = _load();
  if (caller_id) rules = rules.filter(r => r.caller_id === caller_id || r.caller_id === '*');
  return { count: rules.length, rules };
}

// op: clear — remove all ACL rules
function op_clear() {
  const count = _load().length;
  _save([]);
  _audit({ action: 'clear_all', removed: count });
  return { status: 'cleared', removed: count };
}

// op: audit_log
function op_audit_log(params) {
  const { limit = 50 } = params || {};
  if (!fs.existsSync(ALOG_FILE)) return { events: [] };
  const lines = fs.readFileSync(ALOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
  const events = lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  return { count: events.length, events };
}

const MANIFEST = {
  name: 'acl',
  description: 'Access control lists for SCRIBE skill invocations. Ops: grant, revoke, deny, check, list, clear, audit_log.',
  ops: ['grant', 'revoke', 'deny', 'check', 'list', 'clear', 'audit_log'],
};

async function run(op, params) {
  switch (op) {
    case 'grant':     return op_grant(params);
    case 'revoke':    return op_revoke(params);
    case 'deny':      return op_deny(params);
    case 'check':     return op_check(params);
    case 'list':      return op_list(params);
    case 'clear':     return op_clear();
    case 'audit_log': return op_audit_log(params);
    default:
      throw new Error(`Unknown op: ${op}. Available: grant, revoke, deny, check, list, clear, audit_log`);
  }
}

module.exports = { MANIFEST, run };
