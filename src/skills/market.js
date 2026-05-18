'use strict';

// market.js — price feeds, portfolio tracking, P&L analysis, signal generation
// Profit's Brain instrument: SCRIBE watches markets, tracks positions, generates edges.

const fs   = require('fs');
const path = require('path');
const http  = require('http');
const https = require('https');
const crypto = require('crypto');

const PORTFOLIO_FILE = path.join(__dirname, '..', '..', 'data', 'portfolio.json');
const PRICES_FILE    = path.join(__dirname, '..', '..', 'data', 'price_history.jsonl');
const SIGNALS_FILE   = path.join(__dirname, '..', '..', 'data', 'market_signals.jsonl');
const TRADES_FILE    = path.join(__dirname, '..', '..', 'data', 'trade_log.jsonl');

let _memory = null;
function setMemory(m) { _memory = m; }

// ── HTTP fetch (zero deps) ────────────────────────────────────────────────────

function _fetch(url, { timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('fetch timeout')); });
  });
}

// ── price storage ─────────────────────────────────────────────────────────────

function _appendPrice(entry) {
  fs.appendFileSync(PRICES_FILE, JSON.stringify(entry) + '\n', 'utf8');
}

function _loadPrices(symbol, limit = 500) {
  if (!fs.existsSync(PRICES_FILE)) return [];
  return fs.readFileSync(PRICES_FILE, 'utf8').split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(p => p && (!symbol || p.symbol === symbol.toUpperCase()))
    .slice(-limit);
}

// ── portfolio ─────────────────────────────────────────────────────────────────

function _loadPortfolio() {
  if (!fs.existsSync(PORTFOLIO_FILE)) return { cash: 0, positions: {}, updated_at: null };
  try { return JSON.parse(fs.readFileSync(PORTFOLIO_FILE, 'utf8')); } catch { return { cash: 0, positions: {}, updated_at: null }; }
}

function _savePortfolio(p) {
  p.updated_at = Date.now();
  fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(p, null, 2), 'utf8');
}

function _setPosition({ symbol, qty, avg_cost, notes = '' }) {
  if (!symbol) throw new Error('symbol required');
  const p = _loadPortfolio();
  const sym = symbol.toUpperCase();
  if (qty === 0 || qty === null) {
    delete p.positions[sym];
  } else {
    p.positions[sym] = { qty: Number(qty), avg_cost: Number(avg_cost || 0), notes, opened_at: Date.now() };
  }
  _savePortfolio(p);
  return p;
}

function _setCash(amount) {
  const p = _loadPortfolio();
  p.cash = Number(amount);
  _savePortfolio(p);
  return p;
}

function _logTrade({ symbol, side, qty, price, notes = '', caller = 'unknown' }) {
  if (!symbol || !side || !qty || !price) throw new Error('symbol, side, qty, price required');
  const trade = {
    id: crypto.randomBytes(5).toString('hex'),
    symbol: symbol.toUpperCase(),
    side: side.toUpperCase(),   // BUY | SELL | SHORT | COVER
    qty: Number(qty),
    price: Number(price),
    value: Number(qty) * Number(price),
    notes,
    caller,
    ts: Date.now()
  };
  fs.appendFileSync(TRADES_FILE, JSON.stringify(trade) + '\n', 'utf8');

  // auto-update position
  const p = _loadPortfolio();
  const sym = trade.symbol;
  const pos = p.positions[sym] || { qty: 0, avg_cost: 0, notes: '', opened_at: Date.now() };

  if (trade.side === 'BUY' || trade.side === 'COVER') {
    const newQty = pos.qty + trade.qty;
    pos.avg_cost = newQty > 0 ? (pos.qty * pos.avg_cost + trade.qty * trade.price) / newQty : trade.price;
    pos.qty = newQty;
    p.cash -= trade.value;
  } else { // SELL or SHORT
    pos.qty -= trade.qty;
    p.cash  += trade.value;
    if (pos.qty === 0) { delete p.positions[sym]; _savePortfolio(p); return trade; }
  }
  p.positions[sym] = pos;
  _savePortfolio(p);

  if (_memory) {
    try {
      _memory.record({
        summary: `Trade: ${trade.side} ${trade.qty} ${sym} @ ${trade.price}`,
        tags: ['trade', sym, trade.side.toLowerCase()],
        data: { trade_id: trade.id, symbol: sym, side: trade.side, qty: trade.qty, price: trade.price }
      });
    } catch (_) {}
  }

  return trade;
}

