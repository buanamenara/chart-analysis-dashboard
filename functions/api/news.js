import { fetchRssMulti } from "../../lib/rss.js";
import { NEWS_SOURCES } from "../../lib/newsSources.js";

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const assetType = url.searchParams.get("assetType") || "forex";

  try {
    const sources = NEWS_SOURCES[assetType] || NEWS_SOURCES.forex;
    const items = await fetchRssMulti(sources, 6);

    return new Response(JSON.stringify({ items }), {
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
