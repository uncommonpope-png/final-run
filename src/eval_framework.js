'use strict';

const fs = require('fs');
const path = require('path');

const EVAL_DATA_DIR = path.join(__dirname, '..', '..', 'data', 'eval');
const EVAL_SETS = path.join(EVAL_DATA_DIR, 'eval_sets.json');
const CODE_GRADER_RESULTS = path.join(EVAL_DATA_DIR, 'code_grader_results.jsonl');
const LLM_GRADER_RESULTS = path.join(EVAL_DATA_DIR, 'llm_grader_results.jsonl');
const HUMAN_EVAL_RESULTS = path.join(EVAL_DATA_DIR, 'human_eval_results.jsonl');
const PROMPT_CHANGE_LOG = path.join(EVAL_DATA_DIR, 'prompt_change_log.jsonl');

let _skills = null;
let _memory = null;
function setSkills(s) { _skills = s; }
function setMemory(m) { _memory = m; }

function _ensureDir(file) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _loadEvalSets() {
  _ensureDir(EVAL_SETS);
  if (!fs.existsSync(EVAL_SETS)) return {};
  try { return JSON.parse(fs.readFileSync(EVAL_SETS, 'utf8')); } catch { return {}; }
}

function _saveEvalSets(sets) {
  fs.writeFileSync(EVAL_SETS, JSON.stringify(sets, null, 2), 'utf8');
}

function _logCodeResult(entry) {
  _ensureDir(CODE_GRADER_RESULTS);
  fs.appendFileSync(CODE_GRADER_RESULTS, JSON.stringify({ ...entry, ts: Date.now() }) + '\n', 'utf8');
}

function _logLLMResult(entry) {
  _ensureDir(LLM_GRADER_RESULTS);
  fs.appendFileSync(LLM_GRADER_RESULTS, JSON.stringify({ ...entry, ts: Date.now() }) + '\n', 'utf8');
}

function _logHumanResult(entry) {
  _ensureDir(HUMAN_EVAL_RESULTS);
  fs.appendFileSync(HUMAN_EVAL_RESULTS, JSON.stringify({ ...entry, ts: Date.now() }) + '\n', 'utf8');
}

function _logPromptChange(entry) {
  _ensureDir(PROMPT_CHANGE_LOG);
  fs.appendFileSync(PROMPT_CHANGE_LOG, JSON.stringify({ ...entry, ts: Date.now() }) + '\n', 'utf8');
}

function _runCodeGrader(grader, testCase, actualOutput) {
  try {
    const fn = new Function('actual', 'expected', grader.code);
    const result = fn(actualOutput, testCase.expected);
    return {
      passed: result === true || result === testCase.expected,
      score: result === true ? 1 : (typeof result === 'number' ? result : 0),
      details: typeof result === 'string' ? result : null
    };
  } catch (e) {
    return { passed: false, score: 0, error: e.message };
  }
}

function _extractMetrics(actualOutput, testCase) {
  const metrics = {};
  
  if (testCase.expected_format) {
    if (testCase.expected_format === 'json') {
      try {
        JSON.parse(actualOutput);
        metrics.valid_json = true;
      } catch {
        metrics.valid_json = false;
      }
    }
  }
  
  if (testCase.contains) {
    metrics.contains_expected = testCase.contains.every(c => actualOutput.includes(c));
  }
  
  if (testCase.max_length) {
    metrics.length_ok = actualOutput.length <= testCase.max_length;
  }
  
  return metrics;
}

async function _runCodeBasedGrader(eval_set_name, testCase, actualOutput) {
  const evalSets = _loadEvalSets();
  const evalSet = evalSets[eval_set_name];
  if (!evalSet) throw new Error(`Eval set "${eval_set_name}" not found`);
  
  const grader = evalSet.graders?.code;
  if (!grader) throw new Error(`No code grader found in eval set "${eval_set_name}"`);
  
  const codeResult = grader.code ? _runCodeGrader(grader, testCase, actualOutput) : { passed: false };
  const metrics = _extractMetrics(actualOutput, testCase);
  
  const result = {
    eval_set: eval_set_name,
    test_case_id: testCase.id,
    grader_type: 'code',
    passed: codeResult.passed && Object.values(metrics).every(v => v !== false),
    code_score: codeResult.score,
    metrics,
    actual: actualOutput.slice(0, 500),
    expected: testCase.expected,
    graded_at: Date.now()
  };
  
  _logCodeResult(result);
  return result;
}

