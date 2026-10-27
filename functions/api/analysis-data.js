import { fetchQuote, fetchOhlcv } from "../../lib/marketData.js";
import { computeIndicators, summarizeTrend } from "../../lib/indicators.js";

export async function onRequestGet({ request }) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const assetType = searchParams.get("assetType");
  const interval = searchParams.get("interval") || "1h";
  if (!symbol || !assetType) {
    return Response.json({ error: "symbol & assetType wajib diisi" }, { status: 400 });
  }

  try {
    const [quote, bars] = await Promise.all([
      fetchQuote(assetType, symbol),
      fetchOhlcv(assetType, symbol, interval)
    ]);
    const indicators = computeIndicators(bars);
    const trend = summarizeTrend(indicators);

    return Response.json({
      symbol,
      assetType,
      interval,
      quote,
      indicators,
      trendSummary: trend,
      barCount: bars.length,
      lastBars: bars.slice(-20)
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
