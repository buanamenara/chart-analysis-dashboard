import { computeDailyLevels, findSwingPoints, nearestKeyLevel, detectCandlePattern, getActiveSessions } from "./levels.js";

// Mesin sinyal berbasis aturan (rule-based) dengan BOBOT yang menyesuaikan kondisi pasar.
//
// Dua jenis bukti dipisah karena sering saling bertentangan:
//  - Bukti TREN (EMA20/50, SMA200, MACD, breakout PDH/PDL): "ikuti arah".
//  - Bukti PANTULAN (RSI ekstrem, sentuh Bollinger): "harga sudah terlalu jauh, rawan balik".
// ADX dipakai untuk satu hal: bukti pantulan yang MELAWAN tren kuat dikurangi bobotnya
// secara bertahap, dari 1x (ADX 25) ke 0 (ADX 35) — overbought saat tren naik kuat itu
// normal ("band walk"), bukan alasan SELL. Bukti pantulan yang searah tren (pullback)
// tetap dihitung penuh.
// Catatan uji walk-forward 2 tahun (XAUUSD/BTC/ETH, TF 1h): memotong bobot tren &
// menggandakan bobot pantulan saat ranging TIDAK menambah akurasi dan membuat sinyal
// berganti ~70% lebih sering, jadi tidak dipakai.
// Komponen yang netral TIDAK ikut dihitung bobotnya, jadi keyakinan = porsi bobot
// pemenang di antara bukti yang benar-benar memberi arah.

export const SIGNAL_THRESHOLD = 3.0;

const W = { ema: 2.5, sma200: 3.0, macd: 1.5, pdBreak: 1.5, rsi: 1.0, bb: 1.0, candle: 1.0 };

export function marketRegime(adx) {
  if (adx == null) return "normal";
  if (adx >= 25) return "trending";
  if (adx < 20) return "ranging";
  return "normal";
}

const round1 = x => Math.round(x * 10) / 10;
const lerp01 = (x, a, b) => Math.min(1, Math.max(0, (x - a) / (b - a)));

// Pengali bobot bukti pantulan yang MELAWAN tren: 1x (ADX <= 25) turun linear ke 0 (ADX >= 35).
export function counterTrendWeight(adx) {
  return adx == null ? 1 : 1 - lerp01(adx, 25, 35);
}

