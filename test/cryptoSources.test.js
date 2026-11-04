import test from "node:test";
import assert from "node:assert/strict";
import {
  baseAsset, aggregateAligned, parseGateCandles, parseGateTicker, parseCoinbaseCandles, parseCoinbaseStats,
  parseKrakenOhlc, parseKrakenTicker, cryptoQuote, cryptoOhlcv, CRYPTO_SOURCES, _resetCryptoPreference
} from "../lib/cryptoSources.js";

const H = 3600e3;

test("baseAsset: BTCUSDT / BTC-USD / ethusd -> BTC / BTC / ETH", () => {
  assert.equal(baseAsset("BTCUSDT"), "BTC");
  assert.equal(baseAsset("BTC-USD"), "BTC");
  assert.equal(baseAsset("ethusd"), "ETH");
});

test("Gate.io: candle [t, qvol, close, high, low, open, bvol, closed] diurai benar", () => {
  const [b] = parseGateCandles([["1793721600", "111398101.6", "77606.2", "77894", "77372.1", "77689.2", "1434.786", "true"]]);
  assert.deepEqual(b, { time: 1793721600000, open: 77689.2, high: 77894, low: 77372.1, close: 77606.2, volume: 1434.786 });
  const q = parseGateTicker({ last: "102", change_percentage: "2", high_24h: "105", low_24h: "99", base_volume: "10" }, "BTCUSDT");
  assert.equal(q.price, 102);
  assert.ok(Math.abs(q.prevClose - 100) < 1e-9);
  assert.equal(q.changePercent, 2);
  assert.equal(q.source, "gateio");
});

test("Coinbase: candle [t, low, high, open, close, vol] terbaru-dulu -> diurutkan naik", () => {
  const bars = parseCoinbaseCandles([[7200, 9, 12, 10, 11, 5], [3600, 8, 11, 9, 10, 4]]);
  assert.deepEqual(bars.map(b => b.time), [3600e3, 7200e3]);
  assert.deepEqual(bars[1], { time: 7200e3, open: 10, high: 12, low: 9, close: 11, volume: 5 });
  const q = parseCoinbaseStats({ open: "100", high: "110", low: "95", last: "105", volume: "7" }, "BTCUSDT");
  assert.equal(q.change, 5);
  assert.equal(q.changePercent, 5);
});

test("Kraken: OHLC [t, o, h, l, c, vwap, vol, count] & ticker", () => {
  const [b] = parseKrakenOhlc([[1700000000, "10", "12", "9", "11", "10.5", "3.5", 42]]);
  assert.deepEqual(b, { time: 1700000000e3, open: 10, high: 12, low: 9, close: 11, volume: 3.5 });
  const q = parseKrakenTicker({ c: ["105", "1"], o: "100", h: ["106", "107"], l: ["99", "98"], v: ["1", "20"] }, "BTCUSDT");
  assert.equal(q.price, 105);
  assert.equal(q.changePercent, 5);
  assert.equal(q.high, 107);
});

test("aggregateAligned: 1h -> 4h selaras jam 00/04/08 UTC (bukan per-N candle)", () => {
  const t0 = Date.UTC(2026, 0, 5, 2); // mulai jam 02:00 -> candle 4h pertama hanya berisi 02 & 03
  const bars = Array.from({ length: 6 }, (_, i) => ({ time: t0 + i * H, open: i, high: i + 1, low: i - 1, close: i + 0.5, volume: 1 }));
  const out = aggregateAligned(bars, 4 * H);
  assert.equal(out.length, 2);
  assert.equal(out[0].time, Date.UTC(2026, 0, 5, 0));
  assert.equal(out[0].volume, 2);
  assert.equal(out[1].time, Date.UTC(2026, 0, 5, 4));
  assert.equal(out[1].open, 2);
  assert.equal(out[1].close, 5.5);
});

test("aggregateAligned: minggu dimulai hari Senin", () => {
  const day = 86400e3, wed = Date.UTC(2026, 0, 7);
  const bars = [0, 1, 2, 3, 4, 5].map(i => ({ time: wed + i * day, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
  const out = aggregateAligned(bars, 7 * day);
  assert.equal(new Date(out[0].time).getUTCDay(), 1);
  assert.equal(out.length, 2); // Rab-Min, lalu Senin berikutnya
});

const okJson = body => ({ ok: true, status: 200, json: async () => body });

test("rantai sumber: Binance ditolak (451) -> Gate.io dipakai, alasan dicatat, lalu diingat", async () => {
  _resetCryptoPreference();
  const calls = [];
  const fake = async url => {
    calls.push(url);
    if (url.includes("binance")) return { ok: false, status: 451 };
    if (url.includes("gateio")) return okJson([{ last: "100", change_percentage: "1", high_24h: "101", low_24h: "99", base_volume: "5" }]);
    throw new Error("tidak boleh sampai sini");
  };
  // binance pakai fetch bawaan modulnya; uji rantai dengan sumber pengganti yang memakai fake fetch
  const sources = [
    { name: "binance", quote: async () => { const r = await fake("https://binance/x"); if (!r.ok) throw new Error(`HTTP ${r.status}`); } },
    CRYPTO_SOURCES.find(s => s.name === "gateio")
  ];
  const q = await cryptoQuote("BTCUSDT", { fetchImpl: fake, sources });
  assert.equal(q.source, "gateio");
  assert.equal(q.price, 100);
  assert.match(q.fallbackReason, /binance: HTTP 451/);
});

test("rantai sumber: semua gagal -> error berisi alasan tiap sumber", async () => {
  const sources = [
    { name: "a", ohlcv: async () => { throw new Error("HTTP 403"); } },
    { name: "b", ohlcv: async () => [] }
  ];
  await assert.rejects(cryptoOhlcv("BTCUSDT", "1h", 250, { sources }), /a: HTTP 403 \| b: candle terlalu sedikit/);
});

test("cryptoOhlcv menempelkan sumber data pada array (tidak ikut JSON)", async () => {
  const bars = Array.from({ length: 250 }, (_, i) => ({ time: i * H, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
  const out = await cryptoOhlcv("BTCUSDT", "1h", 250, { sources: [{ name: "x", ohlcv: async () => bars }] });
  assert.equal(out.source, "x");
  assert.equal(out.fallbackReason, null);
  assert.equal(JSON.stringify(out).includes("source"), false);
});
