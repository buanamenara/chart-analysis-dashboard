import { fetchRss } from "../../lib/rss.js";
import { ECONOMIC_NEWS_SOURCE } from "../../lib/newsSources.js";
import { getEconomicCalendar, filterCalendarBySymbol } from "../../lib/calendar.js";

export async function onRequestGet({ request }) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");

  try {
    const events = await getEconomicCalendar();
    const filtered = symbol ? filterCalendarBySymbol(events, symbol) : events;
    const [economicNews] = await Promise.allSettled([fetchRss(ECONOMIC_NEWS_SOURCE.url, 5)]);
    return Response.json({
      events: filtered.slice(0, 20),
      news: economicNews.status === "fulfilled" ? economicNews.value : []
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
