import { computeDailyLevels, findSwingPoints, nearestKeyLevel } from "./levels.js";

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
  if (indicators.insufficientData) return { zones: [], potential: null };

  const price = indicators.lastClose;
  const candidates = [];

  const daily = computeDailyLevels(dailyBars);
  if (daily) {
    candidates.push({ price: daily.prevDayHigh, label: "PDH (Previous Day High)" });
    candidates.push({ price: daily.prevDayLow, label: "PDL (Previous Day Low)" });
  }

  const swing = findSwingPoints(bars);
  swing.swingHighs.slice(-5).forEach(s => candidates.push({ price: s.price, label: "Swing High" }));
  swing.swingLows.slice(-5).forEach(s => candidates.push({ price: s.price, label: "Swing Low" }));

  if (indicators.bollinger?.upper) candidates.push({ price: indicators.bollinger.upper, label: "Bollinger Upper" });
  if (indicators.bollinger?.lower) candidates.push({ price: indicators.bollinger.lower, label: "Bollinger Lower" });

  const key = nearestKeyLevel(price);
  if (key) candidates.push({ price: key.level, label: "Key Level (psikologis)" });

  if (!candidates.length) return { zones: [], potential: null };

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
  let potential = null;
  if (nearestSupport && Math.abs(price - nearestSupport.mid) / price * 100 < 0.5) {
    const entry = price;
    const stopLoss = nearestSupport.low - slBuffer;
    const takeProfit = [nearestResistance?.mid, resistances[1]?.mid].filter(Boolean);
    const risk = entry - stopLoss;
    const reward = takeProfit[0] ? takeProfit[0] - entry : null;
    potential = {
      type: "BUY_ZONE",
      zone: nearestSupport,
      entry,
      stopLoss,
      takeProfit,
      riskRewardRatio: reward && risk > 0 ? +(reward / risk).toFixed(2) : null,
      reason: `Harga berada di dekat zona support ${nearestSupport.low.toFixed(2)}-${nearestSupport.high.toFixed(2)} (${nearestSupport.sources.join(", ")}) -> area potensi Buy. Entry ~${entry.toFixed(2)}, SL ${stopLoss.toFixed(2)} (di bawah zona support), TP1 ${takeProfit[0]?.toFixed(2) ?? "-"}${takeProfit[1] ? `, TP2 ${takeProfit[1].toFixed(2)}` : ""}.`
    };
  } else if (nearestResistance && Math.abs(price - nearestResistance.mid) / price * 100 < 0.5) {
    const entry = price;
    const stopLoss = nearestResistance.high + slBuffer;
    const takeProfit = [nearestSupport?.mid, supports[1]?.mid].filter(Boolean);
    const risk = stopLoss - entry;
    const reward = takeProfit[0] ? entry - takeProfit[0] : null;
    potential = {
      type: "SELL_ZONE",
      zone: nearestResistance,
      entry,
      stopLoss,
      takeProfit,
      riskRewardRatio: reward && risk > 0 ? +(reward / risk).toFixed(2) : null,
      reason: `Harga berada di dekat zona resistance ${nearestResistance.low.toFixed(2)}-${nearestResistance.high.toFixed(2)} (${nearestResistance.sources.join(", ")}) -> area potensi Sell. Entry ~${entry.toFixed(2)}, SL ${stopLoss.toFixed(2)} (di atas zona resistance), TP1 ${takeProfit[0]?.toFixed(2) ?? "-"}${takeProfit[1] ? `, TP2 ${takeProfit[1].toFixed(2)}` : ""}.`
    };
  }

  return { zones: [...supports, ...resistances], potential, nearestSupport, nearestResistance };
}
