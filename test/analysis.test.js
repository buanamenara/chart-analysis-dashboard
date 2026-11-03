import test from "node:test";
import assert from "node:assert/strict";
import * as analysis from "../lib/analysis.js";
import { generateRuleBasedSignal } from "../lib/ruleSignal.js";

test("rule-based signal reports directional confidence from available evidence", () => {
  const result = generateRuleBasedSignal({
    indicators: {
      lastClose: 100,
      ema20: 105,
      ema50: 100,
      sma200: 95,
      rsi14: 50,
      macd: { histogram: 0.5 },
      bollinger: { pb: 0.5 }
    },
    dailyBars: [],
    bars: []
  });

  assert.equal(result.signal, "BUY");
  // Semua bukti yang memberi arah bullish (RSI & %b netral tidak ikut dihitung) -> 100%.
  assert.equal(result.confidence, 100);
  assert.equal(result.confidenceLabel, "Tinggi");
});

test("higher-timeframe map selects the next one or two supported intervals", () => {
  assert.equal(typeof analysis.getHigherTimeframes, "function");
  assert.deepEqual(analysis.getHigherTimeframes("1m"), ["3m", "5m"]);
  assert.deepEqual(analysis.getHigherTimeframes("3m"), ["5m", "15m"]);
  assert.deepEqual(analysis.getHigherTimeframes("5m"), ["15m", "1h"]);
  assert.deepEqual(analysis.getHigherTimeframes("15m"), ["1h", "4h"]);
  assert.deepEqual(analysis.getHigherTimeframes("1wk"), []);
});

test("multi-timeframe summary measures directional agreement and ignores neutral rows", () => {
  assert.equal(typeof analysis.summarizeTimeframeSignals, "function");
  const result = analysis.summarizeTimeframeSignals("BUY", [
    { interval: "4h", signal: "BUY" },
    { interval: "1d", signal: "BUY" },
    { interval: "1wk", signal: "SELL" },
    { interval: "1mo", signal: "NETRAL" }
  ]);
  assert.equal(result.bias, "BUY");
  assert.equal(result.agreementPercent, 67);
  assert.equal(result.currentAligned, true);
  assert.equal(result.directionalTimeframes, 3);
});

test("market regime classifies trending vs ranging from ADX and DI", () => {
  const trending = analysis.classifyRegime(32, 28, 12);
  assert.equal(trending.strength, "Trending");
  assert.equal(trending.direction, "naik (+DI dominan)");

  const ranging = analysis.classifyRegime(14, 15, 16);
  assert.equal(ranging.strength, "Ranging (sideways)");
  assert.equal(ranging.direction, null);

  assert.equal(analysis.classifyRegime(null), null);
});

test("technical analysis lowers confidence when ranging and higher TF disagrees", () => {
  const base = {
    indicators: { lastClose: 100, ema20: 101, ema50: 100, sma200: 99, rsi14: 55,
      macd: { histogram: 0.2 }, bollinger: { pb: 0.5 }, adx14: 15, plusDI: 14, minusDI: 16, atr14: 1.2, barsUsed: 120 },
    dailyBars: [], bars: [], signal: { bullishCount: 3, bearishCount: 1, confidence: 60 },
    nearestSupport: { mid: 98 }, nearestResistance: { mid: 103 }
  };
  const aligned = analysis.buildTechnicalAnalysis({ ...base,
    multiTimeframe: { bias: "BUY", agreementPercent: 100, currentAligned: true, directionalTimeframes: 2 } });
  const opposed = analysis.buildTechnicalAnalysis({ ...base,
    multiTimeframe: { bias: "SELL", agreementPercent: 100, currentAligned: false, directionalTimeframes: 2 } });
  assert.ok(opposed.overallConfidence < aligned.overallConfidence);
});
