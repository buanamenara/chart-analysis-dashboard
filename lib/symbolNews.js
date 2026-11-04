import { fetchRss } from "./rss.js";

// Berita KHUSUS simbol yang sedang dianalisa (bukan berita umum per kategori).
// Sumber: RSS headline Yahoo Finance per simbol (gratis, tanpa API key).
// Ide diadaptasi dari skill trader-news (day-trader-skill, MIT): feed per ticker,
// saring yang benar-benar menyebut asetnya, beri label "kenapa penting", buang duplikat.
const YAHOO_RSS = s => `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(s)}&region=US&lang=en-US`;

// Aset -> simbol feed Yahoo + pola "berita ini benar-benar soal aset ini".
// `macroRelevant`: berita makro (Fed, inflasi, dolar) tetap diambil walau tak menyebut
// asetnya, karena memang penggerak utama (emas & forex).
const ASSETS = {
  XAUUSD: { feeds: ["GC=F", "GLD"], label: "Emas", mention: /\bgold\b|\bbullion\b|\bXAU|precious metals?|\bemas\b/i, macroRelevant: true, miningNoise: true },
  XAGUSD: { feeds: ["SI=F", "SLV"], label: "Perak", mention: /\bsilver\b|\bXAG|precious metals?|\bperak\b/i, macroRelevant: true, miningNoise: true },
  BTC: { feeds: ["BTC-USD"], label: "Bitcoin", mention: /\bbitcoin\b|\bBTC\b|spot bitcoin etf/i, macroRelevant: false },
  ETH: { feeds: ["ETH-USD"], label: "Ethereum", mention: /\bethereum\b|\bETH\b|\bether\b/i, macroRelevant: false }
};

// Label "kenapa penting", disesuaikan untuk emas, forex & crypto.
export const NEWS_TAGS = [
  ["makro", /\bFed\b|\bFOMC\b|\bPowell\b|\bCPI\b|\bPCE\b|inflation|rate (?:cut|hike)s?|interest rates?|payrolls|jobs report|\bNFP\b|treasury yields?|\byields?\b|\bdollar\b|\bDXY\b|recession/i],
  ["geopolitik", /\bwar\b|conflict|sanction|tariffs?|election|geopolitic|missile|ceasefire|\bmidterms?\b/i],
  ["bank sentral", /central banks?|\bPBOC\b|\bECB\b|\bBOJ\b|reserves|gold buying|de-dollar/i],
  ["ETF", /\bETFs?\b|inflows?|outflows?/i],
  ["regulasi", /\bSEC\b|regulat|\bban\b|approval|approves|lawsuit|\bcourt\b|legislation|\bbill\b/i],
  ["risiko", /\bhack|exploit|breach|bankrupt|insolven|outage|liquidat|crash|plunge|collapse|launder/i],
  ["rekor", /record high|all-time high|\bATH\b|record low/i]
];

export function assetKey(assetType, symbol) {
  const s = String(symbol || "").toUpperCase();
  if (assetType === "crypto") return s.replace(/USDT?$/, "");
  return s;
}

export function tagNews(title) {
  return NEWS_TAGS.filter(([, rx]) => rx.test(title)).map(([label]) => label);
}

// Artikel clickbait — dibuang untuk semua aset. Hanya pola yang jelas, supaya judul
// biasa ("Gold hits record, which is the biggest gain...") tidak ikut terbuang.
const CLICKBAIT = /\$[\d,]+ invested\b|\binvested \$[\d,]+|how much would you have|\bwhich (?:is|one|will|coin|stock) (?:is )?(?:worth more|better|drops? harder|falls? harder|the better buy)\b|\bwhich drops harder\b|better buy\b|should you buy|millionaire|\b\d+ reasons? to\b|\b\d+ (?:stocks|coins|altcoins|cryptos?) to (?:buy|watch)\b/i;

// Berita perusahaan TAMBANG (emas/perak) — menyebut "gold" tapi bukan soal harga emas
// ("Montage Gold", "Steppe Gold ESG report", ticker bursa). Hanya untuk logam: untuk
// crypto, "bitcoin miners" / "exchange deposits" justru relevan.
const MINING_NOISE = /\b(?:mine|mines|mining|miners?|drill(?:ing)?|exploration|resource growth|ounces? per|ESG|SEHK|TSX|ASX|NYSE|NASDAQ|LSE)\b|\b(?:gold|silver) (?:corp|group|ltd|inc|fields|resources|mining|royalt|deposit)/i;

// Pergerakan harga / pasar — tanda berita ini soal harga, bukan sekadar menyebut nama.
const PRICE_ACTION = /\bprices?\b|\bfutures\b|\bspot\b|surg|soar|jump|rall|climb|\brises?\b|\brising\b|\bgains?\b|\bfalls?\b|\bfell\b|\bdrops?\b|\bslip|\bslid|tumbl|plung|\bsinks?\b|rebound|recover|\bbreaks?\b|\btops?\b|\bbelow \$|\babove \$|\$\d[\d,]*k?\b|volatil|sell-?off|\bdemand\b/i;

// Item penting bila: menyebut aset (atau makro, untuk emas/forex), bukan noise,
// dan punya label penting ATAU membahas pergerakan harga.
export function isRelevant(item, cfg) {
  if (CLICKBAIT.test(item.title)) return false;
  if (cfg.miningNoise && MINING_NOISE.test(item.title)) return false;
  const mentions = cfg.mention.test(item.title);
  if (!mentions && !(cfg.macroRelevant && item.tags.includes("makro"))) return false;
  return item.tags.length > 0 || PRICE_ACTION.test(item.title);
}

const safeLink = link => (/^https?:\/\//i.test(link || "") ? link : null);

export function dedupeNews(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = it.link || it.title.toLowerCase().replace(/\W+/g, " ").trim();
    const tkey = it.title.toLowerCase().replace(/\W+/g, " ").trim();
    if (seen.has(key) || seen.has(tkey)) continue;
    seen.add(key); seen.add(tkey);
    out.push(it);
  }
  return out;
}

// Olah item RSS mentah -> berita relevan, berlabel, tanpa duplikat, terbaru dulu.
export function processSymbolNews(rawItems, cfg, { limit = 8, now = Date.now(), maxAgeHours = 72 } = {}) {
  const items = rawItems
    .map(i => ({ title: i.title, link: safeLink(i.link), pubDate: i.pubDate, source: "Yahoo Finance", tags: tagNews(i.title) }))
    .filter(i => i.title && isRelevant(i, cfg))
    .filter(i => {
      const t = Date.parse(i.pubDate);
      return !Number.isFinite(t) || now - t <= maxAgeHours * 3600e3;
    })
    .sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0));
  return dedupeNews(items).slice(0, limit);
}

// Kembalikan null bila aset tidak didukung (mis. saham) — pemanggil cukup lewati.
export async function fetchSymbolNews(assetType, symbol) {
  const cfg = ASSETS[assetKey(assetType, symbol)];
  if (!cfg) return null;
  const raw = (await Promise.allSettled(cfg.feeds.map(f => fetchRss(YAHOO_RSS(f), 25))))
    .filter(r => r.status === "fulfilled").flatMap(r => r.value);
  return { asset: cfg.label, items: processSymbolNews(raw, cfg) };
}