function _pnl(prices_map = {}) {
  // prices_map: { SYMBOL: current_price, ... }
  const p = _loadPortfolio();
  let total_unrealized = 0;
  const positions = [];

  for (const [sym, pos] of Object.entries(p.positions)) {
    const cur = prices_map[sym] || null;
    const cost_basis = pos.qty * pos.avg_cost;
    const market_val = cur ? pos.qty * cur : null;
    const unrealized  = market_val !== null ? market_val - cost_basis : null;
    const pct         = unrealized !== null && cost_basis ? unrealized / cost_basis : null;
    if (unrealized !== null) total_unrealized += unrealized;
    positions.push({ symbol: sym, qty: pos.qty, avg_cost: pos.avg_cost, current_price: cur,
      cost_basis: Math.round(cost_basis * 100) / 100,
      market_value: market_val !== null ? Math.round(market_val * 100) / 100 : null,
      unrealized_pnl: unrealized !== null ? Math.round(unrealized * 100) / 100 : null,
      unrealized_pct: pct !== null ? Math.round(pct * 10000) / 100 : null
    });
  }

  // realized P&L from trade log
  const trades = _loadTrades();
  let realized = 0;
  const sells = trades.filter(t => t.side === 'SELL' || t.side === 'COVER');
  for (const s of sells) {
    const buys = trades.filter(t => t.symbol === s.symbol && (t.side === 'BUY' || t.side === 'SHORT') && t.ts < s.ts);
    const avgCost = buys.length ? buys.reduce((a, b) => a + b.price, 0) / buys.length : 0;
    realized += (s.price - avgCost) * s.qty;
  }

  return {
    cash: p.cash,
    positions,
    total_unrealized_pnl: Math.round(total_unrealized * 100) / 100,
    total_realized_pnl: Math.round(realized * 100) / 100,
    total_pnl: Math.round((total_unrealized + realized) * 100) / 100
  };
}

function _loadTrades(symbol) {
  if (!fs.existsSync(TRADES_FILE)) return [];
  return fs.readFileSync(TRADES_FILE, 'utf8').split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(t => t && (!symbol || t.symbol === symbol.toUpperCase()));
}

// ── price fetch (CoinGecko free API — no key needed) ─────────────────────────

