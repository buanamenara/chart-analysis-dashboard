import { RSI, EMA, BollingerBands, ATR } from "technicalindicators";
import { normalizeForexSymbol, normalizeCryptoSymbolForYahoo, aggregateBars } from "./yahoo.js";
import { fetchWithTimeout } from "./http.js";

const YAHOO_HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
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
  // Coba query1, lalu query2 kalau kena rate-limit/5xx/timeout (data backtest besar).
  let r = null, lastErr;
  for (const host of YAHOO_HOSTS) {
    const url = `${host}/v8/finance/chart/${encodeURIComponent(ysym)}?interval=${cfg.i}&range=${cfg.r}`;
    try {
      const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" }, timeoutMs: 20000 });
      if (res.status === 429 || res.status >= 500) { lastErr = new Error(`Yahoo ${res.status}`); continue; }
      if (!res.ok) throw new Error(`Yahoo backtest data error: ${res.status}`);
      r = (await res.json())?.chart?.result?.[0];
      if (r?.timestamp) break;
      lastErr = new Error("Data historis kosong");
    } catch (e) { lastErr = e; }
  }
  if (!r?.timestamp) throw new Error(lastErr?.message || "Data historis tidak tersedia untuk instrumen/timeframe ini.");
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

// Supertrend (trend berbasis ATR) — metode modern pengganti EMA-cross.
function computeSupertrend(highs, lows, closes, atr, mult = 3) {
  const n = closes.length;
  const dir = new Array(n).fill(null);
  let upper = null, lower = null, prevDir = 1;
  for (let i = 0; i < n; i++) {
    if (atr[i] == null) continue;
    const hl2 = (highs[i] + lows[i]) / 2;
    const ub = hl2 + mult * atr[i], lb = hl2 - mult * atr[i];
    upper = (upper == null || ub < upper || closes[i - 1] > upper) ? ub : upper;
    lower = (lower == null || lb > lower || closes[i - 1] < lower) ? lb : lower;
    let d = prevDir;
    if (closes[i] > upper) d = 1;
    else if (closes[i] < lower) d = -1;
    dir[i] = d; prevDir = d;
  }
  return dir;
}

// Struktur pasar (SMC): swing high/low kausal + nilai swing terakhir di tiap bar.
function computeStructure(highs, lows, L = 2) {
  const n = highs.length;
  const lastSH = new Array(n).fill(null), lastSL = new Array(n).fill(null);
  let curSH = null, curSL = null;
  for (let i = 0; i < n; i++) {
    const k = i - L; // pivot dikonfirmasi L bar setelahnya (kausal, tanpa look-ahead)
    if (k >= L) {
      let isH = true, isL = true;
      for (let j = k - L; j <= k + L; j++) { if (j === k) continue; if (highs[j] >= highs[k]) isH = false; if (lows[j] <= lows[k]) isL = false; }
      if (isH) curSH = highs[k];
      if (isL) curSL = lows[k];
    }
    lastSH[i] = curSH; lastSL[i] = curSL;
  }
  return { lastSH, lastSL };
}

