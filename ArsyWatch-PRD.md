# PRD — ArsyWatch

> **Product Requirements Document**
> Versi: 1.2 · Tarikh: 14 Okt 2026 · Penulis: Arsyad
> Status: Draft untuk kelulusan
> Konteks: Projek Stardance Challenge 2026 (deadline 31 Okt 2026)

## Changelog v1.0 → v1.1

- Demo awam read-only; kawalan tulis dipindah ke `/admin` (selesaikan konflik demo vs auth)
- Notifikasi Telegram dimasukkan sebagai skop v1.1 (buang dari Non-Goals)
- Pemisahan sijil: Let's Encrypt untuk dashboard, self-signed pinned untuk ingest ESP
- Kiraan peranti dinamakan semula "MAC unik" + caveat randomisasi MAC
- Pembetulan dakwaan "rangkaian sendiri" → passive capture tangkap jiran
- Polisi retention DB ditambah (7 hari detail / 30 hari agregat)
- Satu pass channel-hopping untuk beacon (AP) + probe request (peranti)
- Design system diambil dari rujukan `endspeciesism.org` (lihat `DESIGN.md`)

## Changelog v1.1 → v1.2

Ditulis selepas firmware sebenar dibina. Tiga pembetulan fakta, semuanya hasil
menemui had sebenar semasa menulis kod — bukan andaian.

- **RSSI tidak boleh datang dari promiscuous mode.** PRD v1.1 (§US-1, §Had Teknikal)
  mengandaikan satu pass channel-hop menghasilkan AP *lengkap dengan RSSI*. Ini tidak
  benar pada ESP8266. Callback promiscuous dalam NONOS SDK ialah
  `void(*)(uint8_t*, uint16_t)` — tiada `rx_ctrl`, tiada medan RSSI. Struct
  `wifi_promiscuous_pkt_t` itu ESP32 sahaja. RSSI sebenar hanya datang dari
  `WiFi.scanNetworks()`. Lihat §4 "Nota RSSI" di bawah.
- **Kontrak API kini wujud.** `docs/api.md` ditulis dan **dibekukan**. Ia menggantikan
  penanda TBD dalam §4. Firmware, server dan dashboard semuanya mengikut dokumen itu.
- **Kuasa nod:** operasi tetap guna plag USB (bukan powerbank). Powerbank 10000 mAh
  hanya untuk demo/timelapse sementara. Lihat §5 Risiko.

---

## 1. Executive Summary

### Problem Statement

Tiada cara mudah untuk melihat keadaan udara WiFi di sekeliling rumah — tidak tahu
channel mana padat, tidak tahu berapa banyak MAC unik berada di sekeliling, dan tidak
tahu kenapa WiFi kadangkala perlahan. Router hanya bagi pilihan channel, bukan data
untuk memilih.

### Proposed Solution

Satu nod ESP8266 yang mengimbas AP berdekatan dan mengira MAC unik di udara dalam satu
pass channel-hopping, menghantar data ke VPS, dan memaparkannya dalam dashboard web
awam (read-only) yang dikemas kini secara langsung melalui SSE.

### Success Criteria

| # | Kriteria | Ukuran |
|---|---|---|
| 1 | Jam kerja disahkan | 31 jam direkod dalam Hackatime |
| 2 | Projek di-ship | Dihantar di Stardance sebelum 31 Okt 2026 |
| 3 | Dashboard live | URL awam boleh diakses tanpa login, masa muat < 2s |
| 4 | Kebolehpercayaan nod | ≥ 95% kitaran scan berjaya dihantar dalam 24 jam |
| 5 | Kependaman data | Data muncul di dashboard < 5s selepas diterima server |
| 6 | Penggunaan sumber | < 100MB RSS atas VPS 1GB RAM |

---

## 2. User Experience & Functionality

### User Personas

**Primary — Arsyad, operator**
Memiliki satu nod ESP8266 dan satu VPS. Mahu tahu keadaan WiFi sendiri dan memilih
channel terbaik. Mengakses `/admin` untuk kawalan.

**Secondary — Reviewer & voter Stardance**
Membuka demo URL awam dan menilai dalam ~5 minit. Perlu faham projek dan mencubanya
**tanpa login** dan tanpa baca dokumentasi panjang.

### User Stories & Acceptance Criteria

#### US-1 — Imbasan berterusan

> Sebagai operator, aku mahu ESP mengimbas AP berdekatan setiap 30 saat supaya aku
> mempunyai data berterusan.

**Acceptance Criteria**
- Kitaran imbasan (channel-hop 1–13, dwell ~300ms) tidak melebihi 30 saat
- Setiap AP direkod: SSID, BSSID, RSSI, channel, jenis sekuriti
  - **Pembetulan v1.2:** RSSI datang dari managed scan (`WiFi.scanNetworks()`),
    **bukan** dari promiscuous mode. Lihat §4 Nota RSSI.
