import test from "node:test";
import assert from "node:assert/strict";
import { summarizeTimeframeSignals, buildTechnicalAnalysis, biasFromSignal } from "../lib/analysis.js";
import { generateRuleBasedSignal, regimeWeights } from "../lib/ruleSignal.js";
import { computeIndicators, isLastBarOpen } from "../lib/indicators.js";
import { computeSnrZones, clusterLevels, pickTargets } from "../lib/snr.js";

const baseInd = { lastClose: 100, ema20: 101, ema50: 100, sma200: 99, rsi14: 55, macd: { histogram: 0.2 },
  bollinger: { pb: 0.5 }, adx14: 22, plusDI: 20, minusDI: 15, atr14: 1, barsUsed: 120 };

// ---------- A. bug keyakinan / bias ----------
test("A1: TF besar netral (atau tidak ada) tidak memotong keyakinan", () => {
  const signal = { signal: "BUY", bullishCount: 7, bearishCount: 0, confidence: 80 };
  const none = buildTechnicalAnalysis({ indicators: baseInd, dailyBars: [], bars: [], signal,
    multiTimeframe: summarizeTimeframeSignals("BUY", []) });
  const neutral = buildTechnicalAnalysis({ indicators: baseInd, dailyBars: [], bars: [], signal,
    multiTimeframe: summarizeTimeframeSignals("BUY", [{ interval: "4h", signal: "NETRAL" }]) });
  assert.equal(none.overallConfidence, 80);
  assert.equal(neutral.overallConfidence, 80);
});

test("A1b: TF besar yang BERLAWANAN menurunkan, bukan menaikkan, keyakinan", () => {
  const signal = { signal: "BUY", bullishCount: 7, bearishCount: 0, confidence: 60 };
  const opposed = buildTechnicalAnalysis({ indicators: baseInd, dailyBars: [], bars: [], signal,
    multiTimeframe: summarizeTimeframeSignals("BUY", [{ interval: "4h", signal: "SELL" }, { interval: "1d", signal: "SELL" }]) });
  assert.ok(opposed.overallConfidence < 60, `got ${opposed.overallConfidence}`);
});

test("A2: sinyal NETRAL tidak dianggap berlawanan dengan TF besar", () => {
  const mtf = summarizeTimeframeSignals("NETRAL", [{ interval: "4h", signal: "SELL" }]);
  assert.equal(mtf.currentAligned, null);
  const signal = { signal: "NETRAL", bullishCount: 2, bearishCount: 1, confidence: 60 };
  const r = buildTechnicalAnalysis({ indicators: baseInd, dailyBars: [], bars: [], signal, multiTimeframe: mtf,
    nearestResistance: { mid: 100.1 }, nearestSupport: { mid: 95 } });
  assert.equal(r.trapWarning, null);
  assert.match(r.multiTimeframeText, /masih netral/);
});

test("A2b: TF besar seimbang BUY vs SELL = NETRAL", () => {
  const mtf = summarizeTimeframeSignals("BUY", [{ interval: "4h", signal: "BUY" }, { interval: "1d", signal: "SELL" }]);
  assert.equal(mtf.bias, "NETRAL");
  assert.equal(mtf.currentAligned, null);
});

test("A3: bias analisa mengikuti sinyal (tidak lagi 'bullish' saat sinyal NETRAL)", () => {
  assert.equal(biasFromSignal({ signal: "NETRAL", bullishCount: 5, bearishCount: 2.5 }), "neutral");
  assert.equal(biasFromSignal({ signal: "BUY" }), "bullish");
  assert.equal(biasFromSignal({ bullishCount: 5, bearishCount: 2.5 }), "neutral"); // selisih 2.5 < 3
  assert.equal(biasFromSignal({ bullishCount: 6, bearishCount: 2.5 }), "bullish");
});

test("A4: teks kesimpulan menyebut 'skor bobot', bukan 'indikator'", () => {
  const r = buildTechnicalAnalysis({ indicators: baseInd, dailyBars: [], bars: [],
    signal: { signal: "BUY", bullishCount: 7, bearishCount: 1.5, confidence: 82 } });
  assert.match(r.conclusion, /skor bobot 7 bullish vs 1\.5 bearish/);
  assert.doesNotMatch(r.conclusion, /indikator bullish/);
});

// ---------- B. sinyal ----------
test("B: overbought saat tren naik sangat kuat tidak dihitung sebagai suara SELL", () => {
  const ind = { lastClose: 120, ema20: 115, ema50: 110, sma200: 100, rsi14: 78, macd: { histogram: 1 },
    bollinger: { pb: 0.98 }, adx14: 40, plusDI: 35, minusDI: 10 };
  const r = generateRuleBasedSignal({ indicators: ind, dailyBars: [], bars: [] });
  assert.equal(r.signal, "BUY");
  assert.equal(r.bearishCount, 0);
  assert.equal(r.confidence, 100);
});

