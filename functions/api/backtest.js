import { runBacktest } from "../../lib/backtest.js";

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
      hint: "Contoh: /api/backtest?symbol=XAUUSD&assetType=forex&interval=15m"
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const num = (v, d) => (v != null && v !== "" && !isNaN(+v) ? +v : d);
  try {
    const data = await runBacktest({
      symbol, assetType, interval, strategy,
      slAtr: num(url.searchParams.get("slAtr"), 1.0),
      tpAtr: num(url.searchParams.get("tpAtr"), 1.5),
      rsiPullback: num(url.searchParams.get("rsiPullback"), 45),
      maxHold: num(url.searchParams.get("maxHold"), 12),
      costR: num(url.searchParams.get("costR"), 0.1)
    });
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", "Cache-Control": "max-age=600" }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false, code: "UPSTREAM_ERROR",
      error: "Gagal menjalankan backtest.",
      hint: err.message || "Coba timeframe/instrumen lain."
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}
