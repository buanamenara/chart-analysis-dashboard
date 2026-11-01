import { fetchOhlcv, fetchDailyBars } from "../../lib/marketData.js";
import { computeIndicators } from "../../lib/indicators.js";
import { generateRuleBasedSignal } from "../../lib/ruleSignal.js";

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
      hint: "Contoh: /api/signal?symbol=XAUUSD&assetType=gold&interval=1h"
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const [bars, dailyBars] = await Promise.all([
      fetchOhlcv(assetType, symbol, interval),
      fetchDailyBars(assetType, symbol)
    ]);
    
    const indicators = computeIndicators(bars);
    const signalData = generateRuleBasedSignal({ indicators, dailyBars, bars });

    return new Response(JSON.stringify(signalData), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "max-age=20" 
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      code: "UPSTREAM_ERROR",
      error: "Gagal mengambil data sinyal.",
      hint: "Coba lagi beberapa saat atau ganti simbol."
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}