test("B: overbought saat pasar tidak trending tetap dihitung", () => {
  const ind = { lastClose: 101, ema20: 100.2, ema50: 100, rsi14: 75, macd: { histogram: 0.01 }, bollinger: { pb: 0.97 }, adx14: 15 };
  const r = generateRuleBasedSignal({ indicators: ind, dailyBars: [], bars: [] });
  assert.equal(r.bearishCount, 2);
});

test("B: bobot pantulan melawan tren turun bertahap (tanpa lompatan)", () => {
  assert.equal(regimeWeights(20).counterMult, 1);
  assert.equal(regimeWeights(30).counterMult, 0.5);
  assert.equal(regimeWeights(40).counterMult, 0);
  assert.equal(regimeWeights(null).counterMult, 1);
});

const mkBars = (n, t0, step) => Array.from({ length: n }, (_, i) => {
  const c = 100 + Math.sin(i / 5) * 3 + i * 0.05;
  return { time: t0 + i * step, open: c - 0.2, high: c + 1, low: c - 1, close: c, volume: 10 };
});

test("B: indikator dihitung dari candle tertutup; harga live tetap jadi lastClose", () => {
  const H = 3600e3, t0 = 1_700_000_000_000;
  const bars = mkBars(120, t0, H);
  const now = bars.at(-1).time + 10 * 60e3; // candle terakhir baru berjalan 10 menit
  assert.equal(isLastBarOpen(bars, "1h", now), true);
  const live = [...bars.slice(0, -1), { ...bars.at(-1), close: 150, high: 150 }]; // lonjakan di candle berjalan
  const a = computeIndicators(live, { interval: "1h", now });
  const closedOnly = computeIndicators(bars.slice(0, -1));
  assert.equal(a.lastBarOpen, true);
  assert.equal(a.lastClose, 150);
  assert.equal(a.rsi14, closedOnly.rsi14);
  assert.equal(a.ema20, closedOnly.ema20);
  // tanpa interval: perilaku lama
  assert.equal(computeIndicators(live).lastBarOpen, false);
});

// ---------- C. zona SNR ----------
test("C: kekuatan zona dihitung per kategori, bukan per label", () => {
  const z = clusterLevels([
    { price: 100, label: "POC (Point of Control)" }, { price: 100.1, label: "VAL (Value Area Low)" },
    { price: 100.2, label: "VWAP" }, { price: 100.2, label: "VWAP -1σ" }
  ], 110, 0.5);
  assert.equal(z.length, 1);
  assert.equal(z[0].strength, 1.5); // volume (1) + vwap (0.5)
});

test("C: zona tidak berantai melebihi 2x toleransi", () => {
  const levels = [0, 0.4, 0.8, 1.2, 1.6, 2.0].map((d, i) => ({ price: 100 + d, label: `Swing High ${i}` }));
  const z = clusterLevels(levels, 90, 0.5);
  assert.ok(z.every(c => c.high - c.low <= 1.0 + 1e-9));
  assert.ok(z.length >= 2);
});

test("C: TP1 = level pertama dengan R:R >= 1.5, bukan sekadar yang terdekat", () => {
  const levels = [{ mid: 100.5 }, { mid: 101.0 }, { mid: 102.0 }, { mid: 104 }];
  const r = pickTargets(100, 99, levels, 1);
  assert.deepEqual(r.takeProfit, [102.0, 104]);
  assert.equal(r.rr, 2);
});

test("C: kalau tak ada level ber-R:R cukup, pakai R:R terbaik yang tersedia", () => {
  const r = pickTargets(100, 98, [{ mid: 100.5 }, { mid: 101.5 }], 1);
  assert.deepEqual(r.takeProfit, [101.5]);
  assert.equal(r.rr, 0.75);
});

function snrCase(signal) {
  // Support jelas di 104 (swing low), semua level lain jauh di atas (~108-111).
  const bars = Array.from({ length: 60 }, (_, i) => ({
    time: Date.UTC(2026, 0, 5, 0) + i * 3600e3,
    open: 110, high: 111, low: i % 10 === 5 ? 104 : 109, close: 110, volume: 1
  }));
  const indicators = { lastClose: 104.6, atr14: 0.8, bollinger: {} };
  return computeSnrZones({ indicators, dailyBars: [], bars, signal: { signal } });
}

test("C: setup Buy di support ditolak bila sinyal SELL (dan diberi penjelasan)", () => {
  const sell = snrCase("SELL");
  assert.equal(sell.potential, null);
  assert.match(sell.skippedSetup, /MELAWAN sinyal SELL/);
  const buy = snrCase("BUY");
  assert.equal(buy.potential?.type, "BUY_ZONE");
  assert.equal(buy.skippedSetup, null);
});

test("C: SL memakai buffer 0.5x ATR timeframe ini", () => {
  const { potential: p } = snrCase("BUY");
  assert.ok(Math.abs((p.zone.low - p.stopLoss) - 0.4) < 1e-9);
});
