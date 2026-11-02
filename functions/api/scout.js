import { runScout } from "../../lib/scout.js";

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const assetType = url.searchParams.get("assetType");
  const interval = url.searchParams.get("interval") || "15m";
  const symbols = (url.searchParams.get("symbols") || "")
    .split(",").map(s => s.trim()).filter(Boolean);

  if (!assetType || !symbols.length) {
    return new Response(JSON.stringify({
      ok: false, code: "MISSING_PARAMS",
      error: "Parameter 'assetType' dan 'symbols' (dipisah koma) wajib diisi.",
      hint: "Contoh: /api/scout?assetType=forex&interval=15m&symbols=XAUUSD,EURUSD,GBPUSD"
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const data = await runScout(assetType, symbols, interval);
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", "Cache-Control": "max-age=60" }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false, code: "UPSTREAM_ERROR",
      error: "Gagal menjalankan Scout.",
      hint: err.message || "Coba timeframe/instrumen lain."
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}
