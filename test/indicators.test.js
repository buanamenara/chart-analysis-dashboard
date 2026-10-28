import test from "node:test";
import assert from "node:assert/strict";
import { computeIndicatorSeries } from "../lib/indicators.js";

function makeBars(length) {
  return Array.from({ length }, (_, i) => ({
    time: i * 60_000,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100 + i,
    volume: 1
  }));
}

test("indicator overlay series align with candle indices", () => {
  const bars = makeBars(60);
  const series = computeIndicatorSeries(bars);

  assert.equal(series.ema20.length, bars.length);
  assert.equal(series.bbUpper.length, bars.length);
  assert.equal(series.ema20[18], null);
  assert.equal(series.ema20[19], 109.5);
  assert.equal(series.bbMiddle[19], 109.5);
});

test("SMA 200 overlay stays absent until 200 candles exist", () => {
  const series = computeIndicatorSeries(makeBars(100));
  assert.ok(series.sma200.every(value => value === null));
});
