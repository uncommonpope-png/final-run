'use strict';

/**
 * GEMINI.JS — Interact with Google Gemini API — generate text, analyze content, and process multimodal inputs via brain reasoning
 * Converted from mock-data implementation to brain.think()-powered.
 */

const PLT_AFFINITY = { profit: 0.5, love: 0.3, tax: 0.2 };

async function skill_gemini(brain, memory, input) {
    const prompt = `You are a gemini specialist. Your task: ${typeof input === 'string' ? input : JSON.stringify(input) || 'process this request'}.

Interact with Google Gemini API — generate text, analyze content, and process multimodal inputs via brain reasoning.

Provide a detailed, actionable response in natural language. Include specific recommendations, steps, or analysis based on best practices.`;

    const result = await brain.think(prompt);
    if (memory && typeof memory.witness === 'function') {
        await memory.witness({ type: 'skill_execution', skill: 'gemini', input, result }).catch(() => {});
    }
    return { success: true, skill: 'gemini', result };
}

module.exports = { skill_gemini, PLT_AFFINITY };