// Hitung seri indikator SEKALI (dipakai ulang lintas kombinasi saat optimasi).
function computeSeries(bars) {
  const c = bars.map(b => b.close), n = bars.length;
  const highs = bars.map(b => b.high), lows = bars.map(b => b.low);
  const rsi = align(RSI.calculate({ period: 14, values: c }), 14, n);
  const e20 = align(EMA.calculate({ period: 20, values: c }), 20, n);
  const e50 = align(EMA.calculate({ period: 50, values: c }), 50, n);
  const bb = BollingerBands.calculate({ period: 20, stdDev: 2, values: c });
  const bbU = align(bb.map(x => x.upper), 20, n), bbM = align(bb.map(x => x.middle), 20, n), bbL = align(bb.map(x => x.lower), 20, n);
  const atr = align(ATR.calculate({ period: 14, high: highs, low: lows, close: c }), 14, n);
  const st = computeSupertrend(highs, lows, c, atr, 3);
  const { lastSH, lastSL } = computeStructure(highs, lows, 2);
  // EMA200 = filter bias "higher-timeframe" (proksi tren besar).
  const e200 = align(EMA.calculate({ period: Math.min(200, n - 1), values: c }), Math.min(200, n - 1), n);
  // Fair Value Gap (imbalance 3-candle): bullish bila high[i-2] < low[i]; bearish sebaliknya.
  const fvgUp = new Array(n).fill(false), fvgDn = new Array(n).fill(false);
  for (let i = 2; i < n; i++) { if (highs[i - 2] < lows[i]) fvgUp[i] = true; if (lows[i - 2] > highs[i]) fvgDn[i] = true; }
  // "FVG aktif dalam 10 bar terakhir" sebagai konfirmasi momentum institusional.
  const fvgUpRecent = new Array(n).fill(false), fvgDnRecent = new Array(n).fill(false);
  for (let i = 0; i < n; i++) { for (let j = Math.max(0, i - 10); j <= i; j++) { if (fvgUp[j]) fvgUpRecent[i] = true; if (fvgDn[j]) fvgDnRecent[i] = true; } }
  return { c, highs, lows, rsi, e20, e50, bbU, bbM, bbL, atr, st, lastSH, lastSL, e200, fvgUpRecent, fvgDnRecent };
}

// Simulasi pada rentang bar [fromIdx, toIdx). Exit intrabar via high/low; cost per trade.
// Posisi yang masih terbuka di akhir rentang ditutup di bar terakhir (tak ada look-ahead).
function simulateRange(bars, S, openSignal, { slAtr, tpAtr, maxHold, costR }, fromIdx, toIdx) {
  const { c, highs, lows, rsi, e50, atr, bbM } = S;
  const trades = []; let pos = null;
  const start = Math.max(55, fromIdx);
  for (let i = start; i < toIdx; i++) {
    if (rsi[i] == null || e50[i] == null || atr[i] == null || bbM[i] == null) continue;
    if (pos) {
      const risk = Math.abs(pos.entry - pos.sl);
      let exit = null, r = null;
      if (pos.dir === 1) { if (lows[i] <= pos.sl) { r = -1; exit = 1; } else if (highs[i] >= pos.tp) { r = (pos.tp - pos.entry) / risk; exit = 1; } }
      else { if (highs[i] >= pos.sl) { r = -1; exit = 1; } else if (lows[i] <= pos.tp) { r = (pos.entry - pos.tp) / risk; exit = 1; } }
      if (exit == null && ((i - pos.bar) >= maxHold || i === toIdx - 1)) { exit = 1; r = pos.dir === 1 ? (c[i] - pos.entry) / risk : (pos.entry - c[i]) / risk; }
      if (exit) { trades.push({ r: r - costR }); pos = null; }
    }
    if (!pos && i < toIdx - 1) {
      const sig = openSignal(i, S, c);
      // Strategi bisa balikkan angka (dir) -> pakai exit ATR; atau objek {dir, sl, tp}
      // -> pakai exit berbasis struktur milik strategi itu (mis. SMC).
      const dir = typeof sig === "object" ? sig?.dir : sig;
      if (dir) {
        const a = atr[i];
        let sl, tp;
        if (typeof sig === "object" && sig.sl != null && sig.tp != null) { sl = sig.sl; tp = sig.tp; }
        else { sl = dir === 1 ? c[i] - slAtr * a : c[i] + slAtr * a; tp = dir === 1 ? c[i] + tpAtr * a : c[i] - tpAtr * a; }
        pos = { dir, entry: c[i], bar: i, sl, tp };
      }
    }
  }
  return buildMetrics(trades, bars.slice(0, toIdx), start);
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
  },
  // MODERN — Supertrend: masuk saat tren ATR berbalik (flip).
  supertrend: () => (i, S) => {
    if (S.st[i] == null || S.st[i - 1] == null) return 0;
    if (S.st[i] === 1 && S.st[i - 1] === -1) return 1;
    if (S.st[i] === -1 && S.st[i - 1] === 1) return -1;
    return 0;
  },
  // MODERN — Smart Money Concepts (ICT): liquidity sweep searah tren,
  // dengan EXIT BERBASIS STRUKTUR (SL di balik wick sweep, TP ke likuiditas lawan).
  smc: () => (i, S) => {
    if (S.st[i] == null || S.lastSL[i] == null || S.lastSH[i] == null || S.atr[i] == null) return 0;
    const buf = 0.2 * S.atr[i];
    const sweptLow = S.lows[i] < S.lastSL[i] && S.c[i] > S.lastSL[i];
    const sweptHigh = S.highs[i] > S.lastSH[i] && S.c[i] < S.lastSH[i];
    if (S.st[i] === 1 && sweptLow && S.lastSH[i] > S.c[i]) {
      return { dir: 1, sl: S.lows[i] - buf, tp: S.lastSH[i] }; // TP = sapu likuiditas di swing-high lawan
    }
    if (S.st[i] === -1 && sweptHigh && S.lastSL[i] < S.c[i]) {
      return { dir: -1, sl: S.highs[i] + buf, tp: S.lastSL[i] };
    }
    return 0;
  },
  // MODERN+ — SMC "Pro": liquidity sweep + FILTER BIAS HTF (EMA200) + konfirmasi
  // Fair Value Gap (imbalance). Lebih selektif -> lebih sedikit trade, harapannya
  // win rate lebih tinggi karsearah "uang besar" di tren besar.
  smcPro: () => (i, S) => {
    if (S.st[i] == null || S.lastSL[i] == null || S.lastSH[i] == null || S.atr[i] == null || S.e200[i] == null) return 0;
    const buf = 0.2 * S.atr[i];
    const htfUp = S.c[i] > S.e200[i], htfDn = S.c[i] < S.e200[i];
    const sweptLow = S.lows[i] < S.lastSL[i] && S.c[i] > S.lastSL[i];
    const sweptHigh = S.highs[i] > S.lastSH[i] && S.c[i] < S.lastSH[i];
    if (htfUp && sweptLow && S.fvgUpRecent[i] && S.lastSH[i] > S.c[i]) {
      return { dir: 1, sl: S.lows[i] - buf, tp: S.lastSH[i] };
    }
    if (htfDn && sweptHigh && S.fvgDnRecent[i] && S.lastSL[i] < S.c[i]) {
      return { dir: -1, sl: S.highs[i] + buf, tp: S.lastSL[i] };
    }
    return 0;
  }
};

