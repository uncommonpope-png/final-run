'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'consensus_state.json');
const VOTE_LOG = path.join(__dirname, '..', '..', 'data', 'consensus_votes.jsonl');

let _skills = null;
let _memory = null;
function setSkills(s) { _skills = s; }
function setMemory(m) { _memory = m; }

function _ensureDir(file) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _loadState() {
  _ensureDir(STATE_FILE);
  if (!fs.existsSync(STATE_FILE)) return { proposals: {}, votes: {} };
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { proposals: {}, votes: {} }; }
}

function _saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function _log(entry) {
  _ensureDir(VOTE_LOG);
  fs.appendFileSync(VOTE_LOG, JSON.stringify({ ...entry, ts: Date.now() }) + '\n', 'utf8');
}

function _createProposal({ proposal_id, title, description, proposer, agents = [], threshold_type = 'majority', metadata = {} }) {
  const state = _loadState();
  if (proposal_id && state.proposals[proposal_id]) throw new Error(`Proposal "${proposal_id}" already exists`);

  const id = proposal_id || crypto.randomBytes(4).toString('hex');
  const proposal = {
    id,
    title,
    description,
    proposer,
    agents,
    threshold_type,
    threshold_value: _getThresholdValue(threshold_type, agents.length),
    status: 'voting',
    votes: {},
    dissenters: [],
    minority_report: null,
    created_at: Date.now(),
    deadline: null,
    decided_at: null,
    metadata
  };

  state.proposals[id] = proposal;
  state.votes[id] = [];
  _saveState(state);
  _log({ event: 'proposal_created', proposal_id: id, title, threshold_type, agent_count: agents.length });
  return proposal;
}

function _getThresholdValue(threshold_type, agent_count) {
  switch (threshold_type) {
    case 'unanimous': return agent_count;
    case 'majority': return Math.ceil(agent_count / 2);
    case 'supermajority': return Math.ceil(agent_count * 0.67);
    case 'weighted': return Math.ceil(agent_count * 0.6);
    default: return Math.ceil(agent_count / 2);
  }
}

function _addAgentToProposal(proposal_id, agent_name, weight = 1) {
  const state = _loadState();
  if (!state.proposals[proposal_id]) throw new Error(`Proposal "${proposal_id}" not found`);
  if (!state.proposals[proposal_id].agents.includes(agent_name)) {
    state.proposals[proposal_id].agents.push(agent_name);
    state.proposals[proposal_id].threshold_value = _getThresholdValue(
      state.proposals[proposal_id].threshold_type,
      state.proposals[proposal_id].agents.length
    );
    _saveState(state);
  }
  return state.proposals[proposal_id];
}

function _setDeadline(proposal_id, deadline_ms) {
  const state = _loadState();
  if (!state.proposals[proposal_id]) throw new Error(`Proposal "${proposal_id}" not found`);
  state.proposals[proposal_id].deadline = Date.now() + deadline_ms;
  _saveState(state);
  _log({ event: 'deadline_set', proposal_id, deadline: state.proposals[proposal_id].deadline });
  return state.proposals[proposal_id];
}

function _submitVote({ proposal_id, agent_name, vote, rationale = '', weight = 1, metadata = {} }) {
  const state = _loadState();
  const proposal = state.proposals[proposal_id];
  if (!proposal) throw new Error(`Proposal "${proposal_id}" not found`);
  if (proposal.status !== 'voting') throw new Error(`Proposal "${proposal_id}" is no longer in voting status`);

  if (!proposal.agents.includes(agent_name)) {
    throw new Error(`Agent "${agent_name}" is not part of this proposal`);
  }

  if (proposal.votes[agent_name]) {
    throw new Error(`Agent "${agent_name}" has already voted`);
  }

  const voteRecord = {
    agent_name,
    vote,
    rationale,
    weight,
    metadata,
    voted_at: Date.now()
  };

  proposal.votes[agent_name] = voteRecord;
  state.votes[proposal_id].push(voteRecord);

  _saveState(state);
  _log({ event: 'vote_submitted', proposal_id, agent: agent_name, vote, weight });

  const { decided, result } = _checkThreshold(proposal, state);
  if (decided) {
    proposal.status = result ? 'approved' : 'rejected';
    proposal.decided_at = Date.now();
    _saveState(state);
    _log({ event: 'proposal_decided', proposal_id, result, votes_for: _countVotes(proposal, 'approve'), votes_against: _countVotes(proposal, 'reject') });
  }

  return { vote: voteRecord, threshold_reached: decided, result: decided ? result : null };
}

function _countVotes(proposal, vote_type) {
  return Object.values(proposal.votes).filter(v => v.vote === vote_type).length;
}

function _sumWeightedVotes(proposal, vote_type) {
  return Object.values(proposal.votes)
    .filter(v => v.vote === vote_type)
    .reduce((sum, v) => sum + (v.weight || 1), 0);
}

