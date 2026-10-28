import { fetchWithTimeout } from "./http.js";

const BASE = "https://api.binance.com/api/v3";

const INTERVAL_MAP = {
  "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
  "60m": "1h", "1h": "1h", "4h": "4h", "1d": "1d", "1wk": "1w"
};

export function toBinanceInterval(interval) {
  return INTERVAL_MAP[interval] || "1h";
}

export async function getBinanceQuote(symbol) {
  const res = await fetchWithTimeout(`${BASE}/ticker/24hr?symbol=${encodeURIComponent(symbol)}`);
  if (!res.ok) throw new Error(`Binance quote error: ${res.status}`);
  const d = await res.json();
  return {
    symbol,
    price: parseFloat(d.lastPrice),
    change: parseFloat(d.priceChange),
    changePercent: parseFloat(d.priceChangePercent),
    high: parseFloat(d.highPrice),
    low: parseFloat(d.lowPrice),
    volume: parseFloat(d.volume),
    source: "binance"
  };
}

export async function getBinanceOhlcv(symbol, interval, limit = 200) {
  const biInterval = toBinanceInterval(interval);
  const res = await fetchWithTimeout(`${BASE}/klines?symbol=${encodeURIComponent(symbol)}&interval=${biInterval}&limit=${limit}`);
  if (!res.ok) throw new Error(`Binance klines error: ${res.status}`);
  const rows = await res.json();
  return rows.map(r => ({
    time: r[0],
    open: parseFloat(r[1]),
    high: parseFloat(r[2]),
    low: parseFloat(r[3]),
    close: parseFloat(r[4]),
    volume: parseFloat(r[5])
  }));
}
