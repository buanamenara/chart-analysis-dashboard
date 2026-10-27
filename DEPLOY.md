# Cara Deploy ke Online (GitHub + Render)

Project ini sudah siap (git repo + commit pertama sudah dibuat). Tinggal ikuti langkah berikut.

## 1. Buat repo di GitHub

1. Buka https://github.com/signup (kalau belum punya akun) dan daftar — gratis, tidak perlu kartu kredit.
2. Setelah login, buka https://github.com/new
3. Isi "Repository name", misalnya `chart-analysis-dashboard`
4. Pilih **Private** atau **Public** (bebas, Private juga gratis)
5. **Jangan** centang "Add a README file" (kita sudah punya)
6. Klik **Create repository**
7. Di halaman berikutnya, GitHub akan kasih perintah seperti ini — salin URL repo-nya (bentuknya `https://github.com/USERNAME/chart-analysis-dashboard.git`)

## 2. Push project ke GitHub

Buka terminal di folder project ini (`C:\Users\rdhan\Documents\Chart Analysis`), lalu jalankan (ganti URL dengan punya kamu):

```bash
git remote add origin https://github.com/USERNAME/chart-analysis-dashboard.git
git branch -M main
git push -u origin main
```

Saat `git push`, kemungkinan muncul jendela login GitHub di browser — login seperti biasa untuk autentikasi.

## 3. Deploy ke Render

1. Buka https://dashboard.render.com/register dan daftar — bisa langsung pakai **"Sign up with GitHub"** (gratis, tanpa kartu kredit)
2. Setelah login, klik **New +** → **Web Service**
3. Pilih **Build and deploy from a Git repository**, lalu connect akun GitHub kamu dan pilih repo `chart-analysis-dashboard`
4. Isi konfigurasi:
   - **Name**: bebas, misalnya `chart-analysis-dashboard`
   - **Region**: Singapore (paling dekat ke Indonesia)
   - **Branch**: `main`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**
5. Klik **Create Web Service**
6. Tunggu 2-5 menit sampai status jadi **Live**
7. Render akan kasih URL publik seperti `https://chart-analysis-dashboard.onrender.com` — ini yang dibuka di HP

## Catatan penting

- **Server "tidur" kalau tidak diakses 15 menit** — loading pertama setelah itu butuh ~30-60 detik untuk "bangun". Setelah itu normal.
- Tidak perlu isi environment variable apapun di Render (fitur AI sudah dihapus, jadi tidak butuh API key).
- Setiap kali ada perubahan kode lokal, jalankan ini untuk update versi online:
  ```bash
  git add .
  git commit -m "update: <deskripsi perubahan>"
  git push
  ```
  Render otomatis re-deploy setiap ada push baru ke branch `main`.
- Simpan URL `.onrender.com` itu di HP (bookmark / Add to Home Screen) biar gampang diakses kapan saja.
