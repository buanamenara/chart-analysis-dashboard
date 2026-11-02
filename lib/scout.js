import { fetchOhlcv, fetchDailyBars } from "./marketData.js";
import { computeIndicators } from "./indicators.js";
import { generateRuleBasedSignal } from "./ruleSignal.js";
import { computeSnrZones } from "./snr.js";

const MAX_SYMBOLS = 16;   // 2 fetch/simbol -> <=32 subrequest, aman di Cloudflare (limit 50)
const CONCURRENCY = 4;    // pindai paralel biar cepat, tapi tak membanjiri sumber data

// Tren timeframe lebih tinggi (harian) dari dailyBars yang SUDAH diambil — tanpa fetch
// tambahan. Dipakai sebagai filter "jangan lawan HTF": ema50 vs sma200, fallback ke
// ema20/ema50 atau harga vs sma200 kalau data harian belum 200 bar.
function dailyTrend(dailyBars) {
  const d = computeIndicators(dailyBars);
  if (!d || d.insufficientData) return "flat";
  const { ema20, ema50, sma200, lastClose } = d;
  if (ema50 && sma200) return ema50 > sma200 ? "up" : ema50 < sma200 ? "down" : "flat";
  if (sma200 && lastClose) return lastClose > sma200 ? "up" : "down";
  if (ema20 && ema50) return ema20 > ema50 ? "up" : ema20 < ema50 ? "down" : "flat";
  return "flat";
}

async function scanSymbol(assetType, symbol, interval) {
  const [bars, dailyBars] = await Promise.all([
    fetchOhlcv(assetType, symbol, interval),
    fetchDailyBars(assetType, symbol)
  ]);
  const indicators = computeIndicators(bars);
  if (indicators.insufficientData) return null;

  const sig = generateRuleBasedSignal({ indicators, dailyBars, bars });
  const { potential } = computeSnrZones({ indicators, dailyBars, bars });
  const rr = potential?.riskRewardRatio ?? null;
  const rrQ = potential?.rrQuality ?? null;
  const divOpp = (indicators.rsiDivergence === "bearish" && sig.signal === "BUY") ||
                 (indicators.rsiDivergence === "bullish" && sig.signal === "SELL");

  const htfTrend = dailyTrend(dailyBars);
  const htfAlign = sig.signal === "NETRAL" || htfTrend === "flat" ? "neutral"
    : (sig.signal === "BUY" && htfTrend === "up") || (sig.signal === "SELL" && htfTrend === "down")
      ? "align" : "conflict";

  // SKOR = confidence + bonus R:R + bonus searah HTF − penalti setup buruk / lawan HTF / divergence lawan.
  let score = 0;
  if (sig.signal !== "NETRAL") {
    score = sig.confidence;
    if (rr != null) score += Math.min(20, rr * 8);
    if (htfAlign === "align") score += 12;
    else if (htfAlign === "conflict") score -= 18;
    if (rrQ === "buruk") score -= 30;
    if (divOpp) score -= 15;
  }

  return {
    symbol, price: indicators.lastClose,
    signal: sig.signal, confidence: sig.confidence,
    rr, rrQuality: rrQ, divOpp,
    htfTrend, htfAlign,
    hasSetup: !!potential, setupType: potential?.type || null,
    score: Math.round(score)
  };
}

// Jalankan daftar tugas async dengan batas konkurensi sederhana (pool).
async function runPool(items, limit, worker) {
  const out = [];
  let idx = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try { out[i] = await worker(items[i]); } catch { out[i] = null; }
    }
  });
  await Promise.all(runners);
  return out;
}

// SCOUT: pindai banyak instrumen pada satu timeframe, beri SKOR untuk ranking peluang.
// Ringan (2 fetch/simbol, tanpa multi-timeframe intraday penuh/fundamental) agar aman di Cloudflare.
export async function runScout(assetType, symbols, interval) {
  const list = (symbols || []).slice(0, MAX_SYMBOLS);
  const scanned = await runPool(list, CONCURRENCY, s => scanSymbol(assetType, s, interval));
  const results = scanned.filter(Boolean).sort((a, b) => b.score - a.score);
  return {
    assetType, interval, scanned: results.length, requested: list.length, results,
    disclaimer: "Scout = pemindai cepat (sinyal + R:R + tren harian HTF). Skor untuk prioritas, bukan nasihat. Buka Analisa SNR instrumen terpilih untuk kajian penuh."
  };
}
