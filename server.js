import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchQuote, fetchOhlcv, fetchDailyBars } from "./lib/marketData.js";
import { computeIndicators, summarizeTrend } from "./lib/indicators.js";
import { generateRuleBasedSignal } from "./lib/ruleSignal.js";
import { computeSnrZones } from "./lib/snr.js";
import { buildTechnicalAnalysis } from "./lib/analysis.js";
import { fetchRss, fetchRssMulti } from "./lib/rss.js";
import { NEWS_SOURCES, ECONOMIC_NEWS_SOURCE } from "./lib/newsSources.js";
import { getEconomicCalendar, filterCalendarBySymbol, pairBiasFromCurrencyBias } from "./lib/calendar.js";
import { annotateHighImpactEvents } from "./lib/newsAnalysis.js";
import { getFearGreedIndex, getCryptoGlobalStats } from "./lib/sentiment.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ============================================================
// CACHE SEDERHANA (in-memory)
// Tujuan: mengurangi panggilan ke Yahoo/Binance agar tidak kena
// rate-limit dan halaman terasa lebih cepat.
// Bisa dilewati dengan menambahkan ?nocache=1 di URL endpoint.
// ============================================================
const _cache = new Map();

function shouldBypassCache(req) {
  return req.query.nocache === "1" || req.query.nocache === "true";
}

function cached(key, ttlMs, fn) {
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && now - hit.t < ttlMs) return hit.p;

  const p = Promise.resolve().then(fn);
  _cache.set(key, { p, t: now });
  // Kalau gagal, hapus dari cache supaya request berikutnya mencoba lagi.
  p.catch(() => {
    const cur = _cache.get(key);
    if (cur && cur.p === p) _cache.delete(key);
  });
  return p;
}

// Bersihkan entri lama setiap 5 menit supaya memori tidak membengkak.
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000; // 30 menit
  for (const [k, v] of _cache) {
    if (v.t < cutoff) _cache.delete(k);
  }
}, 5 * 60 * 1000).unref?.();

// ============================================================
// ENDPOINT
// ============================================================

app.get("/api/quote", async (req, res) => {
  try {
    const { symbol, assetType } = req.query;
    if (!symbol || !assetType) return res.status(400).json({ error: "symbol & assetType wajib diisi" });

    const key = `quote:${assetType}:${symbol}`;
    const quote = shouldBypassCache(req)
      ? await fetchQuote(assetType, symbol)
      : await cached(key, 10_000, () => fetchQuote(assetType, symbol));
    res.json(quote);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/analysis-data", async (req, res) => {
  try {
    const { symbol, assetType, interval = "1h" } = req.query;
    if (!symbol || !assetType) return res.status(400).json({ error: "symbol & assetType wajib diisi" });

    const compute = async () => {
      const [quote, bars] = await Promise.all([
        fetchQuote(assetType, symbol),
        fetchOhlcv(assetType, symbol, interval)
      ]);
      const indicators = computeIndicators(bars);
      const trend = summarizeTrend(indicators);
      return {
        symbol,
        assetType,
        interval,
        quote,
        indicators,
        trendSummary: trend,
        barCount: bars.length,
        lastBars: bars.slice(-20)
      };
    };

    const key = `analysis:${assetType}:${symbol}:${interval}`;
    const data = shouldBypassCache(req) ? await compute() : await cached(key, 15_000, compute);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Sinyal teknikal rule-based - gratis, instan, tanpa AI/API berbayar.
app.get("/api/signal", async (req, res) => {
  try {
    const { symbol, assetType, interval = "1h" } = req.query;
    if (!symbol || !assetType) return res.status(400).json({ error: "symbol & assetType wajib diisi" });

    const compute = async () => {
      const [bars, dailyBars] = await Promise.all([
        fetchOhlcv(assetType, symbol, interval),
        fetchDailyBars(assetType, symbol)
      ]);
      const indicators = computeIndicators(bars);
      return generateRuleBasedSignal({ indicators, dailyBars, bars });
    };

    const key = `signal:${assetType}:${symbol}:${interval}`;
    const result = shouldBypassCache(req) ? await compute() : await cached(key, 20_000, compute);
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

    const compute = async () => {
      const [bars, dailyBars] = await Promise.all([
        fetchOhlcv(assetType, symbol, interval),
        fetchDailyBars(assetType, symbol)
      ]);
      const indicators = computeIndicators(bars);
      const { zones, potential, nearestSupport, nearestResistance, pivotLevels } = computeSnrZones({ indicators, dailyBars, bars });
      const signal = generateRuleBasedSignal({ indicators, dailyBars, bars });
      const analysis = buildTechnicalAnalysis({ indicators, dailyBars, bars, signal, nearestSupport, nearestResistance });

      return {
        symbol,
        assetType,
        interval,
        currentPrice: indicators.lastClose,
        zones,
        potential,
        nearestSupport,
        nearestResistance,
        pivotLevels,
        analysis,
        signal: signal.signal,
        confidence: signal.confidence,
        confidenceLabel: signal.confidenceLabel,
        signalReasons: signal.reasons,
        disclaimer: signal.disclaimer,
        bars: bars.slice(-180)
      };
    };

    const key = `snr:${assetType}:${symbol}:${interval}`;
    const data = shouldBypassCache(req) ? await compute() : await cached(key, 30_000, compute);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/news", async (req, res) => {
  try {
    const { assetType = "forex" } = req.query;

    const compute = async () => {
      const sources = NEWS_SOURCES[assetType] || NEWS_SOURCES.forex;
      const items = await fetchRssMulti(sources, 6);
      return { items };
    };

    const key = `news:${assetType}`;
    const data = shouldBypassCache(req) ? await compute() : await cached(key, 180_000, compute);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/economic-calendar", async (req, res) => {
  const { symbol } = req.query;

  const compute = async () => {
    let events = [];
    let calendarError = null;
    try {
      const all = await getEconomicCalendar();
      const filtered = symbol ? filterCalendarBySymbol(all, symbol) : all;
      // Prioritaskan event High Impact di atas (paling penting untuk trading),
      // lalu Medium/Low, masing-masing tetap urut waktu.
      const IMPACT_ORDER = { High: 0, Medium: 1, Low: 2, Holiday: 3 };
      filtered.sort((a, b) => (IMPACT_ORDER[a.impact] ?? 9) - (IMPACT_ORDER[b.impact] ?? 9) || (a.timestamp - b.timestamp));
      events = annotateHighImpactEvents(filtered.slice(0, 20), symbol, pairBiasFromCurrencyBias);
    } catch (err) {
      calendarError = err.message;
    }
    const [economicNews] = await Promise.allSettled([fetchRss(ECONOMIC_NEWS_SOURCE.url, 5)]);
    return {
      events,
      news: economicNews.status === "fulfilled" ? economicNews.value : [],
      calendarError
    };
  };

  const key = `calendar:${symbol || "all"}`;
  const data = shouldBypassCache(req) ? await compute() : await cached(key, 300_000, compute);
  res.json(data);
});

app.get("/api/sentiment", async (req, res) => {
  try {
    const compute = async () => {
      const [fngResult, globalResult] = await Promise.allSettled([getFearGreedIndex(), getCryptoGlobalStats()]);
      return {
        fearGreed: fngResult.status === "fulfilled" ? fngResult.value : null,
        cryptoGlobal: globalResult.status === "fulfilled" ? globalResult.value : null
      };
    };

    const key = "sentiment";
    const data = shouldBypassCache(req) ? await compute() : await cached(key, 180_000, compute);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Market dashboard jalan di http://localhost:${PORT}`);
});
