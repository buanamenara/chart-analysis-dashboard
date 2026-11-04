import { fmtPrice } from "./format.js";
import { computeDailyLevels, computePivotPoints, findSwingPoints, nearestKeyLevel, volumeProfile, anchoredVwap, marketStructure, openingRange } from "./levels.js";

// Kategori sumber level. Kekuatan zona = jumlah KATEGORI berbeda (bukan jumlah label),
// supaya level yang saling turunan (POC+VAH+VAL, VWAP+band) tidak menggelembungkan skor.
// Level yang ikut bergerak tiap candle (Bollinger, band VWAP) & angka bulat dihitung 0.5.
const CATEGORY_WEIGHT = { swing: 1, daily: 1, pivot: 1, volume: 1, orb: 1, vwap: 0.5, bollinger: 0.5, round: 0.5 };

export function categoryOf(label) {
  if (label.startsWith("Swing")) return "swing";
  if (label.startsWith("PD")) return "daily";
  if (label.startsWith("Pivot")) return "pivot";
  if (/^(POC|VAH|VAL)/.test(label)) return "volume";
  if (label.startsWith("VWAP")) return "vwap";
  if (label.startsWith("Bollinger")) return "bollinger";
  if (label.startsWith("OR ")) return "orb";
  return "round";
}

// Clustering berbasis toleransi HARGA (dari ATR timeframe ini). Lebar zona dibatasi
// 2x toleransi supaya level tidak "berantai" jadi satu zona raksasa.
export function clusterLevels(candidates, price, tolerance) {
  const sorted = [...candidates].filter(c => Number.isFinite(c.price)).sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const c of sorted) {
    const last = clusters.at(-1);
    if (last && c.price - last.high <= tolerance && c.price - last.low <= 2 * tolerance) {
      last.levels.push(c);
      last.high = c.price;
    } else {
      clusters.push({ low: c.price, high: c.price, levels: [c] });
    }
  }
  return clusters.map(cl => {
    const cats = [...new Set(cl.levels.map(l => categoryOf(l.label)))];
    const mid = (cl.low + cl.high) / 2;
    return {
      low: cl.low,
      high: cl.high,
      mid,
      strength: cats.reduce((sum, k) => sum + CATEGORY_WEIGHT[k], 0),
      sources: cl.levels.map(l => l.label),
      type: mid >= price ? "resistance" : "support"
    };
  });
}

export const MIN_RR = 1.5;
export const PROJECTED_RR = 2;

// Pilih TP: level pertama yang memberi R:R >= MIN_RR; kalau tidak ada, level dengan R:R
// terbaik. TP2 = level berikutnya setelah TP1.
export function pickTargets(entry, stopLoss, levels, dir) {
  const risk = Math.abs(entry - stopLoss);
  const cands = levels
    .map(z => z.mid)
    .filter(p => (dir > 0 ? p > entry : p < entry))
    .sort((a, b) => (dir > 0 ? a - b : b - a));
  if (!cands.length || !(risk > 0)) return { takeProfit: [], rr: null };
  const rrOf = p => Math.abs(p - entry) / risk;
  let idx = cands.findIndex(p => rrOf(p) >= MIN_RR);
  if (idx < 0) idx = cands.reduce((best, p, i) => (rrOf(p) > rrOf(cands[best]) ? i : best), 0);
  const takeProfit = [cands[idx], cands[idx + 1]].filter(p => p != null);
  return { takeProfit, rr: +rrOf(cands[idx]).toFixed(2) };
}

const rrQualityOf = rr => (rr == null ? null : rr >= 2 ? "baik" : rr >= 1.2 ? "cukup" : rr >= 1 ? "marginal" : "buruk");