export function generateRuleBasedSignal({ indicators, dailyBars, bars }) {
  if (indicators.insufficientData) {
    return { signal: "NETRAL", score: 0, confidence: 0, confidenceLabel: "Rendah", reasons: ["Data historis belum cukup."] };
  }

  const reasons = [];
  let bull = 0, bear = 0;
  const price = indicators.lastClose;
  const regime = marketRegime(indicators.adx14);
  const counterMult = counterTrendWeight(indicators.adx14);

  const vote = (dir, weight, text) => {
    if (dir > 0) bull += weight; else if (dir < 0) bear += weight;
    reasons.push(text);
  };

  // Arah tren dominan (untuk menilai apakah bukti pantulan melawan tren).
  let trendDir = 0;
  if (indicators.plusDI != null && indicators.minusDI != null && indicators.adx14 >= 25) {
    trendDir = indicators.plusDI > indicators.minusDI ? 1 : -1;
  } else if (indicators.ema20 != null && indicators.ema50 != null) {
    trendDir = indicators.ema20 > indicators.ema50 ? 1 : -1;
  }

  // Bukti pantulan: makin kecil bila melawan tren yang makin kuat, lebih besar saat ranging.
  const revWeight = (dir, base) => base * (dir === -trendDir ? counterMult : 1);

  // ---------- BUKTI TREN ----------
  if (indicators.ema20 != null && indicators.ema50 != null) {
    const up = indicators.ema20 > indicators.ema50;
    vote(up ? 1 : -1, W.ema, `**EMA20 (${indicators.ema20.toFixed(2)}) ${up ? "di atas" : "di bawah"} EMA50 (${indicators.ema50.toFixed(2)})** -> bias ${up ? "naik" : "turun"} jangka pendek.`);
  }
  if (indicators.sma200 != null) {
    const up = price > indicators.sma200;
    vote(up ? 1 : -1, W.sma200, `Harga ${up ? "di atas" : "di bawah"} **SMA200 (${indicators.sma200.toFixed(2)})** -> tren besar masih ${up ? "naik" : "turun"}.`);
  }
  if (indicators.macd?.histogram != null) {
    const up = indicators.macd.histogram > 0;
    vote(up ? 1 : -1, W.macd, `**MACD histogram ${up ? "positif" : "negatif"} (${indicators.macd.histogram.toFixed(3)})** -> momentum ${up ? "naik" : "turun"}.`);
  }

  const daily = computeDailyLevels(dailyBars);
  if (daily) {
    if (price > daily.prevDayHigh) {
      vote(1, W.pdBreak, `Harga sudah **menembus PDH (Previous Day High) ${daily.prevDayHigh.toFixed(2)}** -> breakout naik.`);
    } else if (price < daily.prevDayLow) {
      vote(-1, W.pdBreak, `Harga sudah **menembus PDL (Previous Day Low) ${daily.prevDayLow.toFixed(2)}** -> breakout turun.`);
    } else {
      reasons.push(`Harga masih di antara PDH ${daily.prevDayHigh.toFixed(2)} dan PDL ${daily.prevDayLow.toFixed(2)} (range harian).`);
    }
    if (daily.adr14) reasons.push(`ADR 14 hari: **${daily.adr14.toFixed(2)}** poin -> perkiraan jangkauan gerak harga harian.`);
  }

  // ---------- BUKTI PANTULAN ----------
  if (indicators.rsi14 != null) {
    const r = indicators.rsi14;
    if (r < 30 || r > 70) {
      const dir = r < 30 ? 1 : -1;
      const w = revWeight(dir, W.rsi);
      const label = r < 30 ? "oversold" : "overbought";
      if (w > 0) vote(dir, w, `**RSI ${r.toFixed(1)} (${label})** -> rawan ${dir > 0 ? "pantulan naik" : "koreksi turun"}.`);
      else reasons.push(`RSI ${r.toFixed(1)} ${label}, tapi **diabaikan** karena tren ${trendDir > 0 ? "naik" : "turun"} sedang kuat (wajar di tren kuat).`);
    } else {
      reasons.push(`RSI ${r.toFixed(1)} netral, belum ekstrem.`);
    }
  }
  if (indicators.bollinger?.pb != null) {
    const pb = indicators.bollinger.pb;
    if (pb <= 0.05 || pb >= 0.95) {
      const dir = pb <= 0.05 ? 1 : -1;
      const w = revWeight(dir, W.bb);
      const band = dir > 0 ? "bawah" : "atas";
      if (w > 0) vote(dir, w, `Harga nempel **Bollinger Band ${band}** (%b=${pb.toFixed(2)}) -> potensi ${dir > 0 ? "pantulan naik" : "koreksi turun"}.`);
      else reasons.push(`Harga nempel Bollinger ${band} (%b=${pb.toFixed(2)}), **diabaikan** karena searah tren kuat (band walk).`);
    }
  }

  // ---------- POLA CANDLE (dari candle yang sudah tertutup) ----------
  const closedBars = indicators.lastBarOpen ? bars.slice(0, -1) : bars;
  const pattern = detectCandlePattern(closedBars);
  if (pattern) {
    if (pattern.bias === "bullish") vote(1, W.candle, `Pola candle terakhir (tertutup): **${pattern.name}** (bullish).`);
    else if (pattern.bias === "bearish") vote(-1, W.candle, `Pola candle terakhir (tertutup): **${pattern.name}** (bearish).`);
    else reasons.push(`Pola candle terakhir: ${pattern.name} (netral).`);
  }

  // ---------- INFO (tanpa bobot) ----------
  const swing = findSwingPoints(bars);
  if (swing.lastSwingHigh || swing.lastSwingLow) {
    const parts = [];
    if (swing.lastSwingLow) parts.push(`support swing ~**${swing.lastSwingLow.price.toFixed(2)}**`);
    if (swing.lastSwingHigh) parts.push(`resistance swing ~**${swing.lastSwingHigh.price.toFixed(2)}**`);
    reasons.push(`Level terdekat: ${parts.join(", ")}.`);
  }
  const key = nearestKeyLevel(price);
  if (key && key.distancePercent < 0.3) {
    reasons.push(`Harga dekat **key level ${key.level}** (jarak ${key.distancePercent.toFixed(2)}%) -> sering jadi area reaksi harga.`);
  }
  if (counterMult < 1) reasons.push(`Tren kuat (ADX ${indicators.adx14.toFixed(1)}): sinyal pantulan yang melawan tren hanya dihitung ${Math.round(counterMult * 100)}% bobotnya.`);
  if (indicators.lastBarOpen) reasons.push("Indikator dihitung dari candle yang **sudah tertutup**; candle berjalan tidak dipakai agar sinyal tidak berubah-ubah.");
  reasons.push(`Sesi pasar aktif sekarang: **${getActiveSessions().join(", ")}**.`);

  // ---------- KESIMPULAN ----------
  const net = bull - bear;
  let signal = "NETRAL";
  if (net >= SIGNAL_THRESHOLD) signal = "BUY";
  else if (net <= -SIGNAL_THRESHOLD) signal = "SELL";

  const voted = bull + bear;
  const confidence = voted > 0 ? Math.round((Math.max(bull, bear) / voted) * 100) : 0;
  let confidenceLabel = "Rendah";
  if (confidence >= 75) confidenceLabel = "Tinggi";
  else if (confidence >= 50) confidenceLabel = "Sedang";

  return {
    signal,
    regime,
    // bobot (bukan jumlah indikator) — dipertahankan namanya demi kompatibilitas
    bullishCount: round1(bull),
    bearishCount: round1(bear),
    netScore: round1(net),
    confidence,
    confidenceLabel,
    reasons,
    disclaimer: "Ini sinyal otomatis dari kombinasi indikator teknikal (rule-based), bukan nasihat keuangan. Selalu verifikasi sendiri sebelum mengambil keputusan."
  };
}