function _checkThreshold(proposal, state) {
  const totalAgents = proposal.agents.length;
  const totalVotes = Object.keys(proposal.votes).length;

  if (totalVotes < totalAgents) return { decided: false };

  switch (proposal.threshold_type) {
    case 'unanimous':
      return { decided: _countVotes(proposal, 'approve') === totalAgents, result: true };

    case 'majority':
      return {
        decided: totalVotes === totalAgents,
        result: _countVotes(proposal, 'approve') >= proposal.threshold_value
      };

    case 'supermajority':
    case 'weighted':
      const approveCount = _sumWeightedVotes(proposal, 'approve');
      const rejectCount = _sumWeightedVotes(proposal, 'reject');
      const totalWeight = Object.values(proposal.votes).reduce((sum, v) => sum + (v.weight || 1), 0);
      return {
        decided: totalVotes === totalAgents,
        result: approveCount > rejectCount && approveCount >= proposal.threshold_value
      };

    default:
      return {
        decided: totalVotes === totalAgents,
        result: _countVotes(proposal, 'approve') >= proposal.threshold_value
      };
  }
}

function _trackDissent(proposal_id) {
  const state = _loadState();
  const proposal = state.proposals[proposal_id];
  if (!proposal) throw new Error(`Proposal "${proposal_id}" not found`);

  const dissenters = Object.entries(proposal.votes)
    .filter(([, v]) => v.vote === 'reject')
    .map(([name, v]) => ({
      agent_name: name,
      rationale: v.rationale,
      weight: v.weight,
      metadata: v.metadata
    }));

  proposal.dissenters = dissenters;
  _saveState(state);
  return dissenters;
}

function _generateMinorityReport(proposal_id) {
  const state = _loadState();
  const proposal = state.proposals[proposal_id];
  if (!proposal) throw new Error(`Proposal "${proposal_id}" not found`);

  const dissenters = _trackDissent(proposal_id);
  if (dissenters.length === 0) return null;

  const report = {
    proposal_id,
    proposal_title: proposal.title,
    generated_at: Date.now(),
    dissenting_agents: dissenters.length,
    total_agents: proposal.agents.length,
    dissent_ratio: dissenters.length / proposal.agents.length,
    summary: `Minority report for "${proposal.title}": ${dissenters.length} of ${proposal.agents.length} agents dissented.`,
    arguments: dissenters.map(d => ({
      agent: d.agent_name,
      position: 'against',
      rationale: d.rationale,
      weight: d.weight
    })),
    recommendation: dissenters.length > proposal.agents.length / 2
      ? 'Strong dissent - reconsider proposal'
      : 'Minority dissent - proceed with caution'
  };

  proposal.minority_report = report;
  _saveState(state);
  _log({ event: 'minority_report_generated', proposal_id, dissent_count: dissenters.length });
  return report;
}

function _resolveTie(proposal_id, tie_breaker_rule = 'proposer_decides') {
  const state = _loadState();
  const proposal = state.proposals[proposal_id];
  if (!proposal) throw new Error(`Proposal "${proposal_id}" not found`);

  const approveCount = _countVotes(proposal, 'approve');
  const rejectCount = _countVotes(proposal, 'reject');

  if (approveCount !== rejectCount) {
    return { tied: false, result: approveCount > rejectCount ? 'approved' : 'rejected' };
  }

  let resolution;
  switch (tie_breaker_rule) {
    case 'proposer_decides':
      resolution = { rule: 'proposer_decides', winner: 'approve', decided_by: proposal.proposer };
      break;
    case 'first_vote':
      const firstVote = Object.values(proposal.votes).sort((a, b) => a.voted_at - b.voted_at)[0];
      resolution = { rule: 'first_vote', winner: firstVote.vote, decided_by: firstVote.agent_name };
      break;
    case 'random':
      resolution = { rule: 'random', winner: Math.random() > 0.5 ? 'approve' : 'reject', decided_by: 'random_choice' };
      break;
    case 'weight_sum':
      const approveWeight = _sumWeightedVotes(proposal, 'approve');
      const rejectWeight = _sumWeightedVotes(proposal, 'reject');
      resolution = { rule: 'weight_sum', winner: approveWeight >= rejectWeight ? 'approve' : 'reject', approved_weight: approveWeight, rejected_weight: rejectWeight };
      break;
    default:
      resolution = { rule: 'proposer_decides', winner: 'approve', decided_by: proposal.proposer };
  }

  proposal.status = resolution.winner === 'approve' ? 'approved' : 'rejected';
  proposal.decided_at = Date.now();
  proposal.tie_breaker = resolution;
  _saveState(state);

  _log({ event: 'tie_resolved', proposal_id, resolution });
  return { tied: true, resolution };
}