export function computeSnrZones({ indicators, dailyBars, bars, signal }) {
  const pivotLevels = computePivotPoints(dailyBars);
  if (indicators.insufficientData) return { zones: [], potential: null, pivotLevels };

  const price = indicators.lastClose;
  const candidates = [];

  const daily = computeDailyLevels(dailyBars);
  if (daily) {
    candidates.push({ price: daily.prevDayHigh, label: "PDH (Previous Day High)" });
    candidates.push({ price: daily.prevDayLow, label: "PDL (Previous Day Low)" });
  }

  if (pivotLevels) {
    for (const [name, level] of Object.entries(pivotLevels)) {
      candidates.push({ price: level, label: `Pivot ${name.toUpperCase()}` });
    }
  }

  const swing = findSwingPoints(bars);
  swing.swingHighs.slice(-5).forEach(s => candidates.push({ price: s.price, label: "Swing High" }));
  swing.swingLows.slice(-5).forEach(s => candidates.push({ price: s.price, label: "Swing Low" }));

  if (indicators.bollinger?.upper) candidates.push({ price: indicators.bollinger.upper, label: "Bollinger Upper" });
  if (indicators.bollinger?.lower) candidates.push({ price: indicators.bollinger.lower, label: "Bollinger Lower" });

  const key = nearestKeyLevel(price);
  if (key) candidates.push({ price: key.level, label: "Key Level (psikologis)" });

  // Volume Profile (POC/VAH/VAL) & VWAP — level berbasis volume/harga rata-rata.
  const vp = volumeProfile(bars);
  if (vp) {
    candidates.push({ price: vp.poc, label: "POC (Point of Control)" });
    candidates.push({ price: vp.vah, label: "VAH (Value Area High)" });
    candidates.push({ price: vp.val, label: "VAL (Value Area Low)" });
  }
  const vwap = anchoredVwap(bars);
  if (vwap) {
    candidates.push({ price: vwap.vwap, label: "VWAP" });
    candidates.push({ price: vwap.upper1, label: "VWAP +1σ" });
    candidates.push({ price: vwap.lower1, label: "VWAP -1σ" });
  }
  const structure = marketStructure(bars, swing.swingHighs, swing.swingLows);

  // Opening Range Breakout — level OR High/Low jadi kandidat S-R intraday.
  const orb = openingRange(bars);
  if (orb) {
    candidates.push({ price: orb.high, label: `OR High (${orb.session})` });
    candidates.push({ price: orb.low, label: `OR Low (${orb.session})` });
  }

  if (!candidates.length) return { zones: [], potential: null, pivotLevels, volumeProfile: vp, vwap, structure, orb };

  // Semua jarak diukur dengan ATR timeframe ini, jadi otomatis proporsional untuk
  // 1m maupun 1d, dan untuk BTC maupun EURUSD. Fallback ke persentase bila ATR tak ada.
  const atr = indicators.atr14 > 0 ? indicators.atr14 : null;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const tolerance = atr ? clamp(0.6 * atr, price * 0.0005, price * 0.01) : price * 0.0025;
  const nearDistance = atr ? atr : price * 0.005;
  const slBuffer = atr ? 0.5 * atr : (daily?.adr14 ? daily.adr14 * 0.15 : price * 0.003);

  const all = clusterLevels(candidates, price, tolerance);
  const allRes = all.filter(z => z.type === "resistance").sort((a, b) => a.mid - b.mid);
  const allSup = all.filter(z => z.type === "support").sort((a, b) => b.mid - a.mid);
  const resistances = allRes.slice(0, 3);
  const supports = allSup.slice(0, 3);
  const nearestResistance = resistances[0] || null;
  const nearestSupport = supports[0] || null;

  // Jarak harga ke TEPI zona (0 bila harga di dalam zona).
  const distSup = nearestSupport ? Math.max(0, price - nearestSupport.high) : Infinity;
  const distRes = nearestResistance ? Math.max(0, nearestResistance.low - price) : Infinity;
  const buyOk = distSup <= nearDistance;
  const sellOk = distRes <= nearDistance;

  // Dua-duanya dekat: pilih yang searah sinyal; sinyal netral: yang terdekat.
  const sig = signal?.signal;
  let side = null;
  if (buyOk && sellOk) side = sig === "BUY" ? "buy" : sig === "SELL" ? "sell" : distSup <= distRes ? "buy" : "sell";
  else if (buyOk) side = "buy";
  else if (sellOk) side = "sell";

  // Setup yang MELAWAN sinyal tidak ditawarkan: di uji walk-forward 2 tahun (XAUUSD,
  // BTC, ETH TF 1h) setup ini konsisten merugi (rata-rata -0.1R s/d -0.3R per trade).
  let potential = null;
  let skippedSetup = null;
  if (side && ((side === "buy" && sig === "SELL") || (side === "sell" && sig === "BUY"))) {
    skippedSetup = `Harga dekat zona ${side === "buy" ? "support" : "resistance"}, tapi setup ${side === "buy" ? "BUY" : "SELL"} tidak ditampilkan karena MELAWAN sinyal ${sig} (secara historis setup semacam ini merugi). Tunggu sinyal berbalik atau harga ke zona searah sinyal.`;
    side = null;
  }
  if (side) {
    const isBuy = side === "buy";
    const zone = isBuy ? nearestSupport : nearestResistance;
    const entry = isBuy ? Math.min(price, zone.high) : Math.max(price, zone.low);
    const stopLoss = isBuy ? zone.low - slBuffer : zone.high + slBuffer;
    let { takeProfit, rr } = pickTargets(entry, stopLoss, isBuy ? allRes : allSup, isBuy ? 1 : -1);
    const risk = Math.abs(entry - stopLoss);
    // Tidak ada level di depan harga (mis. harga sudah di atas semua resistance saat
    // breakout): TP diproyeksikan pada R:R PROJECTED_RR dari jarak SL, ditandai "proyeksi".
    const tpProjected = !takeProfit.length && risk > 0;
    if (tpProjected) {
      takeProfit = [isBuy ? entry + PROJECTED_RR * risk : entry - PROJECTED_RR * risk];
      rr = PROJECTED_RR;
    }
    const reward = takeProfit[0] != null ? Math.abs(takeProfit[0] - entry) : null;
    const zoneText = `${fmtPrice(zone.low, price)}-${fmtPrice(zone.high, price)} (${zone.sources.join(", ")})`;
    potential = {
      type: isBuy ? "BUY_ZONE" : "SELL_ZONE",
      zone,
      entry,
      stopLoss,
      takeProfit,
      tpProjected,
      riskRewardRatio: rr,
      rrQuality: rrQualityOf(rr),
      rrWarning: rr != null && rr < 1 ? `R:R ${rr} BURUK (risiko ${fmtPrice(risk, price)} > potensi profit ${fmtPrice(reward, price)}) — secara matematis merugikan jangka panjang. Sebaiknya HINDARI / tunggu harga ke level lebih baik, atau cari target lebih jauh.` : null,
      againstSignal: false,
      signalNote: sig === "NETRAL" || !sig ? "Sinyal masih NETRAL — setup ini murni pantulan zona, tunggu konfirmasi candle di zona." : null,
      reason: `Harga berada di dekat zona ${isBuy ? "support" : "resistance"} ${zoneText} -> area potensi ${isBuy ? "Buy" : "Sell"}. Entry (limit) ~${fmtPrice(entry, price)} (tepi ${isBuy ? "atas zona support" : "bawah zona resistance"}), SL ${fmtPrice(stopLoss, price)} (${isBuy ? "di bawah" : "di atas"} zona, buffer 0.5×ATR), TP1 ${fmtPrice(takeProfit[0], price)}${takeProfit[1] != null ? `, TP2 ${fmtPrice(takeProfit[1], price)}` : ""}${tpProjected ? ` (**proyeksi** R:R 1:${PROJECTED_RR} — tidak ada level ${isBuy ? "resistance" : "support"} di depan harga; kelola posisi dengan trailing stop).` : ` (target pertama dengan R:R ≥ ${MIN_RR} bila ada).`}`
    };
  }

  return { zones: [...supports, ...resistances], potential, skippedSetup, nearestSupport, nearestResistance, pivotLevels, volumeProfile: vp, vwap, structure, orb };
}
