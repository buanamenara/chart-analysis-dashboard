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
  const hint = err.hint ? `<div style="font-size: 13px; color: #d1d4dc; margin-top: 6px;">${err.hint}</div>` : "";
  return `<div class="error-box" style="padding: 12px; background: rgba(248, 81, 73, 0.1); border-left: 3px solid #f85149; margin: 10px 0; border-radius: 4px; text-align: left;">
    <div style="color: #f85149; font-weight: 600;">⚠️ ${msg}</div>
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
    toolbar_bg: "#15130c",
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
    el("quotePrice").textContent = fmt(q.price, type === "crypto" ? 2 : 5);
    const changeEl = el("quoteChange");
    const changeTxt = `${q.change >= 0 ? "+" : ""}${fmt(q.change, 4)} (${fmt(q.changePercent, 2)}%)`;
    changeEl.textContent = changeTxt;
    changeEl.className = `change ${q.change >= 0 ? "positive" : "negative"}`;
    
    el("lastUpdated").innerHTML = `<span style="color:#3fb950;">●</span> Diperbarui: ${new Date().toLocaleTimeString("id-ID")} · Sumber: ${q.source === "binance" ? "Binance" : "Yahoo Finance"} (${q.symbol})`;

    el("quoteLow").textContent = `L ${fmt(q.low)}`;
    el("quoteHigh").textContent = `H ${fmt(q.high)}`;
    if (q.high > q.low) {
      const pct = Math.min(100, Math.max(0, ((q.price - q.low) / (q.high - q.low)) * 100));
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
          ["Harga Terakhir", fmt(ind.lastClose)],
          ["RSI (14)", ind.rsi14 != null ? fmt(ind.rsi14, 1) : "-"],
          ["EMA 20", fmt(ind.ema20)],
          ["EMA 50", fmt(ind.ema50)],
          ["SMA 200", ind.sma200 != null ? fmt(ind.sma200) : "Belum cukup data"],
          ["MACD", ind.macd ? fmt(ind.macd.MACD, 4) : "-"],
          ["BB Upper", ind.bollinger ? fmt(ind.bollinger.upper) : "-"],
          ["BB Lower", ind.bollinger ? fmt(ind.bollinger.lower) : "-"]
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
    badge.textContent = data.signal === "BUY" ? "BUY (bias naik)" : data.signal === "SELL" ? "SELL (bias turun)" : "NETRAL";
    badge.className = `signal-badge signal-${data.signal.toLowerCase()}`;

    el("signalReasons").innerHTML = (data.reasons || []).map(r => `<li>${mdBoldToHtml(r)}</li>`).join("");
    el("signalDisclaimer").textContent = data.disclaimer || "";
  } catch (err) {
    el("signalBadge").textContent = "ERROR";
    el("signalBadge").className = "signal-badge signal-netral";
    el("signalReasons").innerHTML = `<li>${renderErrorHtml(err, 'signal')}</li>`;
  }
}
window.retryLoad.signal = loadSignal;

async function loadNews() {
  const { type } = currentInstrument();
  const body = el("newsBody");
  body.innerHTML = `<div class="muted">Memuat berita...</div>`;
  try {
    const res = await fetch(`/api/news?assetType=${type}`);
    let data;
    try { data = await res.json(); } catch(e) { throw new Error("Format data salah."); }
    if (!res.ok) {
      const error = new Error(data.error || "Gagal memuat berita");
      error.hint = data.hint;
      throw error;
    }
    if (!data.items?.length) { body.innerHTML = `<div class="muted">Tidak ada berita.</div>`; return; }
    body.innerHTML = data.items
      .map(n => `<div class="news-item"><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a><div class="news-source">${esc(n.source)}${n.pubDate ? " · " + new Date(n.pubDate).toLocaleString("id-ID") : ""}</div></div>`)
      .join("");
  } catch (err) {
    body.innerHTML = renderErrorHtml(err, 'news');
  }
}
window.retryLoad.news = loadNews;

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

function renderSnrChart(data) {
  const container = el("snrChartContainer");
  container.innerHTML = "";
  snrChart = LightweightCharts.createChart(container, {
    layout: { background: { color: "#131722" }, textColor: "#d1d4dc" },
    grid: { vertLines: { color: "#242832" }, horzLines: { color: "#242832" } },
    timeScale: { timeVisible: true, secondsVisible: false },
    rightPriceScale: { borderColor: "#242832" },
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

  const keyLevels = [];
  if (data.nearestSupport) keyLevels.push({ p: data.nearestSupport.mid, color: "#3fb950", title: `Support ${data.nearestSupport.mid.toFixed(2)}` });
  if (data.nearestResistance) keyLevels.push({ p: data.nearestResistance.mid, color: "#f85149", title: `Resistance ${data.nearestResistance.mid.toFixed(2)}` });
  keyLevels.forEach(l => {
    snrSeries.createPriceLine({
      price: l.p,
      color: l.color,
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: l.title
    });
  });

  if (data.potential) {
    const p = data.potential;
    snrSeries.createPriceLine({ price: p.entry, color: "#d4af37", lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true, title: "Entry" });
    snrSeries.createPriceLine({ price: p.stopLoss, color: "#f85149", lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true, title: "SL" });
    (p.takeProfit || []).forEach((tp, i) => {
      snrSeries.createPriceLine({ price: tp, color: "#3fb950", lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true, title: `TP${i + 1}` });
    });

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
    html += `<div class="snr-analysis">
      <div class="an-head"><span class="an-bias ${biasCls}">Bias Teknikal: ${biasLabel}</span></div>
      <div class="an-grid">
        <div class="an-item"><span class="an-k">Tren</span><span class="an-v">${a.trend}</span></div>
        <div class="an-item"><span class="an-k">Momentum</span><span class="an-v">${a.momentum}</span></div>
        <div class="an-item"><span class="an-k">Volatilitas</span><span class="an-v">${a.volatility}</span></div>
        <div class="an-item"><span class="an-k">Pola Candle</span><span class="an-v">${a.candle}</span></div>
        <div class="an-item"><span class="an-k">Sesi Pasar</span><span class="an-v">${a.sessions}</span></div>
        ${a.keyLevel ? `<div class="an-item"><span class="an-k">Key Level</span><span class="an-v">${a.keyLevel}</span></div>` : ""}
        <div class="an-item"><span class="an-k">Support / Resistance</span><span class="an-v">${a.support ? fmt(a.support) : "-"} / ${a.resistance ? fmt(a.resistance) : "-"}</span></div>
      </div>
      <div class="an-conclusion">${a.conclusion}</div>
    </div>`;
  }

  if (data.potential) {
    const p = data.potential;
    const cls = p.type === "BUY_ZONE" ? "buy" : "sell";
    html += `<div class="snr-potential ${cls}">${mdBoldToHtml(p.reason)}</div>`;
    html += `<table class="snr-tpsl-table"><tbody>
      <tr class="row-entry"><td>Entry</td><td>${fmt(p.entry)}</td></tr>
      <tr class="row-sl"><td>Stop Loss</td><td>${fmt(p.stopLoss)}</td></tr>
      ${(p.takeProfit || []).map((tp, i) => `<tr class="row-tp"><td>Take Profit ${i + 1}</td><td>${fmt(tp)}</td></tr>`).join("")}
      ${p.riskRewardRatio ? `<tr><td>Risk:Reward</td><td>1:${p.riskRewardRatio}</td></tr>` : ""}
    </tbody></table>`;
  } else {
    html += `<div class="snr-potential none">Harga saat ini belum tepat berada di zona support/resistance kuat — belum ada area Buy/Sell spesifik di timeframe ini. Lihat level-level di bawah sebagai referensi.</div>`;
  }

  html += `<div class="snr-zone-list">${data.zones.map(z => `<div class="zone-row ${z.type}"><span>${z.type === "resistance" ? "Resistance" : "Support"} (${z.sources.join(", ")})</span><span>${fmt(z.low)} - ${fmt(z.high)}</span></div>`).join("")}</div>`;
  html += `<ul class="signal-reasons" style="margin-top:12px">${(data.signalReasons || []).map(r => `<li>${mdBoldToHtml(r)}</li>`).join("")}</ul>`;
  html += `<p class="muted">${data.disclaimer || ""}</p>`;

  body.innerHTML = html;
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

    renderSnrChart(data);
    renderSnrBody(data);
    status.innerHTML = `<span style="color:#3fb950;">●</span> Selesai (${new Date().toLocaleTimeString("id-ID")}) — TF: ${intervalSelect.options[intervalSelect.selectedIndex].text}`;
  } catch (err) {
    status.innerHTML = renderErrorHtml(err, 'snr');
  } finally {
    btn.disabled = false;
  }
}
window.retryLoad.snr = loadSnrAnalysis;

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
autoRefreshBox.addEventListener("change", resetAutoRefresh);
refreshIntervalSelect.addEventListener("change", resetAutoRefresh);

initTabs();
initViews();
populateAssetTypes();
populateSymbols();
renderTvChart();
refreshAll();
resetAutoRefresh();
