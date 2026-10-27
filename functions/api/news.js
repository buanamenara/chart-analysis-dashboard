import { fetchRssMulti } from "../../lib/rss.js";
import { NEWS_SOURCES } from "../../lib/newsSources.js";

export async function onRequestGet({ request }) {
  const { searchParams } = new URL(request.url);
  const assetType = searchParams.get("assetType") || "forex";

  try {
    const sources = NEWS_SOURCES[assetType] || NEWS_SOURCES.forex;
    const items = await fetchRssMulti(sources, 6);
    return Response.json({ items });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
