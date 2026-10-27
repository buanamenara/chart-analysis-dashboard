const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

// Interval yang didukung native oleh Yahoo. "3m" dan "4h" tidak ada di Yahoo,
// jadi diagregasi manual dari interval native terdekat (lihat AGGREGATE_FROM di bawah).
const INTERVAL_RANGE_MAP = {
  "1m": { interval: "1m", range: "5d" },
  "5m": { interval: "5m", range: "5d" },
  "15m": { interval: "15m", range: "1mo" },
  "30m": { interval: "30m", range: "1mo" },
  "60m": { interval: "60m", range: "3mo" },
  "1h": { interval: "60m", range: "3mo" },
  "1d": { interval: "1d", range: "2y" },
  "1wk": { interval: "1wk", range: "5y" }
};

// interval kustom -> { base: interval native yang dipakai, groupSize: jumlah candle native digabung jadi 1 }
const AGGREGATE_FROM = {
  "3m": { base: "1m", groupSize: 3 },
  "4h": { base: "1h", groupSize: 4 }
};

export function aggregateBars(bars, groupSize) {
  const out = [];
  for (let i = 0; i < bars.length; i += groupSize) {
    const chunk = bars.slice(i, i + groupSize);
    if (!chunk.length) continue;
    out.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map(b => b.high)),
      low: Math.min(...chunk.map(b => b.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((sum, b) => sum + (b.volume || 0), 0)
    });
  }
  return out;
}

// Yahoo tidak punya pair spot untuk logam mulia (XAUUSD=X, XAGUSD=X 404),
// jadi dipetakan ke kontrak futures COMEX yang paling dekat mengikuti harga spot.
const METAL_OVERRIDES = {
  XAUUSD: "GC=F", // Gold
  XAGUSD: "SI=F", // Silver
  XPTUSD: "PL=F", // Platinum
  XPDUSD: "PA=F"  // Palladium
};

export function normalizeForexSymbol(symbol) {
  const s = symbol.toUpperCase().trim();
  if (METAL_OVERRIDES[s]) return METAL_OVERRIDES[s];
  if (s.endsWith("=X") || s.endsWith("=F")) return s;
  return `${s}=X`;
}

// Dipakai sebagai fallback kalau Binance tidak bisa diakses (ISP di beberapa
// negara memblokir binance.com). Ubah "BTCUSDT"/"BTCUSD" -> "BTC-USD".
export function normalizeCryptoSymbolForYahoo(symbol) {
  let s = symbol.toUpperCase().trim();
  if (s.endsWith("USDT")) s = s.slice(0, -4);
  else if (s.endsWith("USD")) s = s.slice(0, -3);
  return `${s}-USD`;
}

async function fetchChart(yahooSymbol, interval) {
  const cfg = INTERVAL_RANGE_MAP[interval] || INTERVAL_RANGE_MAP["60m"];
  const url = `${BASE}/${encodeURIComponent(yahooSymbol)}?interval=${cfg.interval}&range=${cfg.range}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "application/json"
    }
  });
  if (!res.ok) throw new Error(`Yahoo chart error: ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) {
    const err = data?.chart?.error?.description || "No data returned";
    throw new Error(`Yahoo chart error: ${err}`);
  }
  return result;
}

export async function getYahooQuote(yahooSymbol) {
  // range pendek dipakai khusus di sini: dengan range panjang (mis. 1y),
  // field chartPreviousClose Yahoo kadang keliru jadi harga ~setahun lalu.
  const url = `${BASE}/${encodeURIComponent(yahooSymbol)}?interval=1d&range=5d`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "application/json"
    }
  });
  if (!res.ok) throw new Error(`Yahoo chart error: ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) {
    const err = data?.chart?.error?.description || "No data returned";
    throw new Error(`Yahoo chart error: ${err}`);
  }
  const meta = result.meta;
  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose ?? meta.previousClose;
  const change = price - prevClose;
  const changePercent = prevClose ? (change / prevClose) * 100 : 0;
  return {
    symbol: yahooSymbol,
    price,
    change,
    changePercent,
    high: meta.regularMarketDayHigh,
    low: meta.regularMarketDayLow,
    currency: meta.currency,
    source: "yahoo"
  };
}

export async function getYahooOhlcv(yahooSymbol, interval) {
  const agg = AGGREGATE_FROM[interval];
  if (agg) {
    const baseBars = await getYahooOhlcv(yahooSymbol, agg.base);
    return aggregateBars(baseBars, agg.groupSize);
  }
  const result = await fetchChart(yahooSymbol, interval);
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const { open = [], high = [], low = [], close = [], volume = [] } = quote;
  const bars = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (close[i] == null) continue;
    bars.push({
      time: timestamps[i] * 1000,
      open: open[i],
      high: high[i],
      low: low[i],
      close: close[i],
      volume: volume[i] || 0
    });
  }
  return bars;
}
