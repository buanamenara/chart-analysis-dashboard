import { fetchQuote, fetchOhlcv } from "../../lib/marketData.js";
import { computeIndicators, summarizeTrend } from "../../lib/indicators.js";

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
      hint: "Contoh: /api/analysis-data?symbol=XAUUSD&assetType=gold&interval=1h"
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const [quote, bars] = await Promise.all([
      fetchQuote(assetType, symbol),
      fetchOhlcv(assetType, symbol, interval)
    ]);
    
    const indicators = computeIndicators(bars);
    const trend = summarizeTrend(indicators);

    const data = {
      symbol,
      assetType,
      interval,
      quote,
      indicators,
      trendSummary: trend,
      barCount: bars.length,
      lastBars: bars.slice(-20)
    };

    return new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "max-age=15" 
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      code: "UPSTREAM_ERROR",
      error: "Gagal mengambil data analisa.",
      hint: "Coba lagi beberapa saat atau ganti simbol."
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}