const DISCLAIMER = "Backtest = simulasi masa lalu, BUKAN jaminan masa depan. Model exit sederhana; sudah memasukkan biaya per-trade (costR) tapi tidak menyertakan slippage ekstrem/gap. Sampel & periode terbatas pada data gratis Yahoo.";

export async function runBacktest({ assetType, symbol, interval = "15m", strategy = "trendPB", slAtr = 1.0, tpAtr = 1.5, rsiPullback = 45, maxHold = 12, costR = 0.1 }) {
  const bars = await fetchBacktestBars(assetType, symbol, interval);
  if (bars.length < 120) throw new Error(`Data terlalu sedikit (${bars.length} bar) untuk backtest di TF ini.`);
  const S = computeSeries(bars);
  const openSignal = (STRATEGIES[strategy] || STRATEGIES.trendPB)({ rsiPullback });
  const m = simulateRange(bars, S, openSignal, { slAtr, tpAtr, maxHold, costR }, 55, bars.length);
  return {
    symbol, assetType, interval, strategy,
    params: { slAtr, tpAtr, rsiPullback, maxHold, costR },
    barCount: bars.length,
    ...m,
    netPositive: m.totalR > 0,
    disclaimer: DISCLAIMER,
    dataNote: `Data ${bars.length} bar dari Yahoo Finance (interval ${interval}).`
  };
}

