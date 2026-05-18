'use strict';

/**
 * REFLECTION.JS — Reflect on experiences — analyze events, extract lessons, and integrate insights via brain reasoning
 * Auto-converted from stub/fake to brain.think()-powered implementation.
 */

const PLT_AFFINITY = { profit: 0.3, love: 0.6, tax: 0.1 };

async function reflection(brain, memory, input) {
    const prompt = `You are a reflection specialist. Your task: ${typeof input === 'string' ? input : JSON.stringify(input) || 'process this request'}.

Reflect on experiences — analyze events, extract lessons, and integrate insights via brain reasoning.

Provide a detailed, actionable response in natural language. Include specific recommendations, steps, or analysis based on best practices.`;

    const result = await brain.think(prompt);
    if (memory && typeof memory.witness === 'function') {
        await memory.witness({ type: 'skill_execution', skill: 'reflection', input, result }).catch(() => {});
    }
    return { success: true, skill: 'reflection', result };
}

module.exports = { reflection, PLT_AFFINITY };
