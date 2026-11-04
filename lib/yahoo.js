import { fetchWithTimeout } from "./http.js";
import { INTERVAL_MS, aggregateAligned, mergeTrailingLivePoint } from "./bars.js";

// Interval yang didukung native oleh Yahoo. "3m" dan "4h" tidak ada di Yahoo,
// jadi diagregasi manual dari interval native terdekat (lihat AGGREGATE_FROM di bawah).
const INTERVAL_RANGE_MAP = {
  "1m": { interval: "1m", range: "5d" },
  "3m": { interval: "3m", range: "5d" },
  "5m": { interval: "5m", range: "5d" },
  "15m": { interval: "15m", range: "1mo" },
  "30m": { interval: "30m", range: "1mo" },
  "60m": { interval: "60m", range: "3mo" },
  "1h": { interval: "60m", range: "3mo" },
  "1d": { interval: "1d", range: "2y" },
  "1wk": { interval: "1wk", range: "5y" }
};

// interval kustom -> interval native yang digabung (selaras waktu, lihat lib/bars.js).
const AGGREGATE_FROM = { "3m": "1m", "4h": "1h" };

// Yahoo tidak menyediakan harga spot untuk logam mulia (XAUUSD=X, XAGUSD=X 404).
// - Gold (XAUUSD): pakai PAXG-USD (PAX Gold, token yang dijamin 1:1 emas fisik)
//   sebagai proksi spot — selisihnya ke spot hanya ~0.02%, jauh lebih dekat daripada
//   futures GC=F yang bisa beda puluhan dolar. Chart TradingView diarahkan ke OANDA:XAUUSD.
// - Silver (XAGUSD), Platinum, Palladium: tidak ada proksi spot gratis yang setara,
//   jadi pakai kontrak futures COMEX (chart TradingView juga diarahkan ke futures).
const METAL_OVERRIDES = {
  XAUUSD: "PAXG-USD", // Gold (proksi spot)
  XAGUSD: "SI=F",     // Silver (futures)
  XPTUSD: "PL=F",     // Platinum (futures)
  XPDUSD: "PA=F"      // Palladium (futures)
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

const YAHOO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
// query1 & query2 adalah dua host Yahoo yang setara. Kalau satu kena rate-limit
// (429) / error server (5xx) / timeout, coba host berikutnya -> error sesaat auto-pulih.
const YAHOO_HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];

