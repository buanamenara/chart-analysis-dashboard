const INSTRUMENTS = {
  forex: [
    // Dikembalikan ke OANDA:XAUUSD sesuai permintaan
    { symbol: "XAUUSD", label: "Gold / USD (XAUUSD)", tv: "OANDA:XAUUSD" },
    { symbol: "XAGUSD", label: "Silver / USD (XAGUSD)", tv: "COMEX:SI1!" },
    { symbol: "EURUSD", label: "EUR/USD", tv: "OANDA:EURUSD" },
    { symbol: "GBPUSD", label: "GBP/USD", tv: "OANDA:GBPUSD" },
    { symbol: "USDJPY", label: "USD/JPY", tv: "OANDA:USDJPY" },
    { symbol: "AUDUSD", label: "AUD/USD", tv: "OANDA:AUDUSD" },
    { symbol: "USDCAD", label: "USD/CAD", tv: "OANDA:USDCAD" },
    { symbol: "USDCHF", label: "USD/CHF", tv: "OANDA:USDCHF" },
    { symbol: "NZDUSD", label: "NZD/USD", tv: "OANDA:NZDUSD" },
    { symbol: "EURJPY", label: "EUR/JPY", tv: "OANDA:EURJPY" },
    { symbol: "GBPJPY", label: "GBP/JPY", tv: "OANDA:GBPJPY" }
  ],
  crypto: [
    { symbol: "BTCUSDT", label: "Bitcoin (BTC/USDT)", tv: "BINANCE:BTCUSDT" },
    { symbol: "ETHUSDT", label: "Ethereum (ETH/USDT)", tv: "BINANCE:ETHUSDT" },
    { symbol: "BNBUSDT", label: "BNB (BNB/USDT)", tv: "BINANCE:BNBUSDT" },
    { symbol: "SOLUSDT", label: "Solana (SOL/USDT)", tv: "BINANCE:SOLUSDT" },
    { symbol: "XRPUSDT", label: "XRP (XRP/USDT)", tv: "BINANCE:XRPUSDT" },
    { symbol: "ADAUSDT", label: "Cardano (ADA/USDT)", tv: "BINANCE:ADAUSDT" },
    { symbol: "DOGEUSDT", label: "Dogecoin (DOGE/USDT)", tv: "BINANCE:DOGEUSDT" },
    { symbol: "AVAXUSDT", label: "Avalanche (AVAX/USDT)", tv: "BINANCE:AVAXUSDT" },
    { symbol: "DOTUSDT", label: "Polkadot (DOT/USDT)", tv: "BINANCE:DOTUSDT" },
    { symbol: "LINKUSDT", label: "Chainlink (LINK/USDT)", tv: "BINANCE:LINKUSDT" }
  ],
  stock: [
    { symbol: "^JKSE", label: "IHSG (Indonesia)", tv: "IDX:COMPOSITE" },
    { symbol: "BBCA.JK", label: "BBCA (Bank BCA)", tv: "IDX:BBCA" },
    { symbol: "BBRI.JK", label: "BBRI (Bank BRI)", tv: "IDX:BBRI" },
    { symbol: "BMRI.JK", label: "BMRI (Bank Mandiri)", tv: "IDX:BMRI" },
    { symbol: "TLKM.JK", label: "TLKM (Telkom Indonesia)", tv: "IDX:TLKM" },
    { symbol: "ASII.JK", label: "ASII (Astra International)", tv: "IDX:ASII" },
    { symbol: "GOTO.JK", label: "GOTO (GoTo Gojek Tokopedia)", tv: "IDX:GOTO" },
    { symbol: "AAPL", label: "Apple (AAPL)", tv: "NASDAQ:AAPL" },
    { symbol: "MSFT", label: "Microsoft (MSFT)", tv: "NASDAQ:MSFT" },
    { symbol: "GOOGL", label: "Alphabet / Google (GOOGL)", tv: "NASDAQ:GOOGL" },
    { symbol: "TSLA", label: "Tesla (TSLA)", tv: "NASDAQ:TSLA" },
    { symbol: "NVDA", label: "Nvidia (NVDA)", tv: "NASDAQ:NVDA" },
    { symbol: "AMZN", label: "Amazon (AMZN)", tv: "NASDAQ:AMZN" },
    { symbol: "^GSPC", label: "S&P 500", tv: "SP:SPX" },
    { symbol: "^DJI", label: "Dow Jones", tv: "TVC:DJI" },
    { symbol: "^IXIC", label: "Nasdaq Composite", tv: "NASDAQ:IXIC" }
  ]
};

