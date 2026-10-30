import { RSI, MACD, EMA, SMA, BollingerBands } from "technicalindicators";

export function computeIndicators(bars) {
  const closes = bars.map(b => b.close);

  if (closes.length < 30) {
    return { insufficientData: true };
  }

  const rsi = RSI.calculate({ period: 14, values: closes });
  const macd = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const ema20 = EMA.calculate({ period: 20, values: closes });
  const ema50 = EMA.calculate({ period: 50, values: closes });

  // PERBAIKAN: SMA200 hanya dihitung kalau data >= 200 bar.
  // Kalau kurang, kembalikan array kosong -> sistem anggap "data belum cukup".
  const sma200 = closes.length >= 200
    ? SMA.calculate({ period: 200, values: closes })
    : [];

  const bb = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
  const last = arr => (arr && arr.length ? arr[arr.length - 1] : null);

  return {
    lastClose: closes[closes.length - 1],
    rsi14: last(rsi),
    macd: last(macd),
    ema20: last(ema20),
    ema50: last(ema50),
    sma200: last(sma200),
    bollinger: last(bb),
    barsUsed: closes.length
  };
}

export function computeIndicatorSeries(bars) {
  const closes = bars.map(b => b.close);
  const n = closes.length;
  if (n < 30) return null;

  const sma200 = n >= 200 ? SMA.calculate({ period: 200, values: closes }) : [];
  const ema20 = EMA.calculate({ period: 20, values: closes });
  const ema50 = EMA.calculate({ period: 50, values: closes });
  const bb = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });

  const align = (series, period) => {
    const out = new Array(n).fill(null);
    for (let i = 0; i < series.length; i++) out[i + period - 1] = series[i];
    return out;
  };

  return {
    ema20: align(ema20, 20),
    ema50: align(ema50, 50),
    sma200: align(sma200, 200),
    bbUpper: align(bb.map(b => b.upper), 20),
    bbMiddle: align(bb.map(b => b.middle), 20),
    bbLower: align(bb.map(b => b.lower), 20)
  };
}

export function summarizeTrend(indicators) {
  if (indicators.insufficientData) return "Data tidak cukup untuk analisis indikator.";

  const { lastClose, ema20, ema50, sma200, rsi14, macd, bollinger } = indicators;
  const parts = [];

  if (ema20 && ema50) {
    parts.push(ema20 > ema50
      ? "EMA20 di atas EMA50 (bias naik jangka pendek)"
      : "EMA20 di bawah EMA50 (bias turun jangka pendek)");
  }

  if (sma200 != null) {
    parts.push(lastClose > sma200
      ? "Harga di atas SMA200 (tren besar naik)"
      : "Harga di bawah SMA200 (tren besar turun)");
  }

  if (macd?.histogram != null) {
    parts.push(macd.histogram > 0
      ? "MACD histogram positif (momentum naik)"
      : "MACD histogram negatif (momentum turun)");
  }

  if (bollinger?.pb != null) {
    if (bollinger.pb <= 0.05) parts.push("Harga nempel BB bawah (potensi pantulan naik)");
    else if (bollinger.pb >= 0.95) parts.push("Harga nempel BB atas (potensi koreksi turun)");
  }

  if (rsi14 != null) {
    if (rsi14 > 70) parts.push(`RSI ${rsi14.toFixed(1)} (overbought)`);
    else if (rsi14 < 30) parts.push(`RSI ${rsi14.toFixed(1)} (oversold)`);
    else parts.push(`RSI ${rsi14.toFixed(1)} (netral)`);
  }

  return parts.join(", ");
}
