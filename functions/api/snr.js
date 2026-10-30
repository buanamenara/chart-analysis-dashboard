import { fetchOhlcv, fetchDailyBars } from "../../lib/marketData.js";
import { computeIndicators } from "../../lib/indicators.js";
import { generateRuleBasedSignal } from "../../lib/ruleSignal.js";
import { computeSnrZones } from "../../lib/snr.js";
import { buildTechnicalAnalysis } from "../../lib/analysis.js";

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");
  const assetType = url.searchParams.get("assetType");
  const interval = url.searchParams.get("interval") || "1h";

  if (!symbol || !assetType) {
    return new Response(JSON.stringify({
      ok: false,
      code: "MISSING_PARAMS",
      error: "Parameter 'symbol' dan 'assetType' wajib diisi.",
      hint: "Contoh: /api/snr?symbol=XAUUSD&assetType=gold&interval=1h"
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const [bars, dailyBars] = await Promise.all([
      fetchOhlcv(assetType, symbol, interval),
      fetchDailyBars(assetType, symbol)
    ]);
    
    const indicators = computeIndicators(bars);
    const { zones, potential, nearestSupport, nearestResistance, pivotLevels } = computeSnrZones({ indicators, dailyBars, bars });
    const signal = generateRuleBasedSignal({ indicators, dailyBars, bars });
    const analysis = buildTechnicalAnalysis({ indicators, dailyBars, bars, signal, nearestSupport, nearestResistance });

    const data = {
      symbol,
      assetType,
      interval,
      currentPrice: indicators.lastClose,
      zones,
      potential,
      nearestSupport,
      nearestResistance,
      pivotLevels,
      analysis,
      signal: signal.signal,
      confidence: signal.confidence,
      confidenceLabel: signal.confidenceLabel,
      signalReasons: signal.reasons,
      disclaimer: signal.disclaimer,
      bars: bars.slice(-180)
    };

    return new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "max-age=30" 
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      code: "UPSTREAM_ERROR",
      error: "Gagal mengambil data SNR.",
      hint: "Coba lagi beberapa saat atau ganti simbol."
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}
