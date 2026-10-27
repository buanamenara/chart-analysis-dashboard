// Sumber berita gratis per kategori aset (semua RSS publik, tanpa API key).
export const NEWS_SOURCES = {
  forex: [
    { name: "Investing.com Forex", url: "https://id.investing.com/rss/news_1.rss" },
    { name: "Investing.com Komoditas", url: "https://id.investing.com/rss/news_11.rss" }
  ],
  crypto: [
    { name: "Cointelegraph", url: "https://cointelegraph.com/rss" }
  ],
  stock: [
    { name: "CNBC Indonesia", url: "https://www.cnbcindonesia.com/market/rss" },
    { name: "Investing.com Saham Global", url: "https://id.investing.com/rss/news_25.rss" }
  ]
};

export const ECONOMIC_NEWS_SOURCE = { name: "Investing.com Ekonomi", url: "https://id.investing.com/rss/news_95.rss" };
