import { buildAnalysisData } from "../../lib/analysisPipeline.js";

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
      hint: "Contoh: /api/analysis-data?symbol=XAUUSD&assetType=forex&interval=1h"
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const data = await buildAnalysisData(assetType, symbol, interval);

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
