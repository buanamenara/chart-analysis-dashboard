import { computeDailyLevels, findSwingPoints, nearestKeyLevel, detectCandlePattern, getActiveSessions } from "./levels.js";

// Mesin sinyal berbasis aturan (rule-based) dengan sistem BOBOT (Weighted Voting).
// Tren (EMA/SMA) punya bobot lebih besar dibanding osilator (RSI/BB).
export function generateRuleBasedSignal({ indicators, dailyBars, bars }) {
  if (indicators.insufficientData) {
    return { signal: "NETRAL", score: 0, confidence: 0, confidenceLabel: "Rendah", reasons: ["Data historis belum cukup."] };
  }

  const reasons = [];
  let bullishScore = 0;
  let bearishScore = 0;
  let totalWeight = 0;

  const price = indicators.lastClose;

  // 1. EMA20 vs EMA50 (Tren jangka pendek) - BOBOT: 2.5
  if (indicators.ema20 != null && indicators.ema50 != null) {
    totalWeight += 2.5;
    if (indicators.ema20 > indicators.ema50) {
      bullishScore += 2.5;
      reasons.push(`**EMA20 (${indicators.ema20.toFixed(2)}) di atas EMA50 (${indicators.ema50.toFixed(2)})** -> bias naik jangka pendek.`);
    } else {
      bearishScore += 2.5;
      reasons.push(`**EMA20 (${indicators.ema20.toFixed(2)}) di bawah EMA50 (${indicators.ema50.toFixed(2)})** -> bias turun jangka pendek.`);
    }
  }

  // 2. Harga vs SMA200 (Tren jangka panjang) - BOBOT: 3.0 (Paling Berat)
  if (indicators.sma200 != null) {
    totalWeight += 3.0;
    if (price > indicators.sma200) {
      bullishScore += 3.0;
      reasons.push(`Harga di atas **SMA200 (${indicators.sma200.toFixed(2)})** -> tren besar masih naik.`);
    } else {
      bearishScore += 3.0;
      reasons.push(`Harga di bawah **SMA200 (${indicators.sma200.toFixed(2)})** -> tren besar masih turun.`);
    }
  }

  // 3. RSI - BOBOT: 1.0
  if (indicators.rsi14 != null) {
    totalWeight += 1.0;
    if (indicators.rsi14 < 30) {
      bullishScore += 1.0;
      reasons.push(`**RSI ${indicators.rsi14.toFixed(1)} (oversold)** -> rawan pantulan naik (reversal).`);
    } else if (indicators.rsi14 > 70) {
      bearishScore += 1.0;
      reasons.push(`**RSI ${indicators.rsi14.toFixed(1)} (overbought)** -> rawan koreksi turun.`);
    } else {
      reasons.push(`RSI ${indicators.rsi14.toFixed(1)} netral, belum ekstrem.`);
    }
  }

  // 4. MACD histogram - BOBOT: 1.5
  if (indicators.macd?.histogram != null) {
    totalWeight += 1.5;
    if (indicators.macd.histogram > 0) {
      bullishScore += 1.5;
      reasons.push(`**MACD histogram positif (${indicators.macd.histogram.toFixed(3)})** -> momentum naik.`);
    } else {
      bearishScore += 1.5;
      reasons.push(`**MACD histogram negatif (${indicators.macd.histogram.toFixed(3)})** -> momentum turun.`);
    }
  }

  // 5. Posisi dalam Bollinger Bands (%b) - BOBOT: 1.0
  if (indicators.bollinger?.pb != null) {
    totalWeight += 1.0;
    const pb = indicators.bollinger.pb;
    if (pb <= 0.05) {
      bullishScore += 1.0;
      reasons.push(`Harga nempel **Bollinger Band bawah** (%b=${pb.toFixed(2)}) -> potensi pantulan naik.`);
    } else if (pb >= 0.95) {
      bearishScore += 1.0;
      reasons.push(`Harga nempel **Bollinger Band atas** (%b=${pb.toFixed(2)}) -> potensi koreksi turun.`);
    }
  }

  // 6. Previous Day High/Low + ADR - BOBOT: 1.5
  const daily = computeDailyLevels(dailyBars);
  if (daily) {
    totalWeight += 1.5;
    if (price > daily.prevDayHigh) {
      bullishScore += 1.5;
      reasons.push(`Harga sudah **menembus PDH (Previous Day High) ${daily.prevDayHigh.toFixed(2)}** -> breakout naik.`);
    } else if (price < daily.prevDayLow) {
      bearishScore += 1.5;
      reasons.push(`Harga sudah **menembus PDL (Previous Day Low) ${daily.prevDayLow.toFixed(2)}** -> breakout turun.`);
    } else {
      reasons.push(`Harga masih di antara PDH ${daily.prevDayHigh.toFixed(2)} dan PDL ${daily.prevDayLow.toFixed(2)} (range harian).`);
    }
    if (daily.adr14) {
      reasons.push(`ADR 14 hari: **${daily.adr14.toFixed(2)}** poin -> perkiraan jangkauan gerak harga harian.`);
    }
  }

  // 7. Swing high/low terdekat (hanya info, tidak masuk bobot)
  const swing = findSwingPoints(bars);
  if (swing.lastSwingHigh || swing.lastSwingLow) {
    const parts = [];
    if (swing.lastSwingLow) parts.push(`support swing ~**${swing.lastSwingLow.price.toFixed(2)}**`);
    if (swing.lastSwingHigh) parts.push(`resistance swing ~**${swing.lastSwingHigh.price.toFixed(2)}**`);
    reasons.push(`Level terdekat: ${parts.join(", ")}.`);
  }

  // 8. Key level (hanya info)
  const key = nearestKeyLevel(price);
  if (key && key.distancePercent < 0.3) {
    reasons.push(`Harga dekat **key level ${key.level}** (jarak ${key.distancePercent.toFixed(2)}%) -> sering jadi area reaksi harga.`);
  }

  // 9. Pola candlestick terakhir - BOBOT: 1.0
  const pattern = detectCandlePattern(bars);
  if (pattern) {
    totalWeight += 1.0;
    if (pattern.bias === "bullish") { bullishScore += 1.0; reasons.push(`Pola candle terakhir: **${pattern.name}** (bullish).`); }
    else if (pattern.bias === "bearish") { bearishScore += 1.0; reasons.push(`Pola candle terakhir: **${pattern.name}** (bearish).`); }
    else reasons.push(`Pola candle terakhir: ${pattern.name} (netral).`);
  }

  const sessions = getActiveSessions();
  reasons.push(`Sesi pasar aktif sekarang: **${sessions.join(", ")}**.`);

  // --- PERHITUNGAN SKOR AKHIR ---
  const netScore = bullishScore - bearishScore;
  let signal = "NETRAL";
  
  // Butuh selisih minimal 3.0 poin untuk memicu sinyal (setara 1 tren kuat atau 2-3 indikator kecil)
  if (netScore >= 3.0) signal = "BUY";
  else if (netScore <= -3.0) signal = "SELL";

  // Confidence dihitung dari seberapa dominan skor yang menang
  const agreement = totalWeight > 0 ? Math.round((Math.max(bullishScore, bearishScore) / totalWeight) * 100) : 0;
  let confidenceLabel = "Rendah";
  if (agreement >= 75) confidenceLabel = "Tinggi";
  else if (agreement >= 50) confidenceLabel = "Sedang";

  return {
    signal,
    bullishCount: bullishScore,
    bearishCount: bearishScore,
    confidence: agreement,
    confidenceLabel,
    reasons,
    disclaimer: "Ini sinyal otomatis dari kombinasi indikator teknikal (rule-based), bukan nasihat keuangan. Selalu verifikasi sendiri sebelum mengambil keputusan."
  };
}
