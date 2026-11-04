import test from "node:test";
import assert from "node:assert/strict";
import { assetKey, tagNews, processSymbolNews, dedupeNews } from "../lib/symbolNews.js";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const ago = h => new Date(NOW - h * 3600e3).toUTCString();
const gold = { mention: /\bgold\b|\bbullion\b|\bXAU/i, macroRelevant: true };
const btc = { mention: /\bbitcoin\b|\bBTC\b/i, macroRelevant: false };

test("assetKey memetakan simbol dashboard ke aset berita", () => {
  assert.equal(assetKey("forex", "XAUUSD"), "XAUUSD");
  assert.equal(assetKey("crypto", "BTCUSDT"), "BTC");
  assert.equal(assetKey("crypto", "ETHUSD"), "ETH");
});

test("label berita: makro, ETF, risiko", () => {
  assert.deepEqual(tagNews("Gold climbs as Fed signals rate cut"), ["makro"]);
  assert.ok(tagNews("Spot bitcoin ETF sees record inflows").includes("ETF"));
  assert.ok(tagNews("Exchange hack drains $100M").includes("risiko"));
  assert.deepEqual(tagNews("Company launches new product"), []);
});

test("emas: ambil yang menyebut gold ATAU berita makro; buang yang tak terkait", () => {
  const out = processSymbolNews([
    { title: "Gold hits record high", link: "https://a/1", pubDate: ago(1) },
    { title: "Powell says inflation still sticky", link: "https://a/2", pubDate: ago(2) },
    { title: "Upbit lists 9 altcoins", link: "https://a/3", pubDate: ago(1) }
  ], gold, { now: NOW });
  assert.deepEqual(out.map(i => i.link), ["https://a/1", "https://a/2"]);
  assert.ok(out[0].tags.includes("rekor"));
});

test("crypto: berita makro tanpa menyebut bitcoin tidak diambil", () => {
  const out = processSymbolNews([
    { title: "Bitcoin slips below $77K", link: "https://b/1", pubDate: ago(1) },
    { title: "Stock futures rise as Fed meets", link: "https://b/2", pubDate: ago(1) },
    { title: "If you had bought XRP...", link: "https://b/3", pubDate: ago(1) }
  ], btc, { now: NOW });
  assert.deepEqual(out.map(i => i.link), ["https://b/1"]);
});

test("berita lama (>72 jam) dibuang, urutan terbaru dulu", () => {
  const out = processSymbolNews([
    { title: "Gold falls in old story", link: "https://c/1", pubDate: ago(100) },
    { title: "Gold rises earlier", link: "https://c/2", pubDate: ago(5) },
    { title: "Gold rallies again", link: "https://c/3", pubDate: ago(1) }
  ], gold, { now: NOW });
  assert.deepEqual(out.map(i => i.link), ["https://c/3", "https://c/2"]);
});

test("link non-http dari feed dinolkan (cegah javascript: link)", () => {
  const out = processSymbolNews([{ title: "Gold price jumps", link: "javascript:alert(1)", pubDate: ago(1) }], gold, { now: NOW });
  assert.equal(out[0].link, null);
});

test("berita tambang emas & clickbait dibuang; pergerakan harga diambil", () => {
  const out = processSymbolNews([
    { title: "Montage Gold expects further resource growth at its Kone mine", link: "https://e/1", pubDate: ago(1) },
    { title: "Steppe Gold Releases 2025 ESG Report", link: "https://e/2", pubDate: ago(1) },
    { title: "Gold slips as dollar firms ahead of jobs data", link: "https://e/3", pubDate: ago(1) },
    { title: "Gold company announces new CFO", link: "https://e/4", pubDate: ago(1) }
  ], gold, { now: NOW });
  assert.deepEqual(out.map(i => i.link), ["https://e/3"]);
  const b = processSymbolNews([
    { title: "Bitcoin vs Nvidia: $10,000 Invested 5 Years Ago, Which Is Worth More Now?", link: "https://f/1", pubDate: ago(1) },
    { title: "Bitcoin falls below $75,000 as liquidations mount", link: "https://f/2", pubDate: ago(1) }
  ], btc, { now: NOW });
  assert.deepEqual(b.map(i => i.link), ["https://f/2"]);
});

test("duplikat (link atau judul sama) dibuang", () => {
  const out = dedupeNews([
    { title: "Gold rallies", link: "https://d/1" },
    { title: "Gold rallies!", link: "https://d/2" },
    { title: "Other", link: "https://d/1" }
  ]);
  assert.equal(out.length, 1);
});
