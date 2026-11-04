import { cryptoQuote, cryptoOhlcv } from "./cryptoSources.js";
import { getYahooQuote, getYahooOhlcv, normalizeForexSymbol, normalizeCryptoSymbolForYahoo } from "./yahoo.js";

// Dipakai bersama oleh server.js (dev lokal) dan functions/api/*.js (Cloudflare Pages).

// Jenis aset yang didukung. Emas (XAUUSD) termasuk "forex", bukan "gold".
export const VALID_ASSET_TYPES = ["forex", "crypto", "stock"];

// Kembalikan body error (untuk HTTP 400) bila assetType diisi tapi tidak dikenal,
// atau null bila valid / tidak diisi (cek "wajib diisi" tetap di masing-masing endpoint).
export function assetTypeError(assetType) {
  if (assetType == null || assetType === "") return null;
  if (VALID_ASSET_TYPES.includes(assetType)) return null;
  return {
    ok: false,
    code: "INVALID_ASSET_TYPE",
    error: `assetType '${String(assetType).slice(0, 30)}' tidak valid. Pilihan: ${VALID_ASSET_TYPES.join(", ")}.`,
    hint: "Contoh: /api/quote?symbol=XAUUSD&assetType=forex (emas = forex)"
  };
}

export function resolveYahooSymbol(assetType, symbol) {
  if (assetType === "forex") return normalizeForexSymbol(symbol);
  return symbol; // stock / index: pakai apa adanya (contoh: AAPL, ^JKSE, BBCA.JK)
}

const tagBars = (bars, source, fallbackReason) => {
  Object.defineProperty(bars, "source", { value: source, enumerable: false });
  Object.defineProperty(bars, "fallbackReason", { value: fallbackReason || null, enumerable: false });
  return bars;
};

// Crypto: bursa (Binance -> Gate.io -> Coinbase -> Kraken), lalu Yahoo sebagai cadangan
// terakhir. `fallbackReason` menjelaskan kenapa sumber sebelumnya gagal.
export async function fetchQuote(assetType, symbol) {
  if (assetType === "crypto") {
    try {
      return await cryptoQuote(symbol);
    } catch (e) {
      const q = await getYahooQuote(normalizeCryptoSymbolForYahoo(symbol));
      return { ...q, fallbackReason: e.message };
    }
  }
  return getYahooQuote(resolveYahooSymbol(assetType, symbol));
}

async function cryptoBars(symbol, interval, limit) {
  try {
    return await cryptoOhlcv(symbol, interval, limit);
  } catch (e) {
    const bars = await getYahooOhlcv(normalizeCryptoSymbolForYahoo(symbol), interval);
    return tagBars(bars, "yahoo", e.message);
  }
}

export async function fetchOhlcv(assetType, symbol, interval) {
  if (assetType === "crypto") return cryptoBars(symbol, interval, 250);
  return tagBars(await getYahooOhlcv(resolveYahooSymbol(assetType, symbol), interval), "yahoo");
}

export async function fetchDailyBars(assetType, symbol) {
  if (assetType === "crypto") return cryptoBars(symbol, "1d", 60);
  return tagBars(await getYahooOhlcv(resolveYahooSymbol(assetType, symbol), "1d"), "yahoo");
}
