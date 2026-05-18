'use strict';

/**
 * LAST30DAYS.JS — Analyze activity from the last 30 days — trends, stats, summaries, and insights via brain reasoning
 * Auto-converted from stub/fake to brain.think()-powered implementation.
 */

const PLT_AFFINITY = { profit: 0.5, love: 0.3, tax: 0.2 };

async function last30days(brain, memory, input) {
    const prompt = `You are a last30days specialist. Your task: ${typeof input === 'string' ? input : JSON.stringify(input) || 'process this request'}.

Analyze activity from the last 30 days — trends, stats, summaries, and insights via brain reasoning.

Provide a detailed, actionable response in natural language. Include specific recommendations, steps, or analysis based on best practices.`;

    const result = await brain.think(prompt);
    if (memory && typeof memory.witness === 'function') {
        await memory.witness({ type: 'skill_execution', skill: 'last30days', input, result }).catch(() => {});
    }
    return { success: true, skill: 'last30days', result };
}

module.exports = { last30days, PLT_AFFINITY };
