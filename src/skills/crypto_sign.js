'use strict';

/**
 * SKILL: crypto_sign
 *
 * Cryptographic operations using Node's built-in `crypto` module.
 * Zero external dependencies.
 *
 * Operations:
 *   hash         — SHA-256 / SHA-512 hash of a string or file path
 *   hmac         — HMAC-SHA256 of a message with a secret key
 *   verify_hmac  — verify a given HMAC against expected
 *   hash_file    — hash a file on disk
 *   integrity    — compute a hash for every line of a JSONL ledger and return a manifest
 *   random       — generate N cryptographically random bytes as hex
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const MANIFEST = {
  name: 'crypto_sign',
  description: 'Hash strings/files, HMAC sign/verify, check ledger integrity, generate random bytes.',
  version: '1.0.0',
  inputs: {
    op:        { type: 'string', required: true,  description: '"hash"|"hmac"|"verify_hmac"|"hash_file"|"integrity"|"random"' },
    data:      { type: 'string', required: false, description: 'String to hash or sign' },
    algorithm: { type: 'string', required: false, description: 'Hash algorithm: "sha256" (default) or "sha512"' },
    secret:    { type: 'string', required: false, description: 'HMAC secret key' },
    signature: { type: 'string', required: false, description: 'HMAC signature to verify (verify_hmac op)' },
    filePath:  { type: 'string', required: false, description: 'File path (hash_file, integrity ops)' },
    bytes:     { type: 'number', required: false, description: 'Number of random bytes (random op, default 32)' },
  },
  output: {
    ok:     'boolean',
    op:     'string',
    result: 'any',
    error:  'string — present if ok is false',
    ts:     'string',
  },
};

async function run({ op, data, algorithm = 'sha256', secret, signature, filePath, bytes = 32 }) {
  const ts = new Date().toISOString();
  try {
    let result;
    switch (op) {
      case 'hash':        result = op_hash(data, algorithm);                   break;
      case 'hmac':        result = op_hmac(data, secret, algorithm);           break;
      case 'verify_hmac': result = op_verify_hmac(data, secret, signature, algorithm); break;
      case 'hash_file':   result = op_hash_file(filePath, algorithm);          break;
      case 'integrity':   result = op_integrity(filePath, algorithm);          break;
      case 'random':      result = op_random(bytes);                           break;
      default: return { ok: false, op, error: `Unknown op: ${op}`, ts };
    }
    return { ok: true, op, result, ts };
  } catch (e) {
    return { ok: false, op, error: e.message, ts };
  }
}

// ── Operations ────────────────────────────────────────────────────────────────

function op_hash(data, algorithm) {
  if (!data) throw new Error('data is required');
  const hash = crypto.createHash(algorithm).update(data, 'utf-8').digest('hex');
  return { algorithm, hash, input_length: data.length };
}

function op_hmac(data, secret, algorithm) {
  if (!data)   throw new Error('data is required');
  if (!secret) throw new Error('secret is required');
  const hmac = crypto.createHmac(algorithm, secret).update(data, 'utf-8').digest('hex');
  return { algorithm, hmac };
}

function op_verify_hmac(data, secret, signature, algorithm) {
  if (!data)      throw new Error('data is required');
  if (!secret)    throw new Error('secret is required');
  if (!signature) throw new Error('signature is required');
  const expected = crypto.createHmac(algorithm, secret).update(data, 'utf-8').digest('hex');
  const expBuf = Buffer.from(expected, 'hex');
  let sigBuf;
  try { sigBuf = Buffer.from(signature, 'hex'); } catch { return { valid: false, algorithm, note: 'Invalid signature hex' }; }
  if (expBuf.length !== sigBuf.length) return { valid: false, algorithm, note: 'Signature length mismatch' };
  const valid = crypto.timingSafeEqual(expBuf, sigBuf);
  return { valid, algorithm };
}

function op_hash_file(filePath, algorithm) {
  if (!filePath) throw new Error('filePath is required');
  const resolved = path.resolve(filePath);
  const content = fs.readFileSync(resolved);
  const hash = crypto.createHash(algorithm).update(content).digest('hex');
  const stat = fs.statSync(resolved);
  return { algorithm, hash, file: resolved, size_bytes: stat.size };
}

function op_integrity(filePath, algorithm) {
  if (!filePath) throw new Error('filePath is required');
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf-8');
  const lines = raw.trim().split('\n').filter(Boolean);
  const manifest = lines.map((line, i) => ({
    line: i + 1,
    hash: crypto.createHash(algorithm).update(line, 'utf-8').digest('hex'),
    length: line.length,
  }));
  const root = crypto.createHash(algorithm)
    .update(manifest.map(m => m.hash).join(''), 'utf-8')
    .digest('hex');
  return { algorithm, file: resolved, line_count: lines.length, root_hash: root, manifest };
}

function op_random(bytes) {
  if (bytes < 1 || bytes > 256) throw new Error('bytes must be between 1 and 256');
  return { hex: crypto.randomBytes(bytes).toString('hex'), bytes };
}

module.exports = { MANIFEST, run };
