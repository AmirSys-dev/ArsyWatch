# DESIGN.md — ArsyWatch Design System

> Versi: 1.0 · Tarikh: 14 Okt 2026
> Rujukan visual: [endspeciesism.org](https://endspeciesism.org)
> Skop: dashboard pemantauan WiFi (ArsyWatch)

## 1. Arah Reka Bentuk (Direction)

Sebelum sebarang token, keputusan hala tuju (ECC `frontend-design-direction`):

| Soalan | Jawapan |
|---|---|
| **Purpose** | Dashboard operasi — baca keadaan udara WiFi, pilih channel terbaik |
| **Audience** | Operator (guna harian) + reviewer Stardance (sekali, 5 minit) |
| **Tone** | Tenang, tepat, editorial-teknikal. Bukan "SaaS gelap neon" |
| **Memorable detail** | Kertas hangat + satu aksen oren + semua nombor dalam mono. Dashboard WiFi yang tak nampak macam dashboard WiFi biasa |
| **Constraints** | Next.js, WCAG 2.2 AA, muat < 2s, responsif |

### Sebab rujukan endspeciesism.org

Laman itu membuktikan satu sistem tegas: **asas kertas hangat** (bukan putih tulen),
**satu aksen oren** (bukan ungu AI), **mono untuk data**, radius besar, dan easing
`quint` yang tersendiri. Kami ambil *sistem* itu — bukan komposisi editorialnya
(hero besar, scroll narrative) yang tak sesuai untuk tool guna harian.

**Apa yang diambil:** palet, skala foreground, mono, radius, easing, huruf besar display.
**Apa yang ditolak:** layout editorial scroll-heavy, teks hero gergasi, animasi sinematik.
Tool guna harian mesti tenang dan padat (rujuk `ui-taste/reference/operate.md`).

## 2. Token Warna

Palet rujukan dinyatakan sebagai **triplet HSL** (H S% L%) supaya boleh dijadikan
`hsl(var(--token) / <alpha>)` dalam Tailwind. Nilai hex disertakan untuk kegunaan lurus.

### Neutrals (asas kertas hangat)

| Token | HSL | Hex | Guna |
|---|---|---|---|
| `--bg-1` | `115 7% 100%` | `#FFFFFF` | Latar utama (kertas) |
| `--bg-2` | `115 7% 68%` | `#A9B3A8` | Permukaan sekunder, hover row |
| `--bg-3` | `115 7% 50%` | `#788877` | Sempadan kuat, elemen tidak aktif |
| `--fg-1` | `115 7% 11%` | `#1A1E1A` | Teks utama (bukan `#000`) |
| `--fg-2` | `115 7% 41%` | `#627061` | Teks sekunder, label |
| `--fg-3` | `115 7% 60%` | `#93A092` | Teks lemah, placeholder |
| `--overlay` | `0 0% 0%` | `#000000` | Overlay (guna dengan alpha) |

Hue 115 (hijau pucat) pada saturasi 7% memberi kehangatan halus berbanding zinc/slate
neutral. Ini yang menjadikan latar "kertas" dan bukan "skrin".

### Accent (satu sahaja — oren)

| Token | HSL | Hex | Guna |
|---|---|---|---|
| `--accent-1` | `28 93% 55%` | `#F78522` | Aksen utama, CTA, channel paling padat |
| `--accent-2` | `28 93% 42%` | `#CF6408` | Hover/aktif pada aksen |
| `--accent-3` | `28 93% 32%` | `#9D4D06` | Teks aksen di atas latar cerah (kontras) |

> **Peraturan aksen:** satu hue aksen sahaja. Tiada gradien ungu→biru, tiada glow neon.
> (ECC `design-system` Mode 3 — AI slop detection.)

### Semantic (status sahaja — bukan hiasan)

| Token | HSL | Hex | Guna |
|---|---|---|---|
| `--success` | `115 35% 34%` | `#395F38` | Isyarat kuat, status ok, node online |
| `--warn` | `28 93% 42%` | `#CF6408` | Sama seperti `accent-2` (channel padat) |
| `--danger` | `6 62% 45%` | `#BA3A2E` | Isyarat lemah, ralat, alert |
| `--info` | `200 30% 40%` | `#476C82` | Neutral maklumat |

Semantik dipakai **hanya** mengikut makna. Dilarang letak hue danger pada aksi bukan-musnah.

## 3. Tipografi

Rujukan guna: `poster-cut-neue` (display, condensed uppercase), `Gurajada` (sans),
`Space Mono` (mono). Untuk dashboard kami sesuaikan:

| Peranan | Font | Sebab |
|---|---|---|
| **Display** (tajuk halaman, angka besar) | Condensed grotesk — **Geist** atau **Archivo** (condensed) | Kekalkan rasa display rujukan; elak serif (dilarang untuk dashboard) |
| **UI / body** | **Geist** | Sans neutral, legible pada saiz kecil, tiada "personality" berlebihan |
| **Data / nombor** | **Geist Mono** atau **Space Mono** | Rujukan guna mono untuk data — kami kekalkan. `tabular-nums` wajib |

> **Inter diharamkan** (design-taste Rule 7). Mono untuk **semua** nombor yang berubah
> (RSSI, kiraan, channel) supaya lebar tak bergegar — rujuk `make-interfaces-feel-better`.

### Skala (modular, ratio 1.25)

| Token | Saiz | Guna |
|---|---|---|
| `--text-xs` | 0.75rem / 12px | Caption, label kecil |
| `--text-sm` | 0.875rem / 14px | UI default, sel jadual |
| `--text-base` | 1rem / 16px | Body |
| `--text-lg` | 1.25rem / 20px | Sub-tajuk |
| `--text-xl` | 1.5rem / 24px | Tajuk seksyen |
| `--text-2xl` | 2rem / 32px | Tajuk halaman |
| `--text-4xl` | 3rem / 48px | Angka metrik utama (mono) |

Display besar guna `clamp()` seperti rujukan: `clamp(2rem, 4vw, 3rem)`.

## 4. Spacing & Layout

Skala 4px. Rujukan guna pembolehubah `--padding` berasaskan viewport; kami kekalkan
versi terkawal:

| Token | Nilai |
|---|---|
| `--space-1` … `--space-12` | 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80 · 96 px |
| `--padding` | `clamp(1rem, 4vw, 2rem)` |
| `--gap` | `max(1rem, calc(var(--padding) / 2))` |
| `--max-width-container` | `1440px` |
| `--width-container` | `min(var(--max-width-container), 100%)` |

**Density:** dashboard = padat. Gunakan `divide-y` / `border-t` dan ruang negatif untuk
pengelompokan — **bukan** kotak kad bertindan (design-taste Rule 4, `ui-taste/operate`).

## 5. Radius & Elevation

| Token | Nilai | Guna |
|---|---|---|
| `--radius-sm` | 6px | Input, pill kecil |
| `--radius` | 20px | Kad, panel, butang utama (ikut rujukan) |
| `--radius-lg` | 28px | Panel besar |

- **Radius sepusat:** `outer = inner + padding` (rujuk `make-interfaces-feel-better`).
- **Bayang:** jarang. Guna `border` untuk pemisahan; bayang hanya untuk lapisan
  (popover, modal). Bayang ditint ke hue latar, bukan hitam tulen. Tiada glow luar.
- **Sempadan:** `1px` `--bg-3` @ 30% alpha untuk pemisahan halus.

## 6. Motion

Easing rujukan (quint) — kekalkan:

```css
--ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);   /* masuk / interaksi */
--ease-in-out-quint: cubic-bezier(0.83, 0, 0.17, 1); /* gerak di skrin */
```

| Token | Nilai | Guna |
|---|---|---|
| `--duration-fast` | 150ms | Hover, press, tooltip |
| `--duration-base` | 300ms | Toggle, reveal |
| `--duration-slow` | 500ms | Panel, modal |

**Peraturan (emil-design-eng + ECC make-interfaces-feel-better):**

- Nyatakan sifat tepat: `transition-property: transform, background-color, box-shadow`.
  **Jangan** `transition: all`.
- Tiada `ease-in` untuk UI (rasa lambat). Guna `--ease-out-quint`.
- Masuk dari `scale(0.95)` + `opacity: 0` — **jangan** `scale(0)`.
- Press: `scale(0.97)` pada `:active`.
- Keluar lebih laju daripada masuk.
- Animasi ≤ 300ms untuk elemen UI.
- Gerak hanya pada `transform` / `opacity`.
- Hormati `prefers-reduced-motion`.
- Hover hanya dalam `@media (hover: hover) and (pointer: fine)`.

> Dashboard guna harian: **jangan** koreograf page-load. Motion hanya untuk perubahan
> state (live indicator pulse, row update, toast).

## 7. Komponen — Peraturan

| Elemen | Peraturan |
|---|---|
| **Butang** | `--radius`, `:active scale(0.97)`, transition tepat, hit area ≥ 40×40px |
| **Jadual AP** | Baris guna `divide-y`, hover row = `--bg-2` @ alpha, mono untuk RSSI/channel |
| **Graf channel** | Bar mono-nombor, channel padat = `--accent-1`, label jelas |
| **Status dot** | Pulse halus (live) — hormati reduced-motion |
| **Input** | Label di atas, helper di bawah, ralat di bawah input, `gap: 8px` |
| **Empty state** | Nyatakan cara isi data (beza "tiada data" vs "tiada padanan") |
| **Loading** | Skeleton ikut saiz layout, **bukan** spinner bulat generik |
| **Error** | Inline, sebut cara pulih |
| **Nombor** | `font-variant-numeric: tabular-nums` |

## 8. AI Slop — Diharamkan (ECC design-system Mode 3)

- Gradien ungu→biru, glow neon, `box-shadow` bercahaya
- Kad kaca (glassmorphism) tanpa fungsi
- Hero teks tengah atas gradien stok
- Tiga kad sama lebar bertindan
- Emoji dalam kod/teks
- Nama generik ("Acme", "Nexus"), angka palsu (`99.99%`)
- Imej Unsplash yang boleh rosak
- Serif pada dashboard
- `transition: all`, `will-change: all`

## 9. Aksesibiliti (Gate — WCAG 2.2 AA)

- Kontras teks badan ≥ 4.5:1; teks besar ≥ 3:1
- Setiap kawalan interaktif ada nama aksesibel
- Focus ring kelihatan (guna `--accent-1`)
- State tidak boleh hanya bergantung pada warna — tambah ikon/label
- Sasar 320px width + 200% zoom tanpa klip
- `prefers-reduced-motion` dihormati

## 10. Fail Berkaitan

- `design-tokens.json` — token boleh dibaca mesin
- `design-preview.html` — pratonton visual (kendiri, tiada kebergantungan)
