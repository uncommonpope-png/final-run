'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'debate_state.json');
const DEBATE_LOG = path.join(__dirname, '..', '..', 'data', 'debate_log.jsonl');

let _skills = null;
let _memory = null;
function setSkills(s) { _skills = s; }
function setMemory(m) { _memory = m; }

const SCORE_MIN = 1;
const SCORE_MAX = 10;
const DEFAULT_ROUNDS = 3;

function _ensureDir(file) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _loadState() {
  _ensureDir(STATE_FILE);
  if (!fs.existsSync(STATE_FILE)) return { debates: {} };
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { debates: {} }; }
}

function _saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function _log(entry) {
  _ensureDir(DEBATE_LOG);
  fs.appendFileSync(DEBATE_LOG, JSON.stringify({ ...entry, ts: Date.now() }) + '\n', 'utf8');
}

function _createDebate({ debate_id, topic, description, pro_agents = [], con_agents = [], rounds = DEFAULT_ROUNDS, metadata = {} }) {
  const state = _loadState();
  if (debate_id && state.debates[debate_id]) throw new Error(`Debate "${debate_id}" already exists`);

  const id = debate_id || crypto.randomBytes(4).toString('hex');

  const debate = {
    id,
    topic,
    description,
    pro_agents,
    con_agents,
    rounds,
    current_round: 0,
    status: 'created',
    arguments: [],
    pro_total_score: 0,
    con_total_score: 0,
    winner: null,
    created_at: Date.now(),
    started_at: null,
    concluded_at: null,
    metadata
  };

  state.debates[id] = debate;
  _saveState(state);
  _log({ event: 'debate_created', debate_id: id, topic, pro_count: pro_agents.length, con_count: con_agents.length });
  return debate;
}

function _startDebate(debate_id) {
  const state = _loadState();
  const debate = state.debates[debate_id];
  if (!debate) throw new Error(`Debate "${debate_id}" not found`);
  if (debate.status !== 'created') throw new Error(`Debate "${debate_id}" is not in created status`);

  debate.status = 'active';
  debate.started_at = Date.now();
  _saveState(state);
  _log({ event: 'debate_started', debate_id });
  return debate;
}

function _submitArgument({ debate_id, side, agent_name, content, round, is_rebuttal = false, metadata = {} }) {
  const state = _loadState();
  const debate = state.debates[debate_id];
  if (!debate) throw new Error(`Debate "${debate_id}" not found`);
  if (debate.status !== 'active') throw new Error(`Debate "${debate_id}" is not active`);

  const validAgents = side === 'pro' ? debate.pro_agents : debate.con_agents;
  if (!validAgents.includes(agent_name)) {
    throw new Error(`Agent "${agent_name}" is not assigned to the ${side} side`);
  }

  const argument = {
    id: crypto.randomBytes(4).toString('hex'),
    debate_id,
    side,
    agent_name,
    content,
    round: round || debate.current_round + 1,
    is_rebuttal,
    score: null,
    scored_by: null,
    submitted_at: Date.now(),
    metadata
  };

  debate.arguments.push(argument);
  _saveState(state);
  _log({ event: 'argument_submitted', debate_id, side, agent: agent_name, round: argument.round, is_rebuttal });
  return argument;
}

function _scoreArgument(debate_id, argument_id, score, scored_by = 'judge') {
  const state = _loadState();
  const debate = state.debates[debate_id];
  if (!debate) throw new Error(`Debate "${debate_id}" not found`);

  const argument = debate.arguments.find(a => a.id === argument_id);
  if (!argument) throw new Error(`Argument "${argument_id}" not found`);

  const clampedScore = Math.max(SCORE_MIN, Math.min(SCORE_MAX, score));
  argument.score = clampedScore;
  argument.scored_by = scored_by;
  argument.scored_at = Date.now();

  debate[`${argument.side}_total_score`] += clampedScore;
  _saveState(state);
  _log({ event: 'argument_scored', debate_id, argument_id, score: clampedScore, side: argument.side });
  return argument;
}

function _advanceRound(debate_id) {
  const state = _loadState();
  const debate = state.debates[debate_id];
  if (!debate) throw new Error(`Debate "${debate_id}" not found`);
  if (debate.status !== 'active') throw new Error(`Debate "${debate_id}" is not active`);
  if (debate.current_round >= debate.rounds) throw new Error(`Debate "${debate_id}" has reached max rounds`);

  debate.current_round++;
  _saveState(state);
  _log({ event: 'round_advanced', debate_id, round: debate.current_round });
  return debate;
}

