import { optimizeBacktest } from "../../lib/backtest.js";

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");
  const assetType = url.searchParams.get("assetType");
  const interval = url.searchParams.get("interval") || "15m";
  const strategy = url.searchParams.get("strategy") || "trendPB";

  if (!symbol || !assetType) {
    return new Response(JSON.stringify({
      ok: false, code: "MISSING_PARAMS",
      error: "Parameter 'symbol' dan 'assetType' wajib diisi.",
      hint: "Contoh: /api/optimize?symbol=XAUUSD&assetType=forex&interval=1h"
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const num = (v, d) => (v != null && v !== "" && !isNaN(+v) ? +v : d);
  try {
    const data = await optimizeBacktest({ symbol, assetType, interval, strategy, costR: num(url.searchParams.get("costR"), 0.1) });
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=900" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, code: "UPSTREAM_ERROR", error: "Gagal optimasi.", hint: err.message }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}
