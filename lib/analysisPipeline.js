import { fetchQuote, fetchOhlcv, fetchDailyBars } from "./marketData.js";
import { computeIndicators, summarizeTrend } from "./indicators.js";
import { findSwingPoints } from "./levels.js";
import { generateRuleBasedSignal } from "./ruleSignal.js";
import { computeSnrZones } from "./snr.js";
import { buildTechnicalAnalysis } from "./analysis.js";
import { computeMultiTimeframe } from "./multiTimeframe.js";
import { getFundamental } from "./fundamental.js";

// Satu-satunya implementasi alur analisa, dipakai bersama oleh server.js (Express)
// dan functions/api/*.js (Cloudflare Pages) supaya keduanya tidak bisa berbeda.

// Sumber candle yang dipakai (binance/gateio/coinbase/kraken/yahoo) + alasan fallback.
const dataSourceOf = bars => ({ source: bars?.source || null, fallbackReason: bars?.fallbackReason || null });

export async function buildSignalReport(assetType, symbol, interval) {
  const [bars, dailyBars] = await Promise.all([
    fetchOhlcv(assetType, symbol, interval),
    fetchDailyBars(assetType, symbol)
  ]);
  const indicators = computeIndicators(bars, { interval });
  return { ...generateRuleBasedSignal({ indicators, dailyBars, bars }), dataSource: dataSourceOf(bars) };
}

export async function buildSnrReport(assetType, symbol, interval) {
  const [bars, dailyBars] = await Promise.all([
    fetchOhlcv(assetType, symbol, interval),
    fetchDailyBars(assetType, symbol)
  ]);
  const indicators = computeIndicators(bars, { interval });
  // Sinyal dihitung dulu: pemilihan setup Buy/Sell di zona SNR mengikuti arah sinyal.
  const signal = generateRuleBasedSignal({ indicators, dailyBars, bars });
  const { zones, potential, skippedSetup, nearestSupport, nearestResistance, pivotLevels, volumeProfile, vwap, structure, orb } =
    computeSnrZones({ indicators, dailyBars, bars, signal });
  const [multiTimeframe, fundamental] = await Promise.all([
    computeMultiTimeframe(assetType, symbol, interval, signal.signal, dailyBars),
    getFundamental(assetType, symbol).catch(() => null)
  ]);
  const analysis = buildTechnicalAnalysis({ indicators, dailyBars, bars, signal, nearestSupport, nearestResistance, multiTimeframe, fundamental, volumeProfile, vwap, structure, orb });

  return {
    symbol,
    assetType,
    interval,
    currentPrice: indicators.lastClose,
    dataSource: dataSourceOf(bars),
    zones,
    potential,
    skippedSetup,
    nearestSupport,
    nearestResistance,
    pivotLevels,
    volumeProfile,
    vwap,
    structure,
    orb,
    analysis,
    multiTimeframe,
    signal: signal.signal,
    confidence: analysis.overallConfidence ?? signal.confidence,
    confidenceLabel: analysis.confidenceLabel ?? signal.confidenceLabel,
    signalReasons: signal.reasons,
    disclaimer: signal.disclaimer,
    bars: bars.slice(-180)
  };
}

// Support / resistance terdekat dari swing high/low (untuk strip info di Chart & Sinyal).
export function nearestSwingLevels(bars, price) {
  if (!Number.isFinite(price)) return { support: null, resistance: null };
  const { swingHighs, swingLows } = findSwingPoints(bars);
  const below = swingLows.map(s => s.price).filter(p => p < price);
  const above = swingHighs.map(s => s.price).filter(p => p > price);
  return {
    support: below.length ? Math.max(...below) : null,
    resistance: above.length ? Math.min(...above) : null
  };
}

export async function buildAnalysisData(assetType, symbol, interval) {
  const [quote, bars] = await Promise.all([
    fetchQuote(assetType, symbol),
    fetchOhlcv(assetType, symbol, interval)
  ]);
  const indicators = computeIndicators(bars, { interval });
  return {
    symbol,
    assetType,
    interval,
    quote,
    indicators,
    trendSummary: summarizeTrend(indicators),
    levels: nearestSwingLevels(bars, quote?.price ?? indicators.lastClose),
    dataSource: dataSourceOf(bars),
    barCount: bars.length,
    lastBars: bars.slice(-20)
  };
}
