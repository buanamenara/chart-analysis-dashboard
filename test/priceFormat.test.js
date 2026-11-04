import test from "node:test";
import assert from "node:assert/strict";
import { fmtPrice, priceDecimals } from "../lib/format.js";
import { computeSnrZones } from "../lib/snr.js";
import { buildTechnicalAnalysis, NEUTRAL_MAX_CONFIDENCE } from "../lib/analysis.js";

test("desimal harga mengikuti skala (sama dengan priceDigits di frontend)", () => {
  assert.equal(priceDecimals(1.12625), 5);
  assert.equal(priceDecimals(158.379), 2);
  assert.equal(priceDecimals(4037.54), 2);
  assert.equal(priceDecimals(0.5, "crypto"), 6);
  assert.equal(fmtPrice(1.1262530088), "1.12625");
  assert.equal(fmtPrice(0.00042, 1.126), "0.00042");
  assert.equal(fmtPrice(null), "-");
});

test("teks setup SNR forex tidak dibulatkan ke 2 desimal (Entry/SL/TP terbedakan)", () => {
  // Support swing ~1.1240, harga 1.12450 (pip-level), ATR 0.0008.
  const bars = Array.from({ length: 60 }, (_, i) => ({
    time: Date.UTC(2026, 0, 5) + i * 3600e3,
    open: 1.1262, high: 1.1270, low: i % 10 === 5 ? 1.1240 : 1.1255, close: 1.1262, volume: 0
  }));
  // PDL kemarin 1.1240 = konfluensi dengan swing low (zona tidak lemah).
  const dailyBars = [
    { time: Date.UTC(2026, 0, 3), open: 1.1262, high: 1.1275, low: 1.1250, close: 1.1262 },
    { time: Date.UTC(2026, 0, 4), open: 1.1262, high: 1.1275, low: 1.1240, close: 1.1262 },
    { time: Date.UTC(2026, 0, 5), open: 1.1262, high: 1.1270, low: 1.1255, close: 1.1262 }
  ];
  const r = computeSnrZones({ indicators: { lastClose: 1.1245, atr14: 0.0008, bollinger: {} }, dailyBars, bars, signal: { signal: "BUY" } });
  const p = r.potential;
  assert.equal(p?.type, "BUY_ZONE");
  assert.match(p.reason, /Entry \(limit\) ~1\.12\d{3} /);
  assert.match(p.reason, /SL 1\.12\d{3} /);
  assert.doesNotMatch(p.reason, /SL 1\.12 /);
});

test("sinyal NETRAL tidak pernah berlabel keyakinan Tinggi/Sedang", () => {
  // Kasus nyata XAUUSD 4h: NETRAL, skor 3 vs 5.5, tren kuat -> dulu 'Tinggi (70%)'.
  const ind = { lastClose: 4037, ema20: 3945, ema50: 3960, sma200: 3900, rsi14: 60, macd: { histogram: -1 },
    bollinger: { pb: 0.8 }, adx14: 35, plusDI: 30, minusDI: 15, atr14: 20 };
  const a = buildTechnicalAnalysis({ indicators: ind, dailyBars: [], bars: [],
    signal: { signal: "NETRAL", bullishCount: 3, bearishCount: 5.5, confidence: 65 } });
  assert.equal(a.bias, "neutral");
  assert.equal(a.overallConfidence, NEUTRAL_MAX_CONFIDENCE);
  assert.equal(a.confidenceLabel, "Rendah");
  assert.match(a.conclusion, /sinyal NETRAL/);
  // Sinyal berarah tidak terkena batas ini.
  const buy = buildTechnicalAnalysis({ indicators: ind, dailyBars: [], bars: [],
    signal: { signal: "BUY", bullishCount: 8, bearishCount: 1, confidence: 89 } });
  assert.ok(buy.overallConfidence > NEUTRAL_MAX_CONFIDENCE);
});

test("kesimpulan analisa forex memakai 5 desimal untuk support/resistance", () => {
  const ind = { lastClose: 1.12625, ema20: 1.12583, ema50: 1.12401, sma200: 1.1201, rsi14: 55,
    macd: { histogram: 0.0002 }, bollinger: { pb: 0.5 }, adx14: 22, plusDI: 20, minusDI: 15, atr14: 0.0011 };
  const a = buildTechnicalAnalysis({ indicators: ind, dailyBars: [], bars: [],
    signal: { signal: "BUY", bullishCount: 7, bearishCount: 1, confidence: 80 },
    nearestSupport: { mid: 1.12412 }, nearestResistance: { mid: 1.12988 } });
  assert.match(a.conclusion, /support 1\.12412 & menembus resistance 1\.12988/);
  assert.match(a.trend, /EMA20 \(1\.12583\)/);
  assert.match(a.volatility, /ATR14 ≈ 0\.00110/);
});
