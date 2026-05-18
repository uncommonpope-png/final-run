export const MANIFEST = {
  name: "nlp_parser",
  description: "Pattern-based NLP parser for ARIA/SCRIBE intent classification and entity extraction",
  version: "1.0.0",
  inputs: {
    text: {
      type: "string",
      description: "Natural language text to parse",
      required: true
    }
  },
  output: {
    type: "object",
    description: "Parsed intent, entities, confidence, and parser tier",
    properties: {
      intent: "string",
      entities: "object",
      confidence: "number",
      parser_tier: "string"
    }
  },
  ops: ["parse", "classify", "extract_entities"]
};

const INTENT_PATTERNS = {
  create_mission: [
    /\bcreate\s+(?:a\s+)?mission\b/i,
    /\blaunch\s+mission\b/i,
    /\bstart\s+task\b/i,
    /\bnew\s+mission\b/i,
    /\binitiate\s+mission\b/i,
    /\bbegin\s+(?:a\s+)?task\b/i
  ],
  spawn_agent: [
    /\bspawn\s+agent\b/i,
    /\bcreate\s+sub[-\s]?agent\b/i,
    /\bhire\s+agent\b/i,
    /\badd\s+agent\b/i,
    /\bnew\s+agent\b/i,
    /\bdeploy\s+agent\b/i
  ],
  query_status: [
    /\bhow\s+is\b/i,
    /\bwhat\s+is\s+status\b/i,
    /\bshow\s+agents\b/i,
    /\bstatus\s+(?:of|on)\b/i,
    /\blist\s+(?:all\s+)?agents\b/i,
    /\bget\s+(?:me\s+)?status\b/i,
    /\bhow\s+(?:are|is)\s+\w+\s+(?:doing|going)\b/i
  ],
  modify_behavior: [
    /\bchange\b/i,
    /\bmodify\b/i,
    /\bset\s+behavior\b/i,
    /\badjust\b/i,
    /\btweak\b/i,
    /\bupdate\s+(?:my\s+)?behavior\b/i
  ],
  teach_skill: [
    /\bteach\b/i,
    /\btrain\b/i,
    /\blearn\b/i,
    /\binstruct\b/i,
    /\badd\s+skill\b/i,
    /\benable\b/i
  ],
  delegate_mission: [
    /\bdelegate\b/i,
    /\bassign\s+task\b/i,
    /\bsend\s+(?:to|with)\b/i,
    /\bpass\s+to\b/i,
    /\bredirect\b/i
  ],
  score_situation: [
    /\bscore\b/i,
    /\bplt\s+analysis\b/i,
    /\bevaluate\b/i,
    /\banalyze\b/i,
    /\bassess\b/i,
    /\breview\b/i,
    /\bplotted\s+analysis\b/i
  ],
  memory_search: [
    /\bremember\b/i,
    /\bsearch\s+memory\b/i,
    /\bwhat\s+do\s+you\s+know\b/i,
    /\bfind\s+in\s+memory\b/i,
    /\brecall\b/i,
    /\blookup\b/i,
    /\bretrieve\b/i
  ],
  read_chamber: [
    /\bread\s+chamber\b/i,
    /\bscan\s+repo\b/i,
    /\binspect\s+repository\b/i,
    /\bbrowse\s+chamber\b/i,
    /\bcheck\s+repo\b/i
  ],
  bootstrap_workforce: [
    /\bbootstrap\b/i,
    /\bspawn\s+all\s+agents\b/i,
    /\binitialize\s+workforce\b/i,
    /\bfire\s+up\s+(?:all\s+)?agents\b/i,
    /\bsetup\s+agents\b/i
  ]
};

const ENTITY_PATTERNS = {
  quoted_strings: /"([^"]+)"|'([^']+)'/g,
  numbers: /\b\d+(?:\.\d+)?\b/g,
  names: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
  tier_keywords: /\b(bronze|silver|gold|divine)\b/gi
};

function extractEntities(text) {
  const entities = {
    quotes: [],
    numbers: [],
    names: [],
    tiers: []
  };

  let match;

  const quotePattern = new RegExp(ENTITY_PATTERNS.quoted_strings.source, 'g');
  while ((match = quotePattern.exec(text)) !== null) {
    entities.quotes.push(match[1] || match[2]);
  }

  const numberPattern = new RegExp(ENTITY_PATTERNS.numbers.source, 'g');
  while ((match = numberPattern.exec(text)) !== null) {
    entities.numbers.push(parseFloat(match[0]));
  }

  const namePattern = new RegExp(ENTITY_PATTERNS.names.source, 'g');
  while ((match = namePattern.exec(text)) !== null) {
    entities.names.push(match[0]);
  }

  const tierPattern = new RegExp(ENTITY_PATTERNS.tier_keywords.source, 'gi');
  while ((match = tierPattern.exec(text)) !== null) {
    entities.tiers.push(match[0].toLowerCase());
  }

  return entities;
}

function calculateConfidence(matches, totalPatterns) {
  return matches / totalPatterns;
}

export function parse(text) {
  if (!text || typeof text !== 'string') {
    return {
      intent: null,
      entities: {},
      confidence: 0,
      parser_tier: "pattern"
    };
  }

  const normalizedText = text.trim().toLowerCase();
  const entities = extractEntities(text);
  let bestIntent = null;
  let bestConfidence = 0;
  let bestMatches = 0;

  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    let matches = 0;
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        matches++;
      }
    }

    if (matches > 0) {
      const confidence = calculateConfidence(matches, patterns.length);

      if (confidence > bestConfidence || (confidence === bestConfidence && matches > bestMatches)) {
        bestIntent = intent;
        bestConfidence = confidence;
        bestMatches = matches;
      }
    }
  }

  if (bestConfidence >= 0.85) {
    return {
      intent: bestIntent,
      entities,
      confidence: Math.min(bestConfidence, 1),
      parser_tier: "pattern"
    };
  }

  return {
    intent: bestIntent,
    entities,
    confidence: bestConfidence,
    parser_tier: bestConfidence > 0 ? "pattern" : "llm"
  };
}

export function classify(text) {
  return parse(text);
}

export function extractEntitiesPublic(text) {
  return extractEntities(text);
}

export default { parse, classify, extractEntities: extractEntitiesPublic, MANIFEST };