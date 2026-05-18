'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEYS_DIR = path.join(__dirname, '..', '..', 'data', 'security_keys');
if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true });

function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey, generated_at: Date.now() };
}

function encryptRSA(plaintext, publicKey) {
  const encrypted = crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(plaintext));
  return encrypted.toString('base64');
}

function decryptRSA(ciphertext, privateKey) {
  const decrypted = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(ciphertext, 'base64'));
  return decrypted.toString('utf8');
}

function encryptAES(plaintext, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key.slice(0, 32), 'utf8'), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return { iv: iv.toString('hex'), encrypted, authTag };
}

function decryptAES(cipherObj, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key.slice(0, 32), 'utf8'), Buffer.from(cipherObj.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(cipherObj.authTag, 'hex'));
  let decrypted = decipher.update(cipherObj.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function hashSHA256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hashSHA512(data) {
  return crypto.createHash('sha512').update(data).digest('hex');
}

function HMAC(data, key) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function generateSecureToken(length = 32) {
  return crypto.randomBytes(length).toString('base64url');
}

function verifySignature(data, signature, publicKey) {
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(data);
  return verifier.verify(publicKey, signature, 'base64');
}

function createSignature(data, privateKey) {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(data);
  return signer.sign(privateKey, 'base64');
}

class SecureVault {
  constructor(identity) {
    this.identity = identity;
    this.vaultFile = path.join(KEYS_DIR, `vault_${identity}.json`);
    this.data = this._load();
  }

  _load() {
    if (fs.existsSync(this.vaultFile)) {
      try { return JSON.parse(fs.readFileSync(this.vaultFile, 'utf8')); } catch { return {}; }
    }
    return {};
  }

  _save() {
    fs.writeFileSync(this.vaultFile, JSON.stringify(this.data, null, 2), 'utf8');
  }

  store(key, value, encrypt = true, masterKey = null) {
    if (encrypt && masterKey) {
      const cipher = encryptAES(JSON.stringify(value), masterKey);
      this.data[key] = { encrypted: true, cipher };
    } else {
      this.data[key] = { encrypted: false, value };
    }
    this._save();
  }

  retrieve(key, decrypt = true, masterKey = null) {
    const entry = this.data[key];
    if (!entry) return null;
    if (entry.encrypted && decrypt && masterKey) {
      return JSON.parse(decryptAES(entry.cipher, masterKey));
    }
    return entry.value;
  }

  delete(key) {
    delete this.data[key];
    this._save();
  }

  listKeys() {
    return Object.keys(this.data);
  }
}

class TamperDetector {
  constructor(identity) {
    this.identity = identity;
    this.baselineFile = path.join(KEYS_DIR, `baseline_${identity}.json`);
    this.baseline = this._loadBaseline();
  }

  _loadBaseline() {
    if (fs.existsSync(this.baselineFile)) {
      try { return JSON.parse(fs.readFileSync(this.baselineFile, 'utf8')); } catch { return {}; }
    }
    return {};
  }

  _saveBaseline() {
    fs.writeFileSync(this.baselineFile, JSON.stringify(this.baseline, null, 2), 'utf8');
  }

  setBaseline(key, value) {
    this.baseline[key] = { hash: hashSHA256(JSON.stringify(value)), timestamp: Date.now(), value };
    this._saveBaseline();
  }

  check(key, currentValue) {
    const baseline = this.baseline[key];
    if (!baseline) return { tamper: false, status: 'no_baseline' };
    const currentHash = hashSHA256(JSON.stringify(currentValue));
    const tamper = currentHash !== baseline.hash;
    return { tamper, status: tamper ? 'TAMPERED' : 'ok', baselineTimestamp: baseline.timestamp, currentTimestamp: Date.now() };
  }

  detectDirectory(dirPath) {
    const results = {};
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const fp = path.join(dirPath, file);
      const stat = fs.statSync(fp);
      if (stat.isFile()) {
        const content = fs.readFileSync(fp);
        const hash = hashSHA256(content);
        results[file] = { hash, size: stat.size, mtime: stat.mtime };
      }
    }
    return results;
  }
}