// Grid parameter (kecil tapi masuk akal; indikator dihitung sekali -> cepat).
const GRID = {
  slAtr: [0.8, 1.0, 1.2, 1.5],
  tpAtr: [1.0, 1.5, 2.0, 2.5],
  rsiPullback: [40, 45],
  maxHold: [10, 16]
};

// Optimasi dengan validasi in-sample (IS) / out-of-sample (OOS) untuk cegah curve-fitting.
// Optimasi HANYA di 70% data awal; pemenang diuji ulang di 30% data terakhir yang belum dilihat.
export async function optimizeBacktest({ assetType, symbol, interval = "15m", strategy = "trendPB", costR = 0.1, minTrades = 20 }) {
  const bars = await fetchBacktestBars(assetType, symbol, interval);
  if (bars.length < 300) throw new Error(`Data terlalu sedikit (${bars.length} bar) untuk optimasi dengan validasi.`);
  const S = computeSeries(bars);
  const split = Math.floor(bars.length * 0.7);

  const results = [];
  for (const slAtr of GRID.slAtr) for (const tpAtr of GRID.tpAtr) for (const rsiPullback of GRID.rsiPullback) for (const maxHold of GRID.maxHold) {
    const openSignal = (STRATEGIES[strategy] || STRATEGIES.trendPB)({ rsiPullback });
    const is = simulateRange(bars, S, openSignal, { slAtr, tpAtr, maxHold, costR }, 55, split);
    if (is.trades < minTrades) continue; // butuh sampel cukup agar bermakna
    results.push({ params: { slAtr, tpAtr, rsiPullback, maxHold }, is });
  }
  if (!results.length) throw new Error("Tidak ada kombinasi dengan jumlah trade cukup — coba TF lebih kecil.");

  // Ranking IS: utamakan ekspektansi positif & profit factor, bukan cuma totalR.
  results.sort((a, b) => (b.is.totalR - a.is.totalR) || (b.is.profitFactor - a.is.profitFactor));
  const top = results.slice(0, 8);

  // Uji setiap kandidat teratas di OOS (data yang belum dilihat saat optimasi).
  for (const cand of top) {
    const openSignal = (STRATEGIES[strategy] || STRATEGIES.trendPB)({ rsiPullback: cand.params.rsiPullback });
    cand.oos = simulateRange(bars, S, openSignal, { ...cand.params, costR }, split, bars.length);
    // "robust" bila OOS tetap net-profit & win rate tidak ambruk jauh.
    cand.robust = cand.oos.totalR > 0 && cand.oos.winRate >= Math.max(40, cand.is.winRate - 20);
  }
  // Rekomendasi: kandidat teratas yang LOLOS OOS; kalau tak ada, tandai tak ada yang robust.
  const recommended = top.find(c => c.robust) || null;

  return {
    symbol, assetType, interval, strategy, costR,
    barCount: bars.length,
    combosTested: results.length,
    splitInfo: {
      isFrom: new Date(bars[55].time).toISOString().slice(0, 10),
      isTo: new Date(bars[split - 1].time).toISOString().slice(0, 10),
      oosFrom: new Date(bars[split].time).toISOString().slice(0, 10),
      oosTo: new Date(bars.at(-1).time).toISOString().slice(0, 10)
    },
    top: top.map(c => ({
      params: c.params,
      is: { trades: c.is.trades, winRate: c.is.winRate, profitFactor: c.is.profitFactor, totalR: c.is.totalR, maxDrawdownR: c.is.maxDrawdownR },
      oos: { trades: c.oos.trades, winRate: c.oos.winRate, profitFactor: c.oos.profitFactor, totalR: c.oos.totalR, maxDrawdownR: c.oos.maxDrawdownR },
      robust: c.robust
    })),
    recommended: recommended ? { params: recommended.params, is: recommended.is.totalR, oos: recommended.oos.totalR } : null,
    disclaimer: DISCLAIMER + " Optimasi rawan over-fit: angka IS selalu terlihat bagus; yang penting kolom OOS (data belum dilihat). Settingan 'robust' = tetap profit di OOS."
  };
}
