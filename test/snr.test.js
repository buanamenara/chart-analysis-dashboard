import test from "node:test";
import assert from "node:assert/strict";
import * as levels from "../lib/levels.js";
import { computeSnrZones } from "../lib/snr.js";

const dailyBars = [
  { time: 1, open: 95, high: 105, low: 90, close: 100 },
  { time: 2, open: 100, high: 110, low: 90, close: 100 },
  { time: 3, open: 101, high: 106, low: 99, close: 103 }
];
const bars = Array.from({ length: 40 }, (_, i) => ({
  time: i,
  open: 98 + i * 0.05,
  high: 100 + i * 0.05,
  low: 96 + i * 0.05,
  close: 99 + i * 0.05
}));
const indicators = {
  lastClose: 100,
  bollinger: { upper: 100.1, lower: 95 }
};

test("classic daily pivots use the previous completed candle", () => {
  assert.equal(typeof levels.computePivotPoints, "function");
  const pivots = levels.computePivotPoints(dailyBars);
  assert.equal(pivots.pp, 100);
  assert.equal(pivots.r1, 110);
  assert.equal(pivots.s1, 90);
  assert.equal(pivots.r2, 120);
  assert.equal(pivots.s2, 80);
  assert.equal(pivots.r3, 130);
  assert.equal(pivots.s3, 70);
});

test("SNR zones include pivot sources and keep price-band boundaries", () => {
  const result = computeSnrZones({ indicators, dailyBars, bars });
  assert.ok(result.zones.some(zone => zone.sources.includes("Pivot PP")));
  assert.ok(result.zones.every(zone => zone.low <= zone.high));
  assert.ok(result.zones.some(zone => zone.high > zone.low));
  assert.equal(result.pivotLevels.pp, 100);
});
