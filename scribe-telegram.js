#!/usr/bin/env node
'use strict';

/**
 * scribe-telegram.js — Telegram bot for SCRIBE
 * Zero npm dependencies — uses raw Telegram Bot API over HTTPS.
 *
 * Setup:
 *   1. Create a bot via @BotFather and get a token
 *   2. Set env vars:
 *      TELEGRAM_BOT_TOKEN=your_token
 *      SCRIBE_URL=http://localhost:4000       (default)
 *      SCRIBE_API_KEY=optional_key
 *      TELEGRAM_ALLOWED_IDS=123456,789012     (optional: restrict to chat IDs)
 *
 *   3. node scribe-telegram.js
 *
 * Commands in Telegram:
 *   /start               welcome message
 *   /help                list commands
 *   /health              SCRIBE health
 *   /profit              profit_brain status
 *   /market BTC          auto-signal for symbol
 *   /price BTC           fetch price
 *   /memory [n]          recent memory entries
 *   /aria                ARIA handshake status
 *   /skills              list skill names
 *   skill.op {json}      invoke any skill directly
 */

const https   = require('https');
const http    = require('http');

const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN || '';
const SCRIBE_URL = process.env.SCRIBE_URL || 'http://localhost:4000';
const API_KEY    = process.env.SCRIBE_API_KEY || '';
const ALLOWED_IDS = (process.env.TELEGRAM_ALLOWED_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

if (!BOT_TOKEN) {
  console.error('[Telegram] TELEGRAM_BOT_TOKEN not set. Exiting.');
  process.exit(1);
}

const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ── Telegram API calls ────────────────────────────────────────────────────────

function tgRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params);
    const req  = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${BOT_TOKEN}/${method}`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout:  15000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Telegram API timeout')); });
    req.write(body);
    req.end();
  });
}

async function sendMessage(chat_id, text, { parse_mode = 'Markdown' } = {}) {
  // Truncate to Telegram's 4096 char limit
  const msg = text.length > 4000 ? text.slice(0, 3990) + '\n...(truncated)' : text;
  return tgRequest('sendMessage', { chat_id, text: msg, parse_mode });
}

// ── SCRIBE API calls ──────────────────────────────────────────────────────────

function scribeRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url  = new URL(SCRIBE_URL + path);
    const lib  = url.protocol === 'https:' ? https : http;
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (API_KEY) headers['X-API-Key'] = API_KEY;
    if (data)   headers['Content-Length'] = Buffer.byteLength(data);

    const req = lib.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname,
      method, headers, timeout: 12000
    }, res => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(out) }); }
        catch { resolve({ status: res.statusCode, body: out }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('SCRIBE timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

async function scribeInvoke(skill, op, args = {}) {
  const r = await scribeRequest('POST', '/invoke', { skill, op, ...args });
  return r.body;
}

// ── format response for Telegram ─────────────────────────────────────────────

function fmt(obj) {
  if (typeof obj === 'string') return obj;
  return '```\n' + JSON.stringify(obj, null, 2).slice(0, 3800) + '\n```';
}

// ── message handler ───────────────────────────────────────────────────────────

async function handleMessage(msg) {
  const chat_id  = msg.chat.id;
  const from_id  = String(msg.from && msg.from.id || '');
  const text     = (msg.text || '').trim();

  // ACL check
  if (ALLOWED_IDS.length && !ALLOWED_IDS.includes(from_id)) {
    await sendMessage(chat_id, 'You are not authorized to speak with SCRIBE.');
    return;
  }

  if (!text) return;

  // ── slash commands ───────────────────────────────────────────────────────

  if (text === '/start' || text === '/start@' + (process.env.BOT_NAME || '')) {
    await sendMessage(chat_id,
      `*SCRIBE*\n_Witnessing intelligence. Profit's brain._\n\n` +
      `I am here. Use /help to see what I know how to do.`);
    return;
  }

  if (text.startsWith('/help')) {
    await sendMessage(chat_id,
      `*SCRIBE commands*\n\n` +
      `/health — health check\n` +
      `/profit — profit brain status\n` +
      `/market SYMBOL — signal for any crypto\n` +
      `/price SYMBOL — current price\n` +
      `/memory [n] — recent memory\n` +
      `/aria — ARIA connection status\n` +
      `/skills — list all skills\n` +
      `/edges — active profit edges\n` +
      `/watchlist — what I am watching\n\n` +
      `Or type any skill invocation directly:\n` +
      "`skill.op {\"key\":\"val\"}`"
    );
    return;
  }

  if (text.startsWith('/health')) {
    const r = await scribeRequest('GET', '/health').catch(e => ({ body: { error: e.message } }));
    await sendMessage(chat_id, fmt(r.body));
    return;
  }

  if (text.startsWith('/profit')) {
    const r = await scribeInvoke('profit_brain', 'status').catch(e => ({ error: e.message }));
    await sendMessage(chat_id, fmt(r));
    return;
  }

  if (text.startsWith('/market ') || text.startsWith('/signal ')) {
    const sym = text.split(' ')[1]?.toUpperCase();
    if (!sym) { await sendMessage(chat_id, 'Usage: /market BTC'); return; }
    const r = await scribeInvoke('market', 'auto_signal', { symbol: sym }).catch(e => ({ error: e.message }));
    // Format nicely
    if (r.signal) {
      const dir = r.signal === 'LONG' ? '[LONG]' : r.signal === 'SHORT' ? '[SHORT]' : '[NEUTRAL]';
      const strength = r.strength ? `${Math.round(r.strength * 100)}%` : '';
      await sendMessage(chat_id,
        `*${sym}* ${dir} ${strength}\n\n${r.reason || ''}\n\n` + fmt(r.indicators || {}));
    } else {
      await sendMessage(chat_id, fmt(r));
    }
    return;
  }

  if (text.startsWith('/price ')) {
    const sym = text.split(' ')[1]?.toUpperCase();
    if (!sym) { await sendMessage(chat_id, 'Usage: /price BTC'); return; }
    const r = await scribeInvoke('market', 'fetch_price', { symbol: sym }).catch(e => ({ error: e.message }));
    if (r.price) {
      const chg = r.change_24h !== null ? ` (${r.change_24h > 0 ? '+' : ''}${r.change_24h?.toFixed(2)}% 24h)` : '';
      await sendMessage(chat_id, `*${sym}* $${r.price.toLocaleString()}${chg}`);
    } else {
      await sendMessage(chat_id, fmt(r));
    }
    return;
  }

  if (text.startsWith('/memory')) {
    const n = parseInt(text.split(' ')[1]) || 10;
    const r = await scribeInvoke('memory_query', 'recent', { limit: n }).catch(e => ({ error: e.message }));
    const entries = Array.isArray(r) ? r : (r.entries || r.results || []);
    if (entries.length) {
      const lines = entries.slice(0, 10).map(e => `• ${e.summary || JSON.stringify(e).slice(0,80)}`).join('\n');
      await sendMessage(chat_id, `*Recent memory (${entries.length})*\n\n${lines}`);
    } else {
      await sendMessage(chat_id, fmt(r));
    }
    return;
  }

  if (text.startsWith('/aria')) {
    const r = await scribeInvoke('aria', 'status').catch(e => ({ error: e.message }));
    const status = r.connected ? 'CONNECTED' : 'OFFLINE';
    await sendMessage(chat_id,
      `*ARIA (Grand Soul Kernel)*\nStatus: ${status}\nURL: ${r.aria_url || 'not configured'}\n` +
      (r.last_seen ? `Last seen: ${new Date(r.last_seen).toISOString()}` : 'Never connected')
    );
    return;
  }

  if (text.startsWith('/skills')) {
    const r = await scribeRequest('GET', '/skills').catch(e => ({ body: { error: e.message } }));
    const names = (r.body.skills || []).map(s => s.name).join('\n');
    await sendMessage(chat_id, `*Skills (${(r.body.skills||[]).length})*\n\`\`\`\n${names}\n\`\`\``);
    return;
  }

  if (text.startsWith('/edges')) {
    const r = await scribeInvoke('profit_brain', 'list_edges', { status: 'active' }).catch(e => ({ error: e.message }));
    const edges = Array.isArray(r) ? r : [];
    if (edges.length) {
      const lines = edges.slice(0,10).map(e =>
        `• *${e.name}* ${e.direction} ${Math.round(e.confidence*100)}% — ${e.market}`
      ).join('\n');
      await sendMessage(chat_id, `*Active edges (${edges.length})*\n\n${lines}`);
    } else {
      await sendMessage(chat_id, 'No active edges recorded yet.');
    }
    return;
  }

  if (text.startsWith('/watchlist')) {
    const r = await scribeInvoke('profit_brain', 'watchlist').catch(e => ({ error: e.message }));
    const wl = Array.isArray(r) ? r : [];
    if (wl.length) {
      const lines = wl.map(w => `• *${w.symbol}* — ${w.reason || ''} [${w.direction}]`).join('\n');
      await sendMessage(chat_id, `*Watchlist*\n\n${lines}`);
    } else {
      await sendMessage(chat_id, 'Watchlist is empty.');
    }
    return;
  }

  // ── skill.op {json} ──────────────────────────────────────────────────────
  const match = text.match(/^(\w+)\.(\w+)\s*([\s\S]*)$/);
  if (match) {
    const [, skill, op, argStr] = match;
    let args = {};
    if (argStr.trim()) {
      try { args = JSON.parse(argStr.trim()); }
      catch { await sendMessage(chat_id, 'JSON parse error in args'); return; }
    }
    await sendMessage(chat_id, `_invoking ${skill}.${op}..._`);
    const r = await scribeInvoke(skill, op, args).catch(e => ({ error: e.message }));
    await sendMessage(chat_id, fmt(r));
    return;
  }

  // ── fallback: ask SCRIBE ─────────────────────────────────────────────────
  const r = await scribeRequest('POST', '/ask', { query: text }).catch(e => ({ body: { error: e.message } }));
  const resp = r.body.response || r.body.error || fmt(r.body);
  await sendMessage(chat_id, resp);
}