- Data dihantar dengan token peranti; server tolak dengan 401 jika token salah
- ESP menyambung semula automatik jika WiFi terputus
- ESP tidak reboot akibat kehabisan memori dalam operasi 24 jam
- Channel-hop (promiscuous) menghasilkan kiraan MAC (probe request)
  - **Pembetulan v1.2:** ia **bukan** sumber senarai AP atau RSSI. Ia melengkapkan
    data AP dari managed scan (SSID tersembunyi, WPA3) dan mengira MAC unik.

#### US-2 — Jadual AP langsung

> Sebagai operator, aku mahu jadual AP yang dikemas kini secara langsung.

**Acceptance Criteria**
- Senarai dikemas kini automatik tanpa muat semula halaman (SSE)
- Disusun mengikut kekuatan isyarat (terkuat di atas)
- Menunjukkan masa AP kali terakhir dikesan
- AP yang hilang ditanda "hilang", bukan dipadam serta-merta

#### US-3 — Graf kesesakan channel

> Sebagai operator, aku mahu graf kesesakan channel supaya aku boleh pilih channel terbaik.

**Acceptance Criteria**
- Bar untuk setiap channel 1–14
- Menunjukkan kiraan AP per channel
- Channel paling padat ditanda dengan jelas
- Data boleh ditapis mengikut julat masa

#### US-4 — Kiraan MAC unik

> Sebagai operator, aku mahu kiraan MAC unik sepanjang masa supaya aku tahu berapa
> banyak peranti di sekeliling.

**Acceptance Criteria**
- Graf 24 jam kiraan MAC unik
- MAC di-hash (SHA-256 + salt); MAC mentah **tidak** disimpan
- Kiraan unik per jam
- Tiada payload atau data frame disimpan — hanya kiraan
- **Caveat:** kiraan adalah "MAC unik", **bukan** bilangan manusia/peranti sebenar —
  randomisasi MAC (iOS/Android, ~setiap 15 min) boleh menaikkan kiraan. Nota ini
  dipaparkan pada UI.

#### US-5 — Demo untuk reviewer (awam, read-only)

> Sebagai reviewer Stardance, aku mahu demo yang boleh dicuba dalam 1 minit.

**Acceptance Criteria**
- URL awam langsung (`https://arsy.example.com`), bukan pautan repositori GitHub
- **Tiada login** untuk melihat dashboard; data sebenar, bukan tiruan
- Masa muat < 2 saat
- Mod read-only: tiada kawalan tulis (token, retention, ujian Telegram) di permukaan awam
- README menerangkan projek dalam 5 minit baca

#### US-6 — Notifikasi Telegram (v1.1)

> Sebagai operator, aku mahu notifikasi Telegram supaya aku tahu bila AP baharu muncul
> atau channel jadi padat.

**Acceptance Criteria**
- Alert dihantar bila AP baharu (BSSID belum pernah dilihat) muncul
- Alert dihantar bila channel melebihi ambang kiraan AP (default 5)
- Anti-spam: AP yang sama tidak mencetuskan alert berulang dalam tempoh 1 jam
- Bot token disimpan sebagai environment variable, bukan dalam repo
- Ujian alert boleh dicetuskan dari `/admin`

### Non-Goals

Perkara berikut **tidak** dibina dalam versi ini:

- Alert keselamatan (evil twin, deauth flood)
- Skor kesihatan rangkaian atau cadangan channel automatik
- Carian vendor AP (lookup OUI)
- Peta haba liputan
- Sokongan berbilang nod ESP
- OLED atau perkakasan tambahan
- Akaun berbilang pengguna atau pendaftaran
- Autentikasi per-peranti untuk dashboard (token peranti hanya untuk ingest)

> **Nota:** Notifikasi Telegram **bukan lagi non-goal** — ia kini skop v1.1 (US-6).

---

## 3. AI System Requirements

**Tidak berkenaan.**

ArsyWatch tidak menggunakan sebarang komponen AI atau pembelajaran mesin. Semua
pengiraan deterministik: kiraan, agregat masa, dan hashing. Tiada strategi penilaian
model diperlukan.

---

## 4. Technical Specifications

### Architecture Overview

```
┌──────────────┐  HTTPS POST (pinned)  ┌────────────────────┐  SSE   ┌──────────────┐
│  ESP8266     │ ────────────────────► │  VPS               │ ─────► │  Dashboard   │
│  channel-hop │   api.arsy.example    │  ingest + SQLite   │        │  Next.js     │
│  beacon+probe│   setiap 30s          │  nginx + TLS       │        │  (awam)      │
└──────────────┘                       └────────────────────┘        └──────────────┘
```

