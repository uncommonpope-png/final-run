const COMMAND_HANDLERS = {
  create_mission: {
    schema: {
      mission_name: { type: 'string', required: true },
      objective: { type: 'string', required: true },
      priority: { type: 'string', required: false, enum: ['low', 'medium', 'high', 'critical'] },
      constraints: { type: 'array', required: false }
    },
    handler: async (entities, context) => {
      const reasoning = await import('./reasoning.js').catch(() => null);
      if (reasoning?.scoreMission) {
        const pltScore = await reasoning.scoreMission(entities.objective, context);
        return { command: 'create_mission', payload: { ...entities, pltScore } };
      }
      return { command: 'create_mission', payload: entities };
    }
  },

  spawn_agent: {
    schema: {
      agent_type: { type: 'string', required: true },
      name: { type: 'string', required: true },
      capabilities: { type: 'array', required: false }
    },
    handler: async (entities, context) => {
      const agentSpawn = await import('./agent_spawn.js').catch(() => null);
      if (agentSpawn?.spawn) {
        return await agentSpawn.spawn(entities, context);
      }
      return { command: 'spawn_agent', payload: entities };
    }
  },

  query_status: {
    schema: {
      target_type: { type: 'string', required: true, enum: ['mission', 'agent', 'all'] },
      target_id: { type: 'string', required: false }
    },
    handler: async (entities, context) => {
      const memory = await import('./memory_query.js').catch(() => null);
      if (memory?.query) {
        const results = await memory.query({ type: entities.target_type, id: entities.target_id }, context);
        return { command: 'query_status', payload: results };
      }
      return { command: 'query_status', payload: entities };
    }
  },

  modify_behavior: {
    schema: {
      target: { type: 'string', required: true },
      modification: { type: 'object', required: true }
    },
    handler: async (entities, context) => {
      return { command: 'modify_behavior', payload: entities, target: 'ARIA' };
    }
  },

  teach_skill: {
    schema: {
      skill_name: { type: 'string', required: true },
      implementation: { type: 'string', required: true },
      parameters: { type: 'array', required: false }
    },
    handler: async (entities, context) => {
      const reasoning = await import('./reasoning.js').catch(() => null);
      if (reasoning?.validateSkill) {
        const validated = await reasoning.validateSkill(entities, context);
        return { command: 'teach_skill', payload: validated };
      }
      return { command: 'teach_skill', payload: entities };
    }
  },

  delegate_mission: {
    schema: {
      mission_id: { type: 'string', required: true },
      agent_id: { type: 'string', required: true },
      urgency: { type: 'string', required: false }
    },
    handler: async (entities, context) => {
      return { command: 'delegate_mission', payload: entities, target: 'ARIA' };
    }
  },

  score_situation: {
    schema: {
      situation: { type: 'string', required: true },
      context: { type: 'object', required: false }
    },
    handler: async (entities, context) => {
      const reasoning = await import('./reasoning.js').catch(() => null);
      if (reasoning?.analyzeSituation) {
        const analysis = await reasoning.analyzeSituation(entities.situation, context);
        return { command: 'score_situation', payload: analysis };
      }
      return { command: 'score_situation', payload: entities };
    }
  },

  memory_search: {
    schema: {
      query: { type: 'string', required: true },
      filters: { type: 'object', required: false },
      limit: { type: 'number', required: false }
    },
    handler: async (entities, context) => {
      const memoryQuery = await import('./memory_query.js').catch(() => null);
      if (memoryQuery?.search) {
        const results = await memoryQuery.search(entities.query, entities.filters, context);
        return { command: 'memory_search', payload: results };
      }
      return { command: 'memory_search', payload: entities };
    }
  },

  read_chamber: {
    schema: {
      chamber_id: { type: 'string', required: true },
      depth: { type: 'number', required: false }
    },
    handler: async (entities, context) => {
      const chamberScan = await import('./chamber_scan.js').catch(() => null);
      if (chamberScan?.scan) {
        const results = await chamberScan.scan(entities.chamber_id, entities.depth, context);
        return { command: 'read_chamber', payload: results };
      }
      return { command: 'read_chamber', payload: entities };
    }
  },

  bootstrap_workforce: {
    schema: {
      workforce_type: { type: 'string', required: true },
      count: { type: 'number', required: false },
      specializations: { type: 'array', required: false }
    },
    handler: async (entities, context) => {
      return { command: 'bootstrap_workforce', payload: entities, target: 'ARIA' };
    }
  }
};

function get_handler(intent) {
  const handler = COMMAND_HANDLERS[intent];
  return handler ? handler.handler : null;
}

function validate(schema, params) {
  const errors = [];
  for (const [field, rules] of Object.entries(schema)) {
    if (rules.required && (params[field] === undefined || params[field] === null)) {
      errors.push(`Missing required field: ${field}`);
      continue;
    }
    if (params[field] !== undefined && params[field] !== null) {
      const actualType = Array.isArray(params[field]) ? 'array' : typeof params[field];
      if (actualType !== rules.type) {
        errors.push(`Invalid type for ${field}: expected ${rules.type}, got ${actualType}`);
      }
      if (rules.enum && !rules.enum.includes(params[field])) {
        errors.push(`Invalid value for ${field}: must be one of ${rules.enum.join(', ')}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

async function execute(intent, entities, context = {}) {
  const command = COMMAND_HANDLERS[intent];
  if (!command) {
    throw new Error(`Unknown intent: ${intent}`);
  }
  const validation = validate(command.schema, entities);
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
  }
  return await command.handler(entities, context);
}

function list_commands() {
  return Object.keys(COMMAND_HANDLERS).map(intent => ({
    intent,
    schema: COMMAND_HANDLERS[intent].schema
  }));
}

const MANIFEST = {
  name: 'command_registry',
  version: '1.0.0',
  description: 'Maps NLP intents to executable handlers'
};

module.exports = {
  COMMAND_HANDLERS,
  get_handler,
  validate,
  execute,
  list_commands,
  MANIFEST
};