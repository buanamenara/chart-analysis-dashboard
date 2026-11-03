import test from "node:test";
import assert from "node:assert/strict";
import { computePrevClose, buildYahooQuote, buildYahooBars } from "../lib/yahoo.js";
import { binanceGet, BINANCE_HOSTS, _resetPreferredHost } from "../lib/binance.js";
import { assetTypeError, VALID_ASSET_TYPES } from "../lib/marketData.js";
import { createMemoCache } from "../lib/memoCache.js";

const chart = ({ closes, price = 110, chartPreviousClose = 50, previousClose } = {}) => ({
  meta: { regularMarketPrice: price, chartPreviousClose, previousClose, currency: "USD" },
  timestamp: closes.map((_, i) => 1_700_000_000 + i * 86400),
  indicators: { quote: [{
    open: closes.map(c => (c == null ? null : c - 1)),
    high: closes.map(c => (c == null ? null : c + 2)),
    low: closes.map(c => (c == null ? null : c - 2)),
    close: closes,
    volume: closes.map(() => 10)
  }] }
});

// ---------- 1. prevClose ----------
test("prevClose = close candle sebelum candle terakhir (bukan chartPreviousClose)", () => {
  const r = chart({ closes: [100, 101, 102, 105, 108], chartPreviousClose: 50 });
  assert.equal(computePrevClose(r), 105);
  const q = buildYahooQuote("PAXG-USD", r);
  assert.equal(q.prevClose, 105);
  assert.equal(q.change, 5);
  assert.ok(Math.abs(q.changePercent - (5 / 105) * 100) < 1e-9);
});

test("prevClose: candle terakhir null -> pakai close valid terakhir", () => {
  const r = chart({ closes: [100, 101, 104, null] });
  assert.equal(computePrevClose(r), 104);
});

test("prevClose: candle sebelumnya null juga dilewati", () => {
  const r = chart({ closes: [100, 103, null, 107] });
  assert.equal(computePrevClose(r), 103);
});

test("prevClose: tanpa candle -> fallback ke meta", () => {
  assert.equal(computePrevClose(chart({ closes: [], previousClose: 99 })), 99);
  assert.equal(computePrevClose(chart({ closes: [120], chartPreviousClose: 98 })), 98);
});

// ---------- 2. candle terakhir null ----------
test("OHLCV: candle terakhir null tidak dibuang, diisi regularMarketPrice", () => {
  const bars = buildYahooBars(chart({ closes: [100, 101, null], price: 103 }));
  assert.equal(bars.length, 3);
  const last = bars[2];
  assert.equal(last.close, 103);
  assert.equal(last.open, 103);
  assert.ok(last.high >= 103 && last.low <= 103);
});

test("OHLCV: candle null di tengah tetap dibuang", () => {
  const bars = buildYahooBars(chart({ closes: [100, null, 102] }));
  assert.deepEqual(bars.map(b => b.close), [100, 102]);
});

test("OHLCV: candle terakhir null tanpa harga live -> dibuang", () => {
  const bars = buildYahooBars(chart({ closes: [100, null], price: null }));
  assert.equal(bars.length, 1);
});

// ---------- 3. Binance host cadangan ----------
const okRes = body => ({ ok: true, status: 200, json: async () => body });

test("Binance: data-api.binance.vision dicoba pertama", () => {
  assert.equal(BINANCE_HOSTS[0], "https://data-api.binance.vision");
  assert.equal(BINANCE_HOSTS[1], "https://api.binance.com");
});

test("Binance: host pertama gagal -> pakai host cadangan, lalu diingat", async () => {
  _resetPreferredHost();
  const calls = [];
  const fake = async url => {
    calls.push(url);
    if (url.startsWith(BINANCE_HOSTS[0])) throw new Error("timeout");
    return okRes({ lastPrice: "1" });
  };
  assert.deepEqual(await binanceGet("/ticker/24hr?symbol=BTCUSDT", fake), { lastPrice: "1" });
  assert.equal(calls.length, 2);
  assert.ok(calls[1].startsWith(`${BINANCE_HOSTS[1]}/api/v3/`));

  calls.length = 0;
  await binanceGet("/ticker/24hr?symbol=ETHUSDT", fake);
  assert.equal(calls.length, 1, "host yang berhasil dipakai duluan");
  assert.ok(calls[0].startsWith(BINANCE_HOSTS[1]));
  _resetPreferredHost();
});

test("Binance: HTTP 451 di host pertama -> fallback", async () => {
  _resetPreferredHost();
  const fake = async url => url.startsWith(BINANCE_HOSTS[0])
    ? { ok: false, status: 451 }
    : okRes([1]);
  assert.deepEqual(await binanceGet("/klines?symbol=BTCUSDT", fake), [1]);
  _resetPreferredHost();
});

test("Binance: HTTP 400 (simbol salah) tidak dicoba ke host lain", async () => {
  _resetPreferredHost();
  let n = 0;
  const fake = async () => { n++; return { ok: false, status: 400 }; };
  await assert.rejects(binanceGet("/ticker/24hr?symbol=NOPE", fake));
  assert.equal(n, 1);
});

test("Binance: semua host gagal -> error (supaya fallback Yahoo jalan)", async () => {
  _resetPreferredHost();
  await assert.rejects(binanceGet("/x", async () => { throw new Error("blocked"); }), /blocked/);
});

// ---------- 4. assetType ----------
test("assetType valid / kosong -> tidak error", () => {
  for (const t of VALID_ASSET_TYPES) assert.equal(assetTypeError(t), null);
  assert.equal(assetTypeError(null), null);
  assert.equal(assetTypeError(""), null);
});

test("assetType tidak valid (mis. gold) -> body error 400", () => {
  const e = assetTypeError("gold");
  assert.equal(e.code, "INVALID_ASSET_TYPE");
  assert.match(e.hint, /assetType=forex/);
});

// ---------- 6. cache ----------
test("memo cache: panggilan kedua dalam TTL tidak memanggil ulang", async () => {
  const memo = createMemoCache();
  let n = 0;
  const fn = async () => ++n;
  assert.equal(await memo("k", 10_000, fn), 1);
  assert.equal(await memo("k", 10_000, fn), 1);
  assert.equal(n, 1);
});

test("memo cache: hasil gagal tidak disimpan", async () => {
  const memo = createMemoCache();
  let n = 0;
  await assert.rejects(memo("k", 10_000, async () => { n++; throw new Error("x"); }));
  await new Promise(r => setImmediate(r));
  assert.equal(await memo("k", 10_000, async () => ++n), 2);
});
