'use strict';

/**
 * SKILL: http_post
 *
 * Make outbound HTTP/HTTPS requests: GET, POST, PUT, PATCH, DELETE.
 * Used to send observations to Profitlord, AGM, webhooks, or any endpoint.
 *
 * Zero external dependencies — uses Node's built-in http/https modules.
 */

const https = require('https');
const http  = require('http');
const { URL } = require('url');

const MAX_BYTES  = 500_000;
const TIMEOUT_MS = 20_000;

const MANIFEST = {
  name: 'http_post',
  description: 'Make outbound HTTP requests (GET/POST/PUT/PATCH/DELETE) to any endpoint.',
  version: '1.0.0',
  inputs: {
    url:     { type: 'string', required: true,  description: 'Target URL' },
    method:  { type: 'string', required: false, description: 'HTTP method (default: POST)' },
    body:    { type: 'any',   required: false, description: 'Request body (object or string)' },
    headers: { type: 'object',required: false, description: 'Additional request headers' },
    timeout: { type: 'number', required: false, description: 'Timeout in ms (default 20000)' },
  },
  output: {
    ok:        'boolean',
    status:    'number',
    url:       'string',
    method:    'string',
    body:      'string — response body',
    json:      'any    — parsed JSON if response is JSON',
    truncated: 'boolean',
    error:     'string — present if ok is false',
    ts:        'string',
  },
};

async function run({ url: rawUrl, method = 'POST', body, headers = {}, timeout = TIMEOUT_MS }) {
  const ts = new Date().toISOString();
  if (!rawUrl) return { ok: false, error: 'url is required', ts };

  try {
    const result = await request(rawUrl, method.toUpperCase(), body, headers, timeout);
    return { ok: result.status >= 200 && result.status < 400, ts, ...result };
  } catch (e) {
    return { ok: false, url: rawUrl, method, status: null, body: '', truncated: false, error: e.message, ts };
  }
}

function request(rawUrl, method, body, extraHeaders, timeout) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(rawUrl); } catch { reject(new Error(`Invalid URL: ${rawUrl}`)); return; }

    const isJson = body && typeof body === 'object';
    const bodyStr = body ? (isJson ? JSON.stringify(body) : String(body)) : '';

    const headers = {
      'User-Agent': 'SCRIBE/1.0',
      'Accept': 'application/json, text/plain, */*',
      ...extraHeaders,
    };
    if (bodyStr) {
      headers['Content-Type'] = isJson ? 'application/json' : 'text/plain';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const lib = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers,
      timeout,
    };

    const req = lib.request(options, res => {
      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const next = new URL(res.headers.location, rawUrl).toString();
        res.resume();
        return resolve(request(next, method === 'POST' && res.statusCode === 303 ? 'GET' : method, body, extraHeaders, timeout));
      }

      let responseBody = '';
      let bytes = 0;
      let truncated = false;

      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) { truncated = true; req.destroy(); return; }
        responseBody += chunk.toString('utf-8');
      });

      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(responseBody); } catch { /* not JSON */ }
        resolve({ url: rawUrl, method, status: res.statusCode, body: responseBody, json, truncated });
      });

      res.on('error', reject);
    });

    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout after ${timeout}ms`)); });
    req.on('error', reject);

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

module.exports = { MANIFEST, run };