async function _runDebateRound({ debate_id, pro_skill = 'llm', con_skill = 'llm', run_op = 'reason', prompt_template = null }) {
  const state = _loadState();
  const debate = state.debates[debate_id];
  if (!debate) throw new Error(`Debate "${debate_id}" not found`);

  const roundNum = debate.current_round + 1;
  const previousArguments = debate.arguments.filter(a => a.round < roundNum);

  const results = { pro: [], con: [] };

  if (_skills) {
    const proPrompt = (prompt_template || _defaultPromptTemplate(debate.topic, debate.description, roundNum, 'pro'))
      .replace('{{topic}}', debate.topic)
      .replace('{{description}}', debate.description)
      .replace('{{round}}', roundNum)
      .replace('{{side}}', 'pro')
      .replace('{{previous}}', JSON.stringify(previousArguments.slice(-4)));

    const conPrompt = (prompt_template || _defaultPromptTemplate(debate.topic, debate.description, roundNum, 'con'))
      .replace('{{topic}}', debate.topic)
      .replace('{{description}}', debate.description)
      .replace('{{round}}', roundNum)
      .replace('{{side}}', 'con')
      .replace('{{previous}}', JSON.stringify(previousArguments.slice(-4)));

    try {
      const proResult = await _skills.run(pro_skill, { op: run_op, prompt: proPrompt, caller: `debate:pro:${debate_id}` });
      const proArg = _submitArgument({ debate_id, side: 'pro', agent_name: debate.pro_agents[0] || 'pro_agent', content: proResult.text || String(proResult), round: roundNum });
      results.pro.push({ success: true, argument: proArg });

      const conResult = await _skills.run(con_skill, { op: run_op, prompt: conPrompt, caller: `debate:con:${debate_id}` });
      const conArg = _submitArgument({ debate_id, side: 'con', agent_name: debate.con_agents[0] || 'con_agent', content: conResult.text || String(conResult), round: roundNum });
      results.con.push({ success: true, argument: conArg });
    } catch (e) {
      _log({ event: 'debate_round_error', debate_id, round: roundNum, error: e.message });
    }
  }

  _advanceRound(debate_id);
  return { debate_id, round: roundNum, results };
}

function _defaultPromptTemplate(topic, description, round, side) {
  const role = side === 'pro' ? 'advocate for the proposal' : 'challenge the proposal';
  const roundLabel = round === 1 ? 'opening statement' : `rebuttal (round ${round})`;
  return `You are a debate participant who ${role}.
Topic: {{topic}}
Description: {{description}}

This is round {{round}} - your ${roundLabel}.

${round > 1 ? 'Consider the previous arguments: {{previous}}\n\nProvide your rebuttal.' : 'Present your opening argument.'}

Provide a clear, well-reasoned argument.`;
}

function _calculateAggregateScores(debate) {
  const proScores = debate.arguments.filter(a => a.side === 'pro' && a.score !== null);
  const conScores = debate.arguments.filter(a => a.side === 'con' && a.score !== null);

  const proAvg = proScores.length ? proScores.reduce((s, a) => s + a.score, 0) / proScores.length : 0;
  const conAvg = conScores.length ? conScores.reduce((s, a) => s + a.score, 0) / conScores.length : 0;

  return {
    pro: {
      total_score: debate.pro_total_score,
      avg_score: proAvg,
      argument_count: proScores.length
    },
    con: {
      total_score: debate.con_total_score,
      avg_score: conAvg,
      argument_count: conScores.length
    },
    margin: Math.abs(proAvg - conAvg)
  };
}

function _determineWinner(debate) {
  const scores = _calculateAggregateScores(debate);
  const proWins = scores.pro.total_score > scores.con.total_score;
  const conWins = scores.con.total_score > scores.pro.total_score;
  const tie = scores.pro.total_score === scores.con.total_score;

  return {
    winner: tie ? 'tie' : (proWins ? 'pro' : 'con'),
    margin: scores.margin,
    scores,
    tie: tie
  };
}

function _concludeDebate(debate_id, winner_override = null) {
  const state = _loadState();
  const debate = state.debates[debate_id];
  if (!debate) throw new Error(`Debate "${debate_id}" not found`);

  debate.status = 'concluded';
  debate.concluded_at = Date.now();

  if (winner_override) {
    debate.winner = winner_override;
  } else {
    const result = _determineWinner(debate);
    debate.winner = result.winner;
    debate.score_summary = result.scores;
  }

  _saveState(state);
  _log({ event: 'debate_concluded', debate_id, winner: debate.winner, scores: debate.score_summary });
  return debate;
}

function _getDebateStatus(debate_id) {
  const state = _loadState();
  const debate = state.debates[debate_id];
  if (!debate) throw new Error(`Debate "${debate_id}" not found`);

  return {
    id: debate.id,
    topic: debate.topic,
    status: debate.status,
    current_round: debate.current_round,
    max_rounds: debate.rounds,
    pro_agents: debate.pro_agents,
    con_agents: debate.con_agents,
    argument_count: debate.arguments.length,
    pro_total_score: debate.pro_total_score,
    con_total_score: debate.con_total_score,
    winner: debate.winner,
    scores: debate.score_summary || _calculateAggregateScores(debate)
  };
}