class AccessControl {
  constructor() {
    this.aclFile = path.join(KEYS_DIR, 'acl.json');
    this.acl = this._loadACL();
  }

  _loadACL() {
    if (fs.existsSync(this.aclFile)) {
      try { return JSON.parse(fs.readFileSync(this.aclFile, 'utf8')); } catch { return { roles: {}, policies: {} }; }
    }
    return { roles: {}, policies: {} };
  }

  _saveACL() {
    fs.writeFileSync(this.aclFile, JSON.stringify(this.acl, null, 2), 'utf8');
  }

  defineRole(role, permissions) {
    this.acl.roles[role] = permissions;
    this._saveACL();
  }

  grantAccess(role, resource, action) {
    if (!this.acl.policies[resource]) this.acl.policies[resource] = {};
    if (!this.acl.policies[resource][action]) this.acl.policies[resource][action] = [];
    if (!this.acl.policies[resource][action].includes(role)) {
      this.acl.policies[resource][action].push(role);
    }
    this._saveACL();
  }

  checkAccess(role, resource, action) {
    const allowedRoles = this.acl.policies[resource]?.[action] || [];
    return allowedRoles.includes(role);
  }
}

const MANIFEST = {
  name: 'security',
  description: 'Encryption, signatures, tamper detection, access control',
  version: '1.0.0',
  ops: ['encrypt_rsa', 'decrypt_rsa', 'encrypt_aes', 'decrypt_aes', 'hash', 'hmac', 'verify_signature', 'create_signature',
        'vault_store', 'vault_retrieve', 'tamper_check', 'detect_directory', 'acl_check', 'acl_grant', 'generate_token'],
};

async function run({ op, ...args }) {
  switch (op) {
    case 'encrypt_rsa':
      return { ok: true, result: encryptRSA(args.plaintext, args.publicKey) };
    case 'decrypt_rsa':
      return { ok: true, result: decryptRSA(args.ciphertext, args.privateKey) };
    case 'encrypt_aes':
      return { ok: true, result: encryptAES(args.plaintext, args.key) };
    case 'decrypt_aes':
      return { ok: true, result: decryptAES(args.cipherObj, args.key) };
    case 'hash':
      return { ok: true, sha256: hashSHA256(args.data), sha512: hashSHA512(args.data) };
    case 'hmac':
      return { ok: true, hmac: HMAC(args.data, args.key) };
    case 'verify_signature':
      return { ok: verifySignature(args.data, args.signature, args.publicKey) };
    case 'create_signature':
      return { ok: true, signature: createSignature(args.data, args.privateKey) };
    case 'generate_token':
      return { ok: true, token: generateSecureToken(args.length || 32) };
    case 'vault_store':
      const vault = new SecureVault(args.identity || 'default');
      vault.store(args.key, args.value, args.encrypt, args.masterKey);
      return { ok: true };
    case 'vault_retrieve':
      const vaultR = new SecureVault(args.identity || 'default');
      return { ok: true, value: vaultR.retrieve(args.key, args.decrypt, args.masterKey) };
    case 'tamper_check':
      const td = new TamperDetector(args.identity || 'default');
      return { ok: true, ...td.check(args.key, args.value) };
    case 'detect_directory':
      const td2 = new TamperDetector(args.identity || 'default');
      return { ok: true, results: td2.detectDirectory(args.path) };
    case 'acl_check':
      const acl = new AccessControl();
      return { ok: acl.checkAccess(args.role, args.resource, args.action) };
    case 'acl_grant':
      const aclG = new AccessControl();
      aclG.grantAccess(args.role, args.resource, args.action);
      return { ok: true };
    default:
      throw new Error(`security: unknown op "${op}"`);
  }
}

module.exports = { MANIFEST, run, generateKeyPair, encryptRSA, decryptRSA, encryptAES, decryptAES, hashSHA256, HMAC, SecureVault, TamperDetector, AccessControl };