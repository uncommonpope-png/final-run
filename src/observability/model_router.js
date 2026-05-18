'use strict';

const crypto = require('crypto');

function createRouter(models = {}) {
  const defaultModels = {
    cheap:  'deepseek-r1:1.5b',
    medium: 'deepseek-r1:7b',
    complex: 'deepseek-r1:14b',
    reasoning: 'deepseek-r1:32b',
  };
  const config = { ...defaultModels, ...models };

  const COMPLEXITY_PATTERNS = [
    /analyze|analysis|architect|design|plan/i,
    /complex|intricate|elaborate/i,
    /debug|investigate|diagnose/i,
    /research|study|explore/i,
    /refactor|restructure|rebuild/i,
  ];
  const SIMPLE_PATTERNS = [
    /list|get|show|what is|who is|when/i,
    /simple|count|summarize|translate/i,
  ];

  function classify(prompt) {
    if (!prompt) return 'cheap';
    const upper = prompt.toLowerCase();
    let complexityScore = 0;
    for (const p of COMPLEXITY_PATTERNS) {
      if (p.test(upper)) complexityScore += 2;
    }
    for (const p of SIMPLE_PATTERNS) {
      if (p.test(upper)) complexityScore -= 1;
    }
    if (complexityScore >= 3) return 'complex';
    if (complexityScore >= 1) return 'medium';
    return 'cheap';
  }

  return {
    classify,
    getModel(prompt, tier) {
      if (tier && config[tier]) return config[tier];
      const t = classify(prompt);
      return config[t];
    },
    getTier(prompt) {
      return classify(prompt);
    },
    getAllTiers() { return Object.keys(config); },
  };
}

module.exports = { createRouter };