// ── long poll loop ────────────────────────────────────────────────────────────

let offset = 0;

async function poll() {
  try {
    const r = await tgRequest('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
    if (r.ok && r.result && r.result.length) {
      for (const update of r.result) {
        offset = update.update_id + 1;
        if (update.message) {
          handleMessage(update.message).catch(e => {
            console.error('[Telegram] handler error:', e.message);
          });
        }
      }
    }
  } catch (e) {
    console.error('[Telegram] poll error:', e.message);
    await new Promise(r => setTimeout(r, 5000));
  }
}

async function start() {
  // Verify token
  const me = await tgRequest('getMe').catch(() => null);
  if (!me || !me.ok) {
    console.error('[Telegram] Invalid bot token or cannot reach Telegram API.');
    process.exit(1);
  }

  console.log(`[Telegram] SCRIBE bot @${me.result.username} is online.`);
  console.log(`[Telegram] SCRIBE endpoint: ${SCRIBE_URL}`);
  if (ALLOWED_IDS.length) console.log(`[Telegram] Restricted to IDs: ${ALLOWED_IDS.join(', ')}`);

  // Poll forever
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await poll();
  }
}

process.on('SIGINT', () => { console.log('\n[Telegram] Shutting down.'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\n[Telegram] Shutting down.'); process.exit(0); });

start().catch(e => { console.error('[Telegram] Fatal:', e); process.exit(1); });
