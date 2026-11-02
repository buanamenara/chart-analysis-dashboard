// Level & pola harga tambahan, terinspirasi kategori indikator populer
// (PDH/PDL, ADR, swing high/low, key level, pola candle, sesi pasar).
// Semua dihitung sendiri dari data OHLCV yang sudah ada — gratis, tanpa API tambahan.

export function computePivotPoints(dailyBars) {
  if (!dailyBars || dailyBars.length < 2) return null;
  const { high, low, close } = dailyBars[dailyBars.length - 2];
  if (![high, low, close].every(Number.isFinite)) return null;

  const pp = (high + low + close) / 3;
  const range = high - low;
  return {
    pp,
    r1: 2 * pp - low,
    s1: 2 * pp - high,
    r2: pp + range,
    s2: pp - range,
    r3: high + 2 * (pp - low),
    s3: low - 2 * (high - pp)
  };
}

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

// Volume Profile: histogram volume per level harga dari ~window bar terakhir.
// POC (Point of Control) = harga dengan volume terbesar (magnet harga / S-R kuat).
// VAH/VAL = batas atas/bawah Value Area 70% (zona di mana 70% transaksi terjadi).
// Untuk forex (Yahoo sering volume=0) dipakai proxy rentang (high-low) tiap candle.
export function volumeProfile(bars, window = 150, bins = 24) {
  const recent = bars.slice(-window).filter(b => Number.isFinite(b.high) && Number.isFinite(b.low));
  if (recent.length < 20) return null;
  let lo = Infinity, hi = -Infinity;
  for (const b of recent) { if (b.low < lo) lo = b.low; if (b.high > hi) hi = b.high; }
  const span = hi - lo;
  if (span <= 0) return null;

  const usedVolume = recent.some(b => Number.isFinite(b.volume) && b.volume > 0);
  const binSize = span / bins;
  const vol = new Array(bins).fill(0);
  for (const b of recent) {
    const w = usedVolume ? (b.volume > 0 ? b.volume : 0) : (b.high - b.low || binSize);
    const loB = Math.max(0, Math.floor((b.low - lo) / binSize));
    const hiB = Math.min(bins - 1, Math.floor((b.high - lo) / binSize));
    const n = hiB - loB + 1;
    for (let i = loB; i <= hiB; i++) vol[i] += w / n; // sebar merata ke bin yang dilewati candle
  }

  let pocIdx = 0;
  for (let i = 1; i < bins; i++) if (vol[i] > vol[pocIdx]) pocIdx = i;
  const mid = i => lo + (i + 0.5) * binSize;
  const total = vol.reduce((a, b) => a + b, 0) || 1;

  // Value Area 70%: mekar dari POC ke sisi volume lebih besar sampai menampung 70%.
  let loI = pocIdx, hiI = pocIdx, acc = vol[pocIdx];
  while (acc < total * 0.7 && (loI > 0 || hiI < bins - 1)) {
    const below = loI > 0 ? vol[loI - 1] : -1;
    const above = hiI < bins - 1 ? vol[hiI + 1] : -1;
    if (above >= below) { hiI++; acc += vol[hiI]; } else { loI--; acc += vol[loI]; }
  }

  const price = bars[bars.length - 1].close;
  const poc = mid(pocIdx);
  return {
    poc: +poc.toFixed(5),
    vah: +(lo + (hiI + 1) * binSize).toFixed(5),
    val: +(lo + loI * binSize).toFixed(5),
    pocDistPercent: +(Math.abs(price - poc) / price * 100).toFixed(2),
    usedVolume
  };
}

// Anchored VWAP: harga rata-rata tertimbang volume, di-anchor ke awal hari terakhir.
// Band ±1/±2 standar deviasi jadi S-R dinamis. Harga di atas/bawah VWAP = bias intraday.
export function anchoredVwap(bars) {
  if (!bars || bars.length < 5) return null;
  const dayOf = t => new Date(t).getUTCDate();
  const lastDay = dayOf(bars[bars.length - 1].time);
  let startIdx = bars.length - 1;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (dayOf(bars[i].time) === lastDay) startIdx = i; else break;
  }
  if (bars.length - startIdx < 5) startIdx = Math.max(0, bars.length - 30); // sesi terlalu pendek -> rolling 30

  let pv = 0, vv = 0, pv2 = 0;
  for (let i = startIdx; i < bars.length; i++) {
    const b = bars[i];
    const tp = (b.high + b.low + b.close) / 3;
    const w = Number.isFinite(b.volume) && b.volume > 0 ? b.volume : 1; // forex: bobot rata
    pv += tp * w; vv += w; pv2 += tp * tp * w;
  }
  if (vv <= 0) return null;
  const vwap = pv / vv;
  const sd = Math.sqrt(Math.max(0, pv2 / vv - vwap * vwap));
  const price = bars[bars.length - 1].close;
  return {
    vwap: +vwap.toFixed(5),
    upper1: +(vwap + sd).toFixed(5), lower1: +(vwap - sd).toFixed(5),
    upper2: +(vwap + 2 * sd).toFixed(5), lower2: +(vwap - 2 * sd).toFixed(5),
    bias: price > vwap ? "bullish" : price < vwap ? "bearish" : "netral",
    distPercent: +(Math.abs(price - vwap) / price * 100).toFixed(2)
  };
}

