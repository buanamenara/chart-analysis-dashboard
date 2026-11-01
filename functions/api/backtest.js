import { fetchOhlcv } from "../../lib/marketData.js";

// Fungsi hitung EMA secara cepat tanpa library berat
function calcEMA(prices, period) {
  if (prices.length < period) return [];
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result = new Array(period - 1).fill(null);
  result.push(ema);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol") || "XAUUSD";
  const assetType = url.searchParams.get("assetType") || "forex";
  const interval = url.searchParams.get("interval") || "1h";

  try {
    const bars = await fetchOhlcv(assetType, symbol, interval);
    const testBars = bars.slice(-300); // Uji 300 candle terakhir
    
    if (testBars.length < 50) {
      return new Response(JSON.stringify({ error: "Data historis terlalu sedikit untuk backtest." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const closes = testBars.map(b => b.close);
    const ema20 = calcEMA(closes, 20);
    const ema50 = calcEMA(closes, 50);

    let trades = 0;
    let wins = 0;
    let currentPos = 0; // 1 = Beli, -1 = Jual, 0 = Kosong
    let entryPrice = 0;
    let holdBars = 0;

    // Simulasi: Hold maksimal 10 candle, atau keluar jika sinyal berbalik arah
    for (let i = 50; i < testBars.length; i++) {
      if (ema20[i] === null || ema50[i] === null) continue;

      let cross = 0;
      if (ema20[i] > ema50[i] && ema20[i-1] <= ema50[i-1]) cross = 1; // Sinyal Beli
      if (ema20[i] < ema50[i] && ema20[i-1] >= ema50[i-1]) cross = -1; // Sinyal Jual

      if (currentPos !== 0) {
        holdBars++;
        const currentPrice = closes[i];
        let pnl = currentPos === 1 ? currentPrice - entryPrice : entryPrice - currentPrice;

        if (holdBars >= 10 || (currentPos === 1 && cross === -1) || (currentPos === -1 && cross === 1)) {
          trades++;
          if (pnl > 0) wins++;
          currentPos = 0; 
          holdBars = 0;
        }
      }

      if (currentPos === 0 && cross !== 0) {
        currentPos = cross;
        entryPrice = closes[i];
        holdBars = 0;
      }
    }

    const winRate = trades > 0 ? ((wins / trades) * 100).toFixed(1) : 0;

    return new Response(JSON.stringify({
      symbol: symbol,
      interval: interval,
      strategi: "EMA 20/50 Crossover (Maksimal hold 10 candle)",
      total_trade: trades,
      menang: wins,
      kalah: trades - wins,
      win_rate: `${winRate}%`,
      catatan: "Ini adalah backtest matematis murni dari data historis. Performa masa lalu tidak menjamin masa depan."
    }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "max-age=3600" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: "Gagal melakukan backtest", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