Semua komponen atas satu VPS (2 vCPU, 1GB RAM):
- **nginx** — TLS termination dan reverse proxy
- **Server aplikasi** — Node/Express + better-sqlite3 (ingest, simpanan, API)
- **SQLite** — fail tunggal, tiada server berasingan
- **Dashboard** — Next.js, dihidangkan sebagai laman statik / proses Node

### Integration Points

| Endpoint | Kaedah | Fungsi | Akses |
|---|---|---|---|
| `/api/v1/ingest` | POST | Terima muatan ESP (auth token) | ESP sahaja |
| `/api/v1/aps` | GET | Senarai AP semasa + sejarah RSSI | Awam (read) |
| `/api/v1/channels` | GET | Kiraan AP per channel | Awam (read) |
| `/api/v1/devices` | GET | Kiraan MAC unik mengikut masa | Awam (read) |
| `/api/v1/events` | GET | SSE — tolak data baharu | Awam (read) |
| `/admin/*` | GET/POST | Token, retention, ujian Telegram | Basic auth |

**Kontrak API:** resource nouns plural kebab-case, envelope `{ data, meta }` untuk koleksi,
`{ error: { code, message } }` untuk ralat, kod status HTTP semantik (401/403/404/422/429/500).
Lihat `DESIGN.md` untuk token; lihat `docs/api.md` (TBD) untuk kontrak penuh.

### Skema Data (SQLite)

```sql
scans     (id, device, received_at, uptime_ms)
aps       (id, scan_id, ssid, bssid, rssi, channel, enc)
devices   (id, mac_hash, first_seen, last_seen, frame_count)
channels  (channel, ap_count, updated_at)
```

**Index & Retention**
- Index: `aps(scan_id)`, `aps(bssid)`, `devices(mac_hash)`, `scans(received_at)`
- Prune detail (`scans`, `aps`) lebih tua daripada **7 hari**
- Simpan agregat (`channels`, kiraan per jam) sehingga **30 hari**
- Job prune harian melalui cron; SQLite WAL mode untuk read + write serentak

### Security & Privacy

- **Dua sijil, dua peranan:**
  - `arsy.example.com` → Let's Encrypt (dipercayai browser) → dashboard awam
  - `api.arsy.example.com` → self-signed, sah panjang, **fingerprint dipin** pada ESP
  - Kesannya: LE boleh renew tanpa sentuh ESP; ingest tak mati senyap setiap ~60 hari
- ESP mengesahkan fingerprint sijil ingest — **bukan** `setInsecure()`
- Token per peranti; permintaan ingest tanpa token sah ditolak (401), dibanding
  secara timing-safe
- MAC di-hash SHA-256 + salt; MAC mentah tidak pernah disimpan
- Tiada payload/data frame disimpan — hanya kiraan agregat
- Had kadar: 1 permintaan / 10 saat / token
- Dashboard awam = **read-only**; kawalan tulis di `/admin` di belakang basic auth
- **Nota privasi jujur:** promiscuous mode menangkap frame jiran juga. Kami **hanya**
  simpan kiraan agregat + hash; tiada payload disimpan.

### Had Teknikal ESP8266

| Had | Kesan pada reka bentuk |
|---|---|
| Promiscuous mode hanya satu channel pada satu masa | Channel-hopping (dwell ~300ms setiap channel) |
| Heap bebas ~40–50KB | Hadkan senarai AP (≤ 20), hantar JSON secara stream |
| HTTPS lambat (~1–2s setiap permintaan) | Selang 30s, bukan 5s |
| Bukan monitor mode penuh | Hanya management frame boleh ditangkap |
| **Promiscuous callback tiada RSSI** | RSSI mesti datang dari managed scan — lihat Nota RSSI |

### Nota RSSI — pembetulan v1.2

Callback promiscuous dalam ESP8266 NONOS SDK ditakrifkan sebagai:

```c
void (*wifi_promiscuous_rx_cb)(uint8_t *buf, uint16_t len);
```

Tiada `rx_ctrl`, tiada medan RSSI. Struct `wifi_promiscuous_pkt_t` (yang *ada*
`rx_ctrl.rssi`) ialah ESP32 sahaja. Jadi RSSI **tidak boleh** dibaca semasa
menangkap beacon.

**Kesan:** setiap kitaran scan mempunyai dua fasa:

1. **Fasa A — managed scan** (`WiFi.scanNetworks()`): sumber **sebenar** untuk
   senarai AP + RSSI + channel. Ini yang menghasilkan data yang dihantar.
2. **Fasa B — channel-hop promiscuous**: mengira MAC unik dari probe request,
   dan **melengkapkan** data Fasa A (SSID tersembunyi, WPA3). Ia tidak
   menghasilkan RSSI.

