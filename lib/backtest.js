import { RSI, EMA, BollingerBands, ATR } from "technicalindicators";
import { normalizeForexSymbol, normalizeCryptoSymbolForYahoo, aggregateBars } from "./yahoo.js";
import { fetchWithTimeout } from "./http.js";

const YBASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Range PANJANG agar backtest punya banyak data (Yahoo: 60m s/d 2 tahun, 15m s/d 60 hari).
const BT_RANGE = {
  "1m": { i: "1m", r: "7d" }, "5m": { i: "5m", r: "60d" }, "15m": { i: "15m", r: "60d" },
  "30m": { i: "30m", r: "60d" }, "1h": { i: "60m", r: "2y" }, "60m": { i: "60m", r: "2y" },
  "4h": { i: "60m", r: "2y", agg: 4 }, "1d": { i: "1d", r: "5y" }, "1wk": { i: "1wk", r: "10y" }
};

function resolveSymbol(assetType, symbol) {
  if (assetType === "crypto") return normalizeCryptoSymbolForYahoo(symbol);
  if (assetType === "forex") return normalizeForexSymbol(symbol);
  return symbol;
}

export async function fetchBacktestBars(assetType, symbol, interval) {
  const cfg = BT_RANGE[interval] || BT_RANGE["1h"];
  const ysym = resolveSymbol(assetType, symbol);
  const url = `${YBASE}/${encodeURIComponent(ysym)}?interval=${cfg.i}&range=${cfg.r}`;
  const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Yahoo backtest data error: ${res.status}`);
  const r = (await res.json())?.chart?.result?.[0];
  if (!r?.timestamp) throw new Error("Data historis tidak tersedia untuk instrumen/timeframe ini.");
  const q = r.indicators.quote[0];
  let bars = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    if (q.close[i] == null) continue;
    bars.push({ time: r.timestamp[i] * 1000, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] || 0 });
  }
  if (cfg.agg) bars = aggregateBars(bars, cfg.agg);
  return bars;
}

const align = (series, period, n) => { const out = new Array(n).fill(null); for (let i = 0; i < series.length; i++) out[i + period - 1] = series[i]; return out; };

function buildMetrics(trades, bars, startIdx) {
  const n = trades.length;
  const wins = trades.filter(t => t.r > 0).length;
  const gW = trades.filter(t => t.r > 0).reduce((s, t) => s + t.r, 0);
  const gL = Math.abs(trades.filter(t => t.r <= 0).reduce((s, t) => s + t.r, 0));
  const totalR = trades.reduce((s, t) => s + t.r, 0);
  let peak = 0, eq = 0, maxDD = 0;
  const equity = [];
  for (const t of trades) { eq += t.r; equity.push(+eq.toFixed(2)); if (eq > peak) peak = eq; if (peak - eq > maxDD) maxDD = peak - eq; }
  const days = bars.length > startIdx ? Math.round((bars.at(-1).time - bars[startIdx].time) / 86400000) : 0;
  return {
    trades: n,
    winRate: n ? Math.round((wins / n) * 100) : 0,
    avgR: n ? +(totalR / n).toFixed(3) : 0,
    totalR: +totalR.toFixed(2),
    profitFactor: gL > 0 ? +(gW / gL).toFixed(2) : (gW > 0 ? 99 : 0),
    maxDrawdownR: +maxDD.toFixed(2),
    expectancyR: n ? +(totalR / n).toFixed(3) : 0,
    periodDays: days,
    tradesPerMonth: days > 0 ? +(n / (days / 30)).toFixed(1) : 0,
    equityCurve: equity,
    fromDate: bars[startIdx] ? new Date(bars[startIdx].time).toISOString().slice(0, 10) : null,
    toDate: bars.at(-1) ? new Date(bars.at(-1).time).toISOString().slice(0, 10) : null
  };
}

// Jalankan satu strategi (exit intrabar via high/low; cost dikurangi per trade).
function simulate(bars, openSignal, { slAtrDefault, tpAtrDefault, maxHold, costR }) {
  const c = bars.map(b => b.close), n = bars.length;
  const highs = bars.map(b => b.high), lows = bars.map(b => b.low);
  const rsi = align(RSI.calculate({ period: 14, values: c }), 14, n);
  const e20 = align(EMA.calculate({ period: 20, values: c }), 20, n);
  const e50 = align(EMA.calculate({ period: 50, values: c }), 50, n);
  const bb = BollingerBands.calculate({ period: 20, stdDev: 2, values: c });
  const bbU = align(bb.map(x => x.upper), 20, n), bbM = align(bb.map(x => x.middle), 20, n), bbL = align(bb.map(x => x.lower), 20, n);
  const atr = align(ATR.calculate({ period: 14, high: highs, low: lows, close: c }), 14, n);

  const trades = []; let pos = null;
  const startIdx = 55;
  const S = { rsi, e20, e50, bbU, bbM, bbL, atr };
  for (let i = startIdx; i < n; i++) {
    if (rsi[i] == null || e50[i] == null || atr[i] == null || bbM[i] == null) continue;
    if (pos) {
      const risk = Math.abs(pos.entry - pos.sl);
      let exit = null, r = null;
      if (pos.dir === 1) { if (lows[i] <= pos.sl) { r = -1; exit = 1; } else if (highs[i] >= pos.tp) { r = (pos.tp - pos.entry) / risk; exit = 1; } }
      else { if (highs[i] >= pos.sl) { r = -1; exit = 1; } else if (lows[i] <= pos.tp) { r = (pos.entry - pos.tp) / risk; exit = 1; } }
      if (exit == null && (i - pos.bar) >= maxHold) { exit = 1; r = pos.dir === 1 ? (c[i] - pos.entry) / risk : (pos.entry - c[i]) / risk; }
      if (exit) { trades.push({ r: r - costR }); pos = null; }
    }
    if (!pos) {
      const sig = openSignal(i, S, c);
      if (sig) {
        const a = atr[i];
        pos = {
          dir: sig, entry: c[i], bar: i,
          sl: sig === 1 ? c[i] - slAtrDefault * a : c[i] + slAtrDefault * a,
          tp: sig === 1 ? c[i] + tpAtrDefault * a : c[i] - tpAtrDefault * a
        };
      }
    }
  }
  return buildMetrics(trades, bars, startIdx);
}

// --- Strategi ---
const STRATEGIES = {
  // Default scalping: searah tren (EMA20/50), masuk saat RSI balik dari pullback.
  trendPB: (p) => (i, S) => {
    const up = S.e20[i] > S.e50[i], dn = S.e20[i] < S.e50[i];
    const lo = p.rsiPullback ?? 45, hi = 100 - lo;
    if (up && S.rsi[i - 1] < lo && S.rsi[i] >= lo) return 1;
    if (dn && S.rsi[i - 1] > hi && S.rsi[i] <= hi) return -1;
    return 0;
  },
  // Trend-cross klasik (lebih sedikit trade).
  trendCross: () => (i, S) => {
    if (S.e20[i] > S.e50[i] && S.e20[i - 1] <= S.e50[i - 1]) return 1;
    if (S.e20[i] < S.e50[i] && S.e20[i - 1] >= S.e50[i - 1]) return -1;
    return 0;
  },
  // Mean-reversion (untuk pembanding; biasanya buruk di pasar trending).
  meanRev: (p) => (i, S, c) => {
    const lo = p.rsiPullback ?? 35, hi = 100 - lo;
    if (S.rsi[i] < lo && c[i] <= S.bbL[i]) return 1;
    if (S.rsi[i] > hi && c[i] >= S.bbU[i]) return -1;
    return 0;
  }
};

export async function runBacktest({ assetType, symbol, interval = "15m", strategy = "trendPB", slAtr = 1.0, tpAtr = 1.5, rsiPullback = 45, maxHold = 12, costR = 0.1 }) {
  const bars = await fetchBacktestBars(assetType, symbol, interval);
  if (bars.length < 120) throw new Error(`Data terlalu sedikit (${bars.length} bar) untuk backtest di TF ini.`);
  const factory = STRATEGIES[strategy] || STRATEGIES.trendPB;
  const openSignal = factory({ rsiPullback });
  const m = simulate(bars, openSignal, { slAtrDefault: slAtr, tpAtrDefault: tpAtr, maxHold, costR });
  return {
    symbol, assetType, interval, strategy,
    params: { slAtr, tpAtr, rsiPullback, maxHold, costR },
    barCount: bars.length,
    ...m,
    netPositive: m.totalR > 0,
    disclaimer: "Backtest = simulasi masa lalu, BUKAN jaminan masa depan. Model exit sederhana; sudah memasukkan biaya per-trade (costR) tapi tidak menyertakan slippage ekstrem/gap. Sampel & periode terbatas pada data gratis Yahoo.",
    dataNote: `Data ${bars.length} bar dari Yahoo Finance (interval ${interval}).`
  };
}
