import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchQuote, assetTypeError } from "./lib/marketData.js";
import { runBacktest, optimizeBacktest } from "./lib/backtest.js";
import { runScout } from "./lib/scout.js";
import { buildSignalReport, buildSnrReport, buildAnalysisData } from "./lib/analysisPipeline.js";
import { buildNewsReport } from "./lib/newsReport.js";
import { fetchRss } from "./lib/rss.js";
import { ECONOMIC_NEWS_SOURCE } from "./lib/newsSources.js";
import { getEconomicCalendar, filterCalendarBySymbol, pairBiasFromCurrencyBias } from "./lib/calendar.js";
import { annotateHighImpactEvents } from "./lib/newsAnalysis.js";
import { getFearGreedIndex, getCryptoGlobalStats } from "./lib/sentiment.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Tolak assetType yang tidak dikenal (400) untuk semua /api/*.
// Padanan Cloudflare: functions/api/_middleware.js (logika sama dari lib/marketData.js).
app.use("/api", (req, res, next) => {
  const err = assetTypeError(req.query.assetType);
  if (err) return res.status(400).json(err);
  next();
});

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
        hint: "Contoh: /api/quote?symbol=XAUUSD&assetType=forex"
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
        hint: "Contoh: /api/analysis-data?symbol=XAUUSD&assetType=forex&interval=1h"
      });
    }

    const compute = () => buildAnalysisData(assetType, symbol, interval);

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
        hint: "Contoh: /api/signal?symbol=XAUUSD&assetType=forex&interval=1h"
      });
    }

    const compute = () => buildSignalReport(assetType, symbol, interval);

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
        hint: "Contoh: /api/snr?symbol=XAUUSD&assetType=forex&interval=1h"
      });
    }

    const compute = () => buildSnrReport(assetType, symbol, interval);

    const key = `snr:${assetType}:${symbol}:${interval}`;
    const data = shouldBypassCache(req) ? await compute() : await cached(key, 30_000, compute);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

app.get("/api/news", async (req, res) => {
  try {
    const { assetType = "forex", symbol = "" } = req.query;
    const sym = String(symbol).slice(0, 20);

    const compute = () => buildNewsReport(assetType, sym);

    const key = `news:${assetType}:${sym}`;
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

app.get("/api/backtest", async (req, res) => {
  try {
    const { symbol, assetType, interval = "15m", strategy = "trendPB" } = req.query;
    if (!symbol || !assetType) return res.status(400).json({ error: "symbol & assetType wajib diisi" });
    const num = (v, d) => (v != null && v !== "" && !isNaN(+v) ? +v : d);
    const opts = {
      symbol, assetType, interval, strategy,
      slAtr: num(req.query.slAtr, 1.0), tpAtr: num(req.query.tpAtr, 1.5),
      rsiPullback: num(req.query.rsiPullback, 45), maxHold: num(req.query.maxHold, 12),
      costR: num(req.query.costR, 0.1)
    };
    const key = `bt:${assetType}:${symbol}:${interval}:${strategy}:${opts.slAtr}:${opts.tpAtr}:${opts.rsiPullback}:${opts.maxHold}:${opts.costR}`;
    const data = shouldBypassCache(req) ? await runBacktest(opts) : await cached(key, 600_000, () => runBacktest(opts));
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

app.get("/api/optimize", async (req, res) => {
  try {
    const { symbol, assetType, interval = "15m", strategy = "trendPB" } = req.query;
    if (!symbol || !assetType) return res.status(400).json({ error: "symbol & assetType wajib diisi" });
    const num = (v, d) => (v != null && v !== "" && !isNaN(+v) ? +v : d);
    const opts = { symbol, assetType, interval, strategy, costR: num(req.query.costR, 0.1) };
    const key = `opt:${assetType}:${symbol}:${interval}:${strategy}:${opts.costR}`;
    const data = shouldBypassCache(req) ? await optimizeBacktest(opts) : await cached(key, 900_000, () => optimizeBacktest(opts));
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

app.get("/api/scout", async (req, res) => {
  try {
    const { assetType, interval = "15m", symbols = "" } = req.query;
    const list = symbols.split(",").map(s => s.trim()).filter(Boolean);
    if (!assetType || !list.length) {
      return res.status(400).json({
        ok: false,
        code: "MISSING_PARAMS",
        error: "Parameter 'assetType' dan 'symbols' (dipisah koma) wajib diisi.",
        hint: "Contoh: /api/scout?assetType=forex&interval=15m&symbols=XAUUSD,EURUSD,GBPUSD"
      });
    }
    const key = `scout:${assetType}:${interval}:${list.join(",")}`;
    const compute = () => runScout(assetType, list, interval);
    const data = shouldBypassCache(req) ? await compute() : await cached(key, 60_000, compute);
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
