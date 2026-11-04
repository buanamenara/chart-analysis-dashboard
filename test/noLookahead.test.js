import test from "node:test";
import assert from "node:assert/strict";
import { RSI, EMA, ATR, BollingerBands } from "technicalindicators";
import { computeSeries } from "../lib/backtest.js";
import { computeIndicatorSeries } from "../lib/indicators.js";
import { alignToEnd } from "../lib/bars.js";

// Data sintetis yang naik-turun supaya RSI/ATR bervariasi.
const bars = Array.from({ length: 260 }, (_, i) => {
  const c = 100 + Math.sin(i / 4) * 6 + Math.sin(i / 17) * 9 + i * 0.03;
  return { time: i * 3600e3, open: c - 0.3, high: c + 1 + (i % 5) * 0.2, low: c - 1 - (i % 7) * 0.15, close: c, volume: 10 + (i % 9) };
});
const closes = bars.map(b => b.close), highs = bars.map(b => b.high), lows = bars.map(b => b.low);
const near = (a, b) => Math.abs(a - b) < 1e-9;

test("alignToEnd: nilai terakhir deret jatuh di candle terakhir", () => {
  assert.deepEqual(alignToEnd([7, 8, 9], 5), [null, null, 7, 8, 9]);
});

test("backtest: nilai indikator di candle i hanya memakai data sampai candle i (tanpa look-ahead)", () => {
  const S = computeSeries(bars);
  for (const i of [30, 61, 120, 199, 259]) {
    const pre = closes.slice(0, i + 1);
    assert.ok(near(S.rsi[i], RSI.calculate({ period: 14, values: pre }).at(-1)), `RSI bar ${i}`);
    assert.ok(near(S.e20[i], EMA.calculate({ period: 20, values: pre }).at(-1)), `EMA20 bar ${i}`);
    assert.ok(near(S.atr[i], ATR.calculate({ period: 14, high: highs.slice(0, i + 1), low: lows.slice(0, i + 1), close: pre }).at(-1)), `ATR bar ${i}`);
    assert.ok(near(S.bbM[i], BollingerBands.calculate({ period: 20, stdDev: 2, values: pre }).at(-1).middle), `BB bar ${i}`);
  }
});

test("seri overlay chart (EMA/BB) juga selaras dengan candle-nya", () => {
  const s = computeIndicatorSeries(bars);
  for (const i of [60, 150, 259]) {
    const pre = closes.slice(0, i + 1);
    assert.ok(near(s.ema50[i], EMA.calculate({ period: 50, values: pre }).at(-1)), `EMA50 bar ${i}`);
    assert.ok(near(s.bbUpper[i], BollingerBands.calculate({ period: 20, stdDev: 2, values: pre }).at(-1).upper), `BB upper bar ${i}`);
  }
});
