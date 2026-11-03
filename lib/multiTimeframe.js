import { fetchOhlcv } from "./marketData.js";
import { computeIndicators } from "./indicators.js";
import { generateRuleBasedSignal } from "./ruleSignal.js";
import { getHigherTimeframes, summarizeTimeframeSignals } from "./analysis.js";

// Hitung konfirmasi arah di 1-2 timeframe yang lebih tinggi dari TF yang dipilih
// user. Dipakai untuk konfluensi: sinyal yang searah dengan TF besar lebih kuat.
// dailyBars dioper dari pemanggil supaya tidak fetch ganda.
export async function computeMultiTimeframe(assetType, symbol, interval, currentSignal, dailyBars) {
  const higher = getHigherTimeframes(interval);
  if (!higher.length) return summarizeTimeframeSignals(currentSignal, []);

  const rows = [];
  for (const tf of higher) {
    try {
      const b = await fetchOhlcv(assetType, symbol, tf);
      const ind = computeIndicators(b, { interval: tf });
      if (ind.insufficientData) continue;
      const sig = generateRuleBasedSignal({ indicators: ind, dailyBars, bars: b });
      rows.push({ interval: tf, signal: sig.signal });
    } catch {
      // Lewati TF yang gagal diambil (mis. timeout / data kurang) tanpa menggagalkan analisa utama.
    }
  }
  return { ...summarizeTimeframeSignals(currentSignal, rows), timeframes: rows };
}
