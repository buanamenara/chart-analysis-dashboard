import test from "node:test";
import assert from "node:assert/strict";
import { mergeTrailingLivePoint, aggregateAligned, INTERVAL_MS } from "../lib/bars.js";
import { buildYahooBars, prevCloseInfo, prevCloseFromIntraday, buildYahooQuote } from "../lib/yahoo.js";
import { cryptoOhlcv, cryptoQuote, kraken24hAgoClose, parseKrakenTicker, parseGateTicker, CRYPTO_SOURCES, _resetCryptoPreference } from "../lib/cryptoSources.js";
import { processSymbolNews } from "../lib/symbolNews.js";

const H = 3600e3, DAY = 86400e3;

// ---------- 1. titik "live" Yahoo ----------
test("titik live Yahoo di dalam jam berjalan digabung ke candle jam itu (bukan candle ganda)", () => {
  const t0 = Date.UTC(2026, 10, 4, 0);
  const bars = [
    { time: t0 - H, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 },
    { time: t0, open: 1.5, high: 1.8, low: 1.4, close: 1.6, volume: 3 },
    { time: t0 + 25 * 60e3 + 45e3, open: 1.9, high: 1.9, low: 1.9, close: 1.9, volume: 0 }
  ];
  const out = mergeTrailingLivePoint(bars, H);
  assert.equal(out.length, 2);
  assert.equal(out[1].time, t0);
  assert.equal(out[1].close, 1.9);
  assert.equal(out[1].high, 1.9);
});