async function _runLLMGrader(eval_set_name, testCase, actualOutput) {
  const evalSets = _loadEvalSets();
  const evalSet = evalSets[eval_set_name];
  if (!evalSet) throw new Error(`Eval set "${eval_set_name}" not found`);
  
  const grader = evalSet.graders?.llm;
  if (!grader) throw new Error(`No LLM grader found in eval set "${eval_set_name}"`);
  
  const prompt = grader.prompt_template
    .replace('{{input}}', testCase.input)
    .replace('{{expected}}', testCase.expected)
    .replace('{{actual}}', actualOutput);
  
  const llmResult = await _skills.run('llm', {
    op: 'reason',
    prompt,
    system: grader.system_prompt || 'You are an expert evaluator. Score responses on accuracy, quality, and completeness.',
    model: grader.model || 'deepseek-r1:7b'
  });
  
  let parsedScore = 0.5;
  let feedback = llmResult.text;
  
  try {
    const jsonMatch = llmResult.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      parsedScore = typeof parsed.score === 'number' ? parsed.score : (typeof parsed.result === 'number' ? parsed.result : 0.5);
      feedback = parsed.feedback || llmResult.text;
    } else {
      const scoreMatch = llmResult.text.match(/score[:\s]*(\d+\.?\d*)/i);
      if (scoreMatch) parsedScore = parseFloat(scoreMatch[1]) / 10;
    }
  } catch {}
  
  const result = {
    eval_set: eval_set_name,
    test_case_id: testCase.id,
    grader_type: 'llm',
    passed: parsedScore >= (grader.threshold || 0.7),
    score: parsedScore,
    feedback: feedback.slice(0, 500),
    llm_model: llmResult.model,
    graded_at: Date.now()
  };
  
  _logLLMResult(result);
  return result;
}

async function _runHumanEval(eval_set_name, testCase, actualOutput, humanRating, humanFeedback) {
  const result = {
    eval_set: eval_set_name,
    test_case_id: testCase.id,
    grader_type: 'human',
    rating: humanRating,
    passed: humanRating >= 3,
    feedback: humanFeedback,
    actual: actualOutput.slice(0, 500),
    expected: testCase.expected,
    graded_at: Date.now()
  };
  
  _logHumanResult(result);
  return result;
}

function _createEvalSet(name, description, testCases, graders = {}) {
  const evalSets = _loadEvalSets();
  if (evalSets[name]) throw new Error(`Eval set "${name}" already exists`);
  
  evalSets[name] = {
    id: `eval_${Date.now()}`,
    name,
    description,
    test_cases: testCases,
    graders,
    created_at: Date.now(),
    version: 1
  };
  
  _saveEvalSets(evalSets);
  return evalSets[name];
}

function _updateEvalSet(name, updates) {
  const evalSets = _loadEvalSets();
  if (!evalSets[name]) throw new Error(`Eval set "${name}" not found`);
  
  evalSets[name] = { ...evalSets[name], ...updates, version: (evalSets[name].version || 0) + 1 };
  _saveEvalSets(evalSets);
  return evalSets[name];
}

function _addTestCase(eval_set_name, testCase) {
  const evalSets = _loadEvalSets();
  if (!evalSets[eval_set_name]) throw new Error(`Eval set "${eval_set_name}" not found`);
  
  testCase.id = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  evalSets[eval_set_name].test_cases.push(testCase);
  _saveEvalSets(evalSets);
  
  return testCase;
}

async function _runEvalSet(eval_set_name, executionFn) {
  const evalSets = _loadEvalSets();
  const evalSet = evalSets[eval_set_name];
  if (!evalSet) throw new Error(`Eval set "${eval_set_name}" not found`);
  
  const results = [];
  let passed = 0;
  let failed = 0;
  
  for (const testCase of evalSet.test_cases) {
    try {
      const actualOutput = await executionFn(testCase);
      
      let result;
      if (evalSet.graders?.code) {
        result = await _runCodeBasedGrader(eval_set_name, testCase, actualOutput);
      } else if (evalSet.graders?.llm) {
        result = await _runLLMGrader(eval_set_name, testCase, actualOutput);
      } else {
        result = { passed: false, error: 'No grader configured' };
      }
      
      if (result.passed) passed++; else failed++;
      results.push(result);
    } catch (e) {
      results.push({ test_case_id: testCase.id, passed: false, error: e.message });
      failed++;
    }
  }
  
  const summary = {
    eval_set: eval_set_name,
    total: evalSet.test_cases.length,
    passed,
    failed,
    pass_rate: passed / evalSet.test_cases.length,
    version: evalSet.version,
    executed_at: Date.now()
  };
  
  return { summary, results };
}

async function _triggerEvalOnPromptChange(prompt_key, new_prompt_hash) {
  const evalSets = _loadEvalSets();
  const triggered = [];
  
  for (const [name, evalSet] of Object.entries(evalSets)) {
    if (evalSet.prompt_key === prompt_key) {
      triggered.push(name);
      
      _logPromptChange({
        event: 'eval_triggered',
        prompt_key,
        eval_set: name,
        new_hash: new_prompt_hash,
        triggered_at: Date.now()
      });
    }
  }
  
  return { triggered_eval_sets: triggered };
}

function _listEvalSets() {
  const evalSets = _loadEvalSets();
  return Object.values(evalSets).map(es => ({
    name: es.name,
    description: es.description,
    test_cases_count: es.test_cases?.length || 0,
    has_code_grader: !!es.graders?.code,
    has_llm_grader: !!es.graders?.llm,
    version: es.version,
    created_at: es.created_at
  }));
}

function _getGraderResults(eval_set_name, grader_type) {
  let file;
  if (grader_type === 'code') file = CODE_GRADER_RESULTS;
  else if (grader_type === 'llm') file = LLM_GRADER_RESULTS;
  else if (grader_type === 'human') file = HUMAN_EVAL_RESULTS;
  else throw new Error(`Unknown grader type: ${grader_type}`);
  
  if (!fs.existsSync(file)) return [];
  
  const results = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  return results.filter(r => r.eval_set === eval_set_name);
}

function _computeEvalStats(eval_set_name) {
  const codeResults = _getGraderResults(eval_set_name, 'code');
  const llmResults = _getGraderResults(eval_set_name, 'llm');
  const humanResults = _getGraderResults(eval_set_name, 'human');
  
  return {
    eval_set: eval_set_name,
    code_grader: {
      total: codeResults.length,
      passed: codeResults.filter(r => r.passed).length,
      pass_rate: codeResults.length ? codeResults.filter(r => r.passed).length / codeResults.length : 0
    },
    llm_grader: {
      total: llmResults.length,
      passed: llmResults.filter(r => r.passed).length,
      pass_rate: llmResults.length ? llmResults.filter(r => r.passed).length / llmResults.length : 0,
      avg_score: llmResults.length ? llmResults.reduce((a, r) => a + r.score, 0) / llmResults.length : 0
    },
    human_grader: {
      total: humanResults.length,
      passed: humanResults.filter(r => r.passed).length,
      pass_rate: humanResults.length ? humanResults.filter(r => r.passed).length / humanResults.length : 0,
      avg_rating: humanResults.length ? humanResults.reduce((a, r) => a + r.rating, 0) / humanResults.length : 0
    }
  };
}

const MANIFEST = {
  name: 'eval_framework',
  description: 'Evaluation framework with code graders, LLM graders, and human evaluation for outcome verification',
  ops: ['create_eval_set', 'update_eval_set', 'add_test_case', 'run_eval_set', 'list', 'results', 'stats', 'trigger_on_prompt_change']
};

async function run({ op, caller = 'unknown', ...args }) {
  switch (op) {
    case 'create_eval_set':
      return _createEvalSet(args.name, args.description, args.testCases || [], args.graders || {});
    case 'update_eval_set':
      return _updateEvalSet(args.name, args.updates);
    case 'add_test_case':
      return _addTestCase(args.eval_set_name, args.testCase);
    case 'run_eval_set':
      return _runEvalSet(args.name, args.executionFn);
    case 'list':
      return _listEvalSets();
    case 'results':
      return _getGraderResults(args.eval_set_name, args.grader_type);
    case 'stats':
      return _computeEvalStats(args.eval_set_name);
    case 'trigger_on_prompt_change':
      return _triggerEvalOnPromptChange(args.prompt_key, args.new_prompt_hash);
    default:
      throw new Error(`eval_framework: unknown op "${op}"`);
  }
}

module.exports = { MANIFEST, run, setSkills, setMemory };