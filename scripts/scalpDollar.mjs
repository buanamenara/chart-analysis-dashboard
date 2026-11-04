// Backtest scalping dengan target DOLAR tetap pada lot 0.01 (gaya trading pengguna):
//   XAUUSD 0.01 lot = 1 oz   -> gerak harga $1  = $1 untung/rugi
//   BTCUSD 0.01 lot = 0.01 BTC -> gerak harga $100 = $1 untung/rugi
// TP $5 / $10 dengan RR 1:2 (SL $2.5 / $5). Sinyal dari candle 5m/15m TERTUTUP, masuk di
// OPEN candle berikutnya, exit dicek per candle 1m (lebih akurat untuk SL/TP kecil).
// Candle 1m yang kena SL & TP sekaligus = SL (konservatif). Satu posisi per waktu.
// Biaya (spread) per trade di lot 0.01: emas $0.30, BTC $0.20 (asumsi broker umum).
// Data Binance: PAXGUSDT sebagai proksi XAUUSD, BTCUSDT untuk BTC. 50% awal = in-sample,
// 50% akhir = out-of-sample. Pemakaian: node scripts/scalpDollar.mjs [hari=180]
import { computeSeries } from "../lib/backtest.js";
import { fetchWithTimeout } from "../lib/http.js";
import { aggregateAligned, INTERVAL_MS } from "../lib/bars.js";

const DAYS = Number(process.argv[2]) || 180;
const MAX_HOLD_MIN = 720; // posisi ditutup paksa setelah 12 jam

const INSTR = {
  XAU: { symbol: "PAXGUSDT", perDollar: 1, spread: 0.30, label: "XAUUSD (proksi PAXG)" },     // P/L$ = gerak harga x 1
  BTC: { symbol: "BTCUSDT", perDollar: 0.01, spread: 0.20, label: "BTCUSD" }                  // P/L$ = gerak harga x 0.01
};
const TARGETS = [{ tp: 5, sl: 2.5 }, { tp: 10, sl: 5 }];