async function _fetchPrice(symbol) {
  // Try CoinGecko for crypto; fallback to Yahoo Finance-compatible endpoint
  const coinMap = {
    BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
    DOGE: 'dogecoin', XRP: 'ripple', ADA: 'cardano', AVAX: 'avalanche-2',
    MATIC: 'matic-network', LINK: 'chainlink', DOT: 'polkadot', UNI: 'uniswap',
    LTC: 'litecoin', ATOM: 'cosmos', NEAR: 'near', APT: 'aptos', ARB: 'arbitrum',
    OP: 'optimism', INJ: 'injective-protocol', SUI: 'sui'
  };
  const sym = symbol.toUpperCase();
  const coinId = coinMap[sym];

  if (coinId) {
    try {
      const res = await _fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`);
      if (res.status === 200 && res.body[coinId]) {
        const data = res.body[coinId];
        const entry = { symbol: sym, price: data.usd, change_24h: data.usd_24h_change || null, source: 'coingecko', ts: Date.now() };
        _appendPrice(entry);
        return entry;
      }
    } catch (_) {}
  }

  throw new Error(`No price feed configured for ${sym}. Add to coinMap or configure a custom feed.`);
}

async function _fetchMulti(symbols) {
  const results = {};
  await Promise.all(symbols.map(async s => {
    try { results[s.toUpperCase()] = await _fetchPrice(s); }
    catch (e) { results[s.toUpperCase()] = { error: e.message }; }
  }));
  return results;
}

// ── technical indicators ──────────────────────────────────────────────────────

function _sma(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function _ema(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function _rsi(prices, period = 14) {
  if (prices.length < period + 1) return null;
  const changes = [];
  for (let i = 1; i < prices.length; i++) changes.push(prices[i] - prices[i - 1]);
  const slice = changes.slice(-period);
  const gains = slice.filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
  const losses = Math.abs(slice.filter(c => c < 0).reduce((a, b) => a + b, 0)) / period;
  if (losses === 0) return 100;
  const rs = gains / losses;
  return Math.round((100 - 100 / (1 + rs)) * 100) / 100;
}

function _bollinger(prices, period = 20, stddev_mult = 2) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / period;
  const std = Math.sqrt(variance);
  return {
    upper: Math.round((mid + stddev_mult * std) * 100) / 100,
    mid:   Math.round(mid * 100) / 100,
    lower: Math.round((mid - stddev_mult * std) * 100) / 100,
    std:   Math.round(std * 100) / 100
  };
}

function _indicators(symbol) {
  const history = _loadPrices(symbol, 200).map(p => p.price).filter(Number.isFinite);
  if (history.length < 2) return { symbol, error: 'insufficient price history' };
  const cur = history[history.length - 1];
  return {
    symbol: symbol.toUpperCase(),
    current_price: cur,
    sma_20:  _sma(history, 20),
    sma_50:  _sma(history, 50),
    ema_12:  _ema(history, 12),
    ema_26:  _ema(history, 26),
    rsi_14:  _rsi(history, 14),
    bollinger_20: _bollinger(history, 20),
    data_points: history.length
  };
}

// ── signal generation ─────────────────────────────────────────────────────────

function _emitSignal({ symbol, type, direction, strength, reason, price, caller = 'unknown' }) {
  // direction: LONG | SHORT | NEUTRAL; strength: 0-1; type: technical | fundamental | sentiment | custom
  const sig = {
    id: crypto.randomBytes(5).toString('hex'),
    symbol: symbol.toUpperCase(),
    type,
    direction,
    strength: Math.min(1, Math.max(0, Number(strength || 0.5))),
    reason,
    price: price || null,
    caller,
    ts: Date.now()
  };
  fs.appendFileSync(SIGNALS_FILE, JSON.stringify(sig) + '\n', 'utf8');

  if (_memory) {
    try {
      _memory.record({
        summary: `Signal [${direction}] on ${sym}: ${reason} (strength ${sig.strength})`,
        tags: ['signal', sig.symbol, direction.toLowerCase(), type],
        data: { signal_id: sig.id, symbol: sig.symbol, direction, strength: sig.strength }
      });
    } catch (_) {}
  }

  return sig;
}

function _autoSignal(symbol) {
  // Generate a signal automatically from indicators
  const ind = _indicators(symbol);
  if (ind.error) return { symbol, signal: null, reason: ind.error };

  const signals = [];
  const p = ind.current_price;

  if (ind.rsi_14 !== null) {
    if (ind.rsi_14 < 30) signals.push({ direction: 'LONG', strength: 0.7, reason: `RSI oversold at ${ind.rsi_14}` });
    else if (ind.rsi_14 > 70) signals.push({ direction: 'SHORT', strength: 0.7, reason: `RSI overbought at ${ind.rsi_14}` });
  }
  if (ind.sma_20 && ind.sma_50) {
    if (ind.sma_20 > ind.sma_50) signals.push({ direction: 'LONG', strength: 0.6, reason: `SMA20 (${ind.sma_20}) above SMA50 (${ind.sma_50}) — uptrend` });
    else signals.push({ direction: 'SHORT', strength: 0.5, reason: `SMA20 (${ind.sma_20}) below SMA50 (${ind.sma_50}) — downtrend` });
  }
  if (ind.bollinger_20) {
    if (p < ind.bollinger_20.lower) signals.push({ direction: 'LONG', strength: 0.65, reason: `Price below lower Bollinger band (${ind.bollinger_20.lower})` });
    else if (p > ind.bollinger_20.upper) signals.push({ direction: 'SHORT', strength: 0.65, reason: `Price above upper Bollinger band (${ind.bollinger_20.upper})` });
  }

  if (!signals.length) return { symbol, signal: 'NEUTRAL', strength: 0.3, reason: 'No strong technical signal', indicators: ind };

  // aggregate
  const longs  = signals.filter(s => s.direction === 'LONG');
  const shorts = signals.filter(s => s.direction === 'SHORT');
  const dir    = longs.length >= shorts.length ? 'LONG' : 'SHORT';
  const strength = signals.filter(s => s.direction === dir).reduce((a, b) => a + b.strength, 0) / signals.length;
  const reason   = signals.map(s => s.reason).join(' | ');

  return { symbol, signal: dir, strength: Math.round(strength * 100) / 100, reason, indicators: ind, raw_signals: signals };
}

function _listSignals({ symbol, direction, limit = 50 } = {}) {
  if (!fs.existsSync(SIGNALS_FILE)) return [];
  let rows = fs.readFileSync(SIGNALS_FILE, 'utf8').split('\n')
    .filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (symbol)    rows = rows.filter(r => r.symbol === symbol.toUpperCase());
  if (direction) rows = rows.filter(r => r.direction === direction.toUpperCase());
  return rows.slice(-limit).reverse();
}

// ── MANIFEST & run ────────────────────────────────────────────────────────────

const MANIFEST = {
  name: 'market',
  description: 'Price feeds, portfolio tracking, P&L analysis, technical indicators, signal generation',
  ops: ['fetch_price', 'fetch_multi', 'price_history', 'indicators',
        'set_position', 'set_cash', 'portfolio', 'log_trade', 'trade_history', 'pnl',
        'emit_signal', 'auto_signal', 'list_signals']
};

async function run({ op, caller = 'unknown', ...args }) {
  switch (op) {
    case 'fetch_price':   return _fetchPrice(args.symbol);
    case 'fetch_multi':   return _fetchMulti(args.symbols || []);
    case 'price_history': return _loadPrices(args.symbol, args.limit);
    case 'indicators':    return _indicators(args.symbol);
    case 'set_position':  return _setPosition(args);
    case 'set_cash':      return _setCash(args.amount);
    case 'portfolio':     return _loadPortfolio();
    case 'log_trade':     return _logTrade({ ...args, caller });
    case 'trade_history': return _loadTrades(args.symbol);
    case 'pnl':           return _pnl(args.prices || {});
    case 'emit_signal':   return _emitSignal({ ...args, caller });
    case 'auto_signal':   return _autoSignal(args.symbol);
    case 'list_signals':  return _listSignals(args);
    default:              throw new Error(`market: unknown op "${op}"`);
  }
}

module.exports = { MANIFEST, run, setMemory };
