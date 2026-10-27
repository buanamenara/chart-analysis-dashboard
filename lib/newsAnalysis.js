// Klasifikasi arah dampak berita ekonomi High Impact, berbasis perbandingan
// forecast vs previous. Hanya untuk indikator yang arah dampaknya cukup jelas
// (higher = bullish/bearish untuk mata uang terkait) — indikator ambigu
// (CPI/inflasi, dsb.) sengaja TIDAK diklaim arahnya untuk menghindari sinyal keliru.
const BIAS_RULES = [
  { pattern: /non-?farm|nfp|payrolls|employment change/i, meaning: "higher_bullish" },
  { pattern: /unemployment rate/i, meaning: "higher_bearish" },
  { pattern: /unemployment claims|jobless claims/i, meaning: "higher_bearish" },
  { pattern: /\bgdp\b/i, meaning: "higher_bullish" },
  { pattern: /retail sales/i, meaning: "higher_bullish" },
  { pattern: /\bpmi\b|purchasing managers/i, meaning: "higher_bullish" },
  { pattern: /consumer confidence|consumer sentiment/i, meaning: "higher_bullish" },
  { pattern: /trade balance/i, meaning: "higher_bullish" },
  { pattern: /interest rate|federal funds rate|cash rate|bank rate|rba |boe |boc |ecb /i, meaning: "higher_bullish" },
  { pattern: /durable goods|industrial production|factory orders/i, meaning: "higher_bullish" },
  { pattern: /housing starts|building permits|new home sales|existing home sales/i, meaning: "higher_bullish" }
];

export function parseEconValue(str) {
  if (!str) return null;
  const cleaned = String(str).replace(/,/g, "").trim();
  const m = cleaned.match(/^(-?\d+(?:\.\d+)?)\s*([KMB%]?)$/i);
  if (!m) return null;
  let val = parseFloat(m[1]);
  const suffix = m[2].toUpperCase();
  if (suffix === "K") val *= 1e3;
  else if (suffix === "M") val *= 1e6;
  else if (suffix === "B") val *= 1e9;
  return val;
}

// Event kualitatif (pidato, pernyataan, notulen) tidak punya angka forecast/
// previous untuk dibandingkan — dampaknya tergantung isi & nada bicara, bukan
// beat/miss angka. Ditandai khusus biar tidak kosong begitu saja di UI.
const QUALITATIVE_PATTERN = /statement|press conference|speaks|speech|testimony|minutes|press briefing/i;

export function classifyEventBias(event) {
  const forecast = parseEconValue(event.forecast);
  const previous = parseEconValue(event.previous);

  if (forecast == null && previous == null && QUALITATIVE_PATTERN.test(event.title)) {
    return { bias: "qualitative", forecast, previous };
  }

  const rule = BIAS_RULES.find(r => r.pattern.test(event.title));
  if (!rule || forecast == null || previous == null || forecast === previous) {
    return { bias: "unknown", forecast, previous };
  }

  const forecastHigher = forecast > previous;
  const bullish = rule.meaning === "higher_bullish" ? forecastHigher : !forecastHigher;
  return { bias: bullish ? "bullish" : "bearish", forecast, previous };
}

// Tambahkan field `bias` ke tiap event High impact (biarkan yang lain apa adanya
// supaya payload tidak membengkak untuk event yang tidak relevan).
export function annotateHighImpactEvents(events) {
  return events.map(e => {
    if (e.impact !== "High") return e;
    return { ...e, biasInfo: classifyEventBias(e) };
  });
}
