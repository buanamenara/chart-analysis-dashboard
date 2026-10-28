import { fetchWithTimeout } from "./http.js";

const FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
// Data kalender (forecast/previous event terjadwal) tidak berubah tiap menit,
// jadi cache bisa cukup lama -> jauh mengurangi request ke ForexFactory yang
// sering kena rate-limit (429) karena IP edge Cloudflare dipakai bersama
// banyak proyek lain di seluruh dunia.
const CACHE_FRESH_SECONDS = 30 * 60; // dianggap "fresh", dipakai langsung
const CACHE_STORE_SECONDS = 6 * 3600; // disimpan di Cache API sampai 6 jam untuk fallback basi

// Mapping instrumen -> currency "base" (pembilang) & "quote" (penyebut).
// Dipakai untuk (1) filter event kalender yang relevan, dan (2) menerjemahkan
// bias mata uang jadi bias instrumen: kalau mata uang event = quote, arahnya
// TERBALIK (contoh: USD menguat -> XAUUSD/EURUSD cenderung turun).
// XAU/XAG tidak punya base currency sungguhan (bukan mata uang), base: null.
const SYMBOL_PAIR_INFO = {
  XAUUSD: { base: null, quote: "USD" },
  XAGUSD: { base: null, quote: "USD" },
  EURUSD: { base: "EUR", quote: "USD" },
  GBPUSD: { base: "GBP", quote: "USD" },
  USDJPY: { base: "USD", quote: "JPY" },
  AUDUSD: { base: "AUD", quote: "USD" },
  USDCAD: { base: "USD", quote: "CAD" },
  USDCHF: { base: "USD", quote: "CHF" },
  NZDUSD: { base: "NZD", quote: "USD" },
  EURJPY: { base: "EUR", quote: "JPY" },
  GBPJPY: { base: "GBP", quote: "JPY" }
};

// Crypto & saham: ForexFactory tidak mencakup token/saham spesifik,
// jadi semua instrumen di luar peta di atas otomatis pakai filter "High impact only".

export function relevantCurrencies(symbol) {
  const info = SYMBOL_PAIR_INFO[symbol];
  if (!info) return [];
  return [info.base, info.quote].filter(Boolean);
}

// Terjemahkan bias mata uang ("bullish"/"bearish" untuk `currency`) jadi bias
// instrumen itu sendiri. null kalau mata uang tidak relevan ke instrumen ini.
export function pairBiasFromCurrencyBias(symbol, currency, bias) {
  const info = SYMBOL_PAIR_INFO[symbol];
  if (!info || (bias !== "bullish" && bias !== "bearish")) return null;
  if (info.base === currency) return bias; // base currency -> arah sama
  if (info.quote === currency) return bias === "bullish" ? "bearish" : "bullish"; // quote -> arah terbalik
  return null;
}

async function fetchFromForexFactory() {
  const res = await fetchWithTimeout(FF_URL, { headers: { "User-Agent": UA, Accept: "application/json" }, timeoutMs: 20000 });
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
  if (memCache.events && now - memCache.fetchedAt < CACHE_FRESH_SECONDS * 1000) {
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
// lintas isolate (beda dengan variabel module-level yang cuma per-isolate).
// Payload disimpan beserta timestamp, dan Cache API diminta menyimpannya jauh
// lebih lama (CACHE_STORE_SECONDS) daripada jendela "fresh" (CACHE_FRESH_SECONDS)
// supaya ada data basi untuk fallback kalau ForexFactory sedang rate-limit (429)
// berkepanjangan dan belum sempat fetch baru yang berhasil.
async function getEconomicCalendarWorkers() {
  const cache = caches.default;
  const cacheKey = new Request("https://cache.internal/ff-economic-calendar");

  const cached = await cache.match(cacheKey);
  let cachedPayload = null;
  if (cached) {
    cachedPayload = await cached.json();
    const ageMs = Date.now() - cachedPayload.fetchedAt;
    if (ageMs < CACHE_FRESH_SECONDS * 1000) {
      return cachedPayload.events; // masih fresh, langsung pakai
    }
  }

  try {
    const events = await fetchFromForexFactory();
    const payload = { events, fetchedAt: Date.now() };
    const response = new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CACHE_STORE_SECONDS}` }
    });
    await cache.put(cacheKey, response.clone());
    return events;
  } catch (err) {
    if (cachedPayload) return cachedPayload.events; // basi tapi lebih baik dari error total
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