**Peraturan:** firmware **tidak pernah** mereka-reka RSSI. AP yang tiada bacaan
signal sebenar tidak dihantar langsung. Ini lebih jujur daripada mengisi nilai
andaian.

Implikasi pada US-1: "satu pass" dalam v1.1 bermaksud satu *kitaran scan*, bukan
satu operasi radio tunggal. Dua fasa berlaku dalam kitaran yang sama.

---

## 5. Risks & Roadmap

### Phased Rollout

```
MVP    (jam 0–18)   ESP imbas AP → server simpan → dashboard jadual + graf channel
v1.1   (jam 18–26)  Kiraan MAC unik + graf 24 jam + SSE + notifikasi Telegram
v2.0   (jam 26–31)  Deploy penuh, README, video demo, ship
```

### Technical Risks

| Risiko | Impak | Mitigasi |
|---|---|---|
| Promiscuous mode gagal pada firmware tertentu | Kiraan MAC gagal | Turun ke imbasan sahaja — projek tetap boleh ship |
| HTTPS ESP terlalu perlahan | Data tidak selaju dijangka | Selang 30s; guna HTTP dalam LAN semasa pembangunan |
| Heap habis → ESP reboot | Data terputus | Had 20 AP, stream JSON, watchdog timer |
| Randomisasi MAC | Kiraan "peranti" mengelirukan | Namakan "MAC unik" + caveat pada UI |
| Renewal LE pecahkan fingerprint ESP | Ingest mati senyap | Pisahkan sijil: pinned self-signed untuk ingest |
| DB membesar tanpa had | VPS 1GB penuh | Retention 7/30 hari + index |
| **Skop mungkin kurang 31 jam** | Sijil tidak cukup jam | Lihat nota di bawah |
| Minggu peperiksaan 19–25 Okt | Kapasiti berkurang | Siapkan teras sebelum 18 Okt |
| Deadline 31 Okt | Tidak sempat siap | Bahagian berisiko di akhir, boleh dipotong |

### ⚠ Risiko Utama: Skop Mungkin Tidak Mencukupi 31 Jam

Skop pemantauan sahaja dijangka ~20–25 jam. Sijil Stardance perlu 31 jam disahkan.

**Pilihan mitigasi (disemak):**
1. **Kedalaman** — sejarah RSSI per AP, replay timeline, eksport CSV
2. **Kualiti** — ujian automatik, README terperinci, polish UI
3. **Fitur masuk semula** — **notifikasi Telegram (diterima, US-6)**

### Timeline

```
14 Okt (Rabu)  Setup repo, toolchain, design system, imbasan pertama  → devlog #1
15 Okt (Kha)   Firmware: channel-hop, format JSON, sambung semula
16 Okt (Jum)   Backend: endpoint ingest + auth
17 Okt (Sab)   Backend: DB + agregat + API                            → devlog #2
18 Okt (Ahd)   Backend: SSE stream langsung
── 19–25 Okt: peperiksaan — 30 min/hari sahaja ──
26 Okt (Isn)   Frontend: rangka dashboard + jadual AP
27 Okt (Sel)   Frontend: graf channel + kiraan MAC + Telegram         → devlog #3
28 Okt (Rab)   Frontend: polish + SSE + /admin
29 Okt (Kha)   Deploy VPS: systemd + nginx + LE + pinned cert
30 Okt (Jum)   README + video demo + devlog                           → devlog #4
31 Okt (Sab)   SHIP
```

---

## Lampiran A — Keperluan Pematuhan Stardance

```
[ ] Kategori projek: Hardware
[ ] Repositori GitHub awam, lesen MIT
[ ] README lengkap
[ ] URL demo langsung (bukan pautan GitHub) — awam tanpa login
[ ] 31 jam disahkan dalam Hackatime
[ ] Minimum 4 devlog (had 10 jam setiap devlog)
[ ] Video demo perkakasan
[ ] Timelapse perkakasan (tool Lapse)
```

## Lampiran B — Andaian & Keputusan

1. Pengguna utama operator tunggal (Arsyad); tiada berbilang pengguna
2. Projek dinilai melalui demo awam oleh reviewer Stardance
3. Nod beroperasi 24/7 dengan kuasa USB berterusan
4. Pemantauan adalah passive & agregat; tiada data peribadi disimpan
5. Nama projek: **ArsyWatch**
6. Domain: `arsy.example.com` + `api.arsy.example.com` (TBD — tukar kepada domain sebenar)
7. Bahasa backend: **Node/Express + better-sqlite3**
8. Ambang alert Telegram: **AP baharu** + **channel > 5 AP**, anti-spam 1 jam
9. Retention: **7 hari detail / 30 hari agregat**
10. Design system dirujuk dari `endspeciesism.org` — lihat `DESIGN.md`
11. Hardware ESP8266 fizikal: **TBD**
