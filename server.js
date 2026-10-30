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
// CACHE SEDERHANA (in-memory) — dari perbaikan #3
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
  p.catch(() => {
    const cur = _cache.get(key);
    if (cur && cur.p === p) _cache.delete(key);
  });
  return p;
}

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [k, v] of _cache) {
    if (v.t < cutoff) _cache.delete(k);
  }
}, 5 * 60 * 1000).unref?.();

// ============================================================
// ERROR HELPER — perbaikan #4
// Semua error diklasifikasikan supaya pesan ke pengguna jelas:
//   400 → input salah
//   404 → simbol tidak ditemukan
//   429 → kena rate-limit pihak ketiga
//   502 → gagal ambil data dari sumber
//   500 → bug internal
// ============================================================
function classifyError(err) {
  const msg = String(err?.message || "").toLowerCase();

  // Rate limit
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many")) {
    return {
      status: 429,
      code: "RATE_LIMITED",
      error: "Terlalu banyak permintaan ke sumber data.",
      hint: "Tunggu sekitar 30–60 detik, lalu coba lagi."
    };
  }

  // Simbol tidak ditemukan
  if (
    msg.includes("not found") ||
    msg.includes("tidak ditemukan") ||
    msg.includes("invalid symbol") ||
    msg.includes("unknown symbol") ||
    msg.includes("no data")
  ) {
    return {
      status: 404,
      code: "SYMBOL_NOT_FOUND",
      error: "Simbol atau instrumen tidak ditemukan di sumber data.",
      hint: "Periksa ejaan simbol, atau pilih instrumen lain dari daftar."
    };
  }

  // Timeout / jaringan
  if (
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("econnrefused") ||
    msg.includes("network") ||
    msg.includes("fetch failed") ||
    msg.includes("enotfound")
  ) {
    return {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      error: "Gagal menghubungi sumber data.",
      hint: "Periksa koneksi internet. Kalau tetap gagal, coba beberapa menit lagi."
    };
  }

  // Default: anggap masalah upstream
  return {
    status: 502,
    code: "UPSTREAM_ERROR",
    error: "Gagal mengambil data dari sumber.",
    hint: "Coba lagi beberapa saat. Kalau berulang, ganti simbol atau timeframe."
  };
}

function sendError(res, err) {
  const info = classifyError(err);
  // Log ringkas di server untuk keperluan debug
  console.warn(`[API ${info.code}]`, err?.message || err);
  res.status(info.status).json({
    ok: false,
    code: info.code,
    error: info.error,
    hint: info.hint,
    detail: process.env.NODE_ENV === "production" ? undefined : String(err?.message || err)
  });
}

// ============================================================
// ENDPOINT
// ============================================================

app.get("/api/quote", async (req, res) => {
  try {
    const { symbol, assetType } = req.query;
    if (!symbol || !assetType) {
      return res.status(400).json({
        ok: false,
        code: "MISSING_PARAMS",
        error: "Parameter 'symbol' dan 'assetType' wajib diisi.",
        hint: "Contoh: /api/quote?symbol=XAUUSD&assetType=gold"
      });
    }

    const key = `quote:${assetType}:${symbol}`;
    const quote = shouldBypassCache(req)
      ? await fetchQuote(assetType, symbol)
      : await cached(key, 10_000, () => fetchQuote(assetType, symbol));
    res.json(quote);
  } catch (err) {
    sendError(res, err);
  }
});

app.get("/api/analysis-data", async (req, res) => {
  try {
    const { symbol, assetType, interval = "1h" } = req.query;
    if (!symbol || !assetType) {
      return res.status(400).json({
        ok: false,
        code: "MISSING_PARAMS",
        error: "Parameter 'symbol' dan 'assetType' wajib diisi.",
        hint: "Contoh: /api/analysis-data?symbol=XAUUSD&assetType=gold&interval=1h"
      });
    }

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
    sendError(res, err);
  }
});

// Sinyal teknikal rule-based - gratis, instan, tanpa AI/API berbayar.
app.get("/api/signal", async (req, res) => {
  try {
    const { symbol, assetType, interval = "1h" } = req.query;
    if (!symbol || !assetType) {
      return res.status(400).json({
        ok: false,
        code: "MISSING_PARAMS",
        error: "Parameter 'symbol' dan 'assetType' wajib diisi.",
        hint: "Contoh: /api/signal?symbol=XAUUSD&assetType=gold&interval=1h"
      });
    }

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
    sendError(res, err);
  }
});

// Analisa SNR (Support/Resistance) + potensi area Buy/Sell untuk digambar di chart.
app.get("/api/snr", async (req, res) => {
  try {
    const { symbol, assetType, interval = "1h" } = req.query;
    if (!symbol || !assetType) {
      return res.status(400).json({
        ok: false,
        code: "MISSING_PARAMS",
        error: "Parameter 'symbol' dan 'assetType' wajib diisi.",
        hint: "Contoh: /api/snr?symbol=XAUUSD&assetType=gold&interval=1h"
      });
    }

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
    sendError(res, err);
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
    sendError(res, err);
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

  try {
    const key = `calendar:${symbol || "all"}`;
    const data = shouldBypassCache(req) ? await compute() : await cached(key, 300_000, compute);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
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
    sendError(res, err);
  }
});

// Fallback 404 untuk endpoint API yang tidak dikenal
app.use("/api", (req, res) => {
  res.status(404).json({
    ok: false,
    code: "ENDPOINT_NOT_FOUND",
    error: `Endpoint '${req.path}' tidak tersedia.`,
    hint: "Cek daftar endpoint di dokumentasi atau gunakan URL yang benar."
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Market dashboard jalan di http://localhost:${PORT}`);
});
