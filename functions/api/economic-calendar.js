import { getEconomicCalendar, filterCalendarBySymbol, pairBiasFromCurrencyBias } from "../../lib/calendar.js";
import { annotateHighImpactEvents } from "../../lib/newsAnalysis.js";
import { fetchRss } from "../../lib/rss.js";
import { ECONOMIC_NEWS_SOURCE } from "../../lib/newsSources.js";

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");

  try {
    let events = [];
    let calendarError = null;
    
    try {
      const all = await getEconomicCalendar();
      const filtered = symbol ? filterCalendarBySymbol(all, symbol) : all;
      const IMPACT_ORDER = { High: 0, Medium: 1, Low: 2, Holiday: 3 };
      filtered.sort((a, b) => (IMPACT_ORDER[a.impact] ?? 9) - (IMPACT_ORDER[b.impact] ?? 9) || (a.timestamp - b.timestamp));
      events = annotateHighImpactEvents(filtered.slice(0, 20), symbol, pairBiasFromCurrencyBias);
    } catch (err) {
      calendarError = err.message;
    }

    const [economicNews] = await Promise.allSettled([fetchRss(ECONOMIC_NEWS_SOURCE.url, 5)]);
    
    const data = {
      events,
      news: economicNews.status === "fulfilled" ? economicNews.value : [],
      calendarError
    };

    return new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "max-age=300"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      code: "UPSTREAM_ERROR",
      error: "Gagal mengambil kalender ekonomi.",
      hint: "Coba lagi beberapa saat."
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}
