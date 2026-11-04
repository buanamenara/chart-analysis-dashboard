// Jumlah desimal harga — aturan SAMA dengan priceDigits() di public/app.js supaya angka
// di teks analisa cocok dengan tabel: crypto & harga besar (emas, indeks, BTC) 2 desimal,
// pair forex 5 (EURUSD 1.12625, bukan 1.13).
export function priceDecimals(price, assetType) {
  if (assetType === "crypto") return price >= 1 ? 2 : 6;
  return price > 100 ? 2 : 5;
}

// Format angka berskala harga (harga, level, ATR, jarak) memakai desimal dari harga acuan.
export function fmtPrice(x, ref = x, assetType) {
  if (x == null || !Number.isFinite(x)) return "-";
  return x.toFixed(priceDecimals(ref, assetType));
}
