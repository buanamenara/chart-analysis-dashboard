import { fetchWithTimeout } from "./http.js";
import { getBinanceQuote, getBinanceOhlcv } from "./binance.js";
import { INTERVAL_MS, aggregateAligned } from "./bars.js";
export { aggregateAligned };

// Sumber data crypto gratis (tanpa API key), dicoba berurutan sampai ada yang berhasil:
//   Binance -> Gate.io -> Coinbase -> Kraken   (Yahoo tetap fallback terakhir di marketData.js)
// Tiap jaringan memblokir bursa yang berbeda (ISP Indonesia memblokir banyak bursa;
// IP datacenter Cloudflare sering ditolak Binance), jadi rantai ini menaikkan peluang
// data bursa asli (bukan Yahoo) tersedia di mana pun aplikasi jalan.
// Sumber yang terakhir berhasil diingat (sticky) per instance agar request berikutnya cepat.
const TIMEOUT_MS = 6000;

const getJson = async (url, fetchImpl) => {
  const res = await fetchImpl(url, { timeoutMs: TIMEOUT_MS, headers: { Accept: "application/json", "User-Agent": "market-analysis-dashboard" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

// "BTCUSDT" / "BTCUSD" / "BTC" -> "BTC"
export function baseAsset(symbol) {
  return String(symbol).toUpperCase().trim().replace(/[-_/]/g, "").replace(/(USDT|USDC|USD)$/, "");
}

const num = x => parseFloat(x);

// ---------------- Gate.io ----------------
// candlesticks: [t(detik), quote_vol, close, high, low, open, base_vol, closed], urut naik.
const GATE_IV = { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "60m": "1h", "1h": "1h", "4h": "4h", "1d": "1d", "1wk": "7d" };
export const parseGateCandles = rows => rows.map(r => ({ time: num(r[0]) * 1000, open: num(r[5]), high: num(r[3]), low: num(r[4]), close: num(r[2]), volume: num(r[6]) }));
export function parseGateTicker(d, symbol) {
  const price = num(d.last), pct = num(d.change_percentage);
  if (!Number.isFinite(pct)) throw new Error("change_percentage tidak valid");
  const prevClose = price / (1 + pct / 100);
  return { symbol, price, prevClose, change: price - prevClose, changePercent: pct, high: num(d.high_24h), low: num(d.low_24h), volume: num(d.base_volume), source: "gateio" };
}
const gate = {
  name: "gateio",
  async quote(symbol, f) {
    const d = await getJson(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${baseAsset(symbol)}_USDT`, f);
    if (!Array.isArray(d) || !d[0]?.last) throw new Error("ticker kosong");
    return parseGateTicker(d[0], symbol);
  },
  async ohlcv(symbol, interval, limit, f) {
    const iv = GATE_IV[interval];
    const base = iv ? interval : "1m"; // 3m tidak ada di Gate -> gabung dari 1m
    const n = iv ? limit : Math.min(1000, limit * 3);
    const rows = await getJson(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${baseAsset(symbol)}_USDT&interval=${GATE_IV[base]}&limit=${n}`, f);
    if (!Array.isArray(rows)) throw new Error("candle kosong");
    const bars = parseGateCandles(rows);
    return iv ? bars : aggregateAligned(bars, INTERVAL_MS[interval]);
  }
};

// ---------------- Coinbase Exchange ----------------
// candles: [time(detik), low, high, open, close, volume], urut TERBARU dulu, maks 300.
// granularity yang ada: 60, 300, 900, 3600, 21600, 86400 (detik).
const CB_BASE = { "1m": 60, "3m": 60, "5m": 300, "15m": 900, "30m": 300, "60m": 3600, "1h": 3600, "4h": 3600, "1d": 86400, "1wk": 86400 };
export const parseCoinbaseCandles = rows => rows.map(r => ({ time: num(r[0]) * 1000, open: num(r[3]), high: num(r[2]), low: num(r[1]), close: num(r[4]), volume: num(r[5]) })).sort((a, b) => a.time - b.time);
export function parseCoinbaseStats(d, symbol) {
  const price = num(d.last), prevClose = num(d.open);
  return { symbol, price, prevClose, change: price - prevClose, changePercent: prevClose ? (price - prevClose) / prevClose * 100 : 0, high: num(d.high), low: num(d.low), volume: num(d.volume), source: "coinbase" };
}
const coinbase = {
  name: "coinbase",
  async quote(symbol, f) {
    const d = await getJson(`https://api.exchange.coinbase.com/products/${baseAsset(symbol)}-USD/stats`, f);
    if (!d?.last) throw new Error("stats kosong");
    return parseCoinbaseStats(d, symbol);
  },
  async ohlcv(symbol, interval, limit, f) {
    const g = CB_BASE[interval] || 3600;
    const rows = await getJson(`https://api.exchange.coinbase.com/products/${baseAsset(symbol)}-USD/candles?granularity=${g}`, f);
    if (!Array.isArray(rows)) throw new Error("candle kosong");
    const bars = parseCoinbaseCandles(rows);
    const target = INTERVAL_MS[interval];
    return target && target !== g * 1000 ? aggregateAligned(bars, target) : bars;
  }
};

// ---------------- Kraken ----------------
// OHLC: result[<pair>] = [[time(detik), open, high, low, close, vwap, volume, count]], urut naik, maks 720.
// Ticker: c[0]=last, o=open hari ini (UTC), h[1]/l[1]=24 jam, v[1]=volume 24 jam.
const KRAKEN_IV = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "60m": 60, "1h": 60, "4h": 240, "1d": 1440, "1wk": 10080 };
const krakenPair = symbol => { const b = baseAsset(symbol); return `${b === "BTC" ? "XBT" : b}USD`; };
const krakenResult = d => {
  if (d?.error?.length) throw new Error(d.error.join(","));
  const key = Object.keys(d?.result || {}).find(k => k !== "last");
  if (!key) throw new Error("hasil kosong");
  return d.result[key];
};
export const parseKrakenOhlc = rows => rows.map(r => ({ time: num(r[0]) * 1000, open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]), volume: num(r[6]) }));
// Ticker Kraken hanya punya "open hari ini (UTC)", bukan harga 24 jam lalu. Supaya %
// perubahan sama artinya dengan sumber lain (rolling 24 jam), prevClose diambil dari
// candle 1 jam: close terakhir yang berumur >= 24 jam. Tanpa candle -> pakai open hari ini.
export function kraken24hAgoClose(hourBars, nowMs) {
  for (let i = hourBars.length - 1; i >= 0; i--) {
    if (hourBars[i].time + 3600e3 <= nowMs - 86400e3) return hourBars[i].close;
  }
  return null;
}
export function parseKrakenTicker(t, symbol, prevClose24h = null) {
  const price = num(t.c[0]), prevClose = Number.isFinite(prevClose24h) ? prevClose24h : num(t.o);
  return { symbol, price, prevClose, change: price - prevClose, changePercent: prevClose ? (price - prevClose) / prevClose * 100 : 0, high: num(t.h[1]), low: num(t.l[1]), volume: num(t.v[1]), source: "kraken" };
}
const kraken = {
  name: "kraken",
  async quote(symbol, f) {
    const [tick, ohlc] = await Promise.all([
      getJson(`https://api.kraken.com/0/public/Ticker?pair=${krakenPair(symbol)}`, f),
      getJson(`https://api.kraken.com/0/public/OHLC?pair=${krakenPair(symbol)}&interval=60`, f).catch(() => null)
    ]);
    const prev24 = ohlc ? kraken24hAgoClose(parseKrakenOhlc(krakenResult(ohlc)), Date.now()) : null;
    return parseKrakenTicker(krakenResult(tick), symbol, prev24);
  },
  async ohlcv(symbol, interval, limit, f) {
    const iv = KRAKEN_IV[interval] || 1; // 3m -> gabung dari 1m
    const bars = parseKrakenOhlc(krakenResult(await getJson(`https://api.kraken.com/0/public/OHLC?pair=${krakenPair(symbol)}&interval=${iv}`, f)));
    return KRAKEN_IV[interval] ? bars : aggregateAligned(bars, INTERVAL_MS[interval]);
  }
};

const binance = {
  name: "binance",
  quote: symbol => getBinanceQuote(symbol),
  ohlcv: (symbol, interval, limit) => getBinanceOhlcv(symbol, interval, limit)
};

export const CRYPTO_SOURCES = [binance, gate, coinbase, kraken];
let preferred = 0;
let confirmed = false;   // sudah ada sumber yang terbukti jalan di instance ini?
let discovery = null;    // pencarian sumber yang sedang berjalan (dibagi ke request paralel)
export function _resetCryptoPreference() { preferred = 0; confirmed = false; discovery = null; }

const errText = e => (e?.name === "AbortError" ? "timeout" : String(e?.message || e).slice(0, 160));

// Coba sumber satu per satu (mulai dari yang terakhir berhasil). Hasil membawa
// `source` dan `fallbackReason` (alasan sumber sebelumnya gagal) untuk diagnosa.
// Instance baru (cold start): request paralel pertama (mis. Scout 16 simbol) tidak boleh
// semuanya mencoba Binance yang ditolak -> boros subrequest (batas Cloudflare gratis: 50).
// Jadi satu request mencari sumber yang jalan; request lain menunggu lalu langsung
// memakai sumber itu.
async function tryAll(kind, call, sources = CRYPTO_SOURCES, minBars = 30) {
  // Bergiliran sampai ada sumber yang terbukti jalan (kalau pencarian gagal, request
  // berikutnya yang mencoba — tetap satu per satu, tidak serentak).
  while (sources === CRYPTO_SOURCES && !confirmed) {
    if (!discovery) {
      discovery = runChain(kind, call, sources, minBars);
      try { return await discovery; } finally { discovery = null; }
    }
    await discovery.catch(() => {});
  }
  return runChain(kind, call, sources, minBars);
}

async function runChain(kind, call, sources, minBars) {
  const failures = [];
  for (let k = 0; k < sources.length; k++) {
    const idx = (preferred + k) % sources.length;
    const src = sources[idx];
    try {
      const out = await call(src);
      if (kind === "ohlcv" && (!Array.isArray(out) || out.length < minBars)) throw new Error(`candle terlalu sedikit (${out?.length ?? 0} < ${minBars})`);
      if (kind === "quote" && !(Number.isFinite(out?.price) && Number.isFinite(out?.changePercent))) throw new Error("harga/perubahan tidak valid");
      if (sources === CRYPTO_SOURCES) { preferred = idx; confirmed = true; }
      return { data: out, source: src.name, failures };
    } catch (e) {
      failures.push(`${src.name}: ${errText(e)}`);
    }
  }
  const err = new Error(`Semua sumber crypto gagal — ${failures.join(" | ")}`);
  err.failures = failures;
  throw err;
}

export async function cryptoQuote(symbol, { fetchImpl = fetchWithTimeout, sources } = {}) {
  const { data, source, failures } = await tryAll("quote", s => s.quote(symbol, fetchImpl), sources);
  return { ...data, source, ...(failures.length ? { fallbackReason: failures.join(" | ") } : {}) };
}

export async function cryptoOhlcv(symbol, interval, limit = 250, { fetchImpl = fetchWithTimeout, sources } = {}) {
  // Minimal 200 candle (atau sebanyak yang diminta bila < 200) supaya SMA200 tetap ada:
  // sumber yang hanya bisa memberi sedikit candle (mis. Coinbase 30m/1wk) dilewati.
  const minBars = Math.min(limit, 200);
  const { data, source, failures } = await tryAll("ohlcv", s => s.ohlcv(symbol, interval, limit, fetchImpl), sources, minBars);
  const bars = data.slice(-limit);
  // Properti tambahan di array (tidak ikut JSON) untuk diteruskan pemanggil ke respons.
  Object.defineProperty(bars, "source", { value: source, enumerable: false });
  Object.defineProperty(bars, "fallbackReason", { value: failures.length ? failures.join(" | ") : null, enumerable: false });
  return bars;
}
