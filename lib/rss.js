import { fetchWithTimeout } from "./http.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1");
}

// Parser RSS ringan pakai regex (feed-feed ini strukturnya sederhana & konsisten,
// jadi tidak perlu dependency XML tambahan).
export async function fetchRss(url, limit = 10) {
  const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" } });
  if (!res.ok) throw new Error(`RSS error ${res.status} (${url})`);
  const xml = await res.text();

  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) && items.length < limit) {
    const block = match[1];
    const title = decodeEntities(/<title>([\s\S]*?)<\/title>/.exec(block)?.[1]?.trim() || "");
    const link = decodeEntities(/<link>([\s\S]*?)<\/link>/.exec(block)?.[1]?.trim() || "");
    const pubDate = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(block)?.[1]?.trim() || null;
    if (title) items.push({ title, link, pubDate });
  }
  return items;
}

export async function fetchRssMulti(sources, limitPerSource = 6) {
  const results = await Promise.allSettled(
    sources.map(s => fetchRss(s.url, limitPerSource).then(items => items.map(i => ({ ...i, source: s.name }))))
  );
  return results.filter(r => r.status === "fulfilled").flatMap(r => r.value);
}
