# ScalpRR2 — Asisten scalping RR 1:2

EA MT5 untuk **XAUUSD** dan **BTCUSD** dengan target profit dan stop loss dalam **dolar** (bukan pip).

**Default: sinyal saja.** EA hanya mengirim notifikasi ke MT5 di HP dan menggambar level di chart. Tidak ada order yang dibuka kecuali `InpAutoTrade=true`.

---

## Instalasi & Setup

1. **PC / VPS harus aktif.**  
   - Aplikasi MT5 Android/iOS **TIDAK bisa** menjalankan EA.  
   - EA dijalankan di MT5 desktop; sinyal & posisi muncul otomatis di aplikasi HP.

2. **Download MT5 desktop** (gratis):  
   [https://download.terminal.free/cdn/web/metaquotes.ltd/mt5/mt5setup.exe](https://download.terminal.free/cdn/web/metaquotes.ltd/mt5/mt5setup.exe)  
   Versi ini sudah disimpan di: `%TEMP%\opencode\mt5setup.exe`

3. **Copy file EA:**
   - Buka MT5 desktop → klik **File** → **Open Data Folder**.
   - Masuk ke folder `MQL5\Experts\`.
   - Copy file `ScalpRR2.mq5` ke sana.
   - Restart MT5 atau klik **Refresh** di Navigator.

4. **Aktifkan notifikasi HP** (jika `InpPush=true`):
   - Buka **Tools** → **Options** → tab **Notifications**.
   - Isi **MetaQuotes ID** dari aplikasi MT5 di HP (Settings → Messages → MetaQuotes ID).
   - Klik **Test** untuk verifikasi.

5. **Pasang EA ke chart:**
   - Buka chart **XAUUSD** atau **BTCUSD**, timeframe bebas (EA hanya membaca candle tertutup di timeframe sinyal).
   - Drag EA dari Navigator ke chart.
   - Atur parameter (lihat di bawah), lalu klik **OK**.
   - Pastikan **Algo Trading** aktif (ikon di toolbar berwarna hijau).

---

## Parameter Penting

| Parameter              | Default         | Keterangan |
|------------------------|-----------------|------------|
| `InpAutoTrade`         | **false**       | **Sinyal saja**. Set `true` untuk eksekusi otomatis. |
| `InpPush`              | true            | Kirim notifikasi ke MT5 di HP. |
| `InpDrawLevels`        | true            | Gambar garis Entry/SL/TP di chart. |
| `InpSetup`             | Trend pullback  | Pilih setup: **Trend pullback** (EMA + RSI) atau **Liquidity sweep** (SMC). |
| `InpSignalTF`          | M15             | Timeframe untuk deteksi sinyal (candle tertutup). |
| `InpLots`              | 0.01            | Volume order (dibatasi `InpMaxLots`). |
| `InpMaxLots`           | 0.01            | Lot maksimum (pencegah typo). |
| `InpTakeProfitUSD`     | 10.0            | Target profit kotor **dalam dolar** (sebelum biaya). |
| `InpStopLossUSD`       | 5.0             | Batas rugi kotor **dalam dolar** → RR 1:2. |
| `InpMaxSpreadUSD`      | 0.50            | Skip sinyal bila spread broker > ini (dolar pada lot yang dipilih). |
| `InpDailyLossUSD`      | 25.0            | Stop trading hari ini bila rugi >= ini. |
| `InpMaxTradesDay`      | 20              | Maksimum entry per hari. |
| `InpMaxConsecLoss`     | 5               | Stop hari ini setelah N kali kalah beruntun. |
| `InpSessionFilter`     | true            | Hanya jam London + New York (UTC 07:00–17:00). |
| `InpMagic`             | 2026110501      | Magic number untuk filter posisi EA ini. |

---

## Setup 1: Trend Pullback (default)

**Aturan:**
- Long: EMA20 > EMA50, harga di atas EMA200, RSI dari <40 naik melewati 40 (candle tertutup).
- Short: EMA20 < EMA50, harga di bawah EMA200, RSI dari >60 turun melewati 60 (candle tertutup).

Cocok untuk:
- **XAUUSD** di timeframe M5/M15 saat sesi London & New York.
- **BTCUSD** di M15/M30 saat volatilitas tinggi (break level, berita).

---

## Setup 2: Liquidity Sweep

**Aturan:**
- Long: harga di atas EMA200, candle menembus swing low terakhir (2-leg) tapi close kembali ke dalam.
- Short: harga di bawah EMA200, candle menembus swing high terakhir (2-leg) tapi close kembali ke dalam.

Cocok untuk:
- BTC saat break support/resistance palsu (fakeout + reversal).
- Emas saat open sesi London/New York (sweep stop loss retail).

---

## Backtest & Validasi

- **Backtest riset (Binance BTCUSDT + PAXGUSDT 90 hari, 1m, machine learning + rule-based):**  
  - Belum ditemukan aturan dengan **win rate 85%** pada RR 1:2.  
  - Win rate realistis untuk RR 1:2 adalah **38–50%** (target break-even 33%).  
  - Hasil lengkap ada di `research/README.md` (setelah riset selesai).

- **Test EA ini:**
  1. Jalankan **Strategy Tester** di MT5 desktop.
  2. Pilih EA **ScalpRR2**, simbol, timeframe, periode (minimal 1 bulan).
  3. Mode: **Every tick based on real ticks** (paling akurat, paling lambat) atau **1 minute OHLC** (cepat, kurang akurat untuk scalping).
  4. Set `InpAutoTrade=true` untuk simulasi.
  5. Lihat laporan: PnL, Drawdown, Win rate, Profit factor.

- **Uji di DEMO minimal 1 minggu** sebelum memakai uang sungguhan.

---

## Spread & Kontrak Broker

EA menghitung dolar per point dari spesifikasi broker (tick value/size), jadi otomatis benar untuk:
- Exness: **XAUUSDm** (0.01 lot = 1 oz, spread ~$0.24–0.40)
- Vantage: **XAUUSD** (kontrak & spread tergantung akun)
- BTC: cek nama simbol (`BTCUSD`, `BTCUSDm`, dsb.) dan lot size di Market Watch → Specification.

Untuk **XAU Standard Exness**, user melaporkan spread terlihat ~$0.24 saat kondisi normal (screenshot bid/ask 4048.435/4048.675).

---

## Batasan & Risiko

1. **Win rate 85% pada RR 1:2 tidak realistis** berdasarkan backtest riset. Target yang layak adalah win rate 38%+ yang bertahan di data uji.
2. EA ini **tidak memprediksi** arah harga; hanya mendeteksi kondisi setup (EMA + RSI atau liquidity sweep).
3. **Slippage & rejection:** order bisa ditolak atau dieksekusi harga yang berbeda (market order).
4. **Spread berubah:** spread bisa melebar saat berita / sesi sepi, sehingga TP/SL efektif berkurang.
5. **Drawdown:** rem harian membantu, tapi tetap butuh modal cukup untuk melewati losing streak.
6. **Notifikasi dibatasi:** MT5 membatasi `SendNotification()` maksimal 2x per detik & 10x per menit. Kalau frekuensi melebihi, fungsi bisa diblokir sementara.

---

## Troubleshooting

**EA tidak mengirim order:**
- Pastikan `InpAutoTrade=true`.
- Pastikan **Algo Trading** aktif (ikon hijau di toolbar).
- Cek tab **Experts** di MT5: mungkin ada error atau log "order gagal".

**Notifikasi tidak sampai di HP:**
- Cek MetaQuotes ID sudah diisi & test notifikasi berhasil (Tools → Options → Notifications).
- Cek tab Experts: mungkin ada error `TERMINAL_NOTIFICATIONS_ENABLED = false`.

**Sinyal tidak muncul:**
- EA hanya cek **saat candle baru** di `InpSignalTF` (misal M15).
- Kalau dipasang di tengah candle, sinyal baru muncul setelah candle itu close + candle baru terbuka.
- Cek apakah rem harian aktif (`InpDailyLossUSD` / `InpMaxTradesDay` / `InpMaxConsecLoss`).
- Cek apakah di luar sesi (`InpSessionFilter`).

**Order ditolak broker:**
- Cek margin cukup untuk lot yang dipilih.
- Cek jarak SL/TP >= stop level broker (biasanya 0 untuk market, tapi beberapa simbol punya minimal).
- Cek symbol allowed for trading (Market Watch → klik kanan simbol → Specification).

---

## Hasil Riset ML

Riset machine learning pada BTCUSDT & PAXGUSDT (Binance, 90 hari, 1m) sudah selesai dengan temporal split 60/20/20, entry candle berikutnya, purge horizon, SL-first yang konservatif, dan tanpa posisi overlap.

Hasil out-of-sample: PAXGUSDT 27.3% win rate, 33 trade, net P/L -$39.09 pada skenario biaya $0.26; BTCUSDT tidak memiliki kandidat valid dengan minimal 30 trade. Tidak ada metode 85% yang tervalidasi pada RR 1:2. PAXG bukan XAUUSDm dan BTCUSDT bukan feed broker, jadi hasil ini bukan jaminan hasil akun.

Detail reproduksi: `research/results/evidence.md`, script: `research/run_ml.py`, test: `research/test_research.py`.

---

## Lisensi & Disclaimer

EA ini bagian dari **Chart Analysis Dashboard** dan disediakan "apa adanya". Tidak ada jaminan profit. Risiko trading ditanggung pengguna.
