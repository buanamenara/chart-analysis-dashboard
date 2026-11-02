import { fetchOhlcv, fetchDailyBars } from "./marketData.js";
import { computeIndicators } from "./indicators.js";
import { generateRuleBasedSignal } from "./ruleSignal.js";
import { computeSnrZones } from "./snr.js";

// SCOUT: pindai banyak instrumen pada satu timeframe, hitung sinyal + kualitas
// setup (R:R) + flag divergence-lawan, lalu beri SKOR untuk ranking peluang.
// FILTER diterapkan di skor: setup R:R buruk / divergence lawan diturunkan.
// Ringan (2 fetch/simbol, tanpa multi-timeframe/fundamental) agar aman di Cloudflare.
export async function runScout(assetType, symbols, interval) {
  const list = (symbols || []).slice(0, 12);
  const results = [];
  for (const symbol of list) {
    try {
      const [bars, dailyBars] = await Promise.all([
        fetchOhlcv(assetType, symbol, interval),
        fetchDailyBars(assetType, symbol)
      ]);
      const indicators = computeIndicators(bars);
      if (indicators.insufficientData) continue;
      const sig = generateRuleBasedSignal({ indicators, dailyBars, bars });
      const { potential } = computeSnrZones({ indicators, dailyBars, bars });
      const rr = potential?.riskRewardRatio ?? null;
      const rrQ = potential?.rrQuality ?? null;
      const divOpp = (indicators.rsiDivergence === "bearish" && sig.signal === "BUY") ||
                     (indicators.rsiDivergence === "bullish" && sig.signal === "SELL");

      let score = 0;
      if (sig.signal !== "NETRAL") {
        score = sig.confidence;
        if (rr != null) score += Math.min(20, rr * 8); // R:R bagus menambah skor
        if (rrQ === "buruk") score -= 30;               // FILTER: setup rugi -> turun jauh
        if (divOpp) score -= 15;                        // FILTER: momentum melawan sinyal
      }
      results.push({
        symbol, price: indicators.lastClose,
        signal: sig.signal, confidence: sig.confidence,
        rr, rrQuality: rrQ, divOpp,
        hasSetup: !!potential, setupType: potential?.type || null,
        score: Math.round(score)
      });
    } catch {
      /* lewati simbol yang gagal diambil */
    }
  }
  results.sort((a, b) => b.score - a.score);
  return {
    assetType, interval, scanned: results.length, results,
    disclaimer: "Scout = pemindai cepat (sinyal + R:R, tanpa multi-timeframe). Skor untuk prioritas, bukan nasihat. Buka Analisa SNR instrumen terpilih untuk kajian penuh."
  };
}