test("titik live di periode baru: stempel waktunya diselaraskan ke awal periode", () => {
  const t0 = Date.UTC(2026, 10, 4, 0, 24);
  const out = mergeTrailingLivePoint([
    { time: t0, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    { time: t0 + 105e3, open: 2, high: 2, low: 2, close: 2, volume: 0 } // 00:25:45
  ], 60e3);
  assert.equal(out.length, 2);
  assert.equal(out[1].time, Date.UTC(2026, 10, 4, 0, 25));
});

test("mingguan: titik live 2 hari setelah awal minggu digabung ke candle minggu itu", () => {
  const mon = Date.UTC(2026, 10, 2);
  const out = buildYahooBars({
    meta: { regularMarketPrice: 3936 },
    timestamp: [(mon - 7 * DAY) / 1000, mon / 1000, (mon + 2 * DAY + 25 * 60e3) / 1000],
    indicators: { quote: [{ open: [1, 2, 3936], high: [1, 2, 3936], low: [1, 2, 3936], close: [3907, 3945, 3936], volume: [0, 0, 0] }] }
  }, INTERVAL_MS["1wk"]);
  assert.equal(out.length, 2);
  assert.equal(out[1].close, 3936);
});

test("candle tertutup terakhir tidak tersentuh saat tidak ada titik live", () => {
  const bars = [0, 1, 2].map(i => ({ time: i * H, open: 1, high: 1, low: 1, close: i, volume: 1 }));
  assert.equal(mergeTrailingLivePoint(bars, H).length, 3);
});

// ---------- 3. gabung selaras walau data bolong ----------
test("4h dari 1h tetap selaras walau ada jam yang hilang", () => {
  const t0 = Date.UTC(2026, 0, 5, 20);
  const hours = [20, 21, 0, 1].map(h => ({ time: t0 + ((h + 24 - 20) % 24) * H, open: h, high: h, low: h, close: h, volume: 1 }));
  const out = aggregateAligned(hours, 4 * H);
  assert.deepEqual(out.map(b => new Date(b.time).getUTCHours()), [20, 0]);
});

// ---------- 4. prevClose saat candle kemarin kosong ----------
test("prevCloseInfo menandai candle kemarin yang kosong", () => {
  const d = t => Date.UTC(2026, 10, t) / 1000;
  const info = prevCloseInfo({ timestamp: [d(2), d(3), d(4)], indicators: { quote: [{ close: [3945.9, null, 3936] }] }, meta: {} });
  assert.equal(info.prevClose, 3945.9);
  assert.equal(info.skippedNull, true);
  assert.equal(info.lastCandleTime, Date.UTC(2026, 10, 4));
});

test("prevClose diambil dari data per jam: close terakhir sebelum hari berjalan", () => {
  const today = Date.UTC(2026, 10, 4);
  const hourly = { timestamp: [today - 2 * H, today - H, today].map(t => t / 1000), indicators: { quote: [{ close: [3940, null, 3936] }] } };
  assert.equal(prevCloseFromIntraday(hourly, today), 3940);
  const q = buildYahooQuote("PAXG-USD", { meta: { regularMarketPrice: 3936 }, indicators: { quote: [{ close: [3945.9, null, 3936] }] } }, 3940);
  assert.equal(q.prevClose, 3940);
  assert.ok(Math.abs(q.changePercent - (-4 / 3940) * 100) < 1e-9);
});

test("akhir pekan forex (tanpa candle kosong) tidak dianggap bolong", () => {
  const d = t => Date.UTC(2026, 10, t) / 1000;
  assert.equal(prevCloseInfo({ timestamp: [d(6), d(9)], indicators: { quote: [{ close: [1.10, 1.11] }] }, meta: {} }).skippedNull, false);
});

// ---------- 2. batas subrequest: satu pencarian sumber, lainnya menunggu ----------
test("cold start: request paralel tidak semuanya mencoba sumber yang ditolak", async () => {
  _resetCryptoPreference();
  const binance = CRYPTO_SOURCES[0], gate = CRYPTO_SOURCES[1];
  const calls = { binance: 0, gateio: 0 };
  const bars = Array.from({ length: 250 }, (_, i) => ({ time: i * H, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
  const origB = binance.ohlcv, origG = gate.ohlcv;
  binance.ohlcv = async () => { calls.binance++; await new Promise(r => setTimeout(r, 20)); throw new Error("HTTP 403"); };
  gate.ohlcv = async () => { calls.gateio++; return bars; };
  try {
    const res = await Promise.all(Array.from({ length: 16 }, () => cryptoOhlcv("BTCUSDT", "1h", 250)));
    assert.ok(res.every(r => r.source === "gateio"));
    assert.equal(calls.binance, 1, "Binance hanya dicoba sekali");
    assert.equal(calls.gateio, 16);
  } finally {
    binance.ohlcv = origB; gate.ohlcv = origG; _resetCryptoPreference();
  }
});

// ---------- 5. Kraken 24 jam ----------
test("Kraken: prevClose = close candle 1 jam yang berumur >= 24 jam", () => {
  const now = Date.UTC(2026, 10, 4, 12, 30);
  const hourly = Array.from({ length: 30 }, (_, i) => ({ time: Date.UTC(2026, 10, 3, 6) + i * H, close: 100 + i }));
  const prev = kraken24hAgoClose(hourly, now);
  assert.equal(prev, 100 + 5); // candle 11:00-12:00 kemarin = 25 jam 30 menit lalu tertutup
  const q = parseKrakenTicker({ c: ["110"], o: "90", h: ["0", "111"], l: ["0", "99"], v: ["0", "1"] }, "BTCUSDT", prev);
  assert.equal(q.prevClose, 105);
});

// ---------- 6. sumber dengan candle terlalu sedikit dilewati ----------
test("sumber yang memberi < 200 candle dilewati agar SMA200 tetap ada", async () => {
  const few = Array.from({ length: 50 }, (_, i) => ({ time: i * H, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
  const many = Array.from({ length: 300 }, (_, i) => ({ time: i * H, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
  const out = await cryptoOhlcv("BTCUSDT", "30m", 250, { sources: [{ name: "coinbase", ohlcv: async () => few }, { name: "kraken", ohlcv: async () => many }] });
  assert.equal(out.source, "kraken");
  assert.match(out.fallbackReason, /coinbase: candle terlalu sedikit \(50 < 200\)/);
});

// ---------- 8. Gate.io persen perubahan kosong ----------
test("Gate.io: change_percentage kosong ditolak -> sumber berikutnya", async () => {
  assert.throws(() => parseGateTicker({ last: "1.23", change_percentage: "" }, "XUSDT"), /change_percentage/);
  const q = await cryptoQuote("BTCUSDT", { sources: [
    { name: "gateio", quote: async () => parseGateTicker({ last: "1.23", change_percentage: "" }, "BTCUSDT") },
    { name: "kraken", quote: async () => ({ price: 1.2, changePercent: 1 }) }
  ] });
  assert.equal(q.source, "kraken");
});

// ---------- 7. filter berita ----------
const NOW = Date.parse("2026-11-04T12:00:00Z");
const it = (title, h = 1) => ({ title, link: `https://x/${encodeURIComponent(title)}`, pubDate: new Date(NOW - h * H).toUTCString() });
const gold = { mention: /\bgold\b/i, macroRelevant: true, miningNoise: true };
const btc = { mention: /\bbitcoin\b|\bBTC\b/i, macroRelevant: false };

test("berita: 'which is' di judul normal tidak lagi dibuang", () => {
  const out = processSymbolNews([it("Gold hits record high, which is the biggest weekly gain since 2020")], gold, { now: NOW });
  assert.equal(out.length, 1);
});

test("berita: 'bitcoin miners' & 'deposits' tetap masuk untuk BTC, tapi tambang emas dibuang", () => {
  const b = processSymbolNews([it("Bitcoin miners sell BTC as price slips"), it("Bitcoin exchange deposits surge as price drops")], btc, { now: NOW });
  assert.equal(b.length, 2);
  const g = processSymbolNews([it("Montage Gold mining output rises as gold price climbs")], gold, { now: NOW });
  assert.equal(g.length, 0);
});

test("berita: clickbait tetap dibuang", () => {
  const out = processSymbolNews([
    it("Bitcoin vs Nvidia: $10,000 Invested 5 Years Ago, Which Is Worth More Now?"),
    it("If Bitcoin Falls Below $75,000, Which Drops Harder: Dogecoin or Cardano?")
  ], btc, { now: NOW });
  assert.equal(out.length, 0);
});
