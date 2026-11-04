import { buildNewsReport } from "../../lib/newsReport.js";

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const assetType = url.searchParams.get("assetType") || "forex";
  const symbol = (url.searchParams.get("symbol") || "").slice(0, 20);

  try {
    const data = await buildNewsReport(assetType, symbol);

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
      error: "Gagal mengambil data berita.",
      hint: "Coba lagi beberapa saat."
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}
