'use strict';

// email_send.js — SMTP email dispatch via raw TCP (no external deps)
// Supports plain SMTP and STARTTLS (port 587).
// Config via env vars: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// Ops: send, test_connection, set_config, get_config

const net    = require('net');
const tls    = require('tls');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const DATA_DIR    = path.join(__dirname, '..', '..', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'email_config.json');

// ── Config ────────────────────────────────────────────────────────────────────

function _loadConfig() {
  let stored = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try { stored = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) {}
  }
  return {
    host:  process.env.SMTP_HOST  || stored.host  || '',
    port:  parseInt(process.env.SMTP_PORT  || stored.port  || '587', 10),
    user:  process.env.SMTP_USER  || stored.user  || '',
    pass:  process.env.SMTP_PASS  || stored.pass  || '',
    from:  process.env.SMTP_FROM  || stored.from  || '',
    use_tls: stored.use_tls !== undefined ? stored.use_tls : true,
  };
}

function op_set_config(params) {
  const { host, port, user, pass, from, use_tls = true } = params || {};
  const cfg = { host, port: parseInt(port || 587, 10), user, pass, from, use_tls };
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, CONFIG_FILE);
  return { status: 'saved', host, port: cfg.port, from };
}

function op_get_config() {
  const cfg = _loadConfig();
  return { host: cfg.host, port: cfg.port, user: cfg.user, from: cfg.from, use_tls: cfg.use_tls, pass: cfg.pass ? '[SET]' : '[NOT SET]' };
}

// ── SMTP low-level ────────────────────────────────────────────────────────────

function _b64(s) { return Buffer.from(s).toString('base64'); }

function _smtpDialog(socket, steps) {
  return new Promise((resolve, reject) => {
    let step = 0;
    const log = [];
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error('SMTP timeout.')); }, 20000);

    function next(data) {
      const line = data.toString().trim();
      log.push(`<< ${line}`);
      const code = parseInt(line.slice(0, 3), 10);
      const { expect, send, done } = steps[step] || {};
      if (expect && code !== expect) {
        clearTimeout(timeout);
        reject(new Error(`SMTP error at step ${step}: expected ${expect}, got ${code}: ${line}`));
        return;
      }
      if (done) { clearTimeout(timeout); resolve(log); return; }
      if (send) {
        const cmd = typeof send === 'function' ? send() : send;
        log.push(`>> ${cmd.replace(/\n.*/s, '...')}`);
        socket.write(cmd + '\r\n');
      }
      step++;
    }

    socket.on('data', next);
    socket.on('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

async function _sendEmail({ host, port, user, pass, from, to, subject, body, use_tls }) {
  const recipients = Array.isArray(to) ? to : [to];
  const msg_id = `<${Date.now()}.${crypto.randomBytes(4).toString('hex')}@scribe>`;
  const date = new Date().toUTCString();
  const raw_message = [
    `From: ${from}`,
    `To: ${recipients.join(', ')}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Message-ID: ${msg_id}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    '',
    body,
    '.',
  ].join('\r\n');

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, async () => {
      try {
        // EHLO phase (plain)
        const steps_plain = [
          { expect: 220 },                                           // greeting
          { expect: 250, send: `EHLO scribe` },                     // EHLO
          { expect: 220, send: `STARTTLS` },                        // request TLS
        ];

        if (use_tls && port === 587) {
          await _smtpDialog(socket, steps_plain);
          // Upgrade socket to TLS
          const sec = tls.connect({ socket, host, servername: host }, async () => {
            try {
              const steps_auth = [
                { expect: 250, send: `EHLO scribe` },
                { expect: 334, send: `AUTH LOGIN` },
                { expect: 334, send: _b64(user) },
                { expect: 235, send: _b64(pass) },
                { expect: 250, send: `MAIL FROM:<${from}>` },
                ...recipients.map((r, i) => ({ expect: 250, send: `RCPT TO:<${r}>` })),
                { expect: 354, send: `DATA` },
                { send: raw_message },
                { expect: 250 },
                { expect: 221, send: `QUIT`, done: true },
              ];
              // Fix: RCPT responses are also 250
              const steps_final = [
                { expect: 250, send: `EHLO scribe` },
                { expect: 334, send: `AUTH LOGIN` },
                { expect: 334, send: _b64(user) },
                { expect: 235, send: `MAIL FROM:<${from}>` },
                ...recipients.map(r => ({ expect: 250, send: `RCPT TO:<${r}>` })),
                { expect: 354, send: `DATA` },
                { send: raw_message },
                { expect: 250 },
                { expect: 221, send: `QUIT`, done: true },
              ];
              const log = await _smtpDialog(sec, steps_final);
              sec.destroy();
              resolve({ ok: true, log });
            } catch (e) { sec.destroy(); reject(e); }
          });
          sec.on('error', reject);
        } else {
          // Plain SMTP (port 25 or SSL on 465)
          const sock2 = port === 465 ? tls.connect({ host, port }) : socket;
          const steps_plain2 = [
            { expect: 220 },
            { expect: 250, send: `EHLO scribe` },
            { expect: 334, send: `AUTH LOGIN` },
            { expect: 334, send: _b64(user) },
            { expect: 235, send: `MAIL FROM:<${from}>` },
            ...recipients.map(r => ({ expect: 250, send: `RCPT TO:<${r}>` })),
            { expect: 354, send: `DATA` },
            { send: raw_message },
            { expect: 250 },
            { expect: 221, send: `QUIT`, done: true },
          ];
          const log = await _smtpDialog(sock2, steps_plain2);
          sock2.destroy();
          resolve({ ok: true, log });
        }
      } catch (e) { socket.destroy(); reject(e); }
    });
    socket.on('error', reject);
  });
}

// ── Ops ───────────────────────────────────────────────────────────────────────

async function op_send(params) {
  const { to, subject, body, from: override_from } = params || {};
  if (!to) throw new Error('to required (string or array of addresses)');
  if (!subject) throw new Error('subject required');
  if (!body) throw new Error('body required');
  const cfg = _loadConfig();
  if (!cfg.host) throw new Error('SMTP not configured. Use op set_config or set SMTP_HOST env var.');
  const result = await _sendEmail({
    ...cfg,
    from: override_from || cfg.from,
    to,
    subject,
    body,
  });
  return { status: 'sent', to, subject, ok: result.ok };
}

async function op_test_connection() {
  const cfg = _loadConfig();
  if (!cfg.host) throw new Error('SMTP not configured.');
  // Just open a socket and read the greeting
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: cfg.host, port: cfg.port }, () => {});
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error('Connection timeout.')); }, 8000);
    socket.on('data', (d) => {
      clearTimeout(timeout);
      const line = d.toString().trim();
      socket.destroy();
      if (line.startsWith('220')) resolve({ ok: true, greeting: line });
      else reject(new Error(`Unexpected greeting: ${line}`));
    });
    socket.on('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

const MANIFEST = {
  name: 'email_send',
  description: 'SMTP email dispatch (STARTTLS/plain). Config via env or set_config op. Ops: send, test_connection, set_config, get_config.',
  ops: ['send', 'test_connection', 'set_config', 'get_config'],
};

async function run(op, params) {
  switch (op) {
    case 'send':             return op_send(params);
    case 'test_connection':  return op_test_connection();
    case 'set_config':       return op_set_config(params);
    case 'get_config':       return op_get_config();
    default:
      throw new Error(`Unknown op: ${op}. Available: send, test_connection, set_config, get_config`);
  }
}

module.exports = { MANIFEST, run };
