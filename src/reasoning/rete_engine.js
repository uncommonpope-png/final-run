class ReteEngine {
  constructor() {
    this.workingMemory = [];
    this.rules = new Map();
    this.network = { alphaNodes: new Map(), betaNodes: new Map() };
    this.agenda = [];
    this.activations = new Map();
  }

  addFact(fact) {
    const factWithMeta = {
      ...fact,
      _id: Date.now() + Math.random(),
      _timestamp: Date.now()
    };
    this.workingMemory.push(factWithMeta);
    this._propagateToAlphaNetwork(factWithMeta);
    return factWithMeta;
  }

  removeFact(factId) {
    this.workingMemory = this.workingMemory.filter(f => f._id !== factId);
    this._recomputeActivations();
  }

  defineRule(name, conditions, action) {
    const rule = { name, conditions, action, priority: 0, specificity: 0 };
    rule.specificity = conditions.length;
    this.rules.set(name, rule);
    this._compileRuleToNetwork(rule);
    return rule;
  }

  _compileRuleToNetwork(rule) {
    const alphaNodes = [];

    rule.conditions.forEach((cond, idx) => {
      const alphaNode = {
        id: `${rule.name}-alpha-${idx}`,
        condition: cond,
        matchingFacts: [],
        betaChildren: []
      };
      this.network.alphaNodes.set(alphaNode.id, alphaNode);
      alphaNodes.push(alphaNode.id);

      this.workingMemory.forEach(fact => {
        if (this._matchCondition(fact, cond)) {
          alphaNode.matchingFacts.push(fact._id);
        }
      });
    });

    if (alphaNodes.length > 1) {
      const betaNode = {
        id: `${rule.name}-beta`,
        alphaParents: alphaNodes,
        joinedFacts: [],
        rule: rule.name
      };
      this.network.betaNodes.set(betaNode.id, betaNode);
      this._evaluateBetaNode(betaNode);
    } else if (alphaNodes.length === 1) {
      const alphaNode = this.network.alphaNodes.get(alphaNodes[0]);
      this._checkRuleActivation(rule, alphaNode.matchingFacts);
    }
  }

  _propagateToAlphaNetwork(fact) {
    this.network.alphaNodes.forEach((node, id) => {
      if (this._matchCondition(fact, node.condition)) {
        if (!node.matchingFacts.includes(fact._id)) {
          node.matchingFacts.push(fact._id);
        }
        node.betaChildren.forEach(betaId => {
          const betaNode = this.network.betaNodes.get(betaId);
          if (betaNode) this._evaluateBetaNode(betaNode);
        });
        const rule = this._findRuleByAlphaNode(id);
        if (rule) this._checkRuleActivation(rule, [fact._id]);
      }
    });
  }

  _findRuleByAlphaNode(alphaId) {
    for (const rule of this.rules.values()) {
      if (alphaId.startsWith(rule.name)) return rule;
    }
    return null;
  }

  _matchCondition(fact, condition) {
    if (typeof condition === 'function') return condition(fact);
    if (typeof condition === 'object') {
      return Object.entries(condition).every(([key, value]) => {
        if (value === null) return fact[key] === null || fact[key] === undefined;
        if (typeof value === 'object' && value.type === 'regex') {
          return new RegExp(value.pattern).test(fact[key]);
        }
        if (typeof value === 'object' && value.type === 'greater') {
          return (fact[key] || 0) > value.value;
        }
        return fact[key] === value;
      });
    }
    return true;
  }

  _evaluateBetaNode(betaNode) {
    const rule = this.rules.get(betaNode.rule);
    if (!rule) return;

    const allMatched = rule.conditions.every((cond, idx) => {
      const alphaParentId = betaNode.alphaParents[idx];
      const alphaNode = this.network.alphaNodes.get(alphaParentId);
      return alphaNode && alphaNode.matchingFacts.length > 0;
    });

    if (allMatched) {
      const factSets = betaNode.alphaParents.map(alphaId => {
        const node = this.network.alphaNodes.get(alphaId);
        return node.matchingFacts.map(id => this.workingMemory.find(f => f._id === id));
      });

      const joined = this._joinFacts(factSets);
      betaNode.joinedFacts = joined.map(f => f._id);
      this._checkRuleActivation(rule, joined.map(f => f._id));
    }
  }

  _joinFacts(factSets) {
    if (factSets.length === 0) return [];
    if (factSets.length === 1) return factSets[0];

    const [first, ...rest] = factSets;
    const joined = [];
    
    first.forEach(f1 => {
      let matches = [f1];
      for (const set of rest) {
        const match = set.find(f => this._factsCompatible(f1, f));
        if (!match) break;
        matches.push(match);
      }
      if (matches.length === factSets.length) {
        joined.push(Object.assign({}, ...matches));
      }
    });

    return joined;
  }

  _factsCompatible(f1, f2) {
    const keys1 = Object.keys(f1).filter(k => !k.startsWith('_'));
    const keys2 = Object.keys(f2).filter(k => !k.startsWith('_'));
    const commonKeys = keys1.filter(k => keys2.includes(k));
    return commonKeys.every(k => f1[k] === f2[k]);
  }

  _checkRuleActivation(rule, matchingFactIds) {
    if (matchingFactIds.length === 0) return;

    const activation = {
      rule: rule.name,
      factIds: matchingFactIds,
      timestamp: Date.now(),
      priority: rule.priority + (rule.specificity * 10)
    };

    this.activations.set(rule.name, activation);
    this._addToAgenda(activation);
  }

  _addToAgenda(activation) {
    const existingIdx = this.agenda.findIndex(a => a.rule === activation.rule);
    if (existingIdx >= 0) {
      this.agenda[existingIdx] = activation;
    } else {
      this.agenda.push(activation);
    }

    this.agenda.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return b.timestamp - a.timestamp;
    });
  }

  fireRule(ruleName) {
    const activation = this.activations.get(ruleName);
    if (!activation) return null;

    const rule = this.rules.get(ruleName);
    const facts = activation.factIds.map(id => this.workingMemory.find(f => f._id === id)).filter(Boolean);

    const result = rule.action(facts);
    this.agenda = this.agenda.filter(a => a.rule !== ruleName);
    this.activations.delete(ruleName);

    return result;
  }

  fireAll() {
    const results = [];
    while (this.agenda.length > 0) {
      const activation = this.agenda.shift();
      const result = this.fireRule(activation.rule);
      results.push({ rule: activation.rule, result });
    }
    return results;
  }

  getAgenda() {
    return this.agenda.map(a => ({ rule: a.rule, priority: a.priority }));
  }

  getWorkingMemory() {
    return [...this.workingMemory];
  }

  clear() {
    this.workingMemory = [];
    this.agenda = [];
    this.activations.clear();
  }
}

module.exports = { ReteEngine };