# Cara Deploy ke Online (Cloudflare Pages)

Project ini sudah disiapkan untuk **Cloudflare Pages** (bukan Render):
- Frontend statis ada di `public/` (index.html, app.js, style.css, favicon).
- Backend API ada di `functions/api/*.js` — otomatis jadi endpoint `/api/...` di Cloudflare Pages Functions, tanpa perlu server sendiri.
- Semua sumber data gratis & tanpa API key, jadi tidak perlu environment variable apa pun.

## Cara kerja singkat

| Permintaan | Dilayani oleh |
|-----------|---------------|
| `/`, `/app.js`, `/style.css`, `/favicon.webp` | File statis di `public/` |
| `/api/quote`, `/api/analysis-data`, `/api/signal`, `/api/snr`, `/api/news`, `/api/economic-calendar`, `/api/sentiment` | Cloudflare Pages Functions (`functions/api/*.js`) |

## A. Deploy via Git integration (paling mudah, auto-deploy setiap push)

### 1. Push project ke GitHub

Repo sudah punya remote. Kalau belum pernah push, jalankan (ganti URL dengan milikmu):

```bash
git remote add origin https://github.com/USERNAME/chart-analysis-dashboard.git
git branch -M main
git push -u origin main
```

### 2. Hubungkan ke Cloudflare Pages

1. Buka https://dash.cloudflare.com → pilih akun → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Pilih repository `chart-analysis-dashboard`.
3. Isi **Build settings**:
   - **Framework preset**: `None`
   - **Build command**: `npm install`
   - **Build output directory**: `public`
   - **Root directory**: biarkan kosong (root repo)
4. Klik **Save and Deploy**. Tunggu 1–3 menit sampai status **Active**.

URL publik akan berbentuk `https://chart-analysis-dashboard.pages.dev`.

> Kenapa build command `npm install`? Karena `functions/` mengimpor package `technicalindicators` (untuk RSI/MACD/EMA/BB). `npm install` menyiapkan `node_modules` supaya fungsi bisa di-bundle oleh Cloudflare.

### 3. Update ke online (setiap ada perubahan kode)

Setiap commit baru yang di-push ke `main` otomatis memicu deploy baru:

```bash
git add .
git commit -m "update: <deskripsi perubahan>"
git push
```

## B. Deploy langsung via CLI (Wrangler, opsional)

Kalau mau deploy tanpa GitHub (upload langsung dari folder):

```bash
npm install -g wrangler
wrangler login
wrangler pages deploy public --project-name chart-analysis-dashboard
```

`wrangler.toml` di root sudah berisi `pages_build_output_dir = "public"`, jadi perintah `wrangler pages deploy` juga jalan langsung.

## Catatan penting

- **Pages gratis**: 500 build/bulan, bandwidth & request fungsi gratis (cukup untuk pemakaian pribadi).
- **Cold start**: Pages Functions bisa sedikit lambat di request pertama setelah lama idle (~1–2 detik), setelah itu normal.
- **Kalender ekonomi di-cache** pakai Cloudflare Cache API (30 menit fresh, 6 jam fallback basi) supaya tidak kena rate-limit ForexFactory — tidak perlu konfigurasi tambahan.
- **Tidak perlu environment variable** apa pun di dashboard Cloudflare.
- **Fallback data**: kalau Binance diblokir ISP, otomatis pindah ke Yahoo Finance; kalau ForexFactory rate-limit, pakai cache basi.

## Alternatif: Render (lama, sudah tidak dipakai)

Kalau tetap ingin pakai Render, jalankan `server.js` (Express):
- Build Command: `npm install`
- Start Command: `npm start`
- Instance: Free

Tapi deployment utama project ini sekarang adalah **Cloudflare Pages**.
