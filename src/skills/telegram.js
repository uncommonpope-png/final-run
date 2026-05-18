'use strict';

/**
 * SKILL: telegram
 *
 * Send messages via a Telegram bot using the Bot API.
 * Zero external dependencies — uses Node's built-in https.
 *
 * Requires env vars:
 *   TELEGRAM_BOT_TOKEN  — bot token from @BotFather
 *   TELEGRAM_CHAT_ID    — default chat/channel ID to send to
 *
 * Operations:
 *   send        — send a text message
 *   send_photo  — send a photo by URL
 *   get_me      — return bot info (test that token is valid)
 *   get_updates — return recent messages (polling)
 */

const https = require('https');

const MANIFEST = {
  name: 'telegram',
  description: 'Send messages and media via Telegram Bot API.',
  version: '1.0.0',
  inputs: {
    op:        { type: 'string', required: true,  description: '"send"|"send_photo"|"get_me"|"get_updates"' },
    text:      { type: 'string', required: false, description: 'Message text (send op)' },
    chat_id:   { type: 'string', required: false, description: 'Telegram chat ID (overrides env var)' },
    photo_url: { type: 'string', required: false, description: 'Photo URL (send_photo op)' },
    caption:   { type: 'string', required: false, description: 'Caption for photo' },
    token:     { type: 'string', required: false, description: 'Bot token (overrides TELEGRAM_BOT_TOKEN env var)' },
    parse_mode:{ type: 'string', required: false, description: '"HTML" or "Markdown" (default: plain text)' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any — Telegram API response',
    error:  'string',
    ts:     'string',
  },
};

async function run({ op, text, chat_id, photo_url, caption, token, parse_mode }) {
  const ts = new Date().toISOString();
  const botToken = token || process.env.TELEGRAM_BOT_TOKEN;
  const chatId   = chat_id || process.env.TELEGRAM_CHAT_ID;

  if (!botToken) return { ok: false, op, error: 'TELEGRAM_BOT_TOKEN not set', ts };

  try {
    let result;
    switch (op) {
      case 'send':
        if (!text) throw new Error('text is required');
        if (!chatId) throw new Error('chat_id required (or set TELEGRAM_CHAT_ID env var)');
        result = await api(botToken, 'sendMessage', { chat_id: chatId, text, parse_mode });
        break;
      case 'send_photo':
        if (!photo_url) throw new Error('photo_url is required');
        if (!chatId) throw new Error('chat_id required');
        result = await api(botToken, 'sendPhoto', { chat_id: chatId, photo: photo_url, caption });
        break;
      case 'get_me':
        result = await api(botToken, 'getMe', {});
        break;
      case 'get_updates':
        result = await api(botToken, 'getUpdates', { limit: 10 });
        break;
      default:
        return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

// ── Telegram API call ─────────────────────────────────────────────────────────

function api(token, method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params);
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${token}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 15000,
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!json.ok) reject(new Error(`Telegram error: ${json.description || JSON.stringify(json)}`));
          else resolve(json.result);
        } catch { reject(new Error('Invalid Telegram response')); }
      });
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Telegram API timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { MANIFEST, run };
