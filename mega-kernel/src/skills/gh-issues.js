'use strict';

/**
 * GH-ISSUES.JS — Manage GitHub Issues — create, search, label, assign, and close issues via brain reasoning
 * Converted from mock-data implementation to brain.think()-powered.
 */

const PLT_AFFINITY = { profit: 0.5, love: 0.3, tax: 0.2 };

async function skill_gh_issues(brain, memory, input) {
    const prompt = `You are a gh-issues specialist. Your task: ${typeof input === 'string' ? input : JSON.stringify(input) || 'process this request'}.

Manage GitHub Issues — create, search, label, assign, and close issues via brain reasoning.

Provide a detailed, actionable response in natural language. Include specific recommendations, steps, or analysis based on best practices.`;

    const result = await brain.think(prompt);
    if (memory && typeof memory.witness === 'function') {
        await memory.witness({ type: 'skill_execution', skill: 'gh-issues', input, result }).catch(() => {});
    }
    return { success: true, skill: 'gh-issues', result };
}

module.exports = { skill_gh_issues, PLT_AFFINITY };
