'use strict';

exports.text_summarization = async function(brain, memory, input) {
  try {
    const result = await brain.think({
      model: 't5-base',
      prompt: `Summarize the following text: ${input.text}`,
      max_tokens: 200
    });
    memory.witness('text_summarization', { input: input.text, result: result });
    return { skill: 'text_summarization', result: result, timestamp: new Date().toISOString() };
  } catch (error) {
    memory.witness('text_summarization_error', { input: input.text, error: error.message });
    return { skill: 'text_summarization', result: 'Error: ' + error.message, timestamp: new Date().toISOString() };
  }
};

exports.PLT_AFFINITY = { profit: 0.5, love: 0.3, tax: 0.2 };