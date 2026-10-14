# Component selection — reviewed against anti-slop

> Tarikh: 14 Okt 2026
> Kaedah: inventori sebenar daripada dokumentasi rasmi, disemak satu per satu terhadap
> keperluan produk + peraturan anti-slop (ui-taste, emil-design-eng, DESIGN.md).

---

## Ringkasan keputusan

| Library | Verdict | Sebab ringkas |
|---|---|---|
| **shadcn/ui** | **Guna sebagai asas** | Ini library UI produk sebenar: Data Table, Chart, Empty, Skeleton, Kbd, Tooltip. Semua ada fungsi. |
| **Magic UI** | **2 komponen sahaja** | 90% daripadanya krom halaman pendaratan. Hanya Animated List dan Dot Pattern layak. |
| **Aceternity UI** | **Sifar komponen** | Ini library halaman pemasaran. Setiap komponennya sama ada kesan glow ikut tetikus, latar hero, atau kesan teks. |

**Sebab perbezaan ini penting:** pengguna minta "guna library ini" DAN "pilih berdasarkan
review anti-slop". Dua arahan itu hanya boleh didamaikan satu cara — guna apa yang lulus
semakan. Menggunakan Aceternity di sini bukan mematuhi arahan; ia *menjadi* slop itu sendiri.

---

## Konteks yang menentukan keputusan

Setiap penolakan di bawah berpunca daripada empat fakta produk, bukan citarasa:

1. **Pengguna tunggal, kegunaan harian, desktop.** Emil: apa yang dilihat 100+ kali sehari
   tidak boleh beranimasi.
2. **Tema kertas cerah, satu aksen oren.** DESIGN.md. Sebarang glow/gradien berwarna
   adalah pelanggaran langsung.
3. **Nada "tenang, tepat, editorial-teknikal. Bukan SaaS gelap neon."** DESIGN.md §1.
4. **DESIGN.md sudah menolak secara eksplisit:** layout editorial scroll-heavy, teks hero
   gergasi, animasi sinematik, kad kaca, gradien ungu-biru.

---

## Semakan komponen — mengikut library

### shadcn/ui

| Komponen | Guna? | Sebab |
|---|---|---|
| **Data Table** | ✅ Teras | Jadual AP. Isihan, definisi kolum, state. Ini tulang dashboard. |
| **Chart** | ✅ Teras | Bar kesesakan channel + garis 24 jam MAC unik. Bungkus Recharts. |
| **Empty** | ✅ Wajib | Keadaan "belum ada data" — firmware belum sambung. DESIGN.md minta empty state nyatakan cara isi data. |
| **Skeleton** | ✅ Wajib | DESIGN.md: skeleton ikut saiz layout, **bukan** spinner bulat generik. |
| **Tooltip** | ✅ | Butiran AP pada hover. Emil: lepas tooltip pertama terbuka, yang seterusnya tiada delay dan tiada animasi. |
| **Badge** | ⚠️ Terhad | Hanya untuk makna sebenar (jenis sekuriti: WPA2/WPA3/OPEN). **Bukan** hiasan. Pill yang wujud untuk mengisi ruang = slop. |
| **Kbd** | ✅ | Paparan pintasan papan kekunci. Berpasangan dengan density power-user. |
| **Dialog / Drawer** | ✅ | Aksi admin sahaja: putar token, tetapkan retention. |
| **Sonner (toast)** | ✅ | Maklum balas admin. Emil menulis ini — guna transition, bukan keyframes. |
| **Command (Ctrl+K)** | ✅ | Satu-satunya tempat density tinggi + papan kekunci benar-benar berguna. |
| **Separator / Scroll Area** | ✅ | Utiliti. |
| **Card** | ❌ **Tolak sebagai struktur** | DESIGN.md §4: "**bukan** kotak kad bertindan". Card shadcn ialah kotak bersempadan bersudut bulat — tepat benda yang DESIGN.md larang kalau dijadikan susun atur utama. Guna `divide-y` / `border-t` sahaja. |

### Magic UI

| Komponen | Guna? | Sebab |
|---|---|---|
| **Animated List** | ✅ | Satu-satunya yang layak. Baris AP baharu masuk dengan fade halus. Mesti halus dan tidak menggerakkan layout. |
| **Dot Pattern** | ⚠️ | Versi **statik** sahaja, sebagai tekstur latar sangat halus. Bukan beranimasi. |
| **Number Ticker** | ⚠️ Terhad | **Hanya pada muat pertama.** Jika ia berputar setiap 30 saat ia jadi bunyi bising — nilai berubah 2880 kali sehari. |
| **Meteors** | ❌ | Zarah hiasan. Sifar fungsi. |
| **Aurora Text / Animated Gradient Text / Light Rays / Flickering Grid / Animated Grid Pattern** | ❌ | Teks gradien + cahaya. Dilarang oleh CLAUDE.md global pengguna. |
| **Magic Card / Shine Border / Glare Hover / Border Beam / Backlight** | ❌ | Glow mengikut tetikus. Ini **corak slop AI yang paling kanonik**. Dilarang. |
| **Marquee / Infinite Moving** | ❌ | Gerakan untuk gerakan. Data dashboard tidak sepatutnya bergerak sendiri. |
| **Confetti / Cool Mode** | ❌ | Krom sambutan. Nada salah untuk alat operasi. |
| **Globe / Orbiting Circles / Icon Cloud / Dock / Tweet Card / iPhone / Android** | ❌ | Mainan halaman pendaratan. Sifar fungsi di sini. |
| **Animated Shiny Text / Dia Text Reveal / Comic Text / Kinetic Text / Line Shadow Text** | ❌ | Gerakan teks pada alat data. |
| **Blur Fade** | ⚠️ | Boleh dipertahankan untuk kemasukan senarai, tetapi Emil minta stagger 30–80ms dan tidak menyekat interaksi. Marginal. |
| **Terminal / Hero Video Dialog / Code Comparison / File Tree** | ❌ | Untuk laman pemasaran. |

