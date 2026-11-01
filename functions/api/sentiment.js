import { getFearGreedIndex, getCryptoGlobalStats } from "../../lib/sentiment.js";

export async function onRequestGet(context) {
  try {
    const [fngResult, globalResult] = await Promise.allSettled([getFearGreedIndex(), getCryptoGlobalStats()]);
    
    const data = {
      fearGreed: fngResult.status === "fulfilled" ? fngResult.value : null,
      cryptoGlobal: globalResult.status === "fulfilled" ? globalResult.value : null
    };

    return new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "max-age=180"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      code: "UPSTREAM_ERROR",
      error: "Gagal mengambil data sentimen.",
      hint: "Coba lagi beberapa saat."
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}
