'use strict';

// rss_reader.js — RSS/Atom feed fetcher and parser (pure Node.js, no deps)
// Ops: fetch, list_feeds, add_feed, remove_feed, poll_all, latest

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const DATA_DIR   = path.join(__dirname, '..', '..', 'data');
const FEEDS_FILE = path.join(DATA_DIR, 'rss_feeds.json');
const ITEMS_FILE = path.join(DATA_DIR, 'rss_items.jsonl');
const MAX_ITEMS_STORED = 2000;
const FETCH_TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB

// ── HTTP fetch ────────────────────────────────────────────────────────────────

function _fetch(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'SCRIBE/1.0 RSS Reader' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return _fetch(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      let body = '';
      let bytes = 0;
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_BODY_BYTES) { req.destroy(); reject(new Error('Feed too large.')); return; }
        body += chunk.toString('utf8');
      });
      res.on('end', () => resolve(body));
    });
    req.setTimeout(FETCH_TIMEOUT_MS, () => { req.destroy(); reject(new Error('Fetch timeout.')); });
    req.on('error', reject);
  });
}

// ── XML mini-parser ───────────────────────────────────────────────────────────

function _extractTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
}

function _extractAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["']`, 'i');
  const m = xml.match(re);
  return m ? m[1] : '';
}

function _parseItems(xml) {
  // Handle both RSS <item> and Atom <entry>
  const item_re = /<item[\s>]([\s\S]*?)<\/item>|<entry[\s>]([\s\S]*?)<\/entry>/gi;
  const items = [];
  let match;
  while ((match = item_re.exec(xml)) !== null) {
    const block = match[1] || match[2];
    const title   = _extractTag(block, 'title') || '(no title)';
    const link    = _extractTag(block, 'link') || _extractAttr(block, 'link', 'href');
    const summary = _extractTag(block, 'description') || _extractTag(block, 'summary') || _extractTag(block, 'content');
    const pub     = _extractTag(block, 'pubDate') || _extractTag(block, 'updated') || _extractTag(block, 'published');
    const guid    = _extractTag(block, 'guid') || link || title;
    items.push({
      id: crypto.createHash('sha1').update(guid).digest('hex').slice(0, 12),
      title: title.slice(0, 300),
      link,
      summary: summary.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500),
      published: pub,
    });
  }
  return items;
}

function _parseFeedMeta(xml) {
  const title   = _extractTag(xml, 'title') || 'Unknown Feed';
  const desc    = _extractTag(xml, 'description') || _extractTag(xml, 'subtitle') || '';
  return { title: title.slice(0, 200), description: desc.slice(0, 400) };
}

// ── Feeds registry ────────────────────────────────────────────────────────────

function _loadFeeds() {
  if (!fs.existsSync(FEEDS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(FEEDS_FILE, 'utf8')); } catch (_) { return {}; }
}
function _saveFeeds(f) {
  const tmp = FEEDS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(f, null, 2), 'utf8');
  fs.renameSync(tmp, FEEDS_FILE);
}

// ── Items store ───────────────────────────────────────────────────────────────

function _appendItems(items, feed_url) {
  const lines = items.map(it => JSON.stringify({ ...it, feed: feed_url, fetched_at: new Date().toISOString() }));
  fs.appendFileSync(ITEMS_FILE, lines.join('\n') + '\n', 'utf8');
}

function _loadItems(feed_url, limit) {
  if (!fs.existsSync(ITEMS_FILE)) return [];
  const lines = fs.readFileSync(ITEMS_FILE, 'utf8').trim().split('\n').filter(Boolean);
  let items = lines.map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  if (feed_url) items = items.filter(it => it.feed === feed_url);
  return items.slice(-limit);
}

function _seenIds() {
  if (!fs.existsSync(ITEMS_FILE)) return new Set();
  const lines = fs.readFileSync(ITEMS_FILE, 'utf8').trim().split('\n').filter(Boolean);
  const ids = new Set();
  for (const l of lines) {
    try { const e = JSON.parse(l); if (e.id) ids.add(`${e.feed}::${e.id}`); } catch (_) {}
  }
  return ids;
}

// ── Ops ───────────────────────────────────────────────────────────────────────

async function op_fetch(params) {
  const { url, store = true } = params || {};
  if (!url) throw new Error('url required');
  const xml = await _fetch(url);
  const meta = _parseFeedMeta(xml);
  const items = _parseItems(xml);

  let new_count = 0;
  if (store && items.length) {
    const seen = _seenIds();
    const new_items = items.filter(it => !seen.has(`${url}::${it.id}`));
    if (new_items.length) {
      _appendItems(new_items, url);
      new_count = new_items.length;
      // Trim to max
      if (fs.existsSync(ITEMS_FILE)) {
        const lines = fs.readFileSync(ITEMS_FILE, 'utf8').trim().split('\n').filter(Boolean);
        if (lines.length > MAX_ITEMS_STORED) {
          fs.writeFileSync(ITEMS_FILE, lines.slice(-MAX_ITEMS_STORED).join('\n') + '\n', 'utf8');
        }
      }
    }
  }

  return { url, feed_title: meta.title, item_count: items.length, new_items: new_count, items: items.slice(0, 20) };
}

function op_add_feed(params) {
  const { url, label } = params || {};
  if (!url) throw new Error('url required');
  const feeds = _loadFeeds();
  feeds[url] = { url, label: label || url, added_at: new Date().toISOString(), last_polled: null };
  _saveFeeds(feeds);
  return { status: 'added', url };
}

function op_remove_feed(params) {
  const { url } = params || {};
  if (!url) throw new Error('url required');
  const feeds = _loadFeeds();
  if (!feeds[url]) throw new Error(`Feed not found: ${url}`);
  delete feeds[url];
  _saveFeeds(feeds);
  return { status: 'removed', url };
}

function op_list_feeds() {
  const feeds = _loadFeeds();
  return { count: Object.keys(feeds).length, feeds: Object.values(feeds) };
}

async function op_poll_all() {
  const feeds = _loadFeeds();
  const urls = Object.keys(feeds);
  if (!urls.length) return { polled: 0, results: [] };
  const results = [];
  const now = new Date().toISOString();
  for (const url of urls) {
    try {
      const r = await op_fetch({ url, store: true });
      feeds[url].last_polled = now;
      results.push({ url, ok: true, new_items: r.new_items, total: r.item_count });
    } catch (e) {
      results.push({ url, ok: false, error: e.message });
    }
  }
  _saveFeeds(feeds);
  return { polled: urls.length, results };
}

function op_latest(params) {
  const { feed, limit = 20 } = params || {};
  const items = _loadItems(feed || null, limit);
  return { count: items.length, items: items.reverse().slice(0, limit) };
}

const MANIFEST = {
  name: 'rss_reader',
  description: 'RSS/Atom feed fetcher and parser. Ops: fetch, add_feed, remove_feed, list_feeds, poll_all, latest.',
  ops: ['fetch', 'add_feed', 'remove_feed', 'list_feeds', 'poll_all', 'latest'],
};

async function run(op, params) {
  switch (op) {
    case 'fetch':       return op_fetch(params);
    case 'add_feed':    return op_add_feed(params);
    case 'remove_feed': return op_remove_feed(params);
    case 'list_feeds':  return op_list_feeds();
    case 'poll_all':    return op_poll_all();
    case 'latest':      return op_latest(params);
    default:
      throw new Error(`Unknown op: ${op}. Available: fetch, add_feed, remove_feed, list_feeds, poll_all, latest`);
  }
}

module.exports = { MANIFEST, run };
