class TaskPlanner {
  constructor() {
    this.goals = new Map();
    this.plans = new Map();
    this.resources = new Map();
  }

  setResource(name, available) {
    this.resources.set(name, { available, quantity: available });
  }

  decomposeGoal(goalId, goal, currentState) {
    const decomposition = {
      id: goalId,
      goal,
      subgoals: [],
      steps: [],
      dependencies: new Map(),
      completed: []
    };

    this._decomposeRecursive(goal, decomposition, currentState, 0);
    this.goals.set(goalId, decomposition);
    return decomposition;
  }

  _decomposeRecursive(goal, decomposition, state, depth) {
    if (depth > 10) return;

    if (goal.subgoals) {
      goal.subgoals.forEach((subgoal, idx) => {
        const subgoalId = `${decomposition.id}-sg-${idx}`;
        const steps = this._generateSteps(subgoal, state);
        decomposition.subgoals.push({ id: subgoalId, ...subgoal, steps });
        steps.forEach(step => {
          if (!decomposition.dependencies.has(step.id)) {
            decomposition.dependencies.set(step.id, []);
          }
          step.dependsOn?.forEach(dep => {
            decomposition.dependencies.get(step.id).push(dep);
          });
        });
      });
    } else {
      const steps = this._generateSteps(goal, state);
      decomposition.steps = steps;
    }
  }

  _generateSteps(goal, state) {
    const steps = [];
    const actions = goal.actions || [];
    
    actions.forEach((action, idx) => {
      const step = {
        id: `${goal.id || 'goal'}-step-${idx}`,
        action: action.name || action,
        params: action.params || {},
        prerequisites: action.prerequisites || [],
        resources: action.resources || [],
        expectedOutcome: action.outcome || null
      };
      steps.push(step);
    });

    return steps;
  }

  buildDependencyGraph(goalId) {
    const goal = this.goals.get(goalId);
    if (!goal) return null;

    const graph = { nodes: [], edges: [] };
    const allSteps = [...goal.subgoals.flatMap(sg => sg.steps), ...goal.steps];

    allSteps.forEach(step => {
      graph.nodes.push({ id: step.id, step });
      const deps = goal.dependencies.get(step.id) || [];
      deps.forEach(dep => {
        graph.edges.push({ from: dep, to: step.id });
      });
    });

    return graph;
  }

  topologicalSort(graph) {
    const inDegree = new Map();
    graph.nodes.forEach(n => inDegree.set(n.id, 0));
    graph.edges.forEach(e => {
      inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
    });

    const queue = [];
    inDegree.forEach((deg, id) => {
      if (deg === 0) queue.push(id);
    });

    const sorted = [];
    while (queue.length > 0) {
      const current = queue.shift();
      sorted.push(current);
      graph.edges.filter(e => e.from === current).forEach(e => {
        const newDeg = (inDegree.get(e.to) || 0) - 1;
        inDegree.set(e.to, newDeg);
        if (newDeg === 0) queue.push(e.to);
      });
    }

    return sorted;
  }

  backwardChain(goalId, currentState) {
    const goal = this.goals.get(goalId);
    if (!goal) return null;

    const plan = { steps: [], gaps: [] };
    const state = new Map([...currentState]);

    const allSteps = [...goal.subgoals.flatMap(sg => sg.steps), ...goal.steps].reverse();
    
    for (const step of allSteps) {
      const canExecute = this._checkPrerequisites(step, state);
      if (canExecute) {
        plan.steps.unshift(step);
        if (step.expectedOutcome) {
          state.set(step.expectedOutcome.key, step.expectedOutcome.value);
        }
      } else {
        plan.gaps.push({
          step: step.id,
          missing: step.prerequisites.filter(p => !state.has(p))
        });
      }
    }

    this.plans.set(goalId, plan);
    return plan;
  }

  _checkPrerequisites(step, state) {
    return step.prerequisites.every(prereq => state.has(prereq));
  }

  validatePlan(goalId) {
    const plan = this.plans.get(goalId);
    const goal = this.goals.get(goalId);
    if (!plan || !goal) return { valid: false, errors: ['Plan or goal not found'] };

    const errors = [];
    const allSteps = [...goal.subgoals.flatMap(sg => sg.steps), ...goal.steps];
    const stepMap = new Map(allSteps.map(s => [s.id, s]));

    plan.steps.forEach(step => {
      const stepDef = stepMap.get(step.id);
      if (!stepDef) return;

      stepDef.resources?.forEach(res => {
        const resource = this.resources.get(res);
        if (!resource || !resource.available) {
          errors.push(`Resource ${res} not available for step ${step.id}`);
        }
      });

      stepDef.prerequisites?.forEach(prereq => {
        const prereqMet = plan.steps.some(s => s.action === prereq);
        if (!prereqMet && !goal.completed?.includes(prereq)) {
          errors.push(`Prerequisite ${prereq} not met for step ${step.id}`);
        }
      });
    });

    return { valid: errors.length === 0, errors };
  }

  executePlan(goalId, onStep) {
    const plan = this.plans.get(goalId);
    if (!plan) return { success: false, error: 'Plan not found' };

    const results = [];
    const state = new Map();

    for (const step of plan.steps) {
      const result = onStep(step, state);
      results.push({ step: step.id, result });
      if (step.expectedOutcome) {
        state.set(step.expectedOutcome.key, step.expectedOutcome.value);
      }
      if (!result.success) break;
    }

    return { success: results.every(r => r.result.success), results };
  }
}

module.exports = { TaskPlanner };