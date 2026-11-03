import { getBinanceQuote, getBinanceOhlcv } from "./binance.js";
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

export async function fetchQuote(assetType, symbol) {
  if (assetType === "crypto") {
    try {
      return await getBinanceQuote(symbol);
    } catch {
      // Binance diblokir di beberapa jaringan (mis. ISP Indonesia) -> fallback ke Yahoo Finance
      return getYahooQuote(normalizeCryptoSymbolForYahoo(symbol));
    }
  }
  return getYahooQuote(resolveYahooSymbol(assetType, symbol));
}

export async function fetchOhlcv(assetType, symbol, interval) {
  if (assetType === "crypto") {
    try {
      return await getBinanceOhlcv(symbol, interval, 250);
    } catch {
      return getYahooOhlcv(normalizeCryptoSymbolForYahoo(symbol), interval);
    }
  }
  return getYahooOhlcv(resolveYahooSymbol(assetType, symbol), interval);
}

export async function fetchDailyBars(assetType, symbol) {
  if (assetType === "crypto") {
    try {
      return await getBinanceOhlcv(symbol, "1d", 60);
    } catch {
      return getYahooOhlcv(normalizeCryptoSymbolForYahoo(symbol), "1d");
    }
  }
  return getYahooOhlcv(resolveYahooSymbol(assetType, symbol), "1d");
}
