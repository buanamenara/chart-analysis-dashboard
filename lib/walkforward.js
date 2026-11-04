// Uji walk-forward pipeline analisa (sinyal rule-based + setup SNR) pada data historis.
// Di setiap candle i analisa hanya melihat data s/d candle i (tanpa look-ahead), lalu
// setup yang ditawarkan disimulasikan sebagai limit order dengan biaya per trade.
// Dipakai oleh scripts/walkforward.mjs (laporan) & scripts/buildSetupStats.mjs (statistik
// yang ditampilkan di dashboard sebagai pengganti angka "keyakinan").
import { aggregateAligned, INTERVAL_MS } from "./bars.js";
import { computeIndicators } from "./indicators.js";
import { generateRuleBasedSignal } from "./ruleSignal.js";
import { computeSnrZones } from "./snr.js";

export const WF_DEFAULTS = {
  window: 250,    // jumlah candle yang dianalisa per langkah (mendekati data live)
  fillBars: 6,    // limit order kedaluwarsa setelah N candle
  maxHold: 40,    // posisi ditutup paksa setelah N candle
  costR: 0.05,    // biaya spread/komisi per trade (dalam R)
  horizon: 12     // horizon akurasi arah sinyal (candle)
};

// Simulasi satu setup mulai candle setelah i. Candle yang menyentuh SL & TP sekaligus
// dihitung SL (konservatif). Target tercapai sebelum order terisi = peluang hilang.
export function simulateSetup(bars, i, p, { fillBars, maxHold, costR } = WF_DEFAULTS) {
  const dir = p.type === "BUY_ZONE" ? 1 : -1;
  const tp = p.takeProfit?.[0];
  const risk = Math.abs(p.entry - p.stopLoss);
  if (!(risk > 0) || tp == null) return null;
  let fill = -1;
  for (let k = i + 1; k <= Math.min(bars.length - 1, i + fillBars); k++) {
    const b = bars[k];
    if (dir > 0 ? b.low <= p.entry : b.high >= p.entry) { fill = k; break; }
    if (dir > 0 ? b.high >= tp : b.low <= tp) return { filled: false };
  }
  if (fill < 0) return { filled: false };
  for (let k = fill; k <= Math.min(bars.length - 1, fill + maxHold); k++) {
    const b = bars[k];
    if (dir > 0 ? b.low <= p.stopLoss : b.high >= p.stopLoss) return { filled: true, r: -1 - costR };
    if (k > fill && (dir > 0 ? b.high >= tp : b.low <= tp)) return { filled: true, r: Math.abs(tp - p.entry) / risk - costR };
  }
  const last = bars[Math.min(bars.length - 1, fill + maxHold)].close;
  return { filled: true, r: (dir * (last - p.entry)) / risk - costR, timeout: true };
}

export function summarizeTrades(trades) {
  const n = trades.length;
  if (!n) return { n: 0 };
  const wins = trades.filter(t => t.r > 0).length;
  const total = trades.reduce((s, t) => s + t.r, 0);
  const gw = trades.filter(t => t.r > 0).reduce((s, t) => s + t.r, 0);
  const gl = -trades.filter(t => t.r <= 0).reduce((s, t) => s + t.r, 0);
  return { n, winRate: Math.round((wins / n) * 100), expR: +(total / n).toFixed(3), totalR: +total.toFixed(1), pf: gl > 0 ? +(gw / gl).toFixed(2) : null };
}

export function summarizeSignals(rows) {
  if (!rows.length) return { n: 0 };
  return {
    n: rows.length,
    hitRate: Math.round((rows.filter(s => s.fwdAtr > 0).length / rows.length) * 100),
    avgAtr: +(rows.reduce((a, s) => a + s.fwdAtr, 0) / rows.length).toFixed(3)
  };
}

// bars: candle historis timeframe yang diuji (urut naik). Candle harian diturunkan dari
// bars itu sendiri (UTC); untuk TF harian/mingguan diturunkan apa adanya.
export function walkForward(bars, opts = {}) {
  const o = { ...WF_DEFAULTS, ...opts };
  const daily = aggregateAligned(bars, INTERVAL_MS["1d"]);
  const setups = [], signals = [];
  let di = 0, lastSetupBar = -Infinity;

  for (let i = o.window; i < bars.length - 1; i++) {
    while (di < daily.length && daily[di].time <= bars[i].time) di++;
    const dailyBars = daily.slice(Math.max(0, di - 260), di);
    const win = bars.slice(i - o.window + 1, i + 1);
    const indicators = computeIndicators(win);
    if (indicators.insufficientData) continue;
    const signal = generateRuleBasedSignal({ indicators, dailyBars, bars: win });

    if (signal.signal !== "NETRAL" && i + o.horizon < bars.length && indicators.atr14 > 0) {
      const dir = signal.signal === "BUY" ? 1 : -1;
      signals.push({ fwdAtr: (dir * (bars[i + o.horizon].close - bars[i].close)) / indicators.atr14 });
    }

    // Satu setup per kejadian: setup beruntun di candle berdekatan tidak dihitung ulang.
    if (i - lastSetupBar <= o.fillBars) continue;
    const { potential: p } = computeSnrZones({ indicators, dailyBars, bars: win, signal });
    if (!p) continue;
    const res = simulateSetup(bars, i, p, o);
    if (!res) continue;
    lastSetupBar = i;
    setups.push({ ...res, aligned: signal.signal !== "NETRAL" });
  }

  const filled = setups.filter(s => s.filled);
  return {
    bars: bars.length,
    from: bars[o.window] ? new Date(bars[o.window].time).toISOString().slice(0, 10) : null,
    to: bars.length ? new Date(bars.at(-1).time).toISOString().slice(0, 10) : null,
    setupsOffered: setups.length,
    fillRate: setups.length ? Math.round((filled.length / setups.length) * 100) : 0,
    setups: summarizeTrades(filled),
    setupsAligned: summarizeTrades(filled.filter(s => s.aligned)),
    setupsNeutral: summarizeTrades(filled.filter(s => !s.aligned)),
    signals: summarizeSignals(signals)
  };
}
