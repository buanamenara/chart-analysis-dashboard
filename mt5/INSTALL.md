# Instalasi EA ScalpRR2 ke MT5

## Cara 1: Kompilasi Manual (Termudah)

1. **Buka MT5 desktop** yang sudah terhubung ke broker (Exness/Vantage).

2. **Buka MetaEditor:**
   - Di MT5, tekan `F4` atau klik menu **Tools → MetaQuotes Language Editor**.

3. **Buat Expert Advisor baru:**
   - Di MetaEditor, klik **File → New → Expert Advisor (template)**.
   - Wizard akan muncul:
     - **Name**: `ScalpRR2`
     - **Author/Link**: kosongkan atau isi sesukamu.
     - Klik **Next** sampai **Finish**.

4. **Ganti semua kode:**
   - MetaEditor akan membuka file `.mq5` yang baru dibuat.
   - **Hapus semua isinya**.
   - **Copy semua** isi dari `C:\Users\rdhan\Documents\Chart Analysis\mt5\ScalpRR2.mq5`.
   - **Paste** ke MetaEditor.

5. **Compile:**
   - Klik **Compile** (F7) atau ikon kompilasi.
   - Tab **Errors** harus kosong (0 error, 0 warning boleh ada).
   - File `.ex5` akan dibuat otomatis di `MQL5\Experts\`.

6. **Restart MT5** atau klik **Refresh** di panel Navigator.

7. EA **ScalpRR2** sekarang muncul di Navigator → Expert Advisors.

---

## Cara 2: Copy File Langsung (Kalau MetaEditor Tidak Tersedia)

File `.mq5` (source code) harus dikompilasi dulu menjadi `.ex5` (executable) agar bisa dijalankan MT5. Karena MetaEditor belum terdeteksi di sistem ini, **ikuti Cara 1 di atas** dengan MetaEditor dari instalasi MT5 milik broker.

---

## Setup Notifikasi HP

1. **Di aplikasi MT5 Android/iOS:**
   - Buka **Settings → Messages**.
   - Catat **MetaQuotes ID** (misal: `abc123def456`).

2. **Di MT5 desktop:**
   - Buka **Tools → Options → tab Notifications**.
   - Isi **MetaQuotes ID** yang tadi dicatat.
   - Klik **Test** → notifikasi test harus muncul di HP dalam beberapa detik.
   - Klik **OK**.

---

## Cara Pasang EA ke Chart

1. Buka chart **XAUUSDm** (Exness) atau **XAUUSD** (Vantage).
2. Drag **ScalpRR2** dari Navigator → Expert Advisors ke chart.
3. **Atur parameter** (lihat `mt5/README.md` untuk penjelasan lengkap):
   - `InpAutoTrade` = **false** (sinyal saja, tidak buka order otomatis).
   - `InpPush` = **true** (kirim notifikasi ke HP).
   - `InpSignalTF` = **PERIOD_M15** (atau M5/M30 sesuai preferensi).
   - `InpTakeProfitUSD` = **10.0** (target profit kotor dalam dolar).
   - `InpStopLossUSD` = **5.0** (risiko per posisi, RR 1:2).
   - `InpLots` = **0.01** (volume).
   - Biarkan parameter lain default dulu.
4. **Checklist "Allow Algo Trading"** (di jendela parameter, tab "Common").
5. Klik **OK**.
6. **Pastikan tombol Algo Trading** di toolbar MT5 **berwarna hijau**.

---

## Verifikasi

- **Tab Experts** (di bagian bawah MT5) akan menampilkan log EA, termasuk:
  - Konfirmasi mode (sinyal saja / auto-trade).
  - Lot, TP/SL dalam dolar & harga.
  - Sinyal yang terdeteksi.
- **Chart** akan menampilkan garis **Entry/SL/TP** saat ada sinyal (kalau `InpDrawLevels=true`).
- **HP** akan menerima notifikasi saat sinyal muncul (kalau `InpPush=true`).

---

## Backtest di Strategy Tester

1. Di MT5, tekan `Ctrl+R` atau klik **View → Strategy Tester**.
2. Pilih:
   - **Expert Advisor**: ScalpRR2
   - **Symbol**: XAUUSDm atau BTCUSD
   - **Period**: M15 (atau timeframe sinyal yang dipilih)
   - **Date**: pilih periode minimal 1 bulan
   - **Mode**: **Every tick based on real ticks** (paling akurat) atau **1 minute OHLC** (lebih cepat).
3. Klik **Expert properties** → set `InpAutoTrade=true` untuk simulasi eksekusi.
4. Klik **Start**.
5. Tunggu sampai selesai → lihat laporan **Results**, **Graph**, **Report**.

**Perhatian:** Strategy Tester memakai data historis broker. Hasilnya bisa berbeda dari backtest riset (yang memakai Binance).

---

## File Terkait

- **Source code EA**: `C:\Users\rdhan\Documents\Chart Analysis\mt5\ScalpRR2.mq5`
- **Dokumentasi lengkap**: `C:\Users\rdhan\Documents\Chart Analysis\mt5\README.md`
- **Hasil riset ML**: (sedang berjalan, akan ada di `research/`)

---

## Catatan Penting

1. **Default EA = sinyal saja**, tidak eksekusi otomatis. Untuk auto-trading, set `InpAutoTrade=true` DAN pastikan Algo Trading aktif.
2. **Win rate 85% pada RR 1:2 belum terbukti** di backtest riset. Target realistis: 38–50% (break-even 33%).
3. **Uji di DEMO** minimal 1 minggu sebelum memakai uang sungguhan.
4. **Spread XAUUSDm Exness Standard** yang user screenshot: ~$0.24 (bid 4048.435, ask 4048.675). EA otomatis lewati sinyal bila spread > `InpMaxSpreadUSD` ($0.50 default).
