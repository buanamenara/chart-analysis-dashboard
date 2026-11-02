import { computeDailyLevels, findSwingPoints, nearestKeyLevel, detectCandlePattern, getActiveSessions, fibRetracement } from "./levels.js";

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

// Klasifikasi regime pasar dari ADX (kekuatan tren) + arah dari +DI/-DI.
// Penting: sinyal arah jauh lebih dapat diandalkan saat pasar TRENDING;
// saat RANGING sinyal rawan "false breakout" / bolak-balik.
export function classifyRegime(adx, plusDI, minusDI) {
  if (adx == null) return null;
  let strength, note;
  if (adx >= 40) { strength = "Tren sangat kuat"; note = "momentum searah kuat, sinyal lanjutan lebih dapat diandalkan"; }
  else if (adx >= 25) { strength = "Trending"; note = "tren cukup jelas, sinyal arah lebih valid"; }
  else if (adx >= 20) { strength = "Tren lemah/awal"; note = "tren belum solid, konfirmasi ekstra dianjurkan"; }
  else { strength = "Ranging (sideways)"; note = "pasar menyamping, sinyal arah rawan palsu — utamakan main pantul di support/resistance"; }

  let direction = null;
  if (plusDI != null && minusDI != null && adx >= 20) {
    direction = plusDI > minusDI ? "naik (+DI dominan)" : "turun (-DI dominan)";
  }
  return { adx: Number(adx.toFixed(1)), strength, direction, note };
}

