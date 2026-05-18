class CausalGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this.observations = [];
  }

  addNode(id, type = 'event', properties = {}) {
    if (!this.nodes.has(id)) {
      this.nodes.set(id, { id, type, properties, incoming: [], outgoing: [] });
      this.edges.set(id, { incoming: [], outgoing: [] });
    }
    return this.nodes.get(id);
  }

  addEdge(sourceId, targetId, strength = 1.0, type = 'causes') {
    if (!this.nodes.has(sourceId)) this.addNode(sourceId);
    if (!this.nodes.has(targetId)) this.addNode(targetId);

    const edge = { source: sourceId, target: targetId, strength, type };
    this.edges.get(sourceId).outgoing.push(edge);
    this.edges.get(targetId).incoming.push(edge);
    this.nodes.get(targetId).incoming.push(sourceId);
    this.nodes.get(sourceId).outgoing.push(targetId);

    return edge;
  }

  addObservation(event, cause = null) {
    const obs = {
      id: `obs-${this.observations.length}`,
      event,
      cause,
      timestamp: Date.now()
    };
    this.observations.push(obs);

    this.addNode(event.id, event.type || 'observation', event);
    if (cause) {
      this.addEdge(cause, event.id, 1.0, 'observed');
    }

    return obs;
  }

  inferCausalLink(effect, cause) {
    return this.addEdge(cause, effect.id, 0.8, 'inferred');
  }

  forwardChain(startNodeId) {
    const results = [];
    const visited = new Set();
    const queue = [startNodeId];

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);

      const node = this.nodes.get(current);
      if (node) results.push(node);

      const edges = this.edges.get(current)?.outgoing || [];
      edges.forEach(edge => {
        if (!visited.has(edge.target)) {
          queue.push(edge.target);
        }
      });
    }

    return results;
  }

  backwardChain(endNodeId) {
    const results = [];
    const visited = new Set();
    const queue = [endNodeId];

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);

      const node = this.nodes.get(current);
      if (node) results.push(node);

      const edges = this.edges.get(current)?.incoming || [];
      edges.forEach(edge => {
        if (!visited.has(edge.source)) {
          queue.push(edge.source);
        }
      });
    }

    return results;
  }

  findRootCauses(effectId) {
    const roots = [];
    const visited = new Set();
    const queue = [effectId];

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);

      const edges = this.edges.get(current)?.incoming || [];
      if (edges.length === 0) {
        roots.push(current);
      } else {
        edges.forEach(edge => queue.push(edge.source));
      }
    }

    return roots;
  }

  findAllCauses(effectId, depth = 5) {
    if (depth <= 0) return [];
    const causes = new Map();

    const traverse = (nodeId, currentDepth) => {
      if (currentDepth > depth) return;
      const edges = this.edges.get(nodeId)?.incoming || [];
      edges.forEach(edge => {
        const existing = causes.get(edge.source) || 0;
        causes.set(edge.source, existing + edge.strength);
        traverse(edge.source, currentDepth + 1);
      });
    };

    traverse(effectId, 0);
    return Array.from(causes.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, strength]) => ({ id, strength, node: this.nodes.get(id) }));
  }

  findAllEffects(causeId, depth = 5) {
    if (depth <= 0) return [];
    const effects = new Map();

    const traverse = (nodeId, currentDepth) => {
      if (currentDepth > depth) return;
      const edges = this.edges.get(nodeId)?.outgoing || [];
      edges.forEach(edge => {
        const existing = effects.get(edge.target) || 0;
        effects.set(edge.target, existing + edge.strength);
        traverse(edge.target, currentDepth + 1);
      });
    };

    traverse(causeId, 0);
    return Array.from(effects.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, strength]) => ({ id, strength, node: this.nodes.get(id) }));
  }

  counterfactual(causeId, newValue, effectId) {
    const originalEffects = this.findAllEffects(causeId);
    const targetEffect = originalEffects.find(e => e.id === effectId);

    if (!targetEffect) return { applicable: false, reason: 'No causal path found' };

    const originalNode = this.nodes.get(effectId);
    const originalValue = originalNode?.properties?.value;

    return {
      applicable: true,
      originalValue,
      hypotheticalValue: newValue,
      confidence: targetEffect.strength,
      chain: this._traceCausalPath(causeId, effectId)
    };
  }

  _traceCausalPath(sourceId, targetId) {
    const path = [];
    const visited = new Set();
    const queue = [[sourceId]];

    while (queue.length > 0) {
      const currentPath = queue.shift();
      const current = currentPath[currentPath.length - 1];

      if (current === targetId) return currentPath;

      if (visited.has(current)) continue;
      visited.add(current);

      const edges = this.edges.get(current)?.outgoing || [];
      edges.forEach(edge => {
        queue.push([...currentPath, edge.target]);
      });
    }

    return [];
  }

  computeProbability(targetId) {
    const causes = this.findAllCauses(targetId);
    if (causes.length === 0) return { probability: 1.0, confidence: 0 };

    let weightedSum = 0;
    let weightTotal = 0;

    causes.forEach(cause => {
      const node = cause.node;
      const nodeProb = node?.properties?.probability || 0.5;
      weightedSum += nodeProb * cause.strength;
      weightTotal += cause.strength;
    });

    const probability = weightTotal > 0 ? weightedSum / weightTotal : 0;
    return { probability, confidence: weightTotal / causes.length };
  }

  getGraph() {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()).flatMap(e => e.outgoing),
      observations: this.observations
    };
  }

  exportDOT() {
    let dot = 'digraph causal {\n';
    this.nodes.forEach((node, id) => {
      dot += `  ${id} [label="${id}" type="${node.type}"]\n`;
    });
    this.edges.forEach((edges, sourceId) => {
      edges.outgoing.forEach(edge => {
        dot += `  ${sourceId} -> ${edge.target} [label="${edge.type}" weight="${edge.strength}"]\n`;
      });
    });
    dot += '}\n';
    return dot;
  }
}

module.exports = { CausalGraph };