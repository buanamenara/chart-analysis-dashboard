# Dashboard Analisis Pasar

Dashboard lokal/online yang menampilkan data real-time (forex, crypto, saham/indeks) dengan chart TradingView, sinyal teknikal otomatis rule-based (RSI, EMA, MACD, Bollinger Bands, PDH/PDL, ADR, swing level, pola candlestick), kalender ekonomi, berita pasar, dan tombol **Analisa** yang menggambar zona Support/Resistance beserta area Entry/SL/TP langsung di chart — 100% gratis, tanpa AI berbayar.

## Cara jalankan (lokal)

1. Install dependency (sekali saja):
   ```bash
   npm install
   ```
2. Jalankan server:
   ```bash
   npm start
   ```
3. Buka browser ke http://localhost:3000

Tidak ada API key yang dibutuhkan — semua sumber data gratis dan tanpa autentikasi.

## Deploy ke online

Lihat [DEPLOY.md](DEPLOY.md) untuk panduan lengkap deploy ke GitHub + **Cloudflare Pages** (gratis) supaya bisa diakses dari HP kapan saja.

## Sumber data (gratis, tanpa perlu API key)

- **Crypto**: [Binance public API](https://binance-docs.github.io/apidocs/spot/en/) (fallback otomatis ke Yahoo Finance kalau Binance diblokir ISP)
- **Forex, Saham/Indeks, Logam**: [Yahoo Finance chart API](https://finance.yahoo.com/) (tidak resmi tapi stabil)
- **Chart visual utama**: [TradingView Widget](https://www.tradingview.com/widget/advanced-chart/) (embed gratis)
- **Chart Analisa SNR**: [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) (open-source, dirender sendiri)
- **Kalender ekonomi**: ForexFactory JSON feed
- **Berita**: Investing.com Indonesia (forex/komoditas/saham), Cointelegraph (crypto), CNBC Indonesia (saham lokal)
- **Sentimen crypto**: Fear & Greed Index (alternative.me), CoinGecko global stats

### Kenapa angka di tabel bisa beda dari chart TradingView?

Angka (harga, indikator, sinyal) dihitung dari **Yahoo Finance / Binance**, sedangkan chart TradingView memakai feed-nya sendiri — dua sumber yang berbeda bisa beda beberapa poin/pip. Supaya sedekat mungkin, simbol chart TradingView sengaja **disamakan dengan sumber datanya**:

| Instrumen | Data (Yahoo/Binance) | Chart TradingView |
|-----------|----------------------|-------------------|
| Gold (XAUUSD) | `GC=F` (COMEX gold futures) | `COMEX:GC1!` |
| Silver (XAGUSD) | `SI=F` (COMEX silver futures) | `COMEX:SI1!` |
| Forex | `EURUSD=X` dst. | `OANDA:EURUSD` dst. |
| Crypto | `BTCUSDT` (Binance) / `BTC-USD` (fallback) | `BINANCE:BTCUSDT` |
| Saham/Indeks | `BBCA.JK`, `^JKSE` dst. | `IDX:BBCA`, `IDX:COMPOSITE` dst. |

Catatan: untuk Gold/Silver, Yahoo tidak menyediakan harga *spot* (XAUUSD=X 404), jadi dipakai kontrak **futures COMEX** — chart TradingView juga diarahkan ke futures yang sama supaya angkanya konsisten. Perbedaan kecil yang tersisa biasanya hanya jeda pembaruan data (Yahoo bisa tertunda beberapa menit, dan data saham IDX di Yahoo tertunda ~15 menit).

Catatan: endpoint Yahoo Finance & RSS di atas tidak resmi dan sewaktu-waktu bisa berubah/dibatasi oleh penyedianya.

## Menambah instrumen

Edit daftar `INSTRUMENTS` di [public/app.js](public/app.js) — tambahkan `symbol` (ticker Binance, atau ticker Yahoo seperti `EURUSD`, `BBCA.JK`, `^JKSE`) dan `tv` (simbol TradingView untuk chart utama, format `EXCHANGE:SYMBOL`).

## Struktur proyek

```
server.js               # Express server + routing API (jalankan lokal)
functions/api/          # Versi serverless (Cloudflare Pages Functions) tiap endpoint
lib/marketData.js       # Router sumber data: Binance (crypto) vs Yahoo (fallback/forex/saham)
lib/binance.js          # Fetch quote & OHLCV crypto dari Binance
lib/yahoo.js            # Fetch quote & OHLCV forex/saham/crypto fallback dari Yahoo Finance
lib/http.js             # Fetch dengan timeout (anti-hang) untuk semua sumber eksternal
lib/indicators.js       # Hitung RSI, MACD, EMA, SMA, Bollinger Bands + ringkasan tren
lib/levels.js           # PDH/PDL, ADR, swing high/low, key level, pola candle, sesi pasar
lib/snr.js              # Clustering zona Support/Resistance + area Buy/Sell (Entry/SL/TP)
lib/ruleSignal.js       # Sinyal BUY/SELL/NETRAL rule-based dari kombinasi indikator
lib/calendar.js         # Kalender ekonomi (ForexFactory) + mapping pair currency
lib/newsSources.js      # Daftar sumber berita RSS per kategori aset
lib/rss.js              # Parser RSS ringan (tanpa dependency XML)
lib/newsAnalysis.js     # Klasifikasi dampak berita ekonomi High Impact
lib/sentiment.js        # Fear & Greed Index + data global crypto
public/                 # Frontend (HTML/CSS/JS statis)
```

Catatan: `tradingview-mcp/` dan `.mcp.json` adalah tool MCP lokal (untuk sesi agent/Claude Code) dan sengaja dikecualikan dari git — bukan bagian dari dashboard web ini.

## Batasan & disclaimer

- Ini alat bantu baca data teknikal, bukan nasihat keuangan/investasi.
- Semua sinyal (Sinyal Teknikal maupun Analisa SNR) dihasilkan dari kombinasi indikator teknikal otomatis (rule-based), bukan AI — selalu verifikasi sendiri sebelum mengambil keputusan.
- Data Yahoo Finance & RSS tidak resmi — untuk trading sungguhan, gunakan data dari broker/exchange resmi kamu.
