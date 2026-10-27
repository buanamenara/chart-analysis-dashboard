const FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

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

export async function getEconomicCalendar() {
  const res = await fetch(FF_URL, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`ForexFactory calendar error: ${res.status}`);
  const events = await res.json();
  const now = Date.now();
  return events
    .map(e => ({ ...e, timestamp: new Date(e.date).getTime() }))
    .filter(e => e.timestamp >= now - 24 * 3600 * 1000) // buang yang sudah lewat >1 hari
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function filterCalendarBySymbol(events, symbol) {
  const currencies = relevantCurrencies(symbol);
  if (!currencies.length) return events.filter(e => e.impact === "High");
  return events.filter(e => currencies.includes(e.country));
}
