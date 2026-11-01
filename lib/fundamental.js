import { fetchWithTimeout } from "./http.js";
import { pairBiasFromCurrencyBias } from "./calendar.js";

// Peta simbol dashboard -> CoinGecko id (untuk data pasar crypto).
const CG_IDS = {
  BTCUSDT: "bitcoin", ETHUSDT: "ethereum", BNBUSDT: "binancecoin", SOLUSDT: "solana",
  XRPUSDT: "ripple", ADAUSDT: "cardano", DOGEUSDT: "dogecoin", AVAXUSDT: "avalanche-2",
  DOTUSDT: "polkadot", LINKUSDT: "chainlink"
};
// Chain id DeFiLlama untuk tren fees (hanya aset dengan ekonomi fee signifikan).
const LLAMA_CHAIN = { ETHUSDT: "ethereum", SOLUSDT: "solana", BNBUSDT: "bsc", AVAXUSDT: "avalanche" };

const fmtUsd = n => (n == null ? null : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n).toLocaleString("en-US")}`);
const pct = n => (n == null ? null : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);

// ---------- CRYPTO ----------
export async function getCryptoFundamental(symbol) {
  const id = CG_IDS[symbol];
  if (!id) return null;
  const access = new Date().toISOString();

  const res = await fetchWithTimeout(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`);
  if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
  const j = await res.json();
  const m = j.market_data || {};
  const mcap = m.market_cap?.usd ?? null, fdv = m.fully_diluted_valuation?.usd ?? null;
  const vol = m.total_volume?.usd ?? null, circ = m.circulating_supply ?? null, max = m.max_supply ?? null;
  const athDraw = m.ath_change_percentage?.usd ?? null;
  const mcapFdv = mcap && fdv ? mcap / fdv : null;
  const scarcity = circ && max ? (circ / max) * 100 : null;

  const dims = [
    { key: "Valuasi", detail: `MCap ${fmtUsd(mcap)}${fdv ? `, FDV ${fmtUsd(fdv)}` : ""}${mcapFdv != null ? ` (MCap/FDV ${mcapFdv.toFixed(2)})` : ""}.` },
    { key: "Supply", detail: `Beredar ${circ ? Math.round(circ).toLocaleString("en-US") : "-"}${max ? ` / maks ${Math.round(max).toLocaleString("en-US")} (${scarcity.toFixed(1)}% ditambang)` : " (tanpa batas maks)"}.` },
    { key: "Likuiditas", detail: `Volume 24j ${fmtUsd(vol)}${mcap && vol ? ` (MCap/Vol ${(mcap / vol).toFixed(1)})` : ""}. Dari ATH ${pct(athDraw)}.` }
  ];

  // --- Bias fundamental: diturunkan dari TREN AKTIVITAS (bukan harga) ---
  const reasons = [];
  let score = 0, votes = 0;

  // ETH/chain lain: tren fees 30h (permintaan blockspace).
  if (LLAMA_CHAIN[symbol]) {
    try {
      const fr = await fetchWithTimeout(`https://api.llama.fi/overview/fees/${LLAMA_CHAIN[symbol]}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`);
      if (fr.ok) {
        const f = await fr.json();
        const chg = f.change_30dover30d;
        dims.push({ key: "Fees (30h)", detail: `${fmtUsd(f.total30d)}${chg != null ? `, tren ${pct(chg)} vs 30h sebelumnya` : ""}.` });
        if (chg != null) { votes++; if (chg > 5) { score++; reasons.push(`Fees jaringan naik ${pct(chg)} (30h) → permintaan pemakaian menguat.`); } else if (chg < -5) { score--; reasons.push(`Fees jaringan turun ${pct(chg)} (30h) → permintaan pemakaian melemah.`); } else reasons.push(`Fees jaringan relatif datar (${pct(chg)}).`); }
      }
    } catch { /* fees opsional */ }
  }

  // BTC: tren alamat aktif 90h (adopsi/pemakaian).
  if (symbol === "BTCUSDT") {
    try {
      const ar = await fetchWithTimeout("https://api.blockchain.info/charts/n-unique-addresses?timespan=90days&format=json&cors=true");
      if (ar.ok) {
        const v = (await ar.json()).values;
        if (v?.length > 10) {
          const last = v[v.length - 1].y, first = v[0].y;
          const chg = first ? ((last - first) / first) * 100 : null;
          dims.push({ key: "Alamat aktif (90h)", detail: `${Math.round(last).toLocaleString("en-US")} terbaru, tren ${pct(chg)} dalam 90 hari.` });
          if (chg != null) { votes++; if (chg > 5) { score++; reasons.push(`Alamat aktif naik ${pct(chg)} (90h) → adopsi/pemakaian menguat.`); } else if (chg < -5) { score--; reasons.push(`Alamat aktif turun ${pct(chg)} (90h) → aktivitas on-chain melemah.`); } else reasons.push(`Alamat aktif relatif stabil (${pct(chg)}).`); }
        }
      }
    } catch { /* on-chain opsional */ }
  }

  let direction = "neutral";
  if (votes > 0) { if (score >= 1) direction = "bullish"; else if (score <= -1) direction = "bearish"; }
  const availability = votes > 0;
  const summary = availability
    ? `${reasons.join(" ")}`
    : "Data aktivitas on-chain/fees tidak tersedia gratis untuk aset ini — bias fundamental dibiarkan NETRAL (tidak dipaksakan).";

  return {
    kind: "crypto", symbol, name: j.name, access, dimensions: dims,
    bias: { direction, available: availability, summary, reasons },
    disclaimer: "Fundamental dari data publik CoinGecko/DeFiLlama/blockchain.com (gratis). Bias = interpretasi (OPINI), bukan nasihat keuangan."
  };
}

