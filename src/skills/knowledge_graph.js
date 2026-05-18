'use strict';

/**
 * SKILL: knowledge_graph
 *
 * Build a graph of entities and relationships from SCRIBE's memory.
 * Extracts entities (souls, systems, events) and their connections.
 * The graph is SCRIBE's map of what relates to what.
 *
 * Operations:
 *   build        — extract entities and edges from memory
 *   neighbors    — find all memories/entities connected to a given node
 *   shortest_path — find the shortest chain between two entities
 *   subgraph     — extract a subgraph around a topic or entity
 *   export_dot   — export as DOT format (Graphviz)
 *   export_json  — export as { nodes, edges } JSON
 *   stats        — graph statistics
 */

const fs   = require('fs');
const path = require('path');

const LEDGER_FILE = path.join(__dirname, '..', '..', 'data', 'ledger.jsonl');

const MANIFEST = {
  name: 'knowledge_graph',
  description: 'Build and query a knowledge graph of entities and relationships from SCRIBE\'s memory.',
  version: '1.0.0',
  inputs: {
    op:      { type: 'string', required: true,  description: '"build"|"neighbors"|"shortest_path"|"subgraph"|"export_dot"|"export_json"|"stats"' },
    entity:  { type: 'string', required: false, description: 'Entity name or ID (neighbors, subgraph)' },
    from:    { type: 'string', required: false, description: 'Source entity (shortest_path)' },
    to:      { type: 'string', required: false, description: 'Target entity (shortest_path)' },
    depth:   { type: 'number', required: false, description: 'Subgraph depth (default 2)' },
    limit:   { type: 'number', required: false, description: 'Max entries to build from (default 200)' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any',
    error:  'string',
    ts:     'string',
  },
};

function load_entries(limit) {
  if (!fs.existsSync(LEDGER_FILE)) return [];
  const raw = fs.readFileSync(LEDGER_FILE, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .slice(-limit);
}

function build_graph(entries) {
  const nodes = new Map(); // id -> { id, label, type, count }
  const edges = [];        // { from, to, relation, weight }

  const add_node = (id, label, type) => {
    if (!nodes.has(id)) nodes.set(id, { id, label: label || id, type: type || 'entity', count: 0 });
    nodes.get(id).count++;
  };

  for (const e of entries) {
    // Memory entry itself as a node
    const mem_id = e.id;
    add_node(mem_id, e.summary?.slice(0, 60) || mem_id, e.type || 'memory');

    // Source system as a node
    if (e.source?.system) {
      add_node(e.source.system, e.source.system, 'system');
      edges.push({ from: e.source.system, to: mem_id, relation: 'produced', weight: e.weight || 0.3 });
    }

    // Chamber as a node
    if (e.source?.chamber && e.source.chamber !== e.source?.system) {
      add_node(e.source.chamber, e.source.chamber, 'chamber');
      edges.push({ from: e.source.chamber, to: mem_id, relation: 'sourced_from', weight: 0.3 });
    }

    // Causal link — support both cause_id and parent_id field names
    const causal_parent = e.cause_id || e.parent_id;
    if (causal_parent && nodes.has(causal_parent)) {
      edges.push({ from: causal_parent, to: mem_id, relation: 'caused', weight: 0.9 });
    }

    // Tags as nodes
    for (const tag of (e.tags || [])) {
      if (['boot', 'system', 'query'].includes(tag)) continue; // too generic
      add_node(`tag:${tag}`, tag, 'tag');
      edges.push({ from: mem_id, to: `tag:${tag}`, relation: 'tagged', weight: 0.2 });
    }
  }

  return { nodes: [...nodes.values()], edges };
}

async function run({ op, entity, from: fromNode, to: toNode, depth = 2, limit = 200 }) {
  const ts = new Date().toISOString();
  try {
    const entries = load_entries(limit);
    const graph = build_graph(entries);
    let result;
    switch (op) {
      case 'build':          result = { node_count: graph.nodes.length, edge_count: graph.edges.length, nodes: graph.nodes.slice(0, 50), edges: graph.edges.slice(0, 100) }; break;
      case 'neighbors':      result = op_neighbors(graph, entity);                         break;
      case 'shortest_path':  result = op_shortest_path(graph, fromNode, toNode);           break;
      case 'subgraph':       result = op_subgraph(graph, entity, depth);                   break;
      case 'export_dot':     result = op_export_dot(graph);                                break;
      case 'export_json':    result = { nodes: graph.nodes, edges: graph.edges };          break;
      case 'stats':          result = op_stats(graph);                                     break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

// ── Operations ────────────────────────────────────────────────────────────────

function op_neighbors(graph, entity) {
  if (!entity) throw new Error('entity is required');
  const q = entity.toLowerCase();
  const matching = graph.nodes.filter(n => n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q));
  if (!matching.length) return { entity, neighbors: [], edges: [] };

  const ids = new Set(matching.map(n => n.id));
  const relevant_edges = graph.edges.filter(e => ids.has(e.from) || ids.has(e.to));
  const neighbor_ids = new Set();
  for (const e of relevant_edges) { neighbor_ids.add(e.from); neighbor_ids.add(e.to); }
  const neighbors = graph.nodes.filter(n => neighbor_ids.has(n.id) && !ids.has(n.id));

  return { entity, matched_nodes: matching, neighbors, edges: relevant_edges };
}

function op_shortest_path(graph, fromNode, toNode) {
  if (!fromNode || !toNode) throw new Error('from and to are required');

  // BFS
  const adj = new Map();
  for (const e of graph.edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.to);
  }

  const find_id = q => {
    const node = graph.nodes.find(n => n.id.toLowerCase().includes(q.toLowerCase()) || n.label.toLowerCase().includes(q.toLowerCase()));
    return node?.id;
  };

  const startId = find_id(fromNode);
  const endId   = find_id(toNode);
  if (!startId) return { error: `Node not found: ${fromNode}` };
  if (!endId)   return { error: `Node not found: ${toNode}` };

  const queue = [[startId]];
  const visited = new Set([startId]);

  while (queue.length) {
    const path = queue.shift();
    const node = path[path.length - 1];
    if (node === endId) {
      const full_path = path.map(id => graph.nodes.find(n => n.id === id) || { id });
      return { found: true, length: path.length - 1, path: full_path };
    }
    for (const neighbor of (adj.get(node) || [])) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }
  return { found: false, from: fromNode, to: toNode, message: 'No path found' };
}

function op_subgraph(graph, entity, depth) {
  if (!entity) throw new Error('entity is required');
  const q = entity.toLowerCase();
  const root = graph.nodes.find(n => n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q));
  if (!root) return { entity, nodes: [], edges: [] };

  const included = new Set([root.id]);
  let frontier = new Set([root.id]);

  for (let d = 0; d < depth; d++) {
    const next = new Set();
    for (const e of graph.edges) {
      if (frontier.has(e.from) && !included.has(e.to)) { included.add(e.to); next.add(e.to); }
      if (frontier.has(e.to)   && !included.has(e.from)) { included.add(e.from); next.add(e.from); }
    }
    frontier = next;
    if (!frontier.size) break;
  }

  return {
    entity: root.label,
    depth,
    nodes: graph.nodes.filter(n => included.has(n.id)),
    edges: graph.edges.filter(e => included.has(e.from) && included.has(e.to)),
  };
}

function op_export_dot(graph) {
  const lines = ['digraph SCRIBE {', '  rankdir=LR;'];
  for (const n of graph.nodes.slice(0, 100)) {
    const shape = n.type === 'memory' ? 'box' : n.type === 'system' ? 'diamond' : n.type === 'tag' ? 'ellipse' : 'circle';
    const safe = n.label.replace(/"/g, '\\"').slice(0, 30);
    lines.push(`  "${n.id}" [label="${safe}" shape=${shape}];`);
  }
  for (const e of graph.edges.slice(0, 200)) {
    lines.push(`  "${e.from}" -> "${e.to}" [label="${e.relation}"];`);
  }
  lines.push('}');
  return { dot: lines.join('\n'), node_count: graph.nodes.length, edge_count: graph.edges.length };
}

function op_stats(graph) {
  const type_counts = {};
  for (const n of graph.nodes) { type_counts[n.type] = (type_counts[n.type] || 0) + 1; }
  const relation_counts = {};
  for (const e of graph.edges) { relation_counts[e.relation] = (relation_counts[e.relation] || 0) + 1; }
  const degrees = {};
  for (const e of graph.edges) {
    degrees[e.from] = (degrees[e.from] || 0) + 1;
    degrees[e.to]   = (degrees[e.to]   || 0) + 1;
  }
  const top_nodes = Object.entries(degrees).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([id, degree]) => { const node = graph.nodes.find(n => n.id === id); return { id, label: node?.label || id, degree }; });

  return { node_count: graph.nodes.length, edge_count: graph.edges.length, node_types: type_counts, relation_types: relation_counts, most_connected: top_nodes };
}

module.exports = { MANIFEST, run };
