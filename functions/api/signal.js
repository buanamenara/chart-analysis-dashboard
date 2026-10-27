import { fetchOhlcv, fetchDailyBars } from "../../lib/marketData.js";
import { computeIndicators } from "../../lib/indicators.js";
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
    const result = generateRuleBasedSignal({ indicators, dailyBars, bars });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
