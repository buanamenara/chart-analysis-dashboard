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
  assert.equal(result.confidence, 60);
  assert.equal(result.confidenceLabel, "Sedang");
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
    { interval: "1d", signal: "SELL" },
    { interval: "1wk", signal: "NETRAL" }
  ]);
  assert.equal(result.bias, "BUY");
  assert.equal(result.agreementPercent, 50);
  assert.equal(result.currentAligned, true);
  assert.equal(result.directionalTimeframes, 2);
});
