import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchQuote, fetchOhlcv, fetchDailyBars } from "./lib/marketData.js";
import { computeIndicators, summarizeTrend } from "./lib/indicators.js";
import { generateRuleBasedSignal } from "./lib/ruleSignal.js";
import { computeSnrZones } from "./lib/snr.js";
import { fetchRss, fetchRssMulti } from "./lib/rss.js";
import { NEWS_SOURCES, ECONOMIC_NEWS_SOURCE } from "./lib/newsSources.js";
import { getEconomicCalendar, filterCalendarBySymbol } from "./lib/calendar.js";
import { getFearGreedIndex, getCryptoGlobalStats } from "./lib/sentiment.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/quote", async (req, res) => {
  try {
    const { symbol, assetType } = req.query;
    if (!symbol || !assetType) return res.status(400).json({ error: "symbol & assetType wajib diisi" });
    const quote = await fetchQuote(assetType, symbol);
    res.json(quote);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/analysis-data", async (req, res) => {
  try {
    const { symbol, assetType, interval = "1h" } = req.query;
    if (!symbol || !assetType) return res.status(400).json({ error: "symbol & assetType wajib diisi" });

    const [quote, bars] = await Promise.all([
      fetchQuote(assetType, symbol),
      fetchOhlcv(assetType, symbol, interval)
    ]);
    const indicators = computeIndicators(bars);
    const trend = summarizeTrend(indicators);

    res.json({
      symbol,
      assetType,
      interval,
      quote,
      indicators,
      trendSummary: trend,
      barCount: bars.length,
      lastBars: bars.slice(-20)
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Sinyal teknikal rule-based - gratis, instan, tanpa AI/API berbayar.
app.get("/api/signal", async (req, res) => {
  try {
    const { symbol, assetType, interval = "1h" } = req.query;
    if (!symbol || !assetType) return res.status(400).json({ error: "symbol & assetType wajib diisi" });

    const [bars, dailyBars] = await Promise.all([
      fetchOhlcv(assetType, symbol, interval),
      fetchDailyBars(assetType, symbol)
    ]);
    const indicators = computeIndicators(bars);
    const result = generateRuleBasedSignal({ indicators, dailyBars, bars });

    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Analisa SNR (Support/Resistance) + potensi area Buy/Sell untuk digambar di chart.
app.get("/api/snr", async (req, res) => {
  try {
    const { symbol, assetType, interval = "1h" } = req.query;
    if (!symbol || !assetType) return res.status(400).json({ error: "symbol & assetType wajib diisi" });

    const [bars, dailyBars] = await Promise.all([
      fetchOhlcv(assetType, symbol, interval),
      fetchDailyBars(assetType, symbol)
    ]);
    const indicators = computeIndicators(bars);
    const { zones, potential } = computeSnrZones({ indicators, dailyBars, bars });
    const signal = generateRuleBasedSignal({ indicators, dailyBars, bars });

    res.json({
      symbol,
      assetType,
      interval,
      currentPrice: indicators.lastClose,
      zones,
      potential,
      signal: signal.signal,
      signalReasons: signal.reasons,
      disclaimer: signal.disclaimer,
      bars: bars.slice(-180)
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/news", async (req, res) => {
  try {
    const { assetType = "forex" } = req.query;
    const sources = NEWS_SOURCES[assetType] || NEWS_SOURCES.forex;
    const items = await fetchRssMulti(sources, 6);
    res.json({ items });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/economic-calendar", async (req, res) => {
  try {
    const { symbol } = req.query;
    const events = await getEconomicCalendar();
    const filtered = symbol ? filterCalendarBySymbol(events, symbol) : events;
    const [economicNews] = await Promise.allSettled([fetchRss(ECONOMIC_NEWS_SOURCE.url, 5)]);
    res.json({
      events: filtered.slice(0, 20),
      news: economicNews.status === "fulfilled" ? economicNews.value : []
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/sentiment", async (req, res) => {
  try {
    const [fngResult, globalResult] = await Promise.allSettled([getFearGreedIndex(), getCryptoGlobalStats()]);
    res.json({
      fearGreed: fngResult.status === "fulfilled" ? fngResult.value : null,
      cryptoGlobal: globalResult.status === "fulfilled" ? globalResult.value : null
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Market dashboard jalan di http://localhost:${PORT}`);
});