// Struktur ICT ringkas: Break of Structure (BOS) + Order Block terakhir.
// BOS bullish = harga menembus swing-high terakhir; bearish = menembus swing-low.
// Order Block = candle berlawanan terakhir sebelum impuls yang menembus (zona reaksi).
export function marketStructure(bars, swingHighs, swingLows) {
  if (!bars || bars.length < 5) return null;
  const price = bars[bars.length - 1].close;
  const lastSH = swingHighs?.at(-1) || null;
  const lastSL = swingLows?.at(-1) || null;

  let bos = null;
  if (lastSH && price > lastSH.price) bos = "bullish";
  else if (lastSL && price < lastSL.price) bos = "bearish";

  let orderBlock = null;
  if (bos) {
    // cari candle berlawanan terakhir sebelum candle terakhir (zona order block)
    for (let i = bars.length - 2; i >= Math.max(0, bars.length - 12); i--) {
      const b = bars[i];
      const bullCandle = b.close > b.open;
      if (bos === "bullish" && !bullCandle) { orderBlock = { type: "bullish OB", low: b.low, high: Math.max(b.open, b.close) }; break; }
      if (bos === "bearish" && bullCandle) { orderBlock = { type: "bearish OB", low: Math.min(b.open, b.close), high: b.high }; break; }
    }
  }
  return { bos, orderBlock, lastSwingHigh: lastSH?.price ?? null, lastSwingLow: lastSL?.price ?? null };
}

// Opening Range Breakout (ORB): range (high/low) dari menit-menit awal sesi aktif
// (London 08:00 / New York 13:00 / Open hari 00:00 UTC), lalu status breakout.
// Hanya berlaku untuk TF kecil (<=~15m); di TF besar dikembalikan null (tak relevan).
export function openingRange(bars, windowMinutes = 30) {
  if (!bars || bars.length < 10) return null;

  // Perkirakan interval bar (menit) dari median selisih waktu antar-bar terbaru.
  const diffs = [];
  for (let i = Math.max(0, bars.length - 10); i < bars.length - 1; i++) diffs.push(bars[i + 1].time - bars[i].time);
  diffs.sort((a, b) => a - b);
  const barMin = (diffs[Math.floor(diffs.length / 2)] || 0) / 60000;
  if (!barMin || barMin > 20) return null; // ORB untuk intraday kecil saja

  const now = bars[bars.length - 1].time;
  const d = new Date(now);
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const hour = d.getUTCHours();
  let session, sessionOpen;
  if (hour >= 13) { session = "New York"; sessionOpen = dayStart + 13 * 3600000; }
  else if (hour >= 8) { session = "London"; sessionOpen = dayStart + 8 * 3600000; }
  else { session = "Asia / Open hari"; sessionOpen = dayStart; }

  const orEnd = sessionOpen + windowMinutes * 60000;
  const orBars = bars.filter(b => b.time >= sessionOpen && b.time < orEnd);
  if (!orBars.length) return null;
  let orh = -Infinity, orl = Infinity;
  for (const b of orBars) { if (b.high > orh) orh = b.high; if (b.low < orl) orl = b.low; }
  if (!(orh > orl)) return null;

  const price = bars[bars.length - 1].close;
  const range = orh - orl;
  let bias = "netral", state = "di dalam range (tunggu breakout)";
  if (price > orh) { bias = "bullish"; state = "breakout NAIK (tembus OR High)"; }
  else if (price < orl) { bias = "bearish"; state = "breakdown TURUN (tembus OR Low)"; }

  return {
    session,
    high: +orh.toFixed(5),
    low: +orl.toFixed(5),
    bias,
    state,
    target: +(bias === "bearish" ? orl - range : orh + range).toFixed(5), // proyeksi 1× range
    windowMinutes
  };
}

// Fibonacci retracement otomatis dari ayunan (swing) besar terakhir ~60 bar.
// Menentukan arah ayunan (naik/turun), lalu level 0.236/0.382/0.5/0.618/0.786.
export function fibRetracement(bars, window = 60) {
  const recent = bars.slice(-window);
  if (recent.length < 10) return null;
  let hi = -Infinity, lo = Infinity, hiIdx = 0, loIdx = 0;
  recent.forEach((b, i) => { if (b.high > hi) { hi = b.high; hiIdx = i; } if (b.low < lo) { lo = b.low; loIdx = i; } });
  const diff = hi - lo;
  if (diff <= 0) return null;
  // Arah: kalau high terjadi SETELAH low -> ayunan naik (retrace ke bawah dari high).
  const up = hiIdx > loIdx;
  const ratios = [0.236, 0.382, 0.5, 0.618, 0.786];
  const levels = ratios.map(r => ({ ratio: r, price: up ? hi - diff * r : lo + diff * r }));
  const price = bars[bars.length - 1].close;
  let nearest = null, nd = Infinity;
  for (const l of levels) { const d = Math.abs(price - l.price); if (d < nd) { nd = d; nearest = l; } }
  const atKey = nearest && Math.abs(nearest.ratio - 0.618) < 0.001 || nearest && Math.abs(nearest.ratio - 0.5) < 0.001;
  const nearPct = (nd / price) * 100;
  return { direction: up ? "naik" : "turun", high: hi, low: lo, levels, nearest, nearPercent: +nearPct.toFixed(2), atGoldenZone: !!atKey && nearPct < 0.4 };
}
