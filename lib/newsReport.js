import { fetchRssMulti } from "./rss.js";
import { NEWS_SOURCES } from "./newsSources.js";
import { fetchSymbolNews } from "./symbolNews.js";

// Dipakai bersama oleh server.js dan functions/api/news.js.
// items      : berita umum per kategori aset (seperti sebelumnya)
// symbolNews : berita khusus simbol yang dipilih (emas/perak/BTC/ETH), null bila tak didukung
export async function buildNewsReport(assetType, symbol) {
  const sources = NEWS_SOURCES[assetType] || NEWS_SOURCES.forex;
  const [items, symbolNews] = await Promise.all([
    fetchRssMulti(sources, 6),
    symbol ? fetchSymbolNews(assetType, symbol).catch(() => null) : Promise.resolve(null)
  ]);
  return { items, symbolNews };
}