async function klines1m(symbol, days) {
  const out = [];
  let start = Date.now() - days * 86400e3;
  for (let g = 0; g < 2000; g++) {
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${start}&limit=1000`;
    let rows = null;
    for (let a = 0; a < 4 && !rows; a++) {
      try { const r = await fetchWithTimeout(url, { timeoutMs: 20000 }); if (r.ok) rows = await r.json(); } catch {}
    }
    if (!rows) throw new Error(`Binance ${symbol} gagal`);
    if (!rows.length) break;
    for (const k of rows) out.push({ time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] });
    start = rows.at(-1)[0] + 1;
    if (rows.length < 1000) break;
  }
  while (out.length && out.at(-1).time + 60e3 > Date.now()) out.pop();
  return out;
}

const STRATS = {
  "Trend pullback (EMA20/50 + RSI)": (i, S) => {
    const up = S.e20[i] > S.e50[i] && S.c[i] > S.e200[i], dn = S.e20[i] < S.e50[i] && S.c[i] < S.e200[i];
    if (up && S.rsi[i - 1] < 40 && S.rsi[i] >= 40) return 1;
    if (dn && S.rsi[i - 1] > 60 && S.rsi[i] <= 60) return -1;
    return 0;
  },
  "Supertrend flip + EMA200": (i, S) => {
    if (S.st[i] == null || S.st[i - 1] == null) return 0;
    if (S.st[i] === 1 && S.st[i - 1] === -1 && S.c[i] > S.e200[i]) return 1;
    if (S.st[i] === -1 && S.st[i - 1] === 1 && S.c[i] < S.e200[i]) return -1;
    return 0;
  },
  "Liquidity sweep (SMC) + EMA200": (i, S) => {
    if (S.lastSL[i] == null || S.lastSH[i] == null) return 0;
    if (S.c[i] > S.e200[i] && S.lows[i] < S.lastSL[i] && S.c[i] > S.lastSL[i]) return 1;
    if (S.c[i] < S.e200[i] && S.highs[i] > S.lastSH[i] && S.c[i] < S.lastSH[i]) return -1;
    return 0;
  },
  "Breakout 20 candle + tren": (i, S) => {
    let hh = -Infinity, ll = Infinity;
    for (let k = i - 20; k < i; k++) { hh = Math.max(hh, S.highs[k]); ll = Math.min(ll, S.lows[k]); }
    if (S.c[i] > hh && S.e20[i] > S.e50[i] && S.c[i] > S.e200[i]) return 1;
    if (S.c[i] < ll && S.e20[i] < S.e50[i] && S.c[i] < S.e200[i]) return -1;
    return 0;
  },
  "Pantulan Bollinger + RSI (mean-rev)": (i, S) => {
    if (S.c[i] < S.bbL[i] && S.rsi[i] < 25) return 1;
    if (S.c[i] > S.bbU[i] && S.rsi[i] > 75) return -1;
    return 0;
  }
};

// Pseudo-random deterministik untuk baseline "entry acak".
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

function simulate({ m1, idx1m, bars, S, strat, ins, tp, sl, from, to, random }) {
  const tpPx = tp / ins.perDollar, slPx = sl / ins.perDollar; // jarak harga
  const trades = [];
  let busyUntil = -Infinity;
  for (let i = Math.max(210, from); i < to - 1; i++) {
    if (bars[i + 1].time < busyUntil) continue;
    if (S.e200[i] == null || S.rsi[i] == null || S.rsi[i - 1] == null) continue;
    const dir = random ? (rnd() < 0.15 ? (rnd() < 0.5 ? 1 : -1) : 0) : strat(i, S);
    if (!dir) continue;
    const k0 = idx1m.get(bars[i + 1].time);
    if (k0 == null) continue;
    const entry = m1[k0].open;
    const slLvl = entry - dir * slPx, tpLvl = entry + dir * tpPx;
    let pnl = null, k = k0;
    for (; k < Math.min(m1.length, k0 + MAX_HOLD_MIN); k++) {
      const b = m1[k];
      if (dir > 0 ? b.low <= slLvl : b.high >= slLvl) { pnl = -sl; break; }
      if (dir > 0 ? b.high >= tpLvl : b.low <= tpLvl) { pnl = tp; break; }
    }
    if (pnl == null) { k = Math.min(m1.length - 1, k); pnl = dir * (m1[k].close - entry) * ins.perDollar; }
    trades.push({ pnl: pnl - ins.spread, win: pnl > 0, t: bars[i].time, mins: k - k0 + 1 });
    busyUntil = m1[k].time + 60e3;
  }
  return trades;
}

function stat(t, days) {
  if (!t.length) return { n: 0 };
  let eq = 0, peak = 0, dd = 0, ls = 0, maxLs = 0;
  for (const x of t) { eq += x.pnl; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); ls = x.pnl <= 0 ? ls + 1 : 0; maxLs = Math.max(maxLs, ls); }
  return {
    n: t.length, perDay: +(t.length / days).toFixed(1),
    win: +(t.filter(x => x.win).length / t.length * 100).toFixed(1),
    avg: +(eq / t.length).toFixed(2), total: +eq.toFixed(0), dd: +dd.toFixed(0), lossStreak: maxLs,
    mins: Math.round(t.reduce((s, x) => s + x.mins, 0) / t.length)
  };
}
const fmt = s => s.n ? `n=${String(s.n).padStart(4)} (${String(s.perDay).padStart(4)}/hari) win=${String(s.win).padStart(5)}% rata2=$${String(s.avg).padStart(6)}/trade total=$${String(s.total).padStart(6)} DD=$${String(s.dd).padStart(4)} kalah-beruntun=${String(s.lossStreak).padStart(2)} tahan~${s.mins}mnt` : "n=0";

const passed = [];
for (const [key, ins] of Object.entries(INSTR)) {
  console.error(`Mengambil ${ins.symbol} 1m ${DAYS} hari...`);
  const m1 = await klines1m(ins.symbol, DAYS);
  const idx1m = new Map(m1.map((b, i) => [b.time, i]));
  const days = (m1.at(-1).time - m1[0].time) / 86400e3;
  for (const tf of ["5m", "15m"]) {
    const bars = aggregateAligned(m1, INTERVAL_MS[tf]);
    const S = computeSeries(bars);
    const split = Math.floor(bars.length / 2);
    const half = days / 2;
    console.log(`\n==================== ${ins.label} sinyal ${tf} | ${new Date(m1[0].time).toISOString().slice(0, 10)}..${new Date(m1.at(-1).time).toISOString().slice(0, 10)} | IS s/d ${new Date(bars[split].time).toISOString().slice(0, 10)} | spread $${ins.spread}/trade ====================`);
    for (const { tp, sl } of TARGETS) {
      const be = ((sl + ins.spread) / (sl + tp) * 100).toFixed(1);
      console.log(`  --- TP $${tp} / SL $${sl} (RR 1:2) | win rate impas setelah spread = ${be}% ---`);
      const rows = [["ENTRY ACAK (pembanding)", null, true], ...Object.entries(STRATS).map(([n, f]) => [n, f, false])];
      for (const [name, strat, random] of rows) {
        seed = 7;
        const is = stat(simulate({ m1, idx1m, bars, S, strat, ins, tp, sl, from: 0, to: split, random }), half);
        seed = 7;
        const oos = stat(simulate({ m1, idx1m, bars, S, strat, ins, tp, sl, from: split, to: bars.length, random }), half);
        const ok = !random && is.n >= 30 && oos.n >= 30 && is.avg > 0 && oos.avg > 0;
        if (ok) passed.push({ k: `${ins.label} ${tf} TP$${tp}/SL$${sl}`, name, is, oos });
        console.log(`    ${name}`);
        console.log(`       IS  ${fmt(is)}`);
        console.log(`       OOS ${fmt(oos)}${random ? "" : ok ? "  <= LOLOS" : "  <= gagal"}`);
      }
    }
  }
}

console.log("\n==================== LOLOS: profit setelah spread di in-sample DAN out-of-sample ====================");
if (!passed.length) console.log("  Tidak ada.");
for (const p of passed) console.log(`  ${p.k} | ${p.name}\n     IS  ${fmt(p.is)}\n     OOS ${fmt(p.oos)}`);
