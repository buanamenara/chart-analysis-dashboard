import { fetchOhlcv, fetchDailyBars } from "../../lib/marketData.js";
import { computeIndicators } from "../../lib/indicators.js";
import { computeSnrZones } from "../../lib/snr.js";
import { generateRuleBasedSignal } from "../../lib/ruleSignal.js";

export async function onRequestGet({ request }) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const assetType = searchParams.get("assetType");
  const interval = searchParams.get("interval") || "1h";
  if (!symbol || !assetType) {
    return Response.json({ error: "symbol & assetType wajib diisi" }, { status: 400 });
  }

  try {
    const [bars, dailyBars] = await Promise.all([
      fetchOhlcv(assetType, symbol, interval),
      fetchDailyBars(assetType, symbol)
    ]);
    const indicators = computeIndicators(bars);
    const { zones, potential } = computeSnrZones({ indicators, dailyBars, bars });
    const signal = generateRuleBasedSignal({ indicators, dailyBars, bars });

    return Response.json({
      symbol,
      assetType,
      interval,
      currentPrice: indicators.lastClose,
      zones,
      potential,
      signal: signal.signal,
      signalReasons: signal.reasons,
      disclaimer: signal.disclaimer,
      bars: bars.slice(-180)
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