function _getProposalStatus(proposal_id) {
  const state = _loadState();
  const proposal = state.proposals[proposal_id];
  if (!proposal) throw new Error(`Proposal "${proposal_id}" not found`);

  const votes = Object.values(proposal.votes);
  const votesByType = {
    approve: votes.filter(v => v.vote === 'approve').length,
    reject: votes.filter(v => v.vote === 'reject').length,
    abstain: votes.filter(v => v.vote === 'abstain').length
  };

  return {
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
    threshold_type: proposal.threshold_type,
    threshold_value: proposal.threshold_value,
    total_agents: proposal.agents.length,
    votes_received: votes.length,
    votes_by_type: votesByType,
    deadline: proposal.deadline,
    decided_at: proposal.decided_at,
    has_minority_report: !!proposal.minority_report
  };
}

function _getAllProposals(status_filter = null) {
  const state = _loadState();
  const proposals = Object.values(state.proposals);
  if (status_filter) {
    return proposals.filter(p => p.status === status_filter);
  }
  return proposals.sort((a, b) => b.created_at - a.created_at);
}

function _getVotesForProposal(proposal_id) {
  const state = _loadState();
  if (!state.proposals[proposal_id]) throw new Error(`Proposal "${proposal_id}" not found`);
  return Object.values(state.proposals[proposal_id].votes);
}

async function _runConsensusRound({ proposal_id, agent_configs, execute_votes = true }) {
  const state = _loadState();
  const proposal = state.proposals[proposal_id];
  if (!proposal) throw new Error(`Proposal "${proposal_id}" not found`);

  const results = [];
  if (execute_votes && _skills) {
    for (const config of agent_configs) {
      if (!proposal.agents.includes(config.name)) continue;

      try {
        const voteResult = await _skills.run(config.skill || 'llm', {
          op: 'reason',
          prompt: `Evaluate this proposal and vote:\n\nTitle: ${proposal.title}\nDescription: ${proposal.description}\n\nRespond with JSON: {"vote": "approve|reject|abstain", "rationale": "your reasoning"}`,
          caller: `consensus:${config.name}`
        });

        let vote = 'abstain';
        let rationale = voteResult.text || '';

        try {
          const parsed = JSON.parse(voteResult.text.match(/\{[\s\S]*\}/)?.[0] || '{}');
          vote = ['approve', 'reject', 'abstain'].includes(parsed.vote) ? parsed.vote : 'abstain';
          rationale = parsed.rationale || rationale;
        } catch {}

        if (config.auto_submit !== false) {
          _submitVote({ proposal_id, agent_name: config.name, vote, rationale, weight: config.weight || 1 });
        }

        results.push({ agent: config.name, vote, rationale, success: true });
      } catch (e) {
        results.push({ agent: config.name, vote: 'abstain', rationale: '', success: false, error: e.message });
      }
    }
  }

  const finalStatus = _getProposalStatus(proposal_id);
  return {
    proposal_id,
    round_completed: true,
    votes_cast: results.length,
    current_status: finalStatus,
    votes: results
  };
}

function _resetConsensus() {
  const state = { proposals: {}, votes: {} };
  _saveState(state);
  _log({ event: 'consensus_reset' });
  return { reset: true };
}

const MANIFEST = {
  name: 'consensus_voter',
  description: 'Multi-agent decision making with proposal dissemination, threshold-based voting, dissent tracking, and tie-breaker rules',
  ops: ['create_proposal', 'add_agent', 'set_deadline', 'submit_vote', 'get_proposal', 'get_all', 'get_votes',
        'track_dissent', 'minority_report', 'resolve_tie', 'consensus_round', 'reset']
};

async function run({ op, caller = 'unknown', ...args }) {
  switch (op) {
    case 'create_proposal':
      return _createProposal(args);
    case 'add_agent':
      return _addAgentToProposal(args.proposal_id, args.agent_name, args.weight);
    case 'set_deadline':
      return _setDeadline(args.proposal_id, args.deadline_ms);
    case 'submit_vote':
      return _submitVote(args);
    case 'get_proposal':
      return _getProposalStatus(args.proposal_id);
    case 'get_all':
      return _getAllProposals(args.status_filter);
    case 'get_votes':
      return _getVotesForProposal(args.proposal_id);
    case 'track_dissent':
      return _trackDissent(args.proposal_id);
    case 'minority_report':
      return _generateMinorityReport(args.proposal_id);
    case 'resolve_tie':
      return _resolveTie(args.proposal_id, args.tie_breaker_rule);
    case 'consensus_round':
      return _runConsensusRound(args);
    case 'reset':
      return _resetConsensus();
    default:
      throw new Error(`consensus_voter: unknown op "${op}"`);
  }
}

module.exports = { MANIFEST, run, setSkills, setMemory };
