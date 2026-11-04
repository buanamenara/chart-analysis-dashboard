# Riset Scalping XAUUSD & BTCUSD

## Status

Riset ML selesai pada 5 November 2026. Tidak ditemukan metode yang mencapai win rate 85%+ pada **RR gross 1:2** di out-of-sample dengan bukti yang cukup.

### Hasil final out-of-sample

| Instrumen/proxy | Kandidat | Biaya | Trade | Win rate | Net P/L | Expectancy |
|---|---|---:|---:|---:|---:|---:|
| PAXGUSDT (proxy emas) | Logistic, TP $10, short | $0.26/trade | 33 | 27.3% | -$39.09 | -$1.19/trade |
| PAXGUSDT (biaya lebih lebar) | Kandidat sama | $0.42/trade | 33 | 27.3% | -$44.37 | -$1.35/trade |
| BTCUSDT | Tidak ada kandidat valid | - | - | - | - | - |

BTCUSDT tidak memiliki kandidat dengan minimal 30 trade valid pada test setelah seleksi temporal.

## Metodologi

- Data Binance 1-minute, jendela 90 hari yang ditentukan sebelum melihat hasil.
- Split kronologis 60% train / 20% validation / 20% test.
- Purge horizon antar split.
- Fitur hanya memakai candle yang sudah selesai; entry pada open candle berikutnya.
- TP/SL gross RR 1:2; candle yang menyentuh TP dan SL sekaligus dihitung SL terlebih dahulu.
- Gap adverse diisi pada open; tidak ada posisi overlap atau reuse sebelum posisi selesai.
- Model: Logistic Regression dan HistGradientBoosting dengan seed tetap.
- Ambang dipilih dari validation saja; test dijalankan satu kali tanpa optimasi ulang.

## Batasan penting

- PAXGUSDT **bukan** XAUUSDm Exness.
- BTCUSDT spot Binance **bukan** BTCUSD broker Exness/Vantage.
- Contract size 0.01 lot, bid/ask, slippage, komisi crypto, tick data broker, margin, dan liquidation belum diverifikasi.
- Spread emas `$0.24` berasal dari satu screenshot Exness Standard: Bid 4048.435, Ask 4048.675. Ini bukan distribusi spread.
- Win rate tinggi tidak cukup; pada RR 1:2 break-even sekitar 33.3% sebelum biaya, tetapi biaya dan losing streak tetap penting.

Full evidence: `results/evidence.md` dan `results/evidence.json`.

## Reproduksi

```powershell
# Dari root project
C:\Users\rdhan\AppData\Local\Temp\opencode\mlvenv\Scripts\python.exe research\test_research.py
C:\Users\rdhan\AppData\Local\Temp\opencode\mlvenv\Scripts\python.exe research\run_ml.py
```

Expected test result: `Ran 7 tests ... OK`.

## MT5

EA sinyal-first tersedia di `../mt5/ScalpRR2.mq5`. EA berjalan di MT5 desktop/VPS, bukan langsung di MT5 Android. Notifikasi dan posisi bisa terlihat di aplikasi MT5 HP setelah MetaQuotes ID dikonfigurasi. Default EA tidak membuka order otomatis.
