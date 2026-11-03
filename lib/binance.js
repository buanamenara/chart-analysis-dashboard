import { fetchWithTimeout } from "./http.js";

// Dua host data pasar Binance yang setara (endpoint /api/v3 sama persis):
// - data-api.binance.vision: host khusus market data publik (gratis, tanpa API key),
//   biasanya tetap bisa diakses dari Cloudflare & jaringan yang memblokir binance.com.
//   Dipakai PERTAMA supaya tidak menunggu timeout host yang diblokir.
// - api.binance.com: host utama sebagai cadangan; diblokir sebagian ISP (mis. Indonesia)
//   dan menolak IP datacenter AS (HTTP 451).
// Host yang terakhir berhasil diingat (sticky) untuk request berikutnya.
export const BINANCE_HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];
const HOST_TIMEOUT_MS = 6000;
let preferredHost = 0;

const INTERVAL_MAP = {
  "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
  "60m": "1h", "1h": "1h", "4h": "4h", "1d": "1d", "1wk": "1w"
};

export function toBinanceInterval(interval) {
  return INTERVAL_MAP[interval] || "1h";
}

// Coba host pilihan dulu, lalu host lainnya. `fetchImpl` bisa diganti di unit test.
export async function binanceGet(path, fetchImpl = fetchWithTimeout) {
  let lastErr;
  for (let k = 0; k < BINANCE_HOSTS.length; k++) {
    const idx = (preferredHost + k) % BINANCE_HOSTS.length;
    try {
      const res = await fetchImpl(`${BINANCE_HOSTS[idx]}/api/v3${path}`, { timeoutMs: HOST_TIMEOUT_MS });
      if (res.status === 400) {
        // 400 = parameter salah (mis. simbol tidak ada) -> host lain juga akan menolak.
        throw Object.assign(new Error(`Binance error: 400`), { fatal: true });
      }
      if (!res.ok) { lastErr = new Error(`Binance error: ${res.status}`); continue; }
      const data = await res.json();
      preferredHost = idx;
      return data;
    } catch (e) {
      if (e.fatal) throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error("Binance gagal (semua host)");
}

export function _resetPreferredHost() { preferredHost = 0; }

export async function getBinanceQuote(symbol) {
  const d = await binanceGet(`/ticker/24hr?symbol=${encodeURIComponent(symbol)}`);
  return {
    symbol,
    price: parseFloat(d.lastPrice),
    prevClose: parseFloat(d.prevClosePrice),
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
  const rows = await binanceGet(`/klines?symbol=${encodeURIComponent(symbol)}&interval=${biInterval}&limit=${limit}`);
  return rows.map(r => ({
    time: r[0],
    open: parseFloat(r[1]),
    high: parseFloat(r[2]),
    low: parseFloat(r[3]),
    close: parseFloat(r[4]),
    volume: parseFloat(r[5])
  }));
}
