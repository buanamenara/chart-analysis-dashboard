import { fetchQuote } from "../../lib/marketData.js";

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");
  const assetType = url.searchParams.get("assetType");

  // 1. Pesan Error Jelas
  if (!symbol || !assetType) {
    return new Response(JSON.stringify({
      ok: false,
      code: "MISSING_PARAMS",
      error: "Parameter 'symbol' dan 'assetType' wajib diisi.",
      hint: "Contoh: /api/quote?symbol=XAUUSD&assetType=gold"
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const quote = await fetchQuote(assetType, symbol);
    
    // 2. Cache 10 detik (Biar cepat)
    return new Response(JSON.stringify(quote), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "max-age=10" 
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      code: "UPSTREAM_ERROR",
      error: "Gagal mengambil data.",
      hint: "Coba lagi beberapa saat."
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}
