# Techstack dashboard — keputusan

> Tarikh: 14 Okt 2026
> Disemak terhadap versi sebenar pada npm + dokumentasi rasmi Next.js, bukan dari ingatan.

---

## Keputusan

| Lapisan | Versi | Sebab |
|---|---|---|
| **Next.js** | **16.4.0** | Lihat perbincangan di bawah |
| **React** | **19.3.0** | Next 16 memerlukan React ≥19.2 |
| **Tailwind CSS** | **4.3.3** | Config CSS-first padan dengan DESIGN.md |
| **shadcn/ui** | terkini (CLI) | Satu-satunya library komponen yang lulus semakan anti-slop |
| **Recharts** | melalui shadcn Chart | Chart shadcn membalut Recharts, berjalan di klien |
| **Mode output** | `output: 'export'` | VPS 1GB RAM — tiada proses Node untuk dashboard |

---

## Next 15 atau 16? — pilih 16

Pengguna kata "15 atau 16 maybe". Saya pilih **16.4.0**. Sebabnya bukan "terbaru lebih
baik", tetapi kerana **risiko perubahan itu kecil untuk projek ini**.

### Fakta yang disahkan

| Keperluan Next 16 | Status projek |
|---|---|
| Node ≥ 20.9.0 | Node **26.1.0** — jauh melepasi |
| React 19.2 | React **19.3.0** |
| `output: 'export'` masih disokong | disahkan dalam dokumentasi rasmi |

### Perubahan pecah (breaking) dalam Next 16 — dan sama ada ia kena kita

| Perubahan | Kena kita? |
|---|---|
| `middleware` → `proxy` | Tidak guna middleware |
| `next lint` → ESLint CLI | Guna ESLint terus |
| `params` / `searchParams` jadi async | Tiada dynamic route dengan params |
| `cookies()` / `headers()` jadi async | Eksport statik, tiada akses runtime |
| `experimental.dynamicIO` → `cacheComponents` | Tidak guna |
| Turbopack jadi default | Ya, tetapi bagus — build lebih laju |

**Kesimpulan:** kita guna Next sebagai **cangkerang statik nipis** sahaja. Hampir tiada
API Next yang kita sentuh, jadi permukaan risiko untuk naik ke 16 adalah sangat kecil.
Faedahnya: build Turbopack lebih laju, dan tidak perlu migrasi kemudian.

### Pelan undur (fallback)

Kalau `create-next-app` atau shadcn ada masalah peer-dependency semasa scaffold,
turun ke **15.5.27** (tag `backport`, masih diselenggara). Kod kita tidak akan berubah —
kita tidak guna API yang berbeza antara 15 dan 16. Ini keputusan yang boleh dibalik
dengan kos hampir sifar, jadi tidak perlu risau.

---

## Tailwind 4, bukan 3

Tailwind 4.3.3 ialah versi semasa. Perbezaan yang penting untuk kita:

- Config **CSS-first** (`@theme` dalam CSS) dan bukan `tailwind.config.js`.
  DESIGN.md sudah menyatakan token sebagai triplet HSL untuk corak
  `hsl(var(--token) / <alpha>)` — ini padan terus dengan `@theme` Tailwind 4.
- Enjin Oxide — build jauh lebih laju.
- shadcn/ui menyokong Tailwind v4.

Tiada sebab untuk kekal di Tailwind 3 pada projek baharu.

---

## Perangkap: eksport statik + SSE

Ini perkara paling penting dalam dokumen ini, dan ia mudah terlepas pandang.

Dashboard ialah **eksport statik**. Tiada server Node di belakangnya. Jadi ia mesti
memanggil API secara **relatif**: `/api/v1/aps`, bukan `https://api.arsy.example.com/...`.

Dalam pembangunan, Next dan Express kedua-duanya mahu port 3000. Penyelesaian: jalankan
Express di port lain, dan proxy dalam `next.config`:

```js
// next.config.mjs — dev sahaja; eksport statik mengabaikan ini
const nextConfig = {
  output: 'export',
  async rewrites() {
    return [{ source: '/api/:path*', destination: 'http://127.0.0.1:8787/api/:path*' }];
  },
};
```

`rewrites()` **tidak berfungsi** dalam eksport statik — ia hanya untuk `next dev`.
Dalam produksi, **nginx** yang melakukan proxy. Itu memang disengajakan.

**EventSource (SSE) dalam eksport statik:** klien mesti guna
`new EventSource('/api/v1/events')` secara relatif. nginx mesti tidak menimbal (buffer)
laluan itu — `X-Accel-Buffering: no` sudah dihantar oleh server (`src/sse.js`), tetapi
nginx juga perlu `proxy_buffering off;` untuk laluan `/api/v1/events`. Kalau tidak,
aliran langsung akan tersekat dan dashboard nampak beku walaupun data sampai.

---

## Konfigurasi nginx untuk VPS (AWS, 2 vCPU / 1GB)

```nginx
# Dashboard awam — Let's Encrypt, dipercayai pelayar
server {
  listen 443 ssl http2;
  server_name arsy.example.com;

  ssl_certificate     /etc/letsencrypt/live/arsy.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/arsy.example.com/privkey.pem;

  root /var/www/arsywatch/out;
  index index.html;

  # Eksport statik Next: cuba fail, kemudian .html, kemudian folder
  location / {
    try_files $uri $uri.html $uri/ =404;
  }

  # API baca — proxy ke Express
  location /api/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # SSE mesti tidak dibuffer, jika tidak aliran langsung tersekat
  location /api/v1/events {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 24h;
    proxy_set_header Connection '';
    proxy_http_version 1.1;
  }

  # Admin di belakang Basic auth (Express yang mengesahkan, bukan nginx)
  location /admin/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
  }

  error_page 404 /404.html;
  location = /404.html { internal; }
}
```

Sijil ingest (`api.arsy.example.com`) berasingan dan **self-signed dengan fingerprint
dipin** — itu untuk ESP sahaja, bukan pelayar. Lihat PRD §4 "Dua sijil, dua peranan".

---

## Beban memori atas VPS 1GB

| Proses | Anggaran RSS |
|---|---|
| Express + better-sqlite3 | 60–80 MB |
| nginx | ~10 MB |
| **Dashboard** | **0 MB** — fail statik, tiada proses |
| SQLite (dalam proses Express) | termasuk di atas |
| **Jumlah** | **~90 MB** daripada 1024 MB |

Eksport statik bukan sekadar kemudahan — ia yang menjadikan 1GB cukup selesa.
Kalau kita jalankan Next sebagai server SSR, ia akan makan 150–300 MB lagi tanpa
sebarang faedah untuk projek ini.

---

## Perintah scaffold (untuk Fasa 3)

```bash
cd dashboard
npx create-next-app@latest . --ts --app --tailwind --eslint --no-src-dir --import-alias "@/*"
npx shadcn@latest init
npx shadcn@latest add data-table chart empty skeleton tooltip badge kbd dialog drawer sonner command separator scroll-area
```

Kemudian: **sahkan `npm run build` menghasilkan folder `out/`.** Jangan andaikan —
Turbopack default dalam Next 16, dan kita perlu tahu ia menghasilkan eksport statik
yang betul sebelum menulis sebarang UI.
