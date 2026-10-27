import { computeDailyLevels, findSwingPoints, nearestKeyLevel, detectCandlePattern, getActiveSessions } from "./levels.js";

// Mesin sinyal berbasis aturan (rule-based) — 100% gratis, tanpa AI/API berbayar.
// Setiap indikator "vote" bullish/bearish/netral, lalu dijumlah jadi sinyal akhir.
export function generateRuleBasedSignal({ indicators, dailyBars, bars }) {
  if (indicators.insufficientData) {
    return { signal: "NETRAL", score: 0, reasons: ["Data historis belum cukup."] };
  }

  const reasons = [];
  let bullish = 0;
  let bearish = 0;

  const price = indicators.lastClose;

  // 1. EMA20 vs EMA50 (tren jangka pendek)
  if (indicators.ema20 != null && indicators.ema50 != null) {
    if (indicators.ema20 > indicators.ema50) {
      bullish++;
      reasons.push(`**EMA20 (${indicators.ema20.toFixed(2)}) di atas EMA50 (${indicators.ema50.toFixed(2)})** -> bias naik jangka pendek.`);
    } else {
      bearish++;
      reasons.push(`**EMA20 (${indicators.ema20.toFixed(2)}) di bawah EMA50 (${indicators.ema50.toFixed(2)})** -> bias turun jangka pendek.`);
    }
  }

  // 2. Harga vs SMA200 (tren jangka panjang)
  if (indicators.sma200 != null) {
    if (price > indicators.sma200) {
      bullish++;
      reasons.push(`Harga di atas **SMA200 (${indicators.sma200.toFixed(2)})** -> tren besar masih naik.`);
    } else {
      bearish++;
      reasons.push(`Harga di bawah **SMA200 (${indicators.sma200.toFixed(2)})** -> tren besar masih turun.`);
    }
  }

  // 3. RSI
  if (indicators.rsi14 != null) {
    if (indicators.rsi14 < 30) {
      bullish++;
      reasons.push(`**RSI ${indicators.rsi14.toFixed(1)} (oversold)** -> rawan pantulan naik (reversal).`);
    } else if (indicators.rsi14 > 70) {
      bearish++;
      reasons.push(`**RSI ${indicators.rsi14.toFixed(1)} (overbought)** -> rawan koreksi turun.`);
    } else {
      reasons.push(`RSI ${indicators.rsi14.toFixed(1)} netral, belum ekstrem.`);
    }
  }

  // 4. MACD histogram
  if (indicators.macd?.histogram != null) {
    if (indicators.macd.histogram > 0) {
      bullish++;
      reasons.push(`**MACD histogram positif (${indicators.macd.histogram.toFixed(3)})** -> momentum naik.`);
    } else {
      bearish++;
      reasons.push(`**MACD histogram negatif (${indicators.macd.histogram.toFixed(3)})** -> momentum turun.`);
    }
  }

  // 5. Posisi dalam Bollinger Bands (%b)
  if (indicators.bollinger?.pb != null) {
    const pb = indicators.bollinger.pb;
    if (pb <= 0.05) {
      bullish++;
      reasons.push(`Harga nempel **Bollinger Band bawah** (%b=${pb.toFixed(2)}) -> potensi pantulan naik.`);
    } else if (pb >= 0.95) {
      bearish++;
      reasons.push(`Harga nempel **Bollinger Band atas** (%b=${pb.toFixed(2)}) -> potensi koreksi turun.`);
    }
  }

  // 6. Previous Day High/Low + ADR
  const daily = computeDailyLevels(dailyBars);
  if (daily) {
    if (price > daily.prevDayHigh) {
      bullish++;
      reasons.push(`Harga sudah **menembus PDH (Previous Day High) ${daily.prevDayHigh.toFixed(2)}** -> breakout naik.`);
    } else if (price < daily.prevDayLow) {
      bearish++;
      reasons.push(`Harga sudah **menembus PDL (Previous Day Low) ${daily.prevDayLow.toFixed(2)}** -> breakout turun.`);
    } else {
      reasons.push(`Harga masih di antara PDH ${daily.prevDayHigh.toFixed(2)} dan PDL ${daily.prevDayLow.toFixed(2)} (range harian).`);
    }
    if (daily.adr14) {
      reasons.push(`ADR 14 hari: **${daily.adr14.toFixed(2)}** poin -> perkiraan jangkauan gerak harga harian.`);
    }
  }

  // 7. Swing high/low terdekat (level support/resistance)
  const swing = findSwingPoints(bars);
  if (swing.lastSwingHigh || swing.lastSwingLow) {
    const parts = [];
    if (swing.lastSwingLow) parts.push(`support swing ~**${swing.lastSwingLow.price.toFixed(2)}**`);
    if (swing.lastSwingHigh) parts.push(`resistance swing ~**${swing.lastSwingHigh.price.toFixed(2)}**`);
    reasons.push(`Level terdekat: ${parts.join(", ")}.`);
  }

  // 8. Key level (angka bulat psikologis)
  const key = nearestKeyLevel(price);
  if (key && key.distancePercent < 0.3) {
    reasons.push(`Harga dekat **key level ${key.level}** (jarak ${key.distancePercent.toFixed(2)}%) -> sering jadi area reaksi harga.`);
  }

  // 9. Pola candlestick terakhir
  const pattern = detectCandlePattern(bars);
  if (pattern) {
    if (pattern.bias === "bullish") { bullish++; reasons.push(`Pola candle terakhir: **${pattern.name}** (bullish).`); }
    else if (pattern.bias === "bearish") { bearish++; reasons.push(`Pola candle terakhir: **${pattern.name}** (bearish).`); }
    else reasons.push(`Pola candle terakhir: ${pattern.name} (netral).`);
  }

  const sessions = getActiveSessions();
  reasons.push(`Sesi pasar aktif sekarang: **${sessions.join(", ")}**.`);

  const total = bullish + bearish;
  let signal = "NETRAL";
  if (total > 0) {
    if (bullish - bearish >= 2) signal = "BUY";
    else if (bearish - bullish >= 2) signal = "SELL";
  }

  return {
    signal,
    bullishCount: bullish,
    bearishCount: bearish,
    reasons,
    disclaimer: "Ini sinyal otomatis dari kombinasi indikator teknikal (rule-based), bukan nasihat keuangan. Selalu verifikasi sendiri sebelum mengambil keputusan."
  };
}
