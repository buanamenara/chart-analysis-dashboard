import { fetchRss } from "../../lib/rss.js";
import { ECONOMIC_NEWS_SOURCE } from "../../lib/newsSources.js";
import { getEconomicCalendar, filterCalendarBySymbol, pairBiasFromCurrencyBias } from "../../lib/calendar.js";
import { annotateHighImpactEvents } from "../../lib/newsAnalysis.js";

export async function onRequestGet({ request }) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");

  try {
    const events = await getEconomicCalendar();
    const filtered = symbol ? filterCalendarBySymbol(events, symbol) : events;
    // Prioritaskan event High Impact di atas (paling penting untuk trading),
    // lalu Medium/Low, masing-masing tetap urut waktu.
    const IMPACT_ORDER = { High: 0, Medium: 1, Low: 2, Holiday: 3 };
    filtered.sort((a, b) => (IMPACT_ORDER[a.impact] ?? 9) - (IMPACT_ORDER[b.impact] ?? 9) || (a.timestamp - b.timestamp));
    const annotated = annotateHighImpactEvents(filtered.slice(0, 20), symbol, pairBiasFromCurrencyBias);
    const [economicNews] = await Promise.allSettled([fetchRss(ECONOMIC_NEWS_SOURCE.url, 5)]);
    return Response.json({
      events: annotated,
      news: economicNews.status === "fulfilled" ? economicNews.value : []
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
