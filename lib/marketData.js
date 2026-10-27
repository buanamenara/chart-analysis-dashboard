import { getBinanceQuote, getBinanceOhlcv } from "./binance.js";
import { getYahooQuote, getYahooOhlcv, normalizeForexSymbol, normalizeCryptoSymbolForYahoo } from "./yahoo.js";

// Dipakai bersama oleh server.js (dev lokal) dan functions/api/*.js (Cloudflare Pages).

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
