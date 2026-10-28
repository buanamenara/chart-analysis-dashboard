import { computeDailyLevels, findSwingPoints, nearestKeyLevel, detectCandlePattern, getActiveSessions } from "./levels.js";

// Peta timeframe lebih tinggi untuk analisa konfirmasi arah.
const HIGHER_TIMEFRAME_MAP = {
  "1m": ["3m", "5m"],
  "3m": ["5m", "15m"],
  "5m": ["15m", "1h"],
  "15m": ["1h", "4h"],
  "1h": ["4h", "1d"],
  "4h": ["1d", "1wk"],
  "1d": ["1wk"],
  "1wk": []
};

export function getHigherTimeframes(interval) {
  return HIGHER_TIMEFRAME_MAP[interval] || [];
}

export function summarizeTimeframeSignals(currentSignal, rows) {
  const directional = rows.filter(r => r.signal !== "NETRAL");
  if (!directional.length) {
    return { bias: "NETRAL", agreementPercent: 0, currentAligned: false, directionalTimeframes: 0 };
  }

  const bullish = directional.filter(r => r.signal === "BUY").length;
  const bearish = directional.filter(r => r.signal === "SELL").length;
  const majority = bullish >= bearish ? "BUY" : "SELL";
  const agreement = Math.round((Math.max(bullish, bearish) / directional.length) * 100);

  return {
    bias: majority,
    agreementPercent: agreement,
    currentAligned: currentSignal === majority,
    directionalTimeframes: directional.length
  };
}

// Analisa teknikal lengkap (bukan hanya zona SNR): rangkum tren, momentum,
// volatilitas, level kunci, pola candle, dan sesi pasar, lalu simpulkan bias
// beserta level aksi yang bisa diperhatikan. Semua dihitung dari data OHLCV
// yang sama dengan indikator, jadi konsisten dengan harga di chart.
export function buildTechnicalAnalysis({ indicators, dailyBars, bars, signal, nearestSupport, nearestResistance }) {
  if (indicators.insufficientData) {
    return { bias: "neutral", conclusion: "Data historis belum cukup untuk analisa teknikal." };
  }

  const price = indicators.lastClose;
  const daily = computeDailyLevels(dailyBars);
  const swing = findSwingPoints(bars);
  const pattern = detectCandlePattern(bars);
  const key = nearestKeyLevel(price);

  const trendParts = [];
  if (indicators.ema20 != null && indicators.ema50 != null) {
    trendParts.push(indicators.ema20 > indicators.ema50
      ? `EMA20 (${indicators.ema20.toFixed(2)}) di atas EMA50 (${indicators.ema50.toFixed(2)}) → bias naik jangka pendek`
      : `EMA20 (${indicators.ema20.toFixed(2)}) di bawah EMA50 (${indicators.ema50.toFixed(2)}) → bias turun jangka pendek`);
  }
  if (indicators.sma200 != null) {
    trendParts.push(price > indicators.sma200
      ? `harga di atas SMA200 (${indicators.sma200.toFixed(2)}) → tren besar naik`
      : `harga di bawah SMA200 (${indicators.sma200.toFixed(2)}) → tren besar turun`);
  }

  const momentumParts = [];
  if (indicators.rsi14 != null) {
    if (indicators.rsi14 > 70) momentumParts.push(`RSI ${indicators.rsi14.toFixed(1)} overbought (rawan koreksi)`);
    else if (indicators.rsi14 < 30) momentumParts.push(`RSI ${indicators.rsi14.toFixed(1)} oversold (rawan pantul)`);
    else momentumParts.push(`RSI ${indicators.rsi14.toFixed(1)} netral`);
  }
  if (indicators.macd?.histogram != null) {
    momentumParts.push(`MACD histogram ${indicators.macd.histogram > 0 ? "positif" : "negatif"} (momentum ${indicators.macd.histogram > 0 ? "naik" : "turun"})`);
  }

  const volParts = [];
  if (indicators.bollinger?.pb != null) {
    if (indicators.bollinger.pb <= 0.05) volParts.push("harga menempel Bollinger Bawah (jenuh jual, rawan pantul naik)");
    else if (indicators.bollinger.pb >= 0.95) volParts.push("harga menempel Bollinger Atas (jenuh beli, rawan koreksi turun)");
    else volParts.push(`%b ${indicators.bollinger.pb.toFixed(2)} (harga di dalam band)`);
  }
  if (daily?.adr14) volParts.push(`ADR14 ≈ ${daily.adr14.toFixed(2)} poin`);

  const support = nearestSupport ? nearestSupport.mid : (swing.lastSwingLow ? swing.lastSwingLow.price : null);
  const resistance = nearestResistance ? nearestResistance.mid : (swing.lastSwingHigh ? swing.lastSwingHigh.price : null);

  const candle = pattern
    ? `${pattern.name} (${pattern.bias === "bullish" ? "bullish" : pattern.bias === "bearish" ? "bearish" : "netral"})`
    : "tidak ada pola signifikan";

  const sessions = getActiveSessions().join(", ");

  const bullish = signal?.bullishCount ?? 0;
  const bearish = signal?.bearishCount ?? 0;
  let bias = "neutral";
  if (bullish - bearish >= 2) bias = "bullish";
  else if (bearish - bullish >= 2) bias = "bearish";

  let conclusion;
  if (bias === "bullish") {
    conclusion = `Bias teknikal cenderung BULLISH (${bullish} indikator bullish vs ${bearish} bearish). Konfirmasi beli bila harga bertahan di atas support ${support ? support.toFixed(2) : "-"} dan menembus resistance ${resistance ? resistance.toFixed(2) : "-"}; sebaliknya waspada bila support tersebut jebol.`;
  } else if (bias === "bearish") {
    conclusion = `Bias teknikal cenderung BEARISH (${bearish} indikator bearish vs ${bullish} bullish). Konfirmasi jual bila harga gagal menembus resistance ${resistance ? resistance.toFixed(2) : "-"} dan breakdown support ${support ? support.toFixed(2) : "-"}; sebaliknya waspada bila resistance tersebut tembus.`;
  } else {
    conclusion = `Bias NETRAL/campur (${bullish} bullish vs ${bearish} bearish) — belum ada dominasi arah. Tunggu harga menembus resistance ${resistance ? resistance.toFixed(2) : "-"} (ke atas) atau support ${support ? support.toFixed(2) : "-"} (ke bawah) untuk sinyal lanjutan.`;
  }

  return {
    price,
    bias,
    bullishCount: bullish,
    bearishCount: bearish,
    trend: trendParts.join("; ") || "-",
    momentum: momentumParts.join("; ") || "-",
    volatility: volParts.join("; ") || "-",
    candle,
    sessions,
    keyLevel: key ? `key level psikologis ${key.level}` : null,
    support,
    resistance,
    conclusion
  };
}
