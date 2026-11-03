import { fetchQuote } from "../../lib/marketData.js";
import { createMemoCache } from "../../lib/memoCache.js";

// Sama dengan server.js: cache 10 detik per simbol (bypass dengan ?nocache=1).
const memo = createMemoCache();
const QUOTE_TTL_MS = 10_000;

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
      hint: "Contoh: /api/quote?symbol=XAUUSD&assetType=forex"
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const nocache = ["1", "true"].includes(url.searchParams.get("nocache"));
    const quote = nocache
      ? await fetchQuote(assetType, symbol)
      : await memo(`quote:${assetType}:${symbol}`, QUOTE_TTL_MS, () => fetchQuote(assetType, symbol));
    
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