// ---------- MAKRO (Gold / Forex) ----------
async function yq(sym) {
  const res = await fetchWithTimeout(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) return null;
  const m = (await res.json())?.chart?.result?.[0]?.meta;
  if (!m) return null;
  const prev = m.chartPreviousClose ?? m.previousClose;
  return { price: m.regularMarketPrice, change: prev != null ? m.regularMarketPrice - prev : null };
}

export async function getMacroFundamental(symbol) {
  const access = new Date().toISOString();
  const [dxy, y10, vix] = await Promise.all([yq("DX-Y.NYB").catch(() => null), yq("^TNX").catch(() => null), yq("^VIX").catch(() => null)]);
  const sgn = c => (c == null ? "" : c > 0 ? " (naik)" : c < 0 ? " (turun)" : " (datar)");
  const dims = [
    { key: "DXY (Indeks Dolar)", detail: `${dxy ? dxy.price.toFixed(2) : "-"}${sgn(dxy?.change)}.` },
    { key: "Yield 10Y (US)", detail: `${y10 ? y10.price.toFixed(2) : "-"}%${sgn(y10?.change)}.` },
    { key: "VIX (risiko)", detail: `${vix ? vix.price.toFixed(2) : "-"}${sgn(vix?.change)} — ${vix && vix.price >= 20 ? "risk-off" : "risk-on"}.` }
  ];
  const dxyUp = dxy?.change != null ? dxy.change > 0 : null;
  const yUp = y10?.change != null ? y10.change > 0 : null;
  const vixUp = vix?.change != null ? vix.change > 0 : null;

  const isMetal = symbol === "XAUUSD" || symbol === "XAGUSD";
  const reasons = [];
  let direction = "neutral", available = false;

  if (isMetal) {
    let score = 0, votes = 0;
    if (dxyUp != null) { votes++; if (dxyUp) { score--; reasons.push("DXY naik → dolar kuat menekan emas."); } else { score++; reasons.push("DXY turun → dolar lemah mendukung emas."); } }
    if (yUp != null) { votes++; if (yUp) { score--; reasons.push("Yield 10Y naik → biaya peluang emas naik (menekan)."); } else { score++; reasons.push("Yield 10Y turun → mendukung emas."); } }
    if (vixUp != null) { votes++; if (vixUp) { score++; reasons.push("VIX naik (risk-off) → permintaan safe-haven emas."); } else { score--; reasons.push("VIX turun (risk-on) → minat safe-haven berkurang."); } }
    if (votes > 0) { available = true; direction = score >= 1 ? "bullish" : score <= -1 ? "bearish" : "neutral"; }
  } else {
    if (dxyUp != null) { const pb = pairBiasFromCurrencyBias(symbol, "USD", dxyUp ? "bullish" : "bearish"); if (pb) { available = true; direction = pb; reasons.push(`DXY ${dxyUp ? "naik" : "turun"} → sisi dolar membuat ${symbol} cenderung ${pb === "bullish" ? "menguat" : "melemah"}.`); } }
  }

  return {
    kind: isMetal ? "metal" : "forex", symbol, access, dimensions: dims,
    bias: { direction, available, summary: available ? reasons.join(" ") : "Arah makro belum jelas dari data saat ini — bias NETRAL.", reasons },
    disclaimer: "Faktor makro dari data publik Yahoo (DXY/yield/VIX). Bias = interpretasi (OPINI), bukan nasihat keuangan."
  };
}

export async function getFundamental(assetType, symbol) {
  if (assetType === "crypto") return getCryptoFundamental(symbol);
  if (assetType === "forex") return getMacroFundamental(symbol);
  return null; // saham: belum didukung sumber fundamental gratis yang seragam
}
