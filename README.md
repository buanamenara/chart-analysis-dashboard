# Dashboard Analisis Pasar

Dashboard lokal yang menampilkan data real-time (forex, crypto, saham/indeks) dengan chart TradingView, indikator teknikal otomatis (RSI, EMA, MACD, Bollinger Bands), dan tombol "Analisis AI" yang memanggil Claude API hanya saat ditekan — jadi tidak kena limit sesi chat dan hemat biaya.

## Cara jalankan

1. Install dependency (sekali saja):
   ```bash
   npm install
   ```
2. Buat file `.env` dari contoh, lalu isi API key Claude kamu:
   ```bash
   copy .env.example .env
   ```
   Isi `ANTHROPIC_API_KEY=sk-ant-...` — ambil/daftar key di https://console.anthropic.com/settings/keys
   (Tanpa key ini, dashboard data & chart tetap jalan normal — hanya tombol "Analisis AI" yang butuh key.)
3. Jalankan server:
   ```bash
   npm start
   ```
4. Buka browser ke http://localhost:3000

## Sumber data (gratis, tanpa perlu API key)

- **Crypto**: [Binance public API](https://binance-docs.github.io/apidocs/spot/en/) — real-time.
- **Forex & Saham/Indeks**: [Yahoo Finance chart API](https://finance.yahoo.com/) (tidak resmi tapi stabil dipakai banyak proyek) — real-time/near real-time.
- **Chart visual**: [TradingView Widget](https://www.tradingview.com/widget/advanced-chart/) — embed gratis.

Catatan: endpoint Yahoo Finance di atas tidak resmi dan sewaktu-waktu bisa berubah/dibatasi oleh Yahoo. Kalau suatu saat gagal, alternatif API berbayar/free-tier: [Twelve Data](https://twelvedata.com/), [Alpha Vantage](https://www.alphavantage.co/).

## Menambah instrumen

Edit daftar `INSTRUMENTS` di [public/app.js](public/app.js) — tambahkan `symbol` (kode untuk data: ticker Binance, atau ticker Yahoo seperti `EURUSD`, `BBCA.JK`, `^JKSE`) dan `tv` (kode simbol TradingView untuk chart, format `EXCHANGE:SYMBOL`).

## Struktur proyek

```
server.js            # Express server + routing API
lib/binance.js        # Fetch quote & OHLCV crypto dari Binance
lib/yahoo.js           # Fetch quote & OHLCV forex/saham dari Yahoo Finance
lib/indicators.js       # Hitung RSI, MACD, EMA, SMA, Bollinger Bands
lib/claude.js           # Panggil Claude API untuk narasi analisis
public/                # Frontend (HTML/CSS/JS statis)
```

## Batasan & disclaimer

- Ini alat bantu baca data teknikal, bukan nasihat keuangan/investasi.
- Data Yahoo Finance tidak resmi — untuk trading sungguhan, gunakan data dari broker/exchange resmi kamu.
- Analisis AI dibuat oleh model bahasa dari data teknikal saja — selalu verifikasi sendiri sebelum mengambil keputusan.
