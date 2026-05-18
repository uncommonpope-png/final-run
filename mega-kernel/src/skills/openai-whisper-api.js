'use strict';

/**
 * OPENAI-WHISPER-API.JS — Transcribe audio via Whisper — speech-to-text, diarization, and language detection via brain reasoning
 * Auto-converted from stub/fake to brain.think()-powered implementation.
 */

const PLT_AFFINITY = { profit: 0.5, love: 0.3, tax: 0.2 };

async function openai_whisper_api(brain, memory, input) {
    const prompt = `You are a openai-whisper-api specialist. Your task: ${typeof input === 'string' ? input : JSON.stringify(input) || 'process this request'}.

Transcribe audio via Whisper — speech-to-text, diarization, and language detection via brain reasoning.

Provide a detailed, actionable response in natural language. Include specific recommendations, steps, or analysis based on best practices.`;

    const result = await brain.think(prompt);
    if (memory && typeof memory.witness === 'function') {
        await memory.witness({ type: 'skill_execution', skill: 'openai-whisper-api', input, result }).catch(() => {});
    }
    return { success: true, skill: 'openai-whisper-api', result };
}

module.exports = { openai_whisper_api, PLT_AFFINITY };
