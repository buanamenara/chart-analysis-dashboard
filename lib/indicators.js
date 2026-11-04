import { RSI, MACD, EMA, SMA, BollingerBands, ADX, ATR } from "technicalindicators";

import { INTERVAL_MS } from "./bars.js";
export { INTERVAL_MS };

// true bila candle terakhir masih berjalan (waktu buka + durasi > sekarang).
export function isLastBarOpen(bars, interval, now = Date.now()) {
  const dur = INTERVAL_MS[interval];
  const last = bars?.at?.(-1);
  if (!dur || !last || !Number.isFinite(last.time)) return false;
  return last.time + dur > now;
}

// Indikator dihitung dari candle yang SUDAH TERTUTUP supaya sinyal tidak berganti-ganti
// di tengah candle (repaint). Harga terkini tetap dipakai sebagai `lastClose` (untuk
// jarak ke zona, SMA200, dll). Tanpa `interval`, perilaku lama dipertahankan (semua bar).
export function computeIndicators(bars, { interval, now } = {}) {
  // Candle berjalan SELALU dibuang; kalau sisa candle tertutup < 30, hasilnya
  // "data belum cukup" (lebih jujur daripada memakai candle yang masih bergerak).
  const lastBarOpen = isLastBarOpen(bars, interval, now);
  const liveClose = bars.at(-1)?.close;
  const result = computeIndicatorsRaw(lastBarOpen ? bars.slice(0, -1) : bars);
  if (result.insufficientData) return result;
  return { ...result, lastClose: liveClose, closedClose: result.lastClose, lastBarOpen };
}

function computeIndicatorsRaw(bars) {
  const closes = bars.map(b => b.close);

  if (closes.length < 30) {
    return { insufficientData: true };
  }

  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);

  const rsi = RSI.calculate({ period: 14, values: closes });
  const macd = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const ema20 = EMA.calculate({ period: 20, values: closes });
  const ema50 = EMA.calculate({ period: 50, values: closes });

  // PERBAIKAN: SMA200 hanya dihitung kalau data >= 200 bar.
  // Kalau kurang, kembalikan array kosong -> sistem anggap "data belum cukup".
  const sma200 = closes.length >= 200
    ? SMA.calculate({ period: 200, values: closes })
    : [];

  const bb = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
  const last = arr => (arr && arr.length ? arr[arr.length - 1] : null);

  // ADX = kekuatan tren (bukan arah). >25 = tren kuat, <20 = ranging/sideways.
  // +DI vs -DI memberi arah dominan. ATR = volatilitas absolut rata-rata.
  let adx14 = null, plusDI = null, minusDI = null, atr14 = null;
  if (closes.length >= 28) {
    const adxSeries = ADX.calculate({ period: 14, close: closes, high: highs, low: lows });
    const lastAdx = last(adxSeries);
    if (lastAdx) {
      adx14 = lastAdx.adx ?? null;
      plusDI = lastAdx.pdi ?? null;
      minusDI = lastAdx.mdi ?? null;
    }
    atr14 = last(ATR.calculate({ period: 14, close: closes, high: highs, low: lows }));
  }

  // Divergence RSI (regular) — sinyal pembalikan: harga vs momentum berlawanan.
  const rsiDivergence = detectRsiDivergence(closes, rsi);
  // Hidden divergence — sinyal penerusan tren.
  const rsiHiddenDivergence = detectHiddenDivergence(closes, rsi);

  // Analisa volume — konfirmasi kekuatan pergerakan (bila volume tersedia).
  const vols = bars.map(b => b.volume || 0);
  // Candle terakhir sering belum selesai (volume 0) -> pakai candle terakhir yang sudah terisi.
  let lastIdx = vols.length - 1;
  while (lastIdx > 0 && vols[lastIdx] === 0) lastIdx--;
  const recentVols = vols.slice(Math.max(0, lastIdx - 19), lastIdx + 1).filter(v => v > 0);
  const volAvailable = recentVols.length >= 5;
  const volAvg = volAvailable ? recentVols.reduce((s, v) => s + v, 0) / recentVols.length : 0;
  const volNow = vols[lastIdx];
  const volRatio = volAvailable && volAvg > 0 ? +(volNow / volAvg).toFixed(2) : null;

  return {
    lastClose: closes[closes.length - 1],
    rsi14: last(rsi),
    macd: last(macd),
    ema20: last(ema20),
    ema50: last(ema50),
    sma200: last(sma200),
    bollinger: last(bb),
    adx14,
    plusDI,
    minusDI,
    atr14,
    rsiDivergence,
    rsiHiddenDivergence,
    volume: { available: volAvailable, ratio: volRatio, aboveAvg: volRatio != null && volRatio >= 1.3, thin: volRatio != null && volRatio < 0.7 },
    barsUsed: closes.length
  };
}

