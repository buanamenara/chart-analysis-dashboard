// Fetch dengan timeout, dipakai bersama oleh semua sumber data eksternal
// (Binance, Yahoo, RSS, ForexFactory, alternative.me, CoinGecko) supaya request
// tidak menggantung lama ketika provider lambat atau jaringan memblokir host.
// AbortError yang dihasilkan akan ditangkap oleh pemanggil seperti error biasa,
// sehingga mekanisme fallback (mis. Binance -> Yahoo) tetap berjalan normal.
const DEFAULT_TIMEOUT_MS = 15000;

export async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