### Aceternity UI

| Komponen | Guna? | Sebab |
|---|---|---|
| **Spotlight / Card Spotlight / Card Hover Effect / 3D Card Effect / Evervault Card / Comet Card / Glare Card / Wobble Card / Direction Aware Hover** | ❌ | Kesemua ini kesan kad glow/3D ikut tetikus. Dilarang. |
| **Background Beams / Beams With Collision / Background Lines / Ripple Effect / Glowing Stars / Grid & Dot Backgrounds / Lamp Effect / Hero Highlight / Hero Parallax** | ❌ | Latar bahagian hero. Ini alat data, bukan halaman pendaratan. |
| **Typewriter Effect / Text Generate / Flip Words / Colourful Text / Encrypted Text / Squiggly Text / Canvas Text / Layout Text Flip** | ❌ | Kesan teks. "Typewriter effect" disenaraikan secara eksplisit dalam senarai larangan CLAUDE.md. |
| **Sticky Scroll Reveal / Macbook Scroll / Container Scroll / Parallax Scroll** | ❌ | Naratif scroll. DESIGN.md sudah menolaknya secara eksplisit. |
| **Layout Grid** | ❌ | Beranimasi pada klik. Untuk galeri, bukan jadual. |
| **Tooltip Card** | ❌ | Bertindih dengan Tooltip shadcn. shadcn lebih ringkas dan a11y lebih baik. |
| **Compare / Comparison Slider** | ⚠️ | Berasaskan clip-path. Hanya berguna jika membandingkan dua tetingkap masa. Tiada keperluan itu sekarang. |
| **Semua blok (CTA / FAQ / Pricing / Testimonial / Login)** | ❌ | Blok halaman pemasaran. |

---

## Semakan animasi — gate frekuensi (emil-design-eng)

Setiap animasi yang tinggal mesti lulus gate ini. Frekuensi dahulu, baru easing.

| Elemen | Frekuensi dilihat | Tujuan | Alat | Keputusan |
|---|---|---|---|---|
| Bar kesesakan channel | ~4× sesi | Petunjuk keadaan, elak lompat mengejut | CSS transition pada `transform: scaleY()`, `transform-origin: bottom`, 300ms `cubic-bezier(0.23,1,0.32,1)` | ✅ |
| Baris AP bertukar | ~4× sesi | Petunjuk keadaan | Transition `background-color` 200ms. **Jangan** gerakkan baris. | ✅ |
| Titik "live" | Berterusan | Petunjuk keadaan | Opacity pulse 2s `ease-in-out`, halus | ✅ |
| Nombor metrik utama | 1× muat halaman | Delight (tier jarang) | Roll-up pada mount sahaja, kemudian snap | ✅ |
| Hover baris jadual | Puluhan/hari | Maklum balas | `background-color` sahaja. Tiada transform. | ⚠️ Minimal |
| Skeleton loading | 1× muat | Elak lompat mengejut | CSS animation (luar main thread), shimmer halus | ✅ |
| Indikator putus SSE | Jarang | Petunjuk keadaan | Perubahan warna + label statik | ✅ |
| Koreografi muat halaman | 1× | — | — | ❌ DESIGN.md: "jangan koreograf page-load" |
| Scroll reveal | — | — | — | ❌ |
| Glow ikut tetikus | — | — | — | ❌ |
| Ticker pada setiap kemas kini 30s | 2880×/hari | — | — | ❌ Jadi bunyi bising |

### Peraturan yang mengikat setiap animasi di atas

- Hanya `transform` dan `opacity`. (`scaleY` pada bar; tiada `height`.)
- `transition: transform 200ms ...`, bukan `transition: all`.
- Easing masuk: `cubic-bezier(0.23, 1, 0.32, 1)` — bukan `ease-in`.
- Tiada `scale(0)`. Masuk dari `scale(0.95)` + `opacity: 0`.
- Semua animasi UI bawah 300ms.
- Hover digate: `@media (hover: hover) and (pointer: fine)`.
- `prefers-reduced-motion`: versi lebih lembut, **bukan** sifar. Kekalkan opacity/warna,
  buang gerakan.

---

## Fail yang perlu dicipta dalam Fasa 3

Guna CLI shadcn, bukan salin tampal:

```bash
cd dashboard
npx shadcn@latest init
npx shadcn@latest add data-table chart empty skeleton tooltip badge kbd dialog drawer sonner command separator scroll-area
```

Kemudian salin **dua** komponen Magic UI secara manual (Animated List, Dot Pattern) dan
ubah suainya kepada token DESIGN.md. Jangan pasang Magic UI sebagai pakej.

**Aceternity: tiada pemasangan.**

---

## Satu risiko yang perlu disebut

Dashboard dihoskan sebagai **eksport statik** (`next build` → `out/`) atas VPS 1GB RAM.
Komponen yang bergantung pada runtime Node (contohnya Chart jika ia membuat pengiraan
di server) mesti disemak — Chart shadcn berasaskan Recharts dan berjalan di klien, jadi
ia selamat. Sahkan ini semasa pembinaan, jangan andaikan.
