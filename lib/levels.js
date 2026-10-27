// Level & pola harga tambahan, terinspirasi kategori indikator populer
// (PDH/PDL, ADR, swing high/low, key level, pola candle, sesi pasar).
// Semua dihitung sendiri dari data OHLCV yang sudah ada — gratis, tanpa API tambahan.

export function computeDailyLevels(dailyBars) {
  if (!dailyBars || dailyBars.length < 2) return null;
  const today = dailyBars[dailyBars.length - 1];
  const yesterday = dailyBars[dailyBars.length - 2];

  const last14 = dailyBars.slice(-15, -1); // 14 hari sebelum hari ini
  const adr14 = last14.length
    ? last14.reduce((sum, b) => sum + (b.high - b.low), 0) / last14.length
    : null;

  return {
    prevDayHigh: yesterday.high,
    prevDayLow: yesterday.low,
    dailyOpen: today.open,
    adr14
  };
}

export function findSwingPoints(bars, lookback = 3, window = 80) {
  const recent = bars.slice(-window);
  const swingHighs = [];
  const swingLows = [];

  for (let i = lookback; i < recent.length - lookback; i++) {
    const slice = recent.slice(i - lookback, i + lookback + 1);
    const c = recent[i];
    if (c.high === Math.max(...slice.map(b => b.high))) swingHighs.push({ time: c.time, price: c.high });
    if (c.low === Math.min(...slice.map(b => b.low))) swingLows.push({ time: c.time, price: c.low });
  }

  return {
    swingHighs,
    swingLows,
    lastSwingHigh: swingHighs.at(-1) || null,
    lastSwingLow: swingLows.at(-1) || null
  };
}

// Level psikologis / bulat terdekat dari harga sekarang (mis. 4000, 4050 untuk gold;
// 80000, 81000 untuk BTC) — step menyesuaikan skala harga otomatis.
export function nearestKeyLevel(price) {
  if (!price) return null;
  const magnitude = Math.pow(10, Math.floor(Math.log10(price)) - 1);
  const step = magnitude; // contoh: harga ~4000 -> step 100; harga ~80000 -> step 1000
  const lower = Math.floor(price / step) * step;
  const upper = lower + step;
  const nearest = price - lower < upper - price ? lower : upper;
  return { level: nearest, distance: Math.abs(price - nearest), distancePercent: (Math.abs(price - nearest) / price) * 100 };
}

// Deteksi pola candle sederhana dari 1-2 candle terakhir.
export function detectCandlePattern(bars) {
  if (!bars || bars.length < 2) return null;
  const c = bars[bars.length - 1];
  const p = bars[bars.length - 2];

  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low || 1e-9;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const bodyRatio = body / range;

  const prevBody = Math.abs(p.close - p.open);
  const isBullish = c.close > c.open;
  const prevIsBullish = p.close > p.open;

  if (bodyRatio < 0.1) return { name: "Doji", bias: "netral" };

  if (!prevIsBullish && isBullish && c.close > p.open && c.open < p.close && body > prevBody) {
    return { name: "Bullish Engulfing", bias: "bullish" };
  }
  if (prevIsBullish && !isBullish && c.open > p.close && c.close < p.open && body > prevBody) {
    return { name: "Bearish Engulfing", bias: "bearish" };
  }
  if (bodyRatio < 0.35 && lowerWick > body * 2 && upperWick < body) {
    return { name: isBullish ? "Hammer" : "Hanging Man", bias: isBullish ? "bullish" : "bearish" };
  }
  if (bodyRatio < 0.35 && upperWick > body * 2 && lowerWick < body) {
    return { name: isBullish ? "Inverted Hammer" : "Shooting Star", bias: isBullish ? "netral" : "bearish" };
  }
  if (bodyRatio > 0.7) {
    return { name: isBullish ? "Bullish Marubozu" : "Bearish Marubozu", bias: isBullish ? "bullish" : "bearish" };
  }
  return null;
}

// Sesi pasar aktif berdasarkan jam UTC sekarang (perkiraan standar, tanpa DST).
export function getActiveSessions(date = new Date()) {
  const h = date.getUTCHours();
  const sessions = [];
  if (h >= 0 && h < 9) sessions.push("Tokyo/Asia");
  if (h >= 8 && h < 17) sessions.push("London");
  if (h >= 13 && h < 22) sessions.push("New York");
  return sessions.length ? sessions : ["Sepi (antar sesi)"];
}
