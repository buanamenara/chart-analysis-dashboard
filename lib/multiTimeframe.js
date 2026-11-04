import { fetchOhlcv } from "./marketData.js";
import { computeIndicators } from "./indicators.js";
import { generateRuleBasedSignal } from "./ruleSignal.js";
import { getHigherTimeframes, summarizeTimeframeSignals } from "./analysis.js";
import { createMemoCache } from "./memoCache.js";

// Sinyal TF besar berubah lambat; simpan 60 detik supaya auto-refresh tab Chart
// (tiap 10–60 dtk) tidak memanggil sumber data berulang-ulang.
const memo = createMemoCache();
const HTF_TTL_MS = 60_000;

// Hitung konfirmasi arah di 1-2 timeframe yang lebih tinggi dari TF yang dipilih
// user. Dipakai untuk konfluensi: sinyal yang searah dengan TF besar lebih kuat.
// dailyBars dioper dari pemanggil supaya tidak fetch ganda.
export async function computeMultiTimeframe(assetType, symbol, interval, currentSignal, dailyBars) {
  const higher = getHigherTimeframes(interval);
  if (!higher.length) return summarizeTimeframeSignals(currentSignal, []);

  const rows = [];
  for (const tf of higher) {
    try {
      const sig = await memo(`htf:${assetType}:${symbol}:${tf}`, HTF_TTL_MS, async () => {
        const b = await fetchOhlcv(assetType, symbol, tf);
        const ind = computeIndicators(b, { interval: tf });
        if (ind.insufficientData) return null;
        return generateRuleBasedSignal({ indicators: ind, dailyBars, bars: b }).signal;
      });
      if (sig) rows.push({ interval: tf, signal: sig });
    } catch {
      // Lewati TF yang gagal diambil (mis. timeout / data kurang) tanpa menggagalkan analisa utama.
    }
  }
  return { ...summarizeTimeframeSignals(currentSignal, rows), timeframes: rows };
}
