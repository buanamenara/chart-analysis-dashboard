const FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const CACHE_TTL_SECONDS = 10 * 60; // 10 menit

// Mapping instrumen -> mata uang yang relevan di kalender ForexFactory
// (FF hanya mencakup mata uang mayor; saham Indonesia tidak tercakup, jadi dikosongkan).
const SYMBOL_CURRENCY_MAP = {
  XAUUSD: ["USD"],
  XAGUSD: ["USD"],
  EURUSD: ["EUR", "USD"],
  GBPUSD: ["GBP", "USD"],
  USDJPY: ["USD", "JPY"],
  AUDUSD: ["AUD", "USD"],
  USDCAD: ["USD", "CAD"],
  USDCHF: ["USD", "CHF"],
  NZDUSD: ["NZD", "USD"],
  EURJPY: ["EUR", "JPY"],
  GBPJPY: ["GBP", "JPY"]
};

// Crypto & saham: ForexFactory tidak mencakup token/saham spesifik,
// jadi semua instrumen di luar peta di atas otomatis pakai filter "High impact only".

export function relevantCurrencies(symbol) {
  return SYMBOL_CURRENCY_MAP[symbol] || [];
}

async function fetchFromForexFactory() {
  const res = await fetch(FF_URL, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`ForexFactory calendar error: ${res.status}`);
  const raw = await res.json();
  const now = Date.now();
  return raw
    .map(e => ({ ...e, timestamp: new Date(e.date).getTime() }))
    .filter(e => e.timestamp >= now - 24 * 3600 * 1000) // buang yang sudah lewat >1 hari
    .sort((a, b) => a.timestamp - b.timestamp);
}

// Cache in-memory untuk Node.js (dev lokal) — proses Node persisten jadi ini efektif.
let memCache = { events: null, fetchedAt: 0 };

async function getEconomicCalendarNode() {
  const now = Date.now();
  if (memCache.events && now - memCache.fetchedAt < CACHE_TTL_SECONDS * 1000) {
    return memCache.events;
  }
  try {
    const events = await fetchFromForexFactory();
    memCache = { events, fetchedAt: now };
    return events;
  } catch (err) {
    if (memCache.events) return memCache.events; // data basi > error total
    throw err;
  }
}

// Cache pakai Cloudflare Cache API untuk Workers/Pages Functions — di-share
// lintas isolate (beda dengan variabel module-level yang cuma per-isolate),
// jadi jauh lebih efektif menahan rate-limit ForexFactory (429).
async function getEconomicCalendarWorkers() {
  const cache = caches.default;
  const cacheKey = new Request("https://cache.internal/ff-economic-calendar");

  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  try {
    const events = await fetchFromForexFactory();
    const response = new Response(JSON.stringify(events), {
      headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CACHE_TTL_SECONDS}` }
    });
    await cache.put(cacheKey, response.clone());
    return events;
  } catch (err) {
    // Rate-limit tapi tidak ada entri cache valid sama sekali -> teruskan error.
    throw err;
  }
}

export async function getEconomicCalendar() {
  if (typeof caches !== "undefined" && caches.default) {
    return getEconomicCalendarWorkers();
  }
  return getEconomicCalendarNode();
}

export function filterCalendarBySymbol(events, symbol) {
  const currencies = relevantCurrencies(symbol);
  if (!currencies.length) return events.filter(e => e.impact === "High");
  return events.filter(e => currencies.includes(e.country));
}