// Analisa teknikal lengkap (bukan hanya zona SNR): rangkum tren, momentum,
// volatilitas, kekuatan tren (ADX), konfirmasi multi-timeframe, level kunci,
// pola candle, dan sesi pasar, lalu simpulkan bias + tingkat keyakinan.
// Semua dihitung dari data OHLCV yang sama dengan indikator.
export function buildTechnicalAnalysis({ indicators, dailyBars, bars, signal, nearestSupport, nearestResistance, multiTimeframe, newsBias, fundamental, volumeProfile, vwap, structure }) {
  if (indicators.insufficientData) {
    return { bias: "neutral", conclusion: "Data historis belum cukup untuk analisa teknikal." };
  }

  const price = indicators.lastClose;
  const daily = computeDailyLevels(dailyBars);
  const swing = findSwingPoints(bars);
  const pattern = detectCandlePattern(bars);
  const key = nearestKeyLevel(price);
  const regime = classifyRegime(indicators.adx14, indicators.plusDI, indicators.minusDI);
  const fib = fibRetracement(bars);

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
  if (indicators.rsiDivergence === "bullish") momentumParts.push("divergence RSI BULLISH (harga turun tapi momentum menguat → rawan pembalikan NAIK)");
  else if (indicators.rsiDivergence === "bearish") momentumParts.push("divergence RSI BEARISH (harga naik tapi momentum melemah → rawan pembalikan TURUN)");
  const hdiv = indicators.rsiHiddenDivergence;
  if (hdiv === "bullish") momentumParts.push("hidden divergence BULLISH (penerusan tren NAIK)");
  else if (hdiv === "bearish") momentumParts.push("hidden divergence BEARISH (penerusan tren TURUN)");

  const volParts = [];
  if (indicators.bollinger?.pb != null) {
    if (indicators.bollinger.pb <= 0.05) volParts.push("harga menempel Bollinger Bawah (jenuh jual, rawan pantul naik)");
    else if (indicators.bollinger.pb >= 0.95) volParts.push("harga menempel Bollinger Atas (jenuh beli, rawan koreksi turun)");
    else volParts.push(`%b ${indicators.bollinger.pb.toFixed(2)} (harga di dalam band)`);
  }
  if (indicators.atr14) volParts.push(`ATR14 ≈ ${indicators.atr14.toFixed(2)} (volatilitas per candle TF ini)`);
  if (daily?.adr14) volParts.push(`ADR14 ≈ ${daily.adr14.toFixed(2)} poin (jangkauan harian)`);
  if (indicators.volume?.available && indicators.volume.ratio != null) {
    const v = indicators.volume;
    volParts.push(`Volume ${v.ratio}× rata-rata ${v.aboveAvg ? "(di atas normal → konfirmasi kuat)" : v.thin ? "(tipis → pergerakan kurang didukung)" : "(normal)"}`);
  }

  // Konfluensi berbasis volume/harga: VWAP (bias intraday) + POC/Value Area (magnet harga).
  const flowParts = [];
  if (vwap) {
    flowParts.push(`VWAP ${vwap.vwap.toFixed(2)} — harga ${vwap.bias === "bullish" ? "di ATAS VWAP (bias intraday naik)" : vwap.bias === "bearish" ? "di BAWAH VWAP (bias intraday turun)" : "di VWAP (netral)"}; band ±1σ ${vwap.lower1.toFixed(2)}–${vwap.upper1.toFixed(2)}.`);
  }
  if (volumeProfile) {
    const vpWhere = Math.abs(price - volumeProfile.poc) / price * 100 < 0.2 ? "harga TEPAT di POC (keseimbangan)" : price > volumeProfile.poc ? "harga di atas POC" : "harga di bawah POC";
    flowParts.push(`Volume Profile: POC ${volumeProfile.poc.toFixed(2)} (magnet harga), Value Area ${volumeProfile.val.toFixed(2)}–${volumeProfile.vah.toFixed(2)} — ${vpWhere}${volumeProfile.usedVolume ? "" : " (proxy rentang, volume FX tak tersedia)"}.`);
  }
  if (structure?.bos) {
    flowParts.push(`Struktur: **BOS ${structure.bos.toUpperCase()}** (break of structure)${structure.orderBlock ? `, order block ${structure.orderBlock.type} ${structure.orderBlock.low.toFixed(2)}–${structure.orderBlock.high.toFixed(2)} (zona reaksi)` : ""}.`);
  }

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

  // Ringkasan multi-timeframe untuk ditampilkan + dipakai di keyakinan.
  let mtfText = "TF lebih tinggi masih netral/campur.";
  if (multiTimeframe && multiTimeframe.directionalTimeframes > 0) {
    mtfText = `${multiTimeframe.directionalTimeframes} TF lebih tinggi mayoritas ${multiTimeframe.bias} (kesepakatan ${multiTimeframe.agreementPercent}%), ${multiTimeframe.currentAligned ? "SEARAH dengan TF ini" : "BERLAWANAN dengan TF ini"}.`;
  }

  // Keyakinan menyeluruh: gabungan kesepakatan indikator TF ini + multi-timeframe,
  // lalu disesuaikan dengan regime (tren kuat menaikkan, ranging menurunkan) dan
  // apakah TF lebih tinggi searah.
  let overallConfidence = signal?.confidence ?? 0;
  if (multiTimeframe?.agreementPercent != null) {
    overallConfidence = Math.round(overallConfidence * 0.5 + multiTimeframe.agreementPercent * 0.5);
  }
  if (regime) {
    if (regime.adx >= 25) overallConfidence = Math.min(100, overallConfidence + 10);
    else if (regime.adx < 20) overallConfidence = Math.max(0, overallConfidence - 15);
  }
  if (multiTimeframe && multiTimeframe.directionalTimeframes > 0 && !multiTimeframe.currentAligned) {
    overallConfidence = Math.max(0, overallConfidence - 15);
  }
  // Divergence = peringatan pembalikan: kalau melawan bias, turunkan keyakinan.
  const div = indicators.rsiDivergence;
  if (div === "bullish" && bias === "bearish") overallConfidence = Math.max(0, overallConfidence - 8);
  if (div === "bearish" && bias === "bullish") overallConfidence = Math.max(0, overallConfidence - 8);
  // Volume: konfirmasi di atas rata-rata menaikkan, tipis menurunkan (bila tersedia).
  if (indicators.volume?.available) {
    if (indicators.volume.aboveAvg && bias !== "neutral") overallConfidence = Math.min(100, overallConfidence + 5);
    else if (indicators.volume.thin) overallConfidence = Math.max(0, overallConfidence - 5);
  }
  // VWAP sebagai konfirmasi bias intraday: searah menaikkan, berlawanan menurunkan.
  if (vwap && bias !== "neutral") {
    if ((bias === "bullish" && vwap.bias === "bullish") || (bias === "bearish" && vwap.bias === "bearish")) overallConfidence = Math.min(100, overallConfidence + 6);
    else if ((bias === "bullish" && vwap.bias === "bearish") || (bias === "bearish" && vwap.bias === "bullish")) overallConfidence = Math.max(0, overallConfidence - 6);
  }
  // Hidden divergence searah bias = penerusan tren -> menguatkan.
  if ((hdiv === "bullish" && bias === "bullish") || (hdiv === "bearish" && bias === "bearish")) overallConfidence = Math.min(100, overallConfidence + 5);
  // BOS searah bias = struktur mendukung.
  if (structure?.bos && ((structure.bos === "bullish" && bias === "bullish") || (structure.bos === "bearish" && bias === "bearish"))) overallConfidence = Math.min(100, overallConfidence + 5);

  // Fundamental/makro sebagai lapisan konfirmasi (bukan pemicu entry).
  // Fundamental set konteks arah; teknikal tetap pegang timing/level.
  let fundamentalText = null, fundamentalAlign = null;
  if (fundamental?.bias) {
    const fb = fundamental.bias;
    const label = fundamental.kind === "crypto" ? "Fundamental" : "Makro";
    if (!fb.available || fb.direction === "neutral") {
      fundamentalText = `${label}: NETRAL — ${fb.summary}`;
    } else {
      const fbTech = fb.direction === "bullish" ? "bullish" : "bearish";
      if (bias === "neutral") {
        fundamentalAlign = "context";
        fundamentalText = `${label}: cenderung **${fbTech.toUpperCase()}** — ${fb.summary} (teknikal masih netral; ini konteks arah).`;
      } else if (bias === fbTech) {
        fundamentalAlign = "aligned";
        fundamentalText = `${label}: **SEARAH** dengan teknikal (sama-sama ${fbTech}) — ${fb.summary} Memperkuat setup.`;
        overallConfidence = Math.min(100, overallConfidence + 8);
      } else {
        fundamentalAlign = "conflict";
        fundamentalText = `${label}: **BERLAWANAN** dengan teknikal (fundamental ${fbTech} vs teknikal ${bias}) — ${fb.summary} Hati-hati, kurangi ukuran/tunggu konfirmasi.`;
        overallConfidence = Math.max(0, overallConfidence - 8);
      }
    }
  }

  let confidenceLabel = "Rendah";
  if (overallConfidence >= 70) confidenceLabel = "Tinggi";
  else if (overallConfidence >= 45) confidenceLabel = "Sedang";

  // Deteksi "jebakan" (trap): sintesis beberapa sinyal seperti analis manusia.
  // Bull trap: harga dekat resistance + TF besar bearish + (volume tipis / divergence bearish)
  // -> breakout di sini sering palsu. Mirror untuk bear trap.
  let trapWarning = null;
  const nearRes = resistance != null && Math.abs(price - resistance) / price * 100 < 0.35;
  const nearSup = support != null && Math.abs(price - support) / price * 100 < 0.35;
  const volThin = indicators.volume?.available && indicators.volume.thin;
  const htfSell = multiTimeframe?.directionalTimeframes > 0 && multiTimeframe.bias === "SELL" && !multiTimeframe.currentAligned;
  const htfBuy = multiTimeframe?.directionalTimeframes > 0 && multiTimeframe.bias === "BUY" && !multiTimeframe.currentAligned;
  if (nearRes && (htfSell || indicators.rsiDivergence === "bearish") && (volThin || htfSell)) {
    trapWarning = `⚠ Rawan **BULL TRAP**: harga naik mendekati resistance ${resistance.toFixed(2)}${volThin ? " dengan volume tipis" : ""}${htfSell ? ", sementara TF besar bearish" : ""}${indicators.rsiDivergence === "bearish" ? ", + divergence bearish" : ""} — breakout di sini sering palsu. Tunggu konfirmasi (close tegas di atas resistance + lonjakan volume) sebelum ikut beli.`;
  } else if (nearSup && (htfBuy || indicators.rsiDivergence === "bullish") && (volThin || htfBuy)) {
    trapWarning = `⚠ Rawan **BEAR TRAP**: harga turun mendekati support ${support.toFixed(2)}${volThin ? " dengan volume tipis" : ""}${htfBuy ? ", sementara TF besar bullish" : ""}${indicators.rsiDivergence === "bullish" ? ", + divergence bullish" : ""} — breakdown di sini sering palsu. Tunggu konfirmasi sebelum ikut jual.`;
  }

  // Susun kesimpulan berbobot (bukan hanya SNR): arah + kekuatan tren + konfirmasi
  // multi-timeframe + berita + level aksi.
  const parts = [];
  if (bias === "bullish") parts.push(`Bias teknikal cenderung **BULLISH** (${bullish} indikator bullish vs ${bearish} bearish).`);
  else if (bias === "bearish") parts.push(`Bias teknikal cenderung **BEARISH** (${bearish} bearish vs ${bullish} bullish).`);
  else parts.push(`Bias **NETRAL/campur** (${bullish} bullish vs ${bearish} bearish) — belum ada dominasi arah.`);

  if (trapWarning) parts.push(trapWarning);
  if (regime) parts.push(`Kondisi pasar: **${regime.strength}** (ADX ${regime.adx}${regime.direction ? ", arah " + regime.direction : ""}) — ${regime.note}.`);
  parts.push(`Konfirmasi tren besar: ${mtfText}`);
  if (fundamentalText) parts.push(fundamentalText);
  if (newsBias) parts.push(newsBias);

  if (bias === "bullish") {
    parts.push(`Konfirmasi beli bila harga bertahan di atas support ${support ? support.toFixed(2) : "-"} & menembus resistance ${resistance ? resistance.toFixed(2) : "-"}; batal bila support jebol.`);
  } else if (bias === "bearish") {
    parts.push(`Konfirmasi jual bila harga gagal di resistance ${resistance ? resistance.toFixed(2) : "-"} & breakdown support ${support ? support.toFixed(2) : "-"}; batal bila resistance tembus.`);
  } else {
    parts.push(`Tunggu harga menembus resistance ${resistance ? resistance.toFixed(2) : "-"} (ke atas) atau support ${support ? support.toFixed(2) : "-"} (ke bawah) sebagai pemicu.`);
  }
  if (div) parts.push(`Divergence RSI **${div.toUpperCase()}** terdeteksi — ${div === "bullish" ? "waspada potensi pantulan NAIK" : "waspada potensi koreksi TURUN"}.`);
  if (flowParts.length) parts.push(flowParts.join(" "));
  if (fib?.atGoldenZone) parts.push(`Harga di **golden zone Fibonacci** (${(fib.nearest.ratio * 100).toFixed(1)}% retrace ${fib.direction}) ~${fib.nearest.price.toFixed(2)} — area reaksi penting.`);
  parts.push(`Tingkat keyakinan menyeluruh: **${confidenceLabel} (${overallConfidence}%)**.`);

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
    regime,
    multiTimeframeText: mtfText,
    trapWarning,
    divergence: div || null,
    hiddenDivergence: hdiv || null,
    vwap: vwap || null,
    volumeProfile: volumeProfile || null,
    structure: structure || null,
    volume: indicators.volume?.available ? indicators.volume : null,
    fib: fib ? { direction: fib.direction, nearest: fib.nearest, atGoldenZone: fib.atGoldenZone, nearPercent: fib.nearPercent } : null,
    fundamental: fundamental ? { kind: fundamental.kind, direction: fundamental.bias?.direction, available: fundamental.bias?.available, text: fundamentalText, align: fundamentalAlign, dimensions: fundamental.dimensions, access: fundamental.access, disclaimer: fundamental.disclaimer } : null,
    overallConfidence,
    confidenceLabel,
    conclusion: parts.join(" ")
  };
}