const ASSET_TYPE_LABELS = { forex: "Forex", crypto: "Crypto", stock: "Saham / Indeks" };
const TV_INTERVAL_MAP = { "1m": "1", "3m": "3", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D", "1wk": "W" };

const el = id => document.getElementById(id);
const assetTypeSelect = el("assetType");
const symbolSelect = el("symbolSelect");
const intervalSelect = el("interval");
const autoRefreshBox = el("autoRefresh");
const refreshIntervalSelect = el("refreshInterval");

let tvWidget = null;
let autoRefreshTimer = null;
let lastSignal = null;

// Helper untuk menampilkan Error + Tombol Coba Lagi
window.retryLoad = {};
function renderErrorHtml(err, retryKey) {
  const msg = err.message || "Gagal mengambil data.";
  const hint = err.hint ? `<div style="font-size: 13px; color: #d1d4dc; margin-top: 6px;">${esc(err.hint)}</div>` : "";
  return `<div class="error-box" style="padding: 12px; background: rgba(248, 81, 73, 0.1); border-left: 3px solid #f85149; margin: 10px 0; border-radius: 4px; text-align: left;">
    <div style="color: #f85149; font-weight: 600;">⚠️ ${esc(msg)}</div>
    ${hint}
    <button onclick="window.retryLoad['${retryKey}']()" style="margin-top: 10px; font-size: 12px; padding: 6px 12px; background: transparent; border: 1px solid #555; color: #fff; border-radius: 4px; cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='#333'" onmouseout="this.style.background='transparent'">Coba Lagi</button>
  </div>`;
}

function populateAssetTypes() {
  assetTypeSelect.innerHTML = Object.entries(ASSET_TYPE_LABELS)
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
}

function populateSymbols() {
  const type = assetTypeSelect.value;
  symbolSelect.innerHTML = INSTRUMENTS[type]
    .map(i => `<option value="${i.symbol}">${i.label}</option>`)
    .join("");
}

function currentInstrument() {
  const type = assetTypeSelect.value;
  const symbol = symbolSelect.value;
  const def = INSTRUMENTS[type].find(i => i.symbol === symbol);
  return { type, symbol, tv: def?.tv || symbol };
}

function renderTvChart() {
  const { tv } = currentInstrument();
  const interval = TV_INTERVAL_MAP[intervalSelect.value] || "60";
  el("tv_chart_container").innerHTML = "";
  tvWidget = new TradingView.widget({
    autosize: true,
    symbol: tv,
    interval,
    timezone: "Asia/Jakarta",
    theme: "dark",
    style: "1",
    locale: "id",
    toolbar_bg: "#10151c",
    enable_publishing: false,
    allow_symbol_change: false,
    container_id: "tv_chart_container"
  });
}

function fmt(n, digits = 4) {
  if (n == null || Number.isNaN(n)) return "-";
  return Number(n).toLocaleString("id-ID", { maximumFractionDigits: digits });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

async function loadData() {
  const { type, symbol } = currentInstrument();
  const interval = intervalSelect.value;
  el("quoteSymbol").textContent = `${symbol} (${ASSET_TYPE_LABELS[type]})`;

  try {
    const res = await fetch(`/api/analysis-data?symbol=${encodeURIComponent(symbol)}&assetType=${type}&interval=${interval}`);
    let data;
    try { data = await res.json(); } catch(e) { throw new Error("Server mengembalikan format yang salah (bukan JSON)."); }
    
    if (!res.ok) {
      const error = new Error(data.error || "Gagal mengambil data");
      error.hint = data.hint;
      throw error;
    }

    const q = data.quote;
    const dp = priceDigits(type, q.price);
    el("quotePrice").textContent = fmt(q.price, dp);
    const changeEl = el("quoteChange");
    const changeTxt = `${q.change >= 0 ? "+" : ""}${fmt(q.change, dp)} (${fmt(q.changePercent, 2)}%)`;
    changeEl.textContent = changeTxt;
    changeEl.className = `change ${q.change >= 0 ? "positive" : "negative"}`;
    
    el("lastUpdated").innerHTML = `<span style="color:#3fb950;">●</span> Diperbarui: ${new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" })} WIB · Sumber: ${esc(SOURCE_LABELS[q.source] || q.source || "-")} (${esc(q.symbol)})`;
    renderSparkline(data.lastBars || []);
    renderInfoStrip(data, type);

    const { low, high } = dayRange(q);
    el("quoteLow").textContent = `L ${fmt(low, dp)}`;
    el("quoteHigh").textContent = `H ${fmt(high, dp)}`;
    if (high > low) {
      const pct = Math.min(100, Math.max(0, ((q.price - low) / (high - low)) * 100));
      el("rangePct").textContent = `${fmt(pct, 0)}%`;
      el("rangeFill").style.width = `${pct}%`;
      el("rangeDot").style.left = `${pct}%`;
    } else {
      el("rangePct").textContent = "-";
      el("rangeFill").style.width = "0%";
      el("rangeDot").style.left = "0%";
    }

    const ind = data.indicators;
    const rows = ind.insufficientData
      ? [["Status", "Data historis belum cukup"]]
      : [
          ["Harga Terakhir", fmt(ind.lastClose, dp)],
          ["RSI (14)", ind.rsi14 != null ? fmt(ind.rsi14, 1) : "-"],
          ["EMA 20", fmt(ind.ema20, dp)],
          ["EMA 50", fmt(ind.ema50, dp)],
          ["SMA 200", ind.sma200 != null ? fmt(ind.sma200, dp) : "Belum cukup data"],
          ["MACD", ind.macd ? fmt(ind.macd.MACD, 4) : "-"],
          ["BB Upper", ind.bollinger ? fmt(ind.bollinger.upper, dp) : "-"],
          ["BB Lower", ind.bollinger ? fmt(ind.bollinger.lower, dp) : "-"]
        ];
    el("indicatorTable").querySelector("tbody").innerHTML = rows
      .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
      .join("");
    el("trendSummary").textContent = data.trendSummary || "";
  } catch (err) {
    el("trendSummary").innerHTML = renderErrorHtml(err, 'data');
  }
}
window.retryLoad.data = loadData;

// Jumlah desimal harga: crypto & harga besar (emas, indeks) 2 desimal, pair forex 5.
function priceDigits(type, price) {
  if (type === "crypto") return price >= 1 ? 2 : 6;
  return price > 100 ? 2 : 5;
}

// High/low harian dari sumber data kadang tertinggal dari harga terkini (mis. Yahoo):
// rentang diperluas agar selalu memuat harga sekarang (posisi tidak lewat 100%).
function dayRange(q) {
  const p = Number.isFinite(q?.price) ? q.price : null;
  const low = Number.isFinite(q?.low) ? (p != null ? Math.min(q.low, p) : q.low) : null;
  const high = Number.isFinite(q?.high) ? (p != null ? Math.max(q.high, p) : q.high) : null;
  return { low, high };
}

const SOURCE_LABELS = { binance: "Binance", gateio: "Gate.io", coinbase: "Coinbase", kraken: "Kraken", yahoo: "Yahoo Finance" };

// Grafik mini harga di kartu harga (dari 20 candle terakhir).
function renderSparkline(bars) {
  const svg = el("quoteSpark");
  if (!svg) return;
  const closes = bars.map(b => b.close).filter(Number.isFinite);
  if (closes.length < 2) { svg.innerHTML = ""; return; }
  const min = Math.min(...closes), max = Math.max(...closes), span = max - min || 1;
  const W = 120, H = 44, pad = 3;
  const pts = closes.map((c, i) => [i / (closes.length - 1) * W, pad + (1 - (c - min) / span) * (H - 2 * pad)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  svg.setAttribute("class", `spark ${closes.at(-1) >= closes[0] ? "up" : "down"}`);
  svg.innerHTML = `<path class="area" d="${line} L${W},${H} L0,${H} Z"></path><path class="line" d="${line}"></path>`;
}

// Strip info di bawah chart: tren, ATR, volume, range harian, S/R terdekat.
function renderInfoStrip(data, type) {
  const ind = data.indicators || {}, q = data.quote || {}, lv = data.levels || {};
  const price = q.price ?? ind.lastClose;
  const dp = priceDigits(type, price);
  const set = (id, text, cls) => { const e = el(id); if (!e) return; e.textContent = text; if (cls !== undefined) e.className = `is-v ${cls}`; };
  const sub = (id, text) => { const e = el(id); if (e) e.textContent = text; };

  if (ind.insufficientData) {
    ["isTrend", "isAtr", "isVol"].forEach(id => set(id, "-", ""));
    sub("isTrendSub", "data belum cukup");
  } else {
    const up = ind.ema20 > ind.ema50 && (ind.sma200 == null || price > ind.sma200);
    const down = ind.ema20 < ind.ema50 && (ind.sma200 == null || price < ind.sma200);
    set("isTrend", up ? "BULLISH" : down ? "BEARISH" : "CAMPUR", up ? "up" : down ? "down" : "");
    sub("isTrendSub", ind.adx14 == null ? "" : ind.adx14 >= 25 ? `Kuat (ADX ${fmt(ind.adx14, 0)})` : ind.adx14 >= 20 ? `Sedang (ADX ${fmt(ind.adx14, 0)})` : `Lemah / sideways (ADX ${fmt(ind.adx14, 0)})`);
    set("isAtr", ind.atr14 != null ? fmt(ind.atr14, dp) : "-", "");
    sub("isAtrSub", ind.atr14 != null && price ? `${fmt(ind.atr14 / price * 100, 2)}% dari harga / candle` : "");
    const v = ind.volume;
    if (v?.available && v.ratio != null) {
      set("isVol", v.aboveAvg ? "Tinggi" : v.thin ? "Tipis" : "Normal", v.aboveAvg ? "up" : v.thin ? "down" : "");
      sub("isVolSub", `${fmt(v.ratio, 2)}× rata-rata`);
    } else {
      set("isVol", "-", "");
      sub("isVolSub", "tidak tersedia");
    }
  }
  const { low, high } = dayRange(q);
  if (high > low) {
    set("isRange", `${fmt(low, dp)} – ${fmt(high, dp)}`, "");
    sub("isRangeSub", `harga di ${fmt((price - low) / (high - low) * 100, 0)}% range`);
  } else { set("isRange", "-", ""); sub("isRangeSub", ""); }
  const dist = lvl => (lvl != null && price ? `${fmt(Math.abs(price - lvl) / price * 100, 2)}% dari harga` : "");
  set("isSup", lv.support != null ? fmt(lv.support, dp) : "-", "up"); sub("isSupSub", dist(lv.support));
  set("isRes", lv.resistance != null ? fmt(lv.resistance, dp) : "-", "down"); sub("isResSub", dist(lv.resistance));
}

// Jam pasar (WIB) + status pasar & sesi aktif. Jam sesi perkiraan (UTC):
// Sydney 21–06, Tokyo 00–09, London 07–16, New York 12–21. Forex/emas libur
// Jumat 21:00 UTC s.d. Minggu 21:00 UTC; crypto buka 24/7.
function updateMarketClock() {
  const now = new Date();
  const wib = { timeZone: "Asia/Jakarta" };
  el("mcTime").textContent = `${now.toLocaleTimeString("id-ID", { ...wib, hour12: false })} WIB`;
  el("mcDate").textContent = now.toLocaleDateString("id-ID", { ...wib, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const type = assetTypeSelect.value;
  const d = now.getUTCDay(), h = now.getUTCHours();
  const fxClosed = (d === 5 && h >= 21) || d === 6 || (d === 0 && h < 21);
  const status = el("mcStatus");
  if (type === "crypto") { status.textContent = "Buka 24/7"; status.className = "mc-status"; }
  else if (type === "forex") { status.textContent = fxClosed ? "Libur" : "Buka"; status.className = `mc-status${fxClosed ? " closed" : ""}`; }
  else { status.textContent = "Cek jam bursa"; status.className = "mc-status closed"; }
  const sessions = [["Sydney", 21, 6], ["Tokyo", 0, 9], ["London", 7, 16], ["New York", 12, 21]]
    .filter(([, a, b]) => (a < b ? h >= a && h < b : h >= a || h < b)).map(([n]) => n);
  el("mcSession").textContent = type === "stock" ? "" : (type === "forex" && fxClosed) ? "Pasar forex tutup akhir pekan" : `Sesi aktif: ${sessions.join(" + ") || "-"}`;
}

function mdBoldToHtml(text) {
  const span = document.createElement("span");
  span.textContent = text;
  return span.innerHTML.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

async function loadSignal() {
  const { type, symbol } = currentInstrument();
  const interval = intervalSelect.value;
  try {
    const res = await fetch(`/api/signal?symbol=${encodeURIComponent(symbol)}&assetType=${type}&interval=${interval}`);
    let data;
    try { data = await res.json(); } catch(e) { throw new Error("Format data salah."); }
    if (!res.ok) {
      const error = new Error(data.error || "Gagal memuat sinyal");
      error.hint = data.hint;
      throw error;
    }

    lastSignal = data.signal;

    const badge = el("signalBadge");
    badge.textContent = data.signal;
    badge.className = `signal-badge signal-${data.signal.toLowerCase()}`;
    const conf = Number.isFinite(data.confidence) ? data.confidence : null;
    el("signalConf").textContent = conf != null ? `${conf}%` : "-";
    el("signalConfFill").style.width = `${conf ?? 0}%`;
    badge.classList.toggle("signal-weak", !!data.weakSignal);
    el("signalSub").textContent = data.weakSignal ? `${data.signal} lemah — banyak faktor berlawanan, lebih aman tunggu konfirmasi`
      : data.signal === "BUY" ? `Bias naik · keyakinan ${data.confidenceLabel || "-"}`
      : data.signal === "SELL" ? `Bias turun · keyakinan ${data.confidenceLabel || "-"}`
      : "Belum ada dominasi arah";

    // Ringkas seperti mockup: 3 alasan teratas, sisanya dilipat di "Lihat semua alasan".
    const reasons = (data.reasons || []).map(r => `<li>${mdBoldToHtml(r)}</li>`);
    el("signalReasons").innerHTML = reasons.slice(0, 3).join("");
    el("signalReasonsMore").innerHTML = reasons.slice(3).join("");
    el("signalMoreWrap").hidden = reasons.length <= 3;
    document.querySelectorAll(".ss-pill").forEach(p => p.classList.toggle("active", p.dataset.s === data.signal));
    el("signalDisclaimer").textContent = data.disclaimer || "";
  } catch (err) {
    el("signalBadge").textContent = "ERROR";
    el("signalBadge").className = "signal-badge signal-netral";
    el("signalReasons").innerHTML = `<li>${renderErrorHtml(err, 'signal')}</li>`;
    el("signalMoreWrap").hidden = true;
    el("signalConf").textContent = "-";
    el("signalConfFill").style.width = "0%";
    document.querySelectorAll(".ss-pill").forEach(p => p.classList.remove("active"));
  }
}
window.retryLoad.signal = loadSignal;

async function loadNews() {
  const { type, symbol } = currentInstrument();
  const body = el("newsBody");
  body.innerHTML = `<div class="muted">Memuat berita...</div>`;
  try {
    const res = await fetch(`/api/news?assetType=${type}&symbol=${encodeURIComponent(symbol)}`);
    let data;
    try { data = await res.json(); } catch(e) { throw new Error("Format data salah."); }
    if (!res.ok) {
      const error = new Error(data.error || "Gagal memuat berita");
      error.hint = data.hint;
      throw error;
    }
    const newsRow = n => `<div class="news-item">${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>` : `<span>${esc(n.title)}</span>`}<div class="news-source">${(n.tags || []).map(t => `<span class="news-tag t-${esc(String(t).replace(/\s+/g, "-"))}">${esc(t)}</span>`).join("")}${esc(n.source)}${n.pubDate ? " · " + new Date(n.pubDate).toLocaleString("id-ID") : ""}</div></div>`;
    let html = "";
    const sn = data.symbolNews;
    if (sn) {
      html += `<div class="news-head">Khusus ${esc(sn.asset)} (${esc(symbol)})</div>`;
      html += sn.items.length ? sn.items.map(newsRow).join("") : `<div class="muted">Belum ada berita relevan dalam 72 jam terakhir.</div>`;
      html += `<div class="news-head">Berita umum</div>`;
    }
    html += data.items?.length ? data.items.map(newsRow).join("") : `<div class="muted">Tidak ada berita.</div>`;
    body.innerHTML = html;
    renderNewsMini(sn, data.items || [], symbol);
  } catch (err) {
    body.innerHTML = renderErrorHtml(err, 'news');
  }
}
window.retryLoad.news = loadNews;

// Kartu berita ringkas di halaman Chart (mockup Canva: "Khusus Emas").
// Pakai berita khusus simbol bila ada; kalau tidak (mis. EURUSD/saham), berita umum.
function renderNewsMini(symbolNews, generalItems, symbol) {
  const body = el("newsMiniBody");
  if (!body) return;
  const items = (symbolNews?.items?.length ? symbolNews.items : generalItems).slice(0, 4);
  // Tanpa berita khusus simbol, yang tampil berita UMUM kategori — beri judul jujur.
  const usingSymbol = !!symbolNews?.items?.length;
  el("newsMiniTitle").textContent = usingSymbol ? `Khusus ${symbolNews.asset}` : `Berita ${ASSET_TYPE_LABELS[assetTypeSelect.value] || "Pasar"} (umum)`;
  if (!items.length) { body.innerHTML = `<div class="muted">Belum ada berita relevan.</div>`; return; }
  const hhmm = d => {
    const t = Date.parse(d);
    return Number.isFinite(t) ? new Date(t).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }) : "";
  };
  body.innerHTML = items.map(n => {
    const title = n.link ? `<a class="nm-title" href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>` : `<span class="nm-title">${esc(n.title)}</span>`;
    const tag = (n.tags || [])[0];
    return `<div class="nm-item"><span class="nm-time">${esc(hhmm(n.pubDate))}</span>${title}<span class="nm-tag">${tag ? `<span class="news-tag t-${esc(String(tag).replace(/\s+/g, "-"))}">${esc(tag)}</span>` : ""}</span></div>`;
  }).join("");
}

// "Lihat semua berita →": pindah ke Kalender & Berita, tab Berita Pasar.
function openAllNews() {
  document.querySelector('.quicknav-btn[data-view="news"]')?.click();
  document.querySelector('.tab-btn[data-tab="market-news"]')?.click();
}

function renderEventBias(e, assetType, symbol) {
  const info = e.biasInfo;
  if (!info || info.bias === "unknown") return "";

  if (info.bias === "qualitative") {
    return `<div class="event-bias qualitative">Event kualitatif (pidato/pernyataan/notulen) — tidak ada angka forecast untuk dibandingkan. Dampak ke harga tergantung isi &amp; nada bicara saat rilis, bukan beat/miss angka. Pantau langsung saat jam rilis.</div>`;
  }

  if (info.bias === "inflation") {
    const isMetal = symbol === "XAUUSD" || symbol === "XAGUSD";
    if (isMetal) {
      return `<div class="event-bias qualitative">Event inflasi (CPI/PCE) High Impact — inflasi lebih tinggi cenderung mendukung ${symbol} (lindung nilai), namun bisa juga memicu ekspektasi suku bunga naik sehingga menekannya. Arah ${symbol} tergantung efek mana yang dominan; pantau reaksi saat rilis.</div>`;
    }
    return `<div class="event-bias qualitative">Event inflasi (CPI/PCE) — dampaknya ke ${esc(e.country)} dua arah (bisa memicu ekspektasi kenaikan suku bunga, atau pelemahan daya beli). Pantau reaksi saat rilis.</div>`;
  }

  if (info.bias === "rate") {
    const isMetal = symbol === "XAUUSD" || symbol === "XAGUSD";
    if (isMetal) {
      return `<div class="event-bias qualitative">Keputusan suku bunga (${esc(e.country)}) — kenaikan suku bunga cenderung menekan ${symbol}, penurunan cenderung mendorongnya naik. Pantau angka final &amp; nada pernyataan resmi (FOMC Statement / Press Conference, hawkish/dovish) saat rilis.</div>`;
    }
    return `<div class="event-bias qualitative">Keputusan suku bunga (${esc(e.country)}) — pantau angka final &amp; nada pernyataan resmi untuk arah ke depan.</div>`;
  }

  const isBullish = info.bias === "bullish";
  const biasCls = isBullish ? "bullish" : "bearish";
  const biasLabel = isBullish ? "Cenderung BULLISH" : "Cenderung BEARISH";
  let html = `<div class="event-bias ${biasCls}">${biasLabel} untuk ${esc(e.country)} <span class="muted">(forecast ${esc(e.forecast)} vs prev ${esc(e.previous)})</span></div>`;

  const pairBias = info.pairBias;
  if (pairBias) {
    const pairCls = pairBias === "bullish" ? "bullish" : "bearish";
    const pairLabel = pairBias === "bullish" ? "BULLISH ↑" : "BEARISH ↓";
    html += `<div class="event-bias ${pairCls}">Arah ${symbol} saat rilis: ${pairLabel}</div>`;

    if (lastSignal) {
      const biasDir = pairBias === "bullish" ? "BUY" : "SELL";
      let combo;
      if (lastSignal === "NETRAL") {
        combo = `Sinyal teknikal saat ini masih NETRAL, belum ada konfirmasi kuat dari chart.`;
      } else if (lastSignal === biasDir) {
        combo = `<b>Selaras</b> dengan sinyal teknikal saat ini (${lastSignal}) — kombinasi berita + chart kompak.`;
      } else {
        combo = `<b>Berlawanan</b> dengan sinyal teknikal saat ini (${lastSignal}) — waspada potensi reversal/konflik sinyal.`;
      }
      html += `<div class="event-combo">${combo}</div>`;
    }
  }
  return html;
}

async function loadCalendar() {
  const { symbol, type } = currentInstrument();
  const calBody = el("calendarBody");
  const econBody = el("econNewsBody");
  calBody.innerHTML = `<div class="muted">Memuat kalender...</div>`;
  econBody.innerHTML = `<div class="muted">Memuat berita ekonomi...</div>`;
  try {
    const res = await fetch(`/api/economic-calendar?symbol=${encodeURIComponent(symbol)}`);
    let data;
    try { data = await res.json(); } catch(e) { throw new Error("Format data salah."); }
    if (!res.ok) {
      const error = new Error(data.error || "Gagal memuat kalender");
      error.hint = data.hint;
      throw error;
    }

    calBody.innerHTML = data.calendarError
      ? (data.calendarError.includes("429")
          ? `<div class="muted">Kalender ekonomi sedang dibatasi (rate-limit) — coba lagi beberapa menit lagi.</div>`
          : `<div class="muted">Kalender ekonomi gagal dimuat (${esc(data.calendarError)}).</div>`)
      : (data.events?.length
          ? data.events
              .map(e => {
                const impactCls = ["High", "Medium", "Low", "Holiday"].includes(e.impact) ? e.impact : "Low";
                return `<div class="cal-item"><div class="cal-time">${new Date(e.date).toLocaleString("id-ID", { weekday: "short", hour: "2-digit", minute: "2-digit" })} · ${esc(e.country)}<span class="cal-impact ${impactCls}">${esc(e.impact)}</span></div><div>${esc(e.title)}${e.forecast ? ` (forecast: ${esc(e.forecast)}, prev: ${esc(e.previous)})` : ""}</div>${renderEventBias(e, type, symbol)}</div>`;
              })
              .join("")
          : `<div class="muted">Tidak ada event relevan minggu ini.</div>`);

    econBody.innerHTML = data.news?.length
      ? data.news
          .map(n => `<div class="news-item"><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="news-source">${esc(n.source || "Investing.com Ekonomi")}${n.pubDate ? " · " + new Date(n.pubDate).toLocaleString("id-ID") : ""}</div></div>`)
          .join("")
      : `<div class="muted">Tidak ada berita ekonomi.</div>`;
  } catch (err) {
    const errHtml = renderErrorHtml(err, 'calendar');
    calBody.innerHTML = errHtml;
    econBody.innerHTML = errHtml;
  }
}
window.retryLoad.calendar = loadCalendar;

function initTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-panel").forEach(p => { p.hidden = true; });
      el(`tab-${btn.dataset.tab}`).hidden = false;
    });
  });
}

function initViews() {
  const navButtons = document.querySelectorAll(".quicknav-btn");
  navButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      navButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".view").forEach(v => { v.hidden = true; });
      el(`view-${btn.dataset.view}`).hidden = false;
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  });
}

async function loadSentiment() {
  const { type } = currentInstrument();
  const card = el("sentimentCard");
  if (type !== "crypto") { card.style.display = "none"; return; }
  card.style.display = "";
  const body = el("sentimentBody");
  body.innerHTML = `<div class="muted">Memuat sentimen...</div>`;
  try {
    const res = await fetch("/api/sentiment");
    let data;
    try { data = await res.json(); } catch(e) { throw new Error("Format data salah."); }
    if (!res.ok) {
      const error = new Error(data.error || "Gagal memuat sentimen");
      error.hint = data.hint;
      throw error;
    }
    const rows = [];
    if (data.fearGreed) rows.push(["Fear & Greed Index", `${data.fearGreed.value} (${data.fearGreed.classification})`]);
    if (data.cryptoGlobal) {
      rows.push(["Dominasi BTC", `${fmt(data.cryptoGlobal.btcDominance, 1)}%`]);
      rows.push(["Total Market Cap 24h", `${fmt(data.cryptoGlobal.marketCapChangePercent24h, 2)}%`]);
    }
    body.innerHTML = rows.map(([k, v]) => `<div class="sentiment-row"><span class="muted">${k}</span><span>${v}</span></div>`).join("") || `<div class="muted">Data tidak tersedia.</div>`;
  } catch (err) {
    body.innerHTML = renderErrorHtml(err, 'sentiment');
  }
}
window.retryLoad.sentiment = loadSentiment;

let snrChart = null;
let snrSeries = null;

const SNR_PLACEHOLDER = `<div class="snr-placeholder">Klik <b>"Analisa"</b> untuk menampilkan chart, zona Support/Resistance, serta area Buy/Sell (Entry, SL, TP) di timeframe yang sedang dipilih.</div>`;

function clearSnrChart() {
  if (snrChart) { snrChart.remove(); snrChart = null; snrSeries = null; }
  el("snrChartContainer").innerHTML = SNR_PLACEHOLDER;
  el("snrBody").innerHTML = "";
  el("snrStatus").textContent = "";
}

// Primitive "pita"/band horizontal: menggambar ZONA sebagai kotak (persegi) transparan
// antara dua harga, supaya zona S/R & ORB tidak jadi garis label yang menumpuk di sumbu.
function makeBand(series, priceLow, priceHigh, fillColor) {
  const view = {
    renderer() {
      return {
        draw(target) {
          target.useBitmapCoordinateSpace(scope => {
            const yH = series.priceToCoordinate(priceHigh);
            const yL = series.priceToCoordinate(priceLow);
            if (yH == null || yL == null) return;
            const ctx = scope.context;
            const top = Math.min(yH, yL) * scope.verticalPixelRatio;
            const bot = Math.max(yH, yL) * scope.verticalPixelRatio;
            ctx.fillStyle = fillColor;
            ctx.fillRect(0, top, scope.bitmapSize.width, Math.max(1, bot - top));
          });
        }
      };
    },
    zOrder: () => "bottom"
  };
  return { updateAllViews() {}, paneViews() { return [view]; } };
}

function addBand(series, low, high, fill, edge) {
  if (low == null || high == null) return;
  if (typeof series.attachPrimitive === "function") {
    series.attachPrimitive(makeBand(series, low, high, fill));
  } else {
    // Fallback bila primitive tak didukung: dua garis tepi tipis tanpa label sumbu.
    series.createPriceLine({ price: high, color: edge, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: false });
    series.createPriceLine({ price: low, color: edge, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: false });
  }
}

function renderSnrChart(data) {
  const container = el("snrChartContainer");
  container.innerHTML = "";
  snrChart = LightweightCharts.createChart(container, {
    layout: { background: { color: "#0d1117" }, textColor: "#b4bfce" },
    grid: { vertLines: { color: "#1b222c" }, horzLines: { color: "#1b222c" } },
    timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#272e3a" },
    rightPriceScale: { borderColor: "#272e3a" },
    crosshair: { mode: LightweightCharts.CrosshairMode ? LightweightCharts.CrosshairMode.Normal : 0 },
    watermark: {
      visible: true,
      text: `${data.symbol || ""} · ${data.interval || ""}`,
      color: "rgba(180,191,206,0.08)",
      fontSize: 34,
      horzAlign: "center",
      vertAlign: "center"
    },
    autoSize: true
  });
  snrSeries = snrChart.addCandlestickSeries({
    upColor: "#3fb950", downColor: "#f85149", borderVisible: false,
    wickUpColor: "#3fb950", wickDownColor: "#f85149"
  });

  const seen = new Map();
  data.bars.forEach(b => {
    const t = Math.floor(b.time / 1000);
    seen.set(t, { time: t, open: b.open, high: b.high, low: b.low, close: b.close });
  });
  const candles = [...seen.values()].sort((a, b) => a.time - b.time);
  snrSeries.setData(candles);

  // SEMUA zona SNR sebagai kotak transparan — makin kuat (banyak konfluensi) makin pekat.
  (data.zones || []).forEach(z => {
    const isRes = z.type === "resistance";
    const op = Math.min(0.07 + (z.strength || 1) * 0.03, 0.2);
    const rgb = isRes ? "248,81,73" : "63,185,80";
    addBand(snrSeries, z.low, z.high, `rgba(${rgb},${op.toFixed(2)})`, isRes ? "#f85149" : "#3fb950");
  });
  if (data.orb?.high) addBand(snrSeries, data.orb.low, data.orb.high, "rgba(227,160,8,0.10)", "#e3a008");

  // Level referensi (garis tipis, judul di garis, TANPA label sumbu -> tak menumpuk di kanan):
  const refLine = (price, color, style, title) => {
    if (price == null) return;
    snrSeries.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: false, title });
  };
  if (data.nearestSupport) refLine(data.nearestSupport.mid, "#3fb950", LightweightCharts.LineStyle.Dashed, `S ${data.nearestSupport.mid.toFixed(2)}`);
  if (data.nearestResistance) refLine(data.nearestResistance.mid, "#f85149", LightweightCharts.LineStyle.Dashed, `R ${data.nearestResistance.mid.toFixed(2)}`);
  refLine(data.vwap?.vwap, "#58a6ff", LightweightCharts.LineStyle.Dashed, "VWAP");
  refLine(data.volumeProfile?.poc, "#a371f7", LightweightCharts.LineStyle.Dotted, "POC");

  // Level TRADE (garis tegas + label sumbu — HANYA ini yang muncul di sumbu kanan):
  if (data.potential) {
    const p = data.potential;
    const tradeLine = (price, color, title) => snrSeries.createPriceLine({ price, color, lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true, title });
    tradeLine(p.entry, "#d4af37", "Entry");
    tradeLine(p.stopLoss, "#f85149", "SL");
    (p.takeProfit || []).forEach((tp, i) => tradeLine(tp, "#3fb950", `TP${i + 1}`));

    const lastCandle = candles.at(-1);
    if (lastCandle) {
      snrSeries.setMarkers([{
        time: lastCandle.time,
        position: p.type === "BUY_ZONE" ? "belowBar" : "aboveBar",
        color: p.type === "BUY_ZONE" ? "#3fb950" : "#f85149",
        shape: p.type === "BUY_ZONE" ? "arrowUp" : "arrowDown",
        text: p.type === "BUY_ZONE" ? "BUY" : "SELL"
      }]);
    }
  }

  snrChart.timeScale().fitContent();
}

function renderSnrBody(data) {
  const body = el("snrBody");
  let html = "";

  const a = data.analysis;
  if (a) {
    const biasCls = a.bias === "bullish" ? "buy" : a.bias === "bearish" ? "sell" : "none";
    const biasLabel = a.bias === "bullish" ? "BULLISH" : a.bias === "bearish" ? "BEARISH" : "NETRAL";
    const conf = a.overallConfidence != null ? `<span class="an-conf conf-${(a.confidenceLabel || "").toLowerCase()}">Keyakinan: ${a.confidenceLabel} ${a.overallConfidence}%</span>` : "";
    const regimeText = a.regime ? `${a.regime.strength} (ADX ${a.regime.adx}${a.regime.direction ? ", " + a.regime.direction : ""})` : "-";
    html += `<div class="snr-analysis">
      <div class="an-head"><span class="an-bias ${biasCls}">Bias Teknikal: ${biasLabel}</span>${conf}${a.weakSignal ? `<span class="an-conf conf-rendah">⚠ Sinyal lemah</span>` : ""}</div>
      <div class="an-grid">
        <div class="an-item"><span class="an-k">Kekuatan Tren</span><span class="an-v">${regimeText}</span></div>
        <div class="an-item"><span class="an-k">Multi-Timeframe</span><span class="an-v">${a.multiTimeframeText || "-"}</span></div>
        ${a.fundamental?.text ? `<div class="an-item"><span class="an-k">${a.fundamental.kind === "crypto" ? "Fundamental" : "Makro"}</span><span class="an-v">${mdBoldToHtml(a.fundamental.text)}</span></div>` : ""}
        <div class="an-item"><span class="an-k">Tren</span><span class="an-v">${a.trend}</span></div>
        <div class="an-item"><span class="an-k">Momentum</span><span class="an-v">${a.momentum}</span></div>
        <div class="an-item"><span class="an-k">Volatilitas</span><span class="an-v">${a.volatility}</span></div>
        ${a.divergence ? `<div class="an-item"><span class="an-k">Divergence</span><span class="an-v" style="color:${a.divergence === 'bullish' ? 'var(--green)' : 'var(--red)'}">RSI ${a.divergence.toUpperCase()} (sinyal pembalikan)</span></div>` : ""}
        ${a.hiddenDivergence ? `<div class="an-item"><span class="an-k">Hidden Divergence</span><span class="an-v" style="color:${a.hiddenDivergence === 'bullish' ? 'var(--green)' : 'var(--red)'}">${a.hiddenDivergence.toUpperCase()} (penerusan tren)</span></div>` : ""}
        ${a.vwap ? `<div class="an-item"><span class="an-k">VWAP</span><span class="an-v">${fmt(a.vwap.vwap)} — harga ${a.vwap.bias === 'bullish' ? 'di ATAS (bias naik)' : a.vwap.bias === 'bearish' ? 'di BAWAH (bias turun)' : 'di VWAP (netral)'}</span></div>` : ""}
        ${a.volumeProfile ? `<div class="an-item"><span class="an-k">Volume Profile</span><span class="an-v">POC <b>${fmt(a.volumeProfile.poc)}</b> · Value Area ${fmt(a.volumeProfile.val)}–${fmt(a.volumeProfile.vah)}${a.volumeProfile.usedVolume ? "" : " (proxy rentang)"}</span></div>` : ""}
        ${a.structure?.bos ? `<div class="an-item"><span class="an-k">Struktur (ICT)</span><span class="an-v" style="color:${a.structure.bos === 'bullish' ? 'var(--green)' : 'var(--red)'}">BOS ${a.structure.bos.toUpperCase()}${a.structure.orderBlock ? ` · OB ${fmt(a.structure.orderBlock.low)}–${fmt(a.structure.orderBlock.high)}` : ""}</span></div>` : ""}
        ${a.orb ? `<div class="an-item"><span class="an-k">ORB (${a.orb.session})</span><span class="an-v" style="color:${a.orb.bias === 'bullish' ? 'var(--green)' : a.orb.bias === 'bearish' ? 'var(--red)' : 'var(--text)'}">${fmt(a.orb.low)}–${fmt(a.orb.high)} · ${a.orb.state}${a.orb.bias !== 'netral' ? ` → target ${fmt(a.orb.target)}` : ""}</span></div>` : ""}
        ${a.volume ? `<div class="an-item"><span class="an-k">Volume</span><span class="an-v">${a.volume.ratio}× rata-rata ${a.volume.aboveAvg ? "— di atas normal (konfirmasi)" : a.volume.thin ? "— tipis (lemah)" : "— normal"}</span></div>` : ""}
        ${a.fib ? `<div class="an-item"><span class="an-k">Fibonacci</span><span class="an-v">Retrace ${a.fib.direction}; terdekat ${a.fib.nearest ? (a.fib.nearest.ratio * 100).toFixed(1) + '% @ ' + fmt(a.fib.nearest.price) : '-'}${a.fib.atGoldenZone ? ' <b style="color:var(--accent)">(golden zone)</b>' : ''}</span></div>` : ""}
        <div class="an-item"><span class="an-k">Pola Candle</span><span class="an-v">${a.candle}</span></div>
        <div class="an-item"><span class="an-k">Sesi Pasar</span><span class="an-v">${a.sessions}</span></div>
        ${a.keyLevel ? `<div class="an-item"><span class="an-k">Key Level</span><span class="an-v">${a.keyLevel}</span></div>` : ""}
        <div class="an-item"><span class="an-k">Support / Resistance</span><span class="an-v">${a.support ? fmt(a.support) : "-"} / ${a.resistance ? fmt(a.resistance) : "-"}</span></div>
      </div>
      <div class="an-conclusion">${mdBoldToHtml(a.conclusion)}</div>
    </div>`;
  }

  if (a?.trapWarning) html += `<div class="trap-warn">${mdBoldToHtml(a.trapWarning)}</div>`;

  if (data.potential) {
    const p = data.potential;
    const cls = p.type === "BUY_ZONE" ? "buy" : "sell";
    html += `<div class="snr-potential ${cls}">${mdBoldToHtml(p.reason)}</div>`;
    if (p.rrWarning) html += `<div class="rr-warn">${mdBoldToHtml(p.rrWarning)}</div>`;
    if (p.signalNote) html += `<div class="fund-note">${mdBoldToHtml(p.signalNote)}</div>`;
    if (a?.fundamental?.align === "aligned") html += `<div class="fund-note aligned">✔ ${a.fundamental.kind === "crypto" ? "Fundamental" : "Makro"} SEARAH dengan setup ini — konfluensi lebih kuat.</div>`;
    else if (a?.fundamental?.align === "conflict") html += `<div class="fund-note conflict">⚠ ${a.fundamental.kind === "crypto" ? "Fundamental" : "Makro"} BERLAWANAN dengan setup ini — pertimbangkan kurangi ukuran / tunggu konfirmasi.</div>`;
    html += `<table class="snr-tpsl-table"><tbody>
      <tr class="row-entry"><td>Entry</td><td>${fmt(p.entry)}</td></tr>
      <tr class="row-sl"><td>Stop Loss</td><td>${fmt(p.stopLoss)}</td></tr>
      ${(p.takeProfit || []).map((tp, i) => `<tr class="row-tp"><td>Take Profit ${i + 1}${p.tpProjected ? ` <span class="muted">(proyeksi 1:2)</span>` : ""}</td><td>${fmt(tp)}</td></tr>`).join("")}
      ${p.riskRewardRatio ? `<tr><td>Risk:Reward</td><td style="color:${p.rrQuality === 'buruk' ? 'var(--red)' : p.rrQuality === 'baik' ? 'var(--green)' : 'var(--text)'}">1:${p.riskRewardRatio}${p.rrQuality ? ` (${p.rrQuality})` : ""}</td></tr>` : ""}
    </tbody></table>`;
  } else if (data.skippedSetup) {
    html += `<div class="snr-potential none">${mdBoldToHtml(data.skippedSetup)}</div>`;
  } else {
    html += `<div class="snr-potential none">Harga saat ini belum tepat berada di zona support/resistance kuat — belum ada area Buy/Sell spesifik di timeframe ini. Lihat level-level di bawah sebagai referensi.</div>`;
  }

  html += `<div class="snr-zone-list">${data.zones.map(z => `<div class="zone-row ${z.type}"><span>${z.type === "resistance" ? "Resistance" : "Support"} (${z.sources.join(", ")})</span><span>${fmt(z.low)} - ${fmt(z.high)}</span></div>`).join("")}</div>`;
  html += `<ul class="signal-reasons" style="margin-top:12px">${(data.signalReasons || []).map(r => `<li>${mdBoldToHtml(r)}</li>`).join("")}</ul>`;
  html += `<p class="muted">${data.disclaimer || ""}</p>`;

  body.innerHTML = html;
}

// Kalkulator ukuran posisi: dari Entry/SL setup + modal & risiko -> lot aman.
// Formula umum: unit = (modal x risiko%) / jarakSL. Akurat utk instrumen quote-USD
// (gold, pair /USD, crypto/USDT). Pair non-USD (mis. /JPY) ditandai "perkiraan".
function calcPosition() {
  const res = el("pcResult");
  if (!res) return;
  const d = window.__lastSnr;
  const { type, symbol } = currentInstrument();
  const bal = +el("pcBalance").value, riskPct = +el("pcRisk").value;
  const p = d?.potential;
  if (!p || p.entry == null || p.stopLoss == null) {
    res.innerHTML = `<div class="pc-note">Belum ada setup Entry/SL di timeframe ini (harga belum di zona Buy/Sell). Coba timeframe lain atau tunggu harga ke area.</div>`;
    return;
  }
  if (!(bal > 0) || !(riskPct > 0)) { res.innerHTML = `<div class="pc-note">Isi modal &amp; risiko dengan angka lebih dari 0.</div>`; return; }
  const entry = p.entry, sl = p.stopLoss, tp1 = (p.takeProfit || [])[0] ?? null;
  const slDist = Math.abs(entry - sl);
  if (!(slDist > 0)) { res.innerHTML = `<div class="pc-note">Jarak SL tidak valid.</div>`; return; }

  const riskAmt = bal * riskPct / 100;
  const units = riskAmt / slDist; // unit base: pergerakan sejauh slDist = riskAmt (quote USD)
  let sizeStr = "", accurate = true;
  if (type === "forex") {
    if (symbol.startsWith("XAU")) sizeStr = `${(units / 100).toFixed(2)} lot <span class="muted">(1 lot = 100 oz)</span>`;
    else if (symbol.startsWith("XAG")) { sizeStr = `${(units / 5000).toFixed(2)} lot <span class="muted">(1 lot = 5000 oz)</span>`; accurate = false; }
    else { sizeStr = `${(units / 100000).toFixed(2)} lot <span class="muted">(standar)</span>`; if (!symbol.endsWith("USD")) accurate = false; }
  } else if (type === "crypto") {
    sizeStr = `${(+units.toPrecision(4))} ${symbol.replace(/USDT?$/, "")} <span class="muted">(spot)</span>`;
  } else {
    sizeStr = `${Math.floor(units)} lembar <span class="muted">(saham)</span>`; accurate = false;
  }

  const reward = tp1 != null ? Math.abs(tp1 - entry) : null;
  const profitAmt = reward != null ? units * reward : null;
  const rr = reward != null ? reward / slDist : null;
  const dp = slDist < 1 ? 5 : 2;
  res.innerHTML = `
    <table class="pc-table"><tbody>
      <tr><td>Risiko ($)</td><td>$${riskAmt.toFixed(2)} <span class="muted">(${riskPct}% dari $${bal})</span></td></tr>
      <tr><td>Jarak SL</td><td>${slDist.toFixed(dp)} <span class="muted">(${fmt(entry)} → ${fmt(sl)})</span></td></tr>
      <tr class="pc-hi"><td>Ukuran posisi</td><td>${sizeStr}</td></tr>
      ${profitAmt != null ? `<tr><td>Potensi profit TP1</td><td style="color:var(--green)">+$${profitAmt.toFixed(2)}${rr ? ` <span class="muted">(R:R 1:${rr.toFixed(2)})</span>` : ""}</td></tr>` : ""}
    </tbody></table>
    ${accurate ? "" : `<div class="pc-note">⚠ Instrumen ini bukan quote-USD / non-standar — angka lot ini <b>perkiraan</b>. Sesuaikan nilai pip di brokermu.</div>`}
    <div class="pc-note">Edukasi, bukan nasihat. Umumnya jangan risiko &gt; 1–2% modal per trade.</div>`;
}

async function loadSnrAnalysis() {
  const { type, symbol } = currentInstrument();
  const interval = intervalSelect.value;
  const btn = el("analyzeSnrBtn");
  const status = el("snrStatus");

  btn.disabled = true;
  status.textContent = "Menganalisa...";

  try {
    const res = await fetch(`/api/snr?symbol=${encodeURIComponent(symbol)}&assetType=${type}&interval=${interval}`);
    let data;
    try { data = await res.json(); } catch(e) { throw new Error("Format data salah."); }
    if (!res.ok) {
      const error = new Error(data.error || "Gagal menganalisa");
      error.hint = data.hint;
      throw error;
    }

    window.__lastSnr = data;
    renderSnrChart(data);
    renderSnrBody(data);
    const lg = el("snrLegend"); if (lg) lg.hidden = false;
    const pc = el("posCalc"); if (pc) { pc.hidden = false; calcPosition(); }
    status.innerHTML = `<span style="color:#3fb950;">●</span> Selesai (${new Date().toLocaleTimeString("id-ID")}) — TF: ${intervalSelect.options[intervalSelect.selectedIndex].text}`;
  } catch (err) {
    status.innerHTML = renderErrorHtml(err, 'snr');
  } finally {
    btn.disabled = false;
  }
}
window.retryLoad.snr = loadSnrAnalysis;

// Pindah view secara programatik (mis. dari hasil Scout -> Analisa SNR)
function switchToView(name) {
  const btn = document.querySelector(`.quicknav-btn[data-view="${name}"]`);
  if (btn) btn.click();
}

// Dari baris hasil Scout: pilih instrumen itu, pindah ke Analisa SNR, lalu analisa.
function scoutOpen(symbol) {
  symbolSelect.value = symbol;
  symbolSelect.dispatchEvent(new Event("change"));
  switchToView("snr");
  loadSnrAnalysis();
}
window.scoutOpen = scoutOpen;

function sigBadge(sig) {
  const cls = sig === "BUY" ? "buy" : sig === "SELL" ? "sell" : "none";
  return `<span class="an-bias ${cls}">${sig}</span>`;
}

const HTF_ARROW = { up: "▲", down: "▼", flat: "—" };
function htfCell(r) {
  if (r.signal === "NETRAL") return `<span class="muted">${HTF_ARROW[r.htfTrend] || "—"}</span>`;
  const cls = r.htfAlign === "align" ? "htf-align" : r.htfAlign === "conflict" ? "htf-conflict" : "muted";
  const txt = r.htfAlign === "align" ? "searah" : r.htfAlign === "conflict" ? "lawan" : "netral";
  return `<span class="${cls}">${HTF_ARROW[r.htfTrend] || "—"} ${txt}</span>`;
}

// Hasil terakhir disimpan supaya toggle "hanya peluang berkualitas" tak perlu scan ulang.
window.__lastScout = null;
function scoutIsQuality(r) {
  return r.signal !== "NETRAL" && r.score >= 55 && r.rrQuality !== "buruk" && r.htfAlign !== "conflict";
}

function renderScout() {
  const data = window.__lastScout;
  const result = el("scoutResult");
  if (!data) return;
  const type = data.assetType;
  const labelOf = s => (INSTRUMENTS[type] || []).find(i => i.symbol === s)?.label || s;
  const qualityOnly = el("scoutQualityOnly")?.checked;
  let rowsData = data.results;
  if (qualityOnly) rowsData = rowsData.filter(scoutIsQuality);

  if (!data.results.length) {
    result.innerHTML = `<p class="muted">Tidak ada data yang bisa diambil. Coba timeframe lain.</p>`;
    return;
  }
  if (!rowsData.length) {
    result.innerHTML = `<p class="muted">Tidak ada peluang berkualitas saat ini (semua NETRAL / skor rendah / lawan tren HTF). Hilangkan centang untuk lihat semua.</p>`;
    return;
  }

  const rows = rowsData.map((r, i) => {
    const rrCls = r.rrQuality ? `rr-${r.rrQuality}` : "";
    const rrTxt = r.rr != null ? `1:${r.rr} <span class="rr-q ${rrCls}">${r.rrQuality || ""}</span>` : "—";
    const flags = [];
    if (r.divOpp) flags.push(`<span class="scout-flag warn">divergence lawan</span>`);
    if (r.rrQuality === "buruk") flags.push(`<span class="scout-flag warn">R:R buruk</span>`);
    if (r.htfAlign === "conflict") flags.push(`<span class="scout-flag warn">lawan tren HTF</span>`);
    if (!r.hasSetup) flags.push(`<span class="scout-flag">belum di area</span>`);
    const top = i === 0 && r.signal !== "NETRAL" && r.score >= 60;
    return `<tr class="${top ? "scout-top" : ""}">
      <td class="scout-rank">${i + 1}</td>
      <td class="scout-sym"><b>${r.symbol}</b><br><span class="muted">${labelOf(r.symbol)}</span></td>
      <td>${sigBadge(r.signal)}</td>
      <td>${r.confidence}%</td>
      <td class="${rrCls}">${rrTxt}</td>
      <td>${htfCell(r)}</td>
      <td>${flags.join(" ") || "<span class=\"muted\">—</span>"}</td>
      <td class="scout-score">${r.score}</td>
      <td><button class="btn-ghost scout-go" onclick="window.scoutOpen('${r.symbol}')">Analisa →</button></td>
    </tr>`;
  }).join("");

  const shownNote = qualityOnly ? ` — menampilkan ${rowsData.length}/${data.results.length} (filter kualitas aktif)` : "";
  result.innerHTML = `
    <div class="scout-tablewrap">
      <table class="scout-table">
        <thead><tr><th>#</th><th>Instrumen</th><th>Sinyal</th><th title="Porsi indikator yang searah (Scout tidak menghitung konfirmasi TF besar)">Kesepakatan</th><th>R:R setup</th><th>Tren HTF (D1)</th><th>Catatan</th><th>Skor</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="muted" style="margin-top:10px">${data.disclaimer}${shownNote}</p>`;
}

async function loadScout() {
  const { type } = currentInstrument();
  const interval = el("scoutInterval").value;
  const symbols = INSTRUMENTS[type].map(i => i.symbol);
  const btn = el("scoutRunBtn"), status = el("scoutStatus"), result = el("scoutResult");

  btn.disabled = true;
  status.textContent = `Memindai ${Math.min(symbols.length, 16)} instrumen ${ASSET_TYPE_LABELS[type]} di TF ${interval}... (menarik data, bisa beberapa detik)`;
  result.innerHTML = "";
  try {
    const q = new URLSearchParams({ assetType: type, interval, symbols: symbols.join(",") });
    const res = await fetch(`/api/scout?${q.toString()}`);
    let data;
    try { data = await res.json(); }
    catch (e) {
      const err = new Error("Server sedang sibuk atau deploy baru belum selesai.");
      err.hint = "Tunggu ±1 menit lalu klik Coba Lagi.";
      throw err;
    }
    if (!res.ok) throw new Error(data.error || data.hint || "Gagal memindai");

    window.__lastScout = data;
    renderScout();
    const trunc = data.requested < symbols.length ? ` (${data.requested} teratas dipindai)` : "";
    status.innerHTML = `<span style="color:#3fb950;">●</span> Selesai (${new Date().toLocaleTimeString("id-ID")}) — ${data.scanned} instrumen${trunc}`;
  } catch (err) {
    status.innerHTML = renderErrorHtml(err, 'scout');
  } finally {
    btn.disabled = false;
  }
}
window.retryLoad.scout = loadScout;

function equitySvg(curve) {
  if (!curve || curve.length < 2) return "";
  const w = 600, h = 160, pad = 8;
  const min = Math.min(0, ...curve), max = Math.max(0, ...curve);
  const range = (max - min) || 1;
  const x = i => pad + (i / (curve.length - 1)) * (w - 2 * pad);
  const y = v => h - pad - ((v - min) / range) * (h - 2 * pad);
  const pts = curve.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const zeroY = y(0).toFixed(1);
  const up = curve[curve.length - 1] >= 0;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" style="display:block">
    <line x1="${pad}" y1="${zeroY}" x2="${w - pad}" y2="${zeroY}" stroke="#4a3f22" stroke-width="1" stroke-dasharray="3 3"/>
    <polyline points="${pts}" fill="none" stroke="${up ? '#3fb950' : '#f85149'}" stroke-width="2"/>
  </svg>`;
}

async function loadBacktest() {
  const { type, symbol } = currentInstrument();
  const btn = el("btRunBtn"), status = el("btStatus"), result = el("btResult"), eq = el("btEquityContainer");
  const q = new URLSearchParams({
    symbol, assetType: type, interval: el("btInterval").value, strategy: el("btStrategy").value,
    slAtr: el("btSl").value, tpAtr: el("btTp").value, rsiPullback: el("btRsi").value,
    maxHold: el("btHold").value, costR: el("btCost").value
  });
  btn.disabled = true; status.textContent = `Menjalankan backtest ${symbol}... (menarik data historis, bisa beberapa detik)`;
  result.innerHTML = ""; eq.innerHTML = "";
  try {
    const res = await fetch(`/api/backtest?${q.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.hint || "Gagal backtest");

    const posCls = data.netPositive ? "buy" : "sell";
    const pf = data.profitFactor >= 99 ? "∞" : data.profitFactor;
    result.innerHTML = `
      <div class="bt-head"><span class="an-bias ${posCls}">${data.netPositive ? "NET PROFIT" : "NET LOSS"}: ${data.totalR > 0 ? "+" : ""}${data.totalR}R</span>
        <span class="muted">${symbol} · ${data.interval} · ${data.strategy} · ${data.fromDate} → ${data.toDate} (~${data.periodDays} hari)</span></div>
      <div class="bt-grid">
        <div class="bt-stat"><span class="bt-n">${data.trades}</span><span class="bt-l">Total Trade (${data.tradesPerMonth}/bln)</span></div>
        <div class="bt-stat"><span class="bt-n">${data.winRate}%</span><span class="bt-l">Win Rate</span></div>
        <div class="bt-stat"><span class="bt-n">${data.avgR}R</span><span class="bt-l">Avg / Trade</span></div>
        <div class="bt-stat"><span class="bt-n">${pf}</span><span class="bt-l">Profit Factor</span></div>
        <div class="bt-stat"><span class="bt-n">${data.maxDrawdownR}R</span><span class="bt-l">Max Drawdown</span></div>
      </div>
      <p class="muted" style="margin-top:10px">${data.disclaimer}</p>`;
    eq.innerHTML = `<div class="bt-eqlabel">Kurva ekuitas (akumulasi R):</div>${equitySvg(data.equityCurve)}`;
    status.innerHTML = `<span style="color:#3fb950;">●</span> Selesai (${new Date().toLocaleTimeString("id-ID")})`;
  } catch (err) {
    status.innerHTML = `<span style="color:#f85149;">●</span> Error: ${esc(err.message)}`;
  } finally {
    btn.disabled = false;
  }
}

function buildAiPrompt() {
  const { type, symbol } = currentInstrument();
  const d = window.__lastSnr;
  const q = el("quotePrice")?.textContent || "-";
  const tf = intervalSelect.options[intervalSelect.selectedIndex]?.text || intervalSelect.value;
  let s = `Kamu analis pasar. Berikut data TEKNIKAL + FUNDAMENTAL (rule-based, bukan AI) untuk ${symbol} (${ASSET_TYPE_LABELS[type] || type}), timeframe ${tf}. `;
  s += `Tolong: (1) rangkum kondisi pasar dalam bahasa mudah, (2) pisahkan FAKTA vs OPINI, (3) beri skenario BULLISH & BEARISH beserta level pemicu, (4) JANGAN menyuruh beli/jual — ini edukasi, bukan nasihat keuangan.\n\n`;
  s += `=== DATA ===\nHarga terakhir: ${q}\n`;
  if (d?.analysis) {
    const a = d.analysis;
    s += `Bias teknikal: ${a.bias} | Keyakinan: ${a.confidenceLabel} ${a.overallConfidence}%\n`;
    if (a.regime) s += `Kekuatan tren (ADX): ${a.regime.strength} (ADX ${a.regime.adx}${a.regime.direction ? ", " + a.regime.direction : ""})\n`;
    s += `Multi-timeframe: ${a.multiTimeframeText || "-"}\n`;
    s += `Tren: ${a.trend}\nMomentum: ${a.momentum}\nVolatilitas: ${a.volatility}\nPola candle: ${a.candle}\nSesi: ${a.sessions}\n`;
    s += `Support: ${a.support ?? "-"} | Resistance: ${a.resistance ?? "-"}\n`;
    if (a.vwap) s += `VWAP: ${a.vwap.vwap} (harga ${a.vwap.bias}) | band ±1σ ${a.vwap.lower1}-${a.vwap.upper1}\n`;
    if (a.volumeProfile) s += `Volume Profile: POC ${a.volumeProfile.poc}, Value Area ${a.volumeProfile.val}-${a.volumeProfile.vah}${a.volumeProfile.usedVolume ? "" : " (proxy)"}\n`;
    if (a.structure?.bos) s += `Struktur: BOS ${a.structure.bos}${a.structure.orderBlock ? `, order block ${a.structure.orderBlock.low}-${a.structure.orderBlock.high}` : ""}\n`;
    if (a.orb) s += `ORB ${a.orb.session}: ${a.orb.low}-${a.orb.high}, ${a.orb.state}${a.orb.bias !== 'netral' ? `, target ${a.orb.target}` : ""}\n`;
    if (a.hiddenDivergence) s += `Hidden divergence: ${a.hiddenDivergence} (penerusan tren)\n`;
    if (a.fundamental?.text) s += `Fundamental/Makro: ${a.fundamental.text.replace(/\*\*/g, "")}\n`;
  } else {
    s += `(Buka tab "Analisa SNR" dan klik "Analisa" dulu agar data lengkap ikut tersalin.)\n`;
  }
  if (d?.potential) {
    const p = d.potential;
    s += `\nSetup area ${p.type === "BUY_ZONE" ? "BUY" : "SELL"} (otomatis): Entry ${p.entry}, SL ${p.stopLoss}, TP ${(p.takeProfit || []).join(" / ")}, R:R 1:${p.riskRewardRatio ?? "-"}\n`;
  }
  s += `\n(Sumber data: Yahoo Finance/CoinGecko/DeFiLlama, rule-based. Angka bergerak tiap waktu.)`;
  return s;
}

async function copyForAi() {
  const text = buildAiPrompt();
  const status = el("snrStatus");
  try {
    await navigator.clipboard.writeText(text);
    status.innerHTML = `<span style="color:#3fb950;">●</span> Tersalin! Tempel (Ctrl+V) di chat AI gratis — membuka chat.deepseek.com...`;
    window.open("https://chat.deepseek.com/", "_blank", "noopener");
  } catch (e) {
    // Fallback bila clipboard diblokir: tampilkan teks untuk disalin manual.
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.cssText = "width:100%;height:160px;margin-top:8px;background:var(--panel-raised);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px;font-size:12px";
    el("snrBody").prepend(ta); ta.select();
    status.innerHTML = `<span style="color:#e3a008;">●</span> Salin manual teks di bawah (sudah diblok), lalu tempel ke chat.deepseek.com`;
  }
}

async function loadOptimize() {
  const { type, symbol } = currentInstrument();
  const btn = el("btOptBtn"), status = el("btStatus"), out = el("btOptResult");
  const q = new URLSearchParams({ symbol, assetType: type, interval: el("btInterval").value, strategy: el("btStrategy").value, costR: el("btCost").value });
  btn.disabled = true; status.textContent = `Optimasi ${symbol}: menguji banyak kombinasi (in-sample) lalu validasi out-of-sample... bisa 10–30 detik.`;
  out.innerHTML = "";
  try {
    const res = await fetch(`/api/optimize?${q.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.hint || "Gagal optimasi");
    const rows = data.top.map((c, idx) => {
      const rec = data.recommended && JSON.stringify(data.recommended.params) === JSON.stringify(c.params);
      return `<tr class="${rec ? 'opt-rec' : ''}">
        <td>SL${c.params.slAtr} TP${c.params.tpAtr} RSI${c.params.rsiPullback} H${c.params.maxHold}${rec ? ' ⭐' : ''}</td>
        <td>${c.is.winRate}% / ${c.is.profitFactor} / ${c.is.totalR > 0 ? '+' : ''}${c.is.totalR}R</td>
        <td class="${c.oos.totalR > 0 ? 'oos-pos' : 'oos-neg'}">${c.oos.winRate}% / ${c.oos.profitFactor} / ${c.oos.totalR > 0 ? '+' : ''}${c.oos.totalR}R</td>
        <td>${c.robust ? '<span class="rb-y">✔ robust</span>' : '<span class="rb-n">gagal OOS</span>'}</td></tr>`;
    }).join("");
    out.innerHTML = `
      <div class="opt-head">Optimasi ${symbol} · ${data.interval} · ${data.strategy} — ${data.combosTested} kombinasi diuji</div>
      <div class="muted" style="margin-bottom:8px">IS (dioptimasi): ${data.splitInfo.isFrom} → ${data.splitInfo.isTo} · OOS (validasi, belum dilihat): ${data.splitInfo.oosFrom} → ${data.splitInfo.oosTo}</div>
      ${data.recommended ? `<div class="snr-potential buy">Rekomendasi (lolos OOS): <b>SL${data.recommended.params.slAtr} TP${data.recommended.params.tpAtr} RSI${data.recommended.params.rsiPullback} Hold${data.recommended.params.maxHold}</b> — OOS ${data.recommended.oos > 0 ? '+' : ''}${data.recommended.oos}R.</div>` : `<div class="snr-potential sell">⚠ Tidak ada kombinasi yang tetap profit di data out-of-sample — hati-hati, kemungkinan over-fit / tidak ada edge yang stabil.</div>`}
      <table class="opt-table"><thead><tr><th>Parameter</th><th>In-Sample (win/PF/R)</th><th>Out-of-Sample (win/PF/R)</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted" style="margin-top:8px">${data.disclaimer}</p>`;
    status.innerHTML = `<span style="color:#3fb950;">●</span> Optimasi selesai (${new Date().toLocaleTimeString("id-ID")})`;
  } catch (err) {
    status.innerHTML = `<span style="color:#f85149;">●</span> Error: ${esc(err.message)}`;
  } finally {
    btn.disabled = false;
  }
}

async function refreshFast() {
  await Promise.all([loadData(), loadSignal()]);
}

async function refreshAll() {
  await loadSignal();
  await Promise.all([loadData(), loadNews(), loadCalendar(), loadSentiment()]);
}

function resetAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  if (autoRefreshBox.checked) {
    const secs = parseInt(refreshIntervalSelect.value, 10) || 15;
    autoRefreshTimer = setInterval(refreshFast, secs * 1000);
  }
}

function onInstrumentOrIntervalChange() {
  renderTvChart();
  refreshAll();
  clearSnrChart();
}

assetTypeSelect.addEventListener("change", () => {
  populateSymbols();
  onInstrumentOrIntervalChange();
});
symbolSelect.addEventListener("change", onInstrumentOrIntervalChange);
intervalSelect.addEventListener("change", () => {
  renderTvChart();
  refreshFast();
  clearSnrChart();
});
el("refreshBtn").addEventListener("click", refreshAll);
el("analyzeSnrBtn").addEventListener("click", loadSnrAnalysis);
el("clearSnrBtn").addEventListener("click", clearSnrChart);
el("copyAiBtn").addEventListener("click", copyForAi);
el("btRunBtn").addEventListener("click", loadBacktest);
el("btOptBtn").addEventListener("click", loadOptimize);
el("scoutRunBtn").addEventListener("click", loadScout);
el("scoutQualityOnly").addEventListener("change", renderScout);
el("pcCalcBtn").addEventListener("click", calcPosition);
el("newsMiniMore").addEventListener("click", openAllNews);
el("pcBalance").addEventListener("input", calcPosition);
el("pcRisk").addEventListener("input", calcPosition);
autoRefreshBox.addEventListener("change", resetAutoRefresh);
refreshIntervalSelect.addEventListener("change", resetAutoRefresh);

initTabs();
initViews();
populateAssetTypes();
populateSymbols();
renderTvChart();
refreshAll();
resetAutoRefresh();
updateMarketClock();
setInterval(updateMarketClock, 1000);
