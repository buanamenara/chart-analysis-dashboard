import { fetchWithTimeout } from "./http.js";

export async function getFearGreedIndex() {
  const res = await fetchWithTimeout("https://api.alternative.me/fng/?limit=1");
  if (!res.ok) throw new Error(`Fear&Greed error: ${res.status}`);
  const data = await res.json();
  const d = data.data?.[0];
  if (!d) return null;
  return { value: Number(d.value), classification: d.value_classification };
}

export async function getCryptoGlobalStats() {
  const res = await fetchWithTimeout("https://api.coingecko.com/api/v3/global");
  if (!res.ok) throw new Error(`CoinGecko global error: ${res.status}`);
  const { data } = await res.json();
  return {
    totalMarketCapUsd: data.total_market_cap?.usd,
    btcDominance: data.market_cap_percentage?.btc,
    ethDominance: data.market_cap_percentage?.eth,
    marketCapChangePercent24h: data.market_cap_change_percentage_24h_usd
  };
}