function _getArguments(debate_id, filters = {}) {
  const state = _loadState();
  const debate = state.debates[debate_id];
  if (!debate) throw new Error(`Debate "${debate_id}" not found`);

  let args = debate.arguments;
  if (filters.side) args = args.filter(a => a.side === filters.side);
  if (filters.round) args = args.filter(a => a.round === filters.round);
  if (filters.rebuttals !== undefined) args = args.filter(a => a.is_rebuttal === filters.rebuttals);
  if (filters.min_score !== undefined) args = args.filter(a => a.score !== null && a.score >= filters.min_score);

  return args;
}

function _getDebateTimeline(debate_id) {
  const state = _loadState();
  const debate = state.debates[debate_id];
  if (!debate) throw new Error(`Debate "${debate_id}" not found`);

  return debate.arguments
    .sort((a, b) => a.submitted_at - b.submitted_at)
    .map(a => ({
      argument_id: a.id,
      side: a.side,
      agent: a.agent_name,
      round: a.round,
      is_rebuttal: a.is_rebuttal,
      score: a.score,
      timestamp: a.submitted_at
    }));
}

function _listDebates(status_filter = null) {
  const state = _loadState();
  const debates = Object.values(state.debates);
  if (status_filter) {
    return debates.filter(d => d.status === status_filter);
  }
  return debates.sort((a, b) => b.created_at - a.created_at);
}

async function _runFullDebate({ debate_id, pro_skill = 'llm', con_skill = 'llm', auto_score = true, scoring_skill = 'llm' }) {
  const state = _loadState();
  const debate = state.debates[debate_id];
  if (!debate) throw new Error(`Debate "${debate_id}" not found`);

  _startDebate(debate_id);
  const roundResults = [];

  for (let i = 0; i < debate.rounds; i++) {
    const roundResult = await _runDebateRound({ debate_id, pro_skill, con_skill });
    roundResults.push(roundResult);

    if (auto_score && _skills) {
      for (const arg of [...(roundResult.results.pro || []), ...(roundResult.results.con || [])]) {
        if (arg.success && arg.argument) {
          try {
            const scorePrompt = `Score this debate argument from 1-10:\n\n"${arg.argument.content.slice(0, 500)}"\n\nRespond with JSON: {"score": number}`;
            const scoreResult = await _skills.run(scoring_skill, { op: 'reason', prompt: scorePrompt, caller: `debate:scoring:${debate_id}` });

            let parsedScore = 5;
            try {
              const parsed = JSON.parse(scoreResult.text.match(/\{[\s\S]*\}/)?.[0] || '{"score":5}');
              parsedScore = Math.max(1, Math.min(10, parsed.score || 5));
            } catch {}

            _scoreArgument(debate_id, arg.argument.id, parsedScore, 'auto_llm');
          } catch {}
        }
      }
    }
  }

  const concluded = _concludeDebate(debate_id);
  return {
    debate_id,
    rounds_completed: debate.rounds,
    winner: concluded.winner,
    score_summary: concluded.score_summary,
    arguments: concluded.arguments.length,
    timeline: roundResults
  };
}

function _resetDebates() {
  const state = { debates: {} };
  _saveState(state);
  _log({ event: 'debates_reset' });
  return { reset: true };
}

const MANIFEST = {
  name: 'debate_arena',
  description: 'Pro/Con structured debate format with multiple rounds, rebuttals, scoring (1-10), and winner determination',
  ops: ['create', 'start', 'submit_argument', 'score_argument', 'advance_round', 'run_round', 'run_full',
        'determine_winner', 'conclude', 'get_status', 'get_arguments', 'get_timeline', 'list', 'reset']
};

async function run({ op, caller = 'unknown', ...args }) {
  switch (op) {
    case 'create':
      return _createDebate(args);
    case 'start':
      return _startDebate(args.debate_id);
    case 'submit_argument':
      return _submitArgument(args);
    case 'score_argument':
      return _scoreArgument(args.debate_id, args.argument_id, args.score, args.scored_by);
    case 'advance_round':
      return _advanceRound(args.debate_id);
    case 'run_round':
      return _runDebateRound(args);
    case 'run_full':
      return _runFullDebate(args);
    case 'determine_winner':
      return _determineWinner(_loadState().debates[args.debate_id]);
    case 'conclude':
      return _concludeDebate(args.debate_id, args.winner_override);
    case 'get_status':
      return _getDebateStatus(args.debate_id);
    case 'get_arguments':
      return _getArguments(args.debate_id, args.filters || {});
    case 'get_timeline':
      return _getDebateTimeline(args.debate_id);
    case 'list':
      return _listDebates(args.status_filter);
    case 'reset':
      return _resetDebates();
    default:
      throw new Error(`debate_arena: unknown op "${op}"`);
  }
}

module.exports = { MANIFEST, run, setSkills, setMemory };
