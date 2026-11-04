import test from "node:test";
import assert from "node:assert/strict";
import { computeSnrZones, PROJECTED_RR } from "../lib/snr.js";
import { buildTechnicalAnalysis, summarizeTimeframeSignals, MAX_CONFIDENCE, WEAK_CONFIDENCE } from "../lib/analysis.js";
import { fetchCalendarEvents } from "../lib/calendar.js";

// ---------- TP proyeksi ----------
test("setup BUY tanpa resistance di atas harga -> TP proyeksi R:R 1:2", () => {
  // Harga di atas semua level (breakout): support di 104, tidak ada level di atas 110.
  const bars = Array.from({ length: 60 }, (_, i) => ({
    time: Date.UTC(2026, 0, 5) + i * 3600e3, open: 103, high: 104.5, low: i % 10 === 5 ? 104 : 103.5, close: 104, volume: 1
  }));
  const r = computeSnrZones({ indicators: { lastClose: 104.6, atr14: 0.8, bollinger: {} }, dailyBars: [], bars, signal: { signal: "BUY" } });
  const p = r.potential;
  assert.equal(p?.type, "BUY_ZONE");
  assert.equal(p.tpProjected, true);
  const risk = p.entry - p.stopLoss;
  assert.ok(Math.abs(p.takeProfit[0] - (p.entry + PROJECTED_RR * risk)) < 1e-9);
  assert.equal(p.riskRewardRatio, PROJECTED_RR);
  assert.match(p.reason, /proyeksi/);
});

// ---------- keyakinan ----------
const ind = { lastClose: 100, ema20: 101, ema50: 100, sma200: 99, rsi14: 55, macd: { histogram: 0.2 },
  bollinger: { pb: 0.5 }, adx14: 40, plusDI: 30, minusDI: 10, atr14: 1, volume: { available: true, aboveAvg: true, ratio: 1.6 } };

test("keyakinan dibatasi maksimal 90%", () => {
  const a = buildTechnicalAnalysis({ indicators: ind, dailyBars: [], bars: [],
    signal: { signal: "BUY", bullishCount: 8, bearishCount: 0, confidence: 100 },
    multiTimeframe: summarizeTimeframeSignals("BUY", [{ interval: "4h", signal: "BUY" }, { interval: "1d", signal: "BUY" }]) });
  assert.equal(a.overallConfidence, MAX_CONFIDENCE);
  assert.equal(a.weakSignal, false);
});

test("sinyal SELL dengan banyak faktor berlawanan ditandai lemah", () => {
  const ranging = { ...ind, adx14: 15, plusDI: 14, minusDI: 16, volume: { available: true, thin: true, ratio: 0.4 } };
  const a = buildTechnicalAnalysis({ indicators: ranging, dailyBars: [], bars: [],
    signal: { signal: "SELL", bullishCount: 1.5, bearishCount: 5.5, confidence: 79 },
    multiTimeframe: summarizeTimeframeSignals("SELL", [{ interval: "1d", signal: "BUY" }]) });
  assert.ok(a.overallConfidence < WEAK_CONFIDENCE, `got ${a.overallConfidence}`);
  assert.equal(a.weakSignal, true);
  assert.match(a.conclusion, /SELL LEMAH/);
});

test("fundamental tidak mengubah angka keyakinan (hanya konteks)", () => {
  const base = { indicators: ind, dailyBars: [], bars: [], signal: { signal: "BUY", bullishCount: 6, bearishCount: 1, confidence: 70 } };
  const noFund = buildTechnicalAnalysis(base);
  const conflict = buildTechnicalAnalysis({ ...base, fundamental: { kind: "forex", bias: { available: true, direction: "bearish", summary: "x" } } });
  assert.equal(conflict.overallConfidence, noFund.overallConfidence);
  assert.equal(conflict.fundamental.align, "conflict");
});

// ---------- kalender paralel ----------
test("kalender: kedua sumber jalan bersamaan; FF gagal -> biquote langsung dipakai", async () => {
  const t0 = Date.now();
  const started = [];
  const out = await fetchCalendarEvents({
    ff: () => { started.push("ff"); return new Promise((_, rej) => setTimeout(() => rej(new Error("429")), 60)); },
    bq: () => { started.push("bq"); return new Promise(res => setTimeout(() => res([{ title: "NFP" }]), 50)); }
  });
  assert.deepEqual(started, ["ff", "bq"]);
  assert.deepEqual(out, [{ title: "NFP" }]);
  assert.ok(Date.now() - t0 < 150, "tidak menunggu berurutan");
});

test("kalender: FF berhasil -> FF diutamakan; dua-duanya gagal -> error FF", async () => {
  assert.deepEqual(await fetchCalendarEvents({ ff: async () => ["ff"], bq: async () => ["bq"] }), ["ff"]);
  await assert.rejects(fetchCalendarEvents({ ff: async () => { throw new Error("FF 429"); }, bq: async () => { throw new Error("bq down"); } }), /FF 429/);
});
