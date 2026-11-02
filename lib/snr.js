import { computeDailyLevels, computePivotPoints, findSwingPoints, nearestKeyLevel, volumeProfile, anchoredVwap, marketStructure, openingRange } from "./levels.js";

// Gabungkan beberapa level kandidat (swing high/low, PDH/PDL, Bollinger, key level)
// jadi "zona" SNR dengan clustering sederhana berbasis jarak persentase.
function clusterLevels(candidates, price, tolerancePercent = 0.25) {
  const sorted = [...candidates].sort((a, b) => a.price - b.price);
  const clusters = [];

  for (const c of sorted) {
    const last = clusters.at(-1);
    if (last && Math.abs(c.price - last.mid) / price * 100 <= tolerancePercent) {
      last.levels.push(c);
      last.low = Math.min(last.low, c.price);
      last.high = Math.max(last.high, c.price);
      last.mid = (last.low + last.high) / 2;
    } else {
      clusters.push({ low: c.price, high: c.price, mid: c.price, levels: [c] });
    }
  }

  return clusters.map(cl => ({
    low: cl.low,
    high: cl.high,
    mid: cl.mid,
    strength: cl.levels.length,
    sources: cl.levels.map(l => l.label),
    type: cl.mid >= price ? "resistance" : "support"
  }));
}

export function computeSnrZones({ indicators, dailyBars, bars }) {
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

  // Volume Profile (POC/VAH/VAL) & VWAP — level berbasis volume/harga rata-rata,
  // dijadikan kandidat zona SNR agar entry/SL/TP memperhitungkan magnet harga nyata.
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

  const zones = clusterLevels(candidates, price)
    .sort((a, b) => Math.abs(a.mid - price) - Math.abs(b.mid - price));

  const resistances = zones.filter(z => z.type === "resistance").sort((a, b) => a.mid - b.mid).slice(0, 3);
  const supports = zones.filter(z => z.type === "support").sort((a, b) => b.mid - a.mid).slice(0, 3);

  const nearestResistance = resistances[0] || null;
  const nearestSupport = supports[0] || null;

  // Buffer SL dihitung dari ADR (volatilitas harian rata-rata) supaya proporsional
  // ke instrumen manapun, bukan persentase tetap. Fallback 0.3% kalau ADR tidak ada.
  const slBuffer = daily?.adr14 ? daily.adr14 * 0.15 : price * 0.003;

  // Potensi area Buy/Sell: harga dekat salah satu zona (<0.5%) dianggap "di area reaksi".
  // Entry diletakkan di tepi zona (bukan harga pasar) supaya Risk:Reward realistis:
  // kalau harga masih di atas zona support, entry = tepi atas zona (order limit),
  // kalau sudah menembus, entry = harga pasar.
  let potential = null;
  if (nearestSupport && Math.abs(price - nearestSupport.mid) / price * 100 < 0.5) {
    const entry = Math.min(price, nearestSupport.high);
    const stopLoss = nearestSupport.low - slBuffer;
    const takeProfit = [nearestResistance?.mid, resistances[1]?.mid].filter(Boolean);
    const risk = entry - stopLoss;
    const reward = takeProfit[0] ? takeProfit[0] - entry : null;
    const rr = reward && risk > 0 ? +(reward / risk).toFixed(2) : null;
    potential = {
      type: "BUY_ZONE",
      zone: nearestSupport,
      entry,
      stopLoss,
      takeProfit,
      riskRewardRatio: rr,
      rrQuality: rr == null ? null : rr >= 2 ? "baik" : rr >= 1.2 ? "cukup" : rr >= 1 ? "marginal" : "buruk",
      rrWarning: rr != null && rr < 1 ? `R:R ${rr} BURUK (risiko ${risk.toFixed(1)} > potensi profit ${reward.toFixed(1)}) — secara matematis merugikan jangka panjang. Sebaiknya HINDARI / tunggu harga ke level lebih baik, atau cari target lebih jauh.` : null,
      reason: `Harga berada di dekat zona support ${nearestSupport.low.toFixed(2)}-${nearestSupport.high.toFixed(2)} (${nearestSupport.sources.join(", ")}) -> area potensi Buy. Entry (limit) ~${entry.toFixed(2)} (tepi atas zona support), SL ${stopLoss.toFixed(2)} (di bawah zona support), TP1 ${takeProfit[0]?.toFixed(2) ?? "-"}${takeProfit[1] ? `, TP2 ${takeProfit[1].toFixed(2)}` : ""}.`
    };
  } else if (nearestResistance && Math.abs(price - nearestResistance.mid) / price * 100 < 0.5) {
    const entry = Math.max(price, nearestResistance.low);
    const stopLoss = nearestResistance.high + slBuffer;
    const takeProfit = [nearestSupport?.mid, supports[1]?.mid].filter(Boolean);
    const risk = stopLoss - entry;
    const reward = takeProfit[0] ? entry - takeProfit[0] : null;
    const rr = reward && risk > 0 ? +(reward / risk).toFixed(2) : null;
    potential = {
      type: "SELL_ZONE",
      zone: nearestResistance,
      entry,
      stopLoss,
      takeProfit,
      riskRewardRatio: rr,
      rrQuality: rr == null ? null : rr >= 2 ? "baik" : rr >= 1.2 ? "cukup" : rr >= 1 ? "marginal" : "buruk",
      rrWarning: rr != null && rr < 1 ? `R:R ${rr} BURUK (risiko ${risk.toFixed(1)} > potensi profit ${reward.toFixed(1)}) — secara matematis merugikan jangka panjang. Sebaiknya HINDARI / tunggu harga ke level lebih baik, atau cari target lebih jauh.` : null,
      reason: `Harga berada di dekat zona resistance ${nearestResistance.low.toFixed(2)}-${nearestResistance.high.toFixed(2)} (${nearestResistance.sources.join(", ")}) -> area potensi Sell. Entry (limit) ~${entry.toFixed(2)} (tepi bawah zona resistance), SL ${stopLoss.toFixed(2)} (di atas zona resistance), TP1 ${takeProfit[0]?.toFixed(2) ?? "-"}${takeProfit[1] ? `, TP2 ${takeProfit[1].toFixed(2)}` : ""}.`
    };
  }

  return { zones: [...supports, ...resistances], potential, nearestSupport, nearestResistance, pivotLevels, volumeProfile: vp, vwap, structure, orb };
}