async function yahooChart(yahooSymbol, interval, range) {
  let lastErr;
  for (const host of YAHOO_HOSTS) {
    const url = `${host}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${interval}&range=${range}`;
    try {
      const res = await fetchWithTimeout(url, { headers: { "User-Agent": YAHOO_UA, Accept: "application/json" }, timeoutMs: 12000 });
      if (res.status === 429 || res.status >= 500) { lastErr = new Error(`Yahoo ${res.status}`); continue; }
      if (!res.ok) throw new Error(`Yahoo chart error: ${res.status}`);
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result) { lastErr = new Error(data?.chart?.error?.description || "No data returned"); continue; }
      return result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("Yahoo chart gagal (semua host)");
}

async function fetchChart(yahooSymbol, interval) {
  const cfg = INTERVAL_RANGE_MAP[interval] || INTERVAL_RANGE_MAP["60m"];
  return yahooChart(yahooSymbol, cfg.interval, cfg.range);
}

const isNum = v => typeof v === "number" && Number.isFinite(v);

// Penutupan sebelumnya dihitung dari candle harian, BUKAN meta.chartPreviousClose
// (itu penutupan SEBELUM jendela 5 hari -> perubahan % bisa salah besar).
// Aturan: candle terakhir = hari berjalan; prevClose = close valid terakhir
// di candle-candle sebelumnya. Kalau candle terakhir close-nya null (belum
// terisi), close valid terakhir sebelum candle itu tetap dipakai -> sama.
// Fallback ke meta.previousClose / chartPreviousClose hanya bila data candle kosong.
// `skippedNull` = ada candle kosong yang dilewati (mis. candle harian KEMARIN kosong
// di Yahoo), artinya prevClose bisa berasal dari 2+ hari lalu -> perlu dikoreksi.
// Akhir pekan forex tidak terhitung: di hari libur Yahoo memang tidak memberi candle.
export function prevCloseInfo(result) {
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const ts = result?.timestamp || [];
  let skippedNull = false;
  for (let i = closes.length - 2; i >= 0; i--) {
    if (isNum(closes[i])) return { prevClose: closes[i], skippedNull, lastCandleTime: ts.at(-1) != null ? ts.at(-1) * 1000 : null };
    skippedNull = true;
  }
  const meta = result?.meta || {};
  return { prevClose: meta.previousClose ?? meta.chartPreviousClose ?? null, skippedNull: false, lastCandleTime: null };
}

export function computePrevClose(result) {
  return prevCloseInfo(result).prevClose;
}

// Close valid terakhir dari data intraday (mis. 1 jam) SEBELUM awal hari berjalan.
export function prevCloseFromIntraday(intradayResult, beforeMs) {
  const ts = intradayResult?.timestamp || [];
  const closes = intradayResult?.indicators?.quote?.[0]?.close || [];
  for (let i = ts.length - 1; i >= 0; i--) {
    if (ts[i] * 1000 < beforeMs && isNum(closes[i])) return closes[i];
  }
  return null;
}

export function buildYahooQuote(yahooSymbol, result, prevCloseOverride = null) {
  const meta = result.meta || {};
  const price = meta.regularMarketPrice;
  const prevClose = isNum(prevCloseOverride) ? prevCloseOverride : computePrevClose(result);
  const change = isNum(prevClose) ? price - prevClose : 0;
  const changePercent = prevClose ? (change / prevClose) * 100 : 0;
  return {
    symbol: yahooSymbol,
    price,
    prevClose,
    change,
    changePercent,
    high: meta.regularMarketDayHigh,
    low: meta.regularMarketDayLow,
    currency: meta.currency,
    source: "yahoo"
  };
}

export async function getYahooQuote(yahooSymbol) {
  const result = await yahooChart(yahooSymbol, "1d", "5d");
  const info = prevCloseInfo(result);
  // Candle harian kemarin kosong -> ambil penutupan kemarin dari data per jam,
  // supaya % perubahan tidak dihitung terhadap 2 hari lalu.
  let override = null;
  if (info.skippedNull && info.lastCandleTime) {
    try {
      override = prevCloseFromIntraday(await yahooChart(yahooSymbol, "60m", "5d"), info.lastCandleTime);
    } catch { /* tetap pakai close valid terakhir */ }
  }
  return buildYahooQuote(yahooSymbol, result, override);
}

// Ubah respons chart Yahoo jadi array bar. Candle di tengah yang close-nya null
// dibuang (data bolong), tapi candle TERAKHIR (candle berjalan) dipertahankan dan
// diisi dengan meta.regularMarketPrice supaya harga terkini tidak hilang dari chart.
export function buildYahooBars(result, intervalMs = null) {
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const { open = [], high = [], low = [], close = [], volume = [] } = quote;
  const livePrice = result?.meta?.regularMarketPrice;
  const lastIdx = timestamps.length - 1;
  const bars = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (close[i] == null) {
      if (i !== lastIdx || !isNum(livePrice)) continue;
      const o = isNum(open[i]) ? open[i] : livePrice;
      bars.push({
        time: timestamps[i] * 1000,
        open: o,
        high: Math.max(isNum(high[i]) ? high[i] : livePrice, o, livePrice),
        low: Math.min(isNum(low[i]) ? low[i] : livePrice, o, livePrice),
        close: livePrice,
        volume: volume[i] || 0
      });
      continue;
    }
    bars.push({
      time: timestamps[i] * 1000,
      open: open[i],
      high: high[i],
      low: low[i],
      close: close[i],
      volume: volume[i] || 0
    });
  }
  return mergeTrailingLivePoint(bars, intervalMs);
}

export async function getYahooOhlcv(yahooSymbol, interval) {
  const base = AGGREGATE_FROM[interval];
  if (base) {
    const baseBars = await getYahooOhlcv(yahooSymbol, base);
    return aggregateAligned(baseBars, INTERVAL_MS[interval]);
  }
  const result = await fetchChart(yahooSymbol, interval);
  return buildYahooBars(result, INTERVAL_MS[interval]);
}