// Deteksi divergence RSI "regular" dari ~45 bar terakhir (lookback pivot 3).
// Bullish: harga lower-low tapi RSI higher-low. Bearish: harga higher-high tapi RSI lower-high.
function detectRsiDivergence(closes, rsiArr) {
  const n = closes.length;
  if (n < 40 || rsiArr.length < 20) return null;
  const rsiAt = i => (i - 14 >= 0 && i - 14 < rsiArr.length ? rsiArr[i - 14] : null);
  const L = 3, from = Math.max(14 + L, n - 45);
  const lows = [], highs = [];
  for (let i = from + L; i < n - L; i++) {
    let isLow = true, isHigh = true;
    for (let j = i - L; j <= i + L; j++) { if (j === i) continue; if (closes[j] <= closes[i]) isLow = false; if (closes[j] >= closes[i]) isHigh = false; }
    if (isLow && rsiAt(i) != null) lows.push(i);
    if (isHigh && rsiAt(i) != null) highs.push(i);
  }
  if (lows.length >= 2) {
    const [a, b] = lows.slice(-2);
    if (closes[b] < closes[a] && rsiAt(b) > rsiAt(a) + 1) return "bullish";
  }
  if (highs.length >= 2) {
    const [a, b] = highs.slice(-2);
    if (closes[b] > closes[a] && rsiAt(b) < rsiAt(a) - 1) return "bearish";
  }
  return null;
}

// Hidden divergence = sinyal PENERUSAN tren (bukan pembalikan).
// Hidden bullish: harga higher-low tapi RSI lower-low -> tren naik lanjut.
// Hidden bearish: harga lower-high tapi RSI higher-high -> tren turun lanjut.
function detectHiddenDivergence(closes, rsiArr) {
  const n = closes.length;
  if (n < 40 || rsiArr.length < 20) return null;
  const rsiAt = i => (i - 14 >= 0 && i - 14 < rsiArr.length ? rsiArr[i - 14] : null);
  const L = 3, from = Math.max(14 + L, n - 45);
  const lows = [], highs = [];
  for (let i = from + L; i < n - L; i++) {
    let isLow = true, isHigh = true;
    for (let j = i - L; j <= i + L; j++) { if (j === i) continue; if (closes[j] <= closes[i]) isLow = false; if (closes[j] >= closes[i]) isHigh = false; }
    if (isLow && rsiAt(i) != null) lows.push(i);
    if (isHigh && rsiAt(i) != null) highs.push(i);
  }
  if (lows.length >= 2) {
    const [a, b] = lows.slice(-2);
    if (closes[b] > closes[a] && rsiAt(b) < rsiAt(a) - 1) return "bullish"; // higher-low harga, lower-low RSI
  }
  if (highs.length >= 2) {
    const [a, b] = highs.slice(-2);
    if (closes[b] < closes[a] && rsiAt(b) > rsiAt(a) + 1) return "bearish"; // lower-high harga, higher-high RSI
  }
  return null;
}

export function computeIndicatorSeries(bars) {
  const closes = bars.map(b => b.close);
  const n = closes.length;
  if (n < 30) return null;

  // PERBAIKAN: SMA200 hanya dihitung kalau data >= 200 bar.
  const sma200 = n >= 200 ? SMA.calculate({ period: 200, values: closes }) : [];
  const ema20 = EMA.calculate({ period: 20, values: closes });
  const ema50 = EMA.calculate({ period: 50, values: closes });
  const bb = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });

  const align = (series, period) => {
    const out = new Array(n).fill(null);
    for (let i = 0; i < series.length; i++) out[i + period - 1] = series[i];
    return out;
  };

  return {
    ema20: align(ema20, 20),
    ema50: align(ema50, 50),
    sma200: align(sma200, 200),
    bbUpper: align(bb.map(b => b.upper), 20),
    bbMiddle: align(bb.map(b => b.middle), 20),
    bbLower: align(bb.map(b => b.lower), 20)
  };
}

export function summarizeTrend(indicators) {
  if (indicators.insufficientData) return "Data tidak cukup untuk analisis indikator.";

  const { lastClose, ema20, ema50, sma200, rsi14, macd, bollinger } = indicators;
  const parts = [];

  if (ema20 && ema50) {
    parts.push(ema20 > ema50
      ? "EMA20 di atas EMA50 (bias naik jangka pendek)"
      : "EMA20 di bawah EMA50 (bias turun jangka pendek)");
  }

  // PERBAIKAN: hanya tampilkan alasan SMA200 kalau SMA200 benar-benar ada.
  if (sma200 != null) {
    parts.push(lastClose > sma200
      ? "Harga di atas SMA200 (tren besar naik)"
      : "Harga di bawah SMA200 (tren besar turun)");
  }

  if (macd?.histogram != null) {
    parts.push(macd.histogram > 0
      ? "MACD histogram positif (momentum naik)"
      : "MACD histogram negatif (momentum turun)");
  }

  if (bollinger?.pb != null) {
    if (bollinger.pb <= 0.05) parts.push("Harga nempel BB bawah (potensi pantulan naik)");
    else if (bollinger.pb >= 0.95) parts.push("Harga nempel BB atas (potensi koreksi turun)");
  }

  if (rsi14 != null) {
    if (rsi14 > 70) parts.push(`RSI ${rsi14.toFixed(1)} (overbought)`);
    else if (rsi14 < 30) parts.push(`RSI ${rsi14.toFixed(1)} (oversold)`);
    else parts.push(`RSI ${rsi14.toFixed(1)} (netral)`);
  }

  return parts.join(", ");
}
