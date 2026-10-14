# Kontrak API — ArsyWatch v1

> Versi: 1.0 · Tarikh: 14 Okt 2026
> Status: **Beku (frozen)** — firmware, server, dan dashboard semua bergantung pada dokumen ini.
> Rujukan: [`DESIGN.md`](../DESIGN.md)

Dokumen ini menggantikan penanda **TBD** dalam PRD §4 (*"lihat `docs/api.md` (TBD) untuk
kontrak penuh"*). Sebarang perubahan selepas Fasa 1 bermula memerlukan bump versi
(`/api/v2`) atau perubahan tambahan (additive) sahaja.

---

## 0. Peraturan Am

### 0.1 Envelope

**Koleksi** — setiap respons berjaya:

```json
{ "data": <objek | senarai>, "meta": { ... } }
```

- `data` — sentiasa wujud pada respons 2xx.
- `meta` — metadata konteks (window, kiraan, masa jana). Boleh kosong `{}` tetapi
  sentiasa hadir pada respons koleksi.

**Ralat** — setiap respons bukan-2xx:

```json
{ "error": { "code": "snake_case_code", "message": "Ayat manusia tunggal" } }
```

`code` stabil dan boleh diprogram; `message` untuk manusia dan **tidak** boleh
diparse oleh klien.

### 0.2 Konvensyen

| Perkara | Peraturan |
|---|---|
| Noun sumber | Plural, kebab-case (`/api/v1/aps`, `/api/v1/channels`) |
| Versi | Dalam laluan (`/api/v1`) — bukan header |
| Masa | ISO-8601 UTC dengan milisaat (`2026-10-14T12:00:00.000Z`) |
| ID | Integer auto-increment SQLite (bukan UUID) |
| Penomboran | Integer sahaja. RSSI integer dBm. Tiada string nombor. |
| BSSID | Huruf besar, kolon: `A4:2B:8C:91:F3:0F` |
| MAC mentah | **Tidak pernah** dalam respons. Hanya `mac_hash` (SHA-256 hex). |
| `null` vs tiada | Field yang tidak berkenaan = `null`, bukan dihilangkan |

### 0.3 Kod Status

| Kod | Guna |
|---|---|
| `200` | GET berjaya |
| `201` | Ingest berjaya (rekod baharu dicipta) |
| `400` | JSON tidak sah / badan tidak boleh diparse |
| `401` | Token peranti tiada atau tidak sah |
| `403` | Basic auth gagal pada `/admin/*` |
| `404` | Laluan tidak wujud |
| `413` | Badan melebihi 64 KB |
| `422` | Skema sah JSON tetapi gagal validasi semantik |
| `429` | Had kadar dilanggar |
| `500` | Ralat dalaman |

### 0.4 Senarai Kod Ralat

```
bad_request · invalid_token · forbidden · not_found
validation_failed · rate_limited · payload_too_large · internal_error
```

### 0.5 Had Kadar

| Skop | Had | Header respons |
|---|---|---|
| `/api/v1/ingest` | 1 permintaan / 10 saat / token | `Retry-After: <saat>` pada 429 |
| `/api/v1/*` (baca) | 120 permintaan / minit / IP | `Retry-After` pada 429 |

### 0.6 CORS

Baca (`GET /api/v1/*`) — `Access-Control-Allow-Origin: *`, `GET, OPTIONS` sahaja.
Ingest — tiada CORS (ESP bukan pelayar).

---

## 1. Ingest — `POST /api/v1/ingest`

Satu-satunya titik tulis dari ESP. Satu kitaran imbasan = satu permintaan.

### 1.1 Pengesahan

```
Authorization: Bearer <DEVICE_TOKEN>
Content-Type: application/json
```

- Token dibanding secara **timing-safe** (`crypto.timingSafeEqual`).
- Panjang tak sepadan mesti **tidak** memintas keluar awal sebelum perbandingan
  masa tetap (bandingkan hash panjang tetap, bukan string mentah).
- Tiada token / tidak sah → `401 invalid_token`.
- Sijil: ESP mempin fingerprint `api.arsy.example.com` (self-signed). nginx
  menamatkan TLS; Express tidak pernah lihat TLS mentah.

### 1.2 Badan Permintaan

```json
{
  "device": "arsywatch-01",
  "uptime_ms": 1234567,
  "firmware": "1.0.0",
  "aps": [
    {
      "ssid": "HomeNet",
      "bssid": "A4:2B:8C:91:F3:0F",
      "rssi": -51,
      "channel": 6,
      "enc": "wpa2"
    }
  ],
  "macs": ["A4:2B:8C:91:F3:10", "7C:10:C9:02:44:AB"]
}
```

| Field | Jenis | Wajib | Peraturan |
|---|---|---|---|
| `device` | string | ✅ | `^[a-z0-9][a-z0-9-]{0,31}$` — ID logik nod |
| `uptime_ms` | integer | ✅ | ≥ 0. Masa hidup ESP sejak boot |
| `firmware` | string | ➖ | Versi semver; untuk diagnostik |
| `aps` | array | ✅ | 0–**20** item (had heap PRD §4) |
| `aps[].ssid` | string | ✅ | ≤ 32 bait UTF-8. SSID tersembunyi = `""` |
| `aps[].bssid` | string | ✅ | `^([0-9A-F]{2}:){5}[0-9A-F]{2}$` huruf besar |
| `aps[].rssi` | integer | ✅ | −100 … 0 dBm |
| `aps[].channel` | integer | ✅ | 1 … 196 (2.4 GHz 1–14; 5 GHz 32–196) |
| `aps[].enc` | enum | ✅ | `open` \| `wep` \| `wpa` \| `wpa2` \| `wpa3` \| `wpa2/wpa3` \| `unknown` |
| `macs` | array\<string\> | ✅ | 0–**200** item. MAC mentah untuk hashing server |

**Nota privasi MAC:** ESP menghantar MAC **mentah** melalui TLS yang dipin; server
meng-hash segera dengan `MAC_SALT` (SHA-256) dan **membuang** nilai mentah. MAC
mentah tidak pernah ditulis ke DB, log, atau respons. Hashing dibuat di server
(bukan ESP) supaya `MAC_SALT` kekal di luar repositori awam.

**Nota masa:** ESP8266 tanpa RTC tidak mempunyai masa boleh percaya. Oleh itu cap masa
**ditetapkan oleh server** (`received_at`). ESP tidak menghantar masa. Jika `uptime_ms`
menurun antara dua imbasan, server menganggap ESP reboot dan merekod `reboot` dalam
meta respons.

### 1.3 Respons — `201`

```json
{
  "data": {
    "scan_id": 42,
    "received_at": "2026-10-14T12:00:00.000Z",
    "aps_stored": 12,
    "macs_stored": 47,
    "new_aps": ["A4:2B:8C:91:F3:0F"],
    "reboot": false
  },
  "meta": { "ingest_lag_ms": 123 }
}
```

- `aps_stored` — bilangan baris `aps` dimasukkan (selepas dedup BSSID).
- `macs_stored` — bilangan MAC **unik** baharu/dikemas kini dalam `devices`.
- `new_aps` — BSSID yang **belum pernah** dilihat (untuk notifikasi Telegram).
  Dihadkan kepada 20 pertama.
- `ingest_lag_ms` — masa pemprosesan pelayan (diagnostik).

### 1.4 Ralat

| Kod | Bila |
|---|---|
| `400 bad_request` | JSON tidak sah, badan kosong |
| `401 invalid_token` | Token hilang/tidak sah |
| `413 payload_too_large` | > 64 KB |
| `422 validation_failed` | Field hilang, jenis salah, di luar julat. Respons termasuk `error.details[]` |
| `429 rate_limited` | < 10 s sejak ingest terakhir token ini |
| `500 internal_error` | Ralat DB/lain-lain |

`422` membawa butiran:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "1 field tidak sah",
    "details": [
      { "path": "aps[3].rssi", "issue": "di luar julat −100…0" }
    ]
  }
}
```

---

## 2. Access Points — `GET /api/v1/aps`

Senarai AP semasa, disusun mengikut isyarat.

### 2.1 Parameter

| Param | Default | Nilai | Maksud |
|---|---|---|---|
| `window` | `15m` | `5m` `15m` `1h` `6h` `24h` `7d` | Julat lihat-belakang |
| `sort` | `signal` | `signal` `last_seen` `ssid` `channel` | Isihan |
| `limit` | `50` | 1…200 | Bilangan maksimum baris |
| `include_stale` | `true` | `true` `false` | Sertakan AP yang hilang |

### 2.2 Respons — `200`

```json
{
  "data": [
    {
      "bssid": "A4:2B:8C:91:F3:0F",
      "ssid": "HomeNet",
      "channel": 6,
      "enc": "wpa2",
      "rssi": -51,
      "rssi_avg": -53.2,
      "rssi_min": -61,
      "rssi_max": -48,
      "sightings": 14,
      "first_seen": "2026-10-14T09:00:00.000Z",
      "last_seen": "2026-10-14T11:59:58.000Z",
      "age_s": 2,
      "stale": false
    }
  ],
  "meta": {
    "window": "15m",
    "count": 12,
    "stale_after_s": 90,
    "generated_at": "2026-10-14T12:00:00.000Z"
  }
}
```

- `rssi` — bacaan terkini; `rssi_avg/min/max` — agregat dalam window.
- `age_s` — saat sejak `last_seen`; **integer**.
- `stale` — `true` apabila `age_s > meta.stale_after_s`. AP yang hilang **ditanda**,
  bukan dipadam (PRD US-2). `stale_after_s` = 3× selang imbasan (3 × 30 s = 90 s).

---

## 3. Kesesakan Channel — `GET /api/v1/channels`

Kiraan AP per channel dalam window. Untuk memilih channel terbaik.

### 3.1 Parameter

| Param | Default | Nilai |
|---|---|---|
| `window` | `1h` | `5m` `15m` `1h` `6h` `24h` `7d` |
| `band` | `all` | `all` `2.4` `5` |

### 3.2 Respons — `200`

Sentiasa memulangkan **channel 1–14** (band `2.4`/`all`) walaupun kiraan sifar, supaya
graf bar stabil tanpa lompat.

```json
{
  "data": [
    { "channel": 1, "ap_count": 2, "avg_rssi": -72.0, "is_peak": false },
    { "channel": 6, "ap_count": 5, "avg_rssi": -58.4, "is_peak": true }
  ],
  "meta": {
    "window": "1h",
    "band": "all",
    "peak_channel": 6,
    "total_aps": 12,
    "threshold": 5,
    "generated_at": "2026-10-14T12:00:00.000Z"
  }
}
```

- `is_peak` — `true` pada **satu** channel sahaja (kiraan tertinggi; seri → channel
  terkecil menang, deterministik).
- `threshold` — ambang notifikasi Telegram (PRD US-6, default 5). Dihantar dalam meta
  supaya UI boleh tandakan channel yang melanggar tanpa hardcode.

---

## 4. Peranti — `GET /api/v1/devices`

Kiraan MAC unik mengikut masa.

### 4.1 Parameter

| Param | Default | Nilai |
|---|---|---|
| `window` | `24h` | `1h` `6h` `24h` `7d` `30d` |
| `bucket` | auto | `hour` `day` — auto: `hour` ≤ 48 j, selebihnya `day` |

### 4.2 Respons — `200`

```json
{
  "data": {
    "total_unique": 47,
    "peak": { "bucket": "2026-10-14T21:00:00.000Z", "unique": 63 },
    "buckets": [
      { "bucket": "2026-10-14T00:00:00.000Z", "unique": 3, "frames": 118 },
      { "bucket": "2026-10-14T01:00:00.000Z", "unique": 1, "frames": 22 }
    ]
  },
  "meta": {
    "window": "24h",
    "bucket": "hour",
    "caveat": "Kiraan adalah MAC unik, bukan bilangan orang. Randomisasi MAC iOS/Android boleh menaikkan kiraan.",
    "generated_at": "2026-10-14T12:00:00.000Z"
  }
}
```

- `buckets` — **satu entry bagi setiap bucket** dalam window, termasuk sifar (graf
  padat, tiada jurang).
- `total_unique` — bilangan `mac_hash` **berbeza** dalam window (bukan jumlah bucket).
- `meta.caveat` **wajib dipaparkan** oleh UI (PRD US-4). Dihantar bersama data supaya
  UI tidak boleh terlupa.
- MAC mentah tidak pernah hadir. `mac_hash` individu **tidak** didedahkan secara awam —
  hanya agregat.

---

## 5. Aliran Langsung — `GET /api/v1/events`

Server-Sent Events. Tolak data baharu tanpa muat semula (PRD US-2).

### 5.1 Header Respons

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

`X-Accel-Buffering: no` penting supaya nginx tidak menimbal (buffer) aliran.

### 5.2 Jenis Event

| Event | Bila | Data |
|---|---|---|
| `hello` | Segera selepas sambung | `{ "server_time": "...", "last_scan_id": 41 }` |
| `scan` | Selepas setiap ingest berjaya | Ringkasan scan (di bawah) |
| `heartbeat` | Setiap 25 s | `{ "ts": "..." }` |

```
event: hello
data: {"server_time":"2026-10-14T12:00:00.000Z","last_scan_id":41}

event: scan
data: {"scan_id":42,"received_at":"2026-10-14T12:00:30.000Z","ap_count":12,"unique_macs":47,"new_aps":1,"peak_channel":6}

event: heartbeat
data: {"ts":"2026-10-14T12:00:55.000Z"}
```

### 5.3 Semantik Klien

- Klien (dashboard) **mesti** guna `EventSource` dengan sambung-semula automatik.
- `heartbeat` tiada = sambungan mati → klien tutup dan sambung semula.
- `id:` tidak digunakan pada v1 (tiada replay). Klien yang sambung semula mengambil
  keadaan penuh melalui `GET /api/v1/aps` + `/channels` + `/devices`.
- Had: 50 klien serentak. Melebihi → `503` dengan `Retry-After`.

---

## 6. Pentadbiran — `/admin/*`

Di belakang **HTTP Basic auth** (`ADMIN_USER` / `ADMIN_PASS`). Bukan awam. Kegagalan →
`403 forbidden` (bukan 401, kerana skema auth berbeza daripada token peranti).

| Laluan | Kaedah | Fungsi |
|---|---|---|
| `/admin` | GET | Halaman status (HTML) |
| `/admin/api/status` | GET | Kesihatan nod, saiz DB, umur scan terakhir |
| `/admin/api/tokens` | GET | Senarai token peranti (hash sahaja) |
| `/admin/api/tokens` | POST | Putar token: `{ "device": "arsywatch-01" }` |
| `/admin/api/retention` | GET | Polisi semasa + kiraan baris |
| `/admin/api/retention` | POST | `{ "detail_days": 7, "aggregate_days": 30 }` |
| `/admin/api/telegram/test` | POST | Hantar alert ujian |
| `/admin/api/prune` | POST | Jalankan prune sekarang (di luar cron) |

### 6.1 Respons Status — `GET /admin/api/status`

```json
{
  "data": {
    "node_online": true,
    "last_scan": {
      "id": 42,
      "received_at": "2026-10-14T12:00:30.000Z",
      "age_s": 4,
      "device": "arsywatch-01",
      "firmware": "1.0.0"
    },
    "db": { "size_bytes": 184320, "scans": 2880, "aps": 34560 },
    "uptime_s": 86400,
    "telegram": { "configured": true, "last_sent": "2026-10-14T11:00:00.000Z" }
  },
  "meta": { "generated_at": "2026-10-14T12:00:34.000Z" }
}
```

`node_online` = `last_scan.age_s < 90`.

---

## 7. Lampiran — Contoh `curl`

```bash
# Ingest (ESP simulasi)
curl -sS -X POST https://api.arsy.example.com/api/v1/ingest \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device":"arsywatch-01","uptime_ms":1000,
    "aps":[{"ssid":"HomeNet","bssid":"A4:2B:8C:91:F3:0F","rssi":-51,"channel":6,"enc":"wpa2"}],
    "macs":["A4:2B:8C:91:F3:10"]
  }'

# AP semasa
curl -sS 'https://arsy.example.com/api/v1/aps?window=15m&sort=signal'

# Kesesakan channel
curl -sS 'https://arsy.example.com/api/v1/channels?window=1h'

# MAC unik 24 j
curl -sS 'https://arsy.example.com/api/v1/devices?window=24h&bucket=hour'

# SSE
curl -N 'https://arsy.example.com/api/v1/events'

# Admin
curl -sS -u "$ADMIN_USER:$ADMIN_PASS" 'https://arsy.example.com/admin/api/status'
```

---

## 8. Skema Pangkalan Data (SQLite)

Rujukan pelaksanaan untuk §1–§6. WAL mode; `synchronous = NORMAL`.

```sql
-- Satu kitaran imbasan = satu baris.
CREATE TABLE scans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  device       TEXT    NOT NULL,
  firmware     TEXT,
  received_at  INTEGER NOT NULL,          -- epoch ms (UTC)
  uptime_ms    INTEGER NOT NULL,
  reboot       INTEGER NOT NULL DEFAULT 0 -- 0/1
);
CREATE INDEX idx_scans_received_at ON scans(received_at);
CREATE INDEX idx_scans_device      ON scans(device, received_at);

-- Satu AP per imbasan.
CREATE TABLE aps (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id   INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  ssid      TEXT    NOT NULL,             -- "" jika tersembunyi
  bssid     TEXT    NOT NULL,
  rssi      INTEGER NOT NULL,
  channel   INTEGER NOT NULL,
  enc       TEXT    NOT NULL
);
CREATE INDEX idx_aps_scan_id ON aps(scan_id);
CREATE INDEX idx_aps_bssid   ON aps(bssid, scan_id);
CREATE INDEX idx_aps_channel ON aps(channel, scan_id);

-- Satu MAC unik seumur hayat (dipangkas ikut retention).
CREATE TABLE devices (
  mac_hash    TEXT    PRIMARY KEY,        -- SHA-256 hex
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  frame_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_devices_last_seen ON devices(last_seen);

-- Agregat unik per jam — kekal 30 hari walaupun detail dipangkas.
CREATE TABLE device_hours (
  hour_bucket INTEGER NOT NULL,           -- epoch ms, dipangkas ke jam
  mac_hash    TEXT    NOT NULL,
  frames      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hour_bucket, mac_hash)
) WITHOUT ROWID;
CREATE INDEX idx_device_hours_bucket ON device_hours(hour_bucket);

-- Snapshot terakhir kiraan channel (laluan pantas untuk paparan langsung).
-- Sejarah penuh dikira dari aps JOIN scans dalam window.
CREATE TABLE channels (
  channel    INTEGER PRIMARY KEY,
  ap_count   INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- Token peranti (hash sahaja; token mentah tidak disimpan).
CREATE TABLE device_tokens (
  device     TEXT    PRIMARY KEY,
  token_hash TEXT    NOT NULL,            -- SHA-256 hex token mentah
  created_at INTEGER NOT NULL,
  last_seen  INTEGER
);

-- AP yang pernah dilihat (untuk kesan "AP baharu" + anti-spam Telegram).
CREATE TABLE ap_registry (
  bssid       TEXT    PRIMARY KEY,
  ssid        TEXT    NOT NULL,
  first_seen  INTEGER NOT NULL,
  last_alert  INTEGER
);

-- Kunci-nilai konfigurasi (polisi retention, dsb.).
CREATE TABLE config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### 8.1 Sisihan daripada PRD §4

PRD menyenaraikan empat jadual (`scans`, `aps`, `devices`, `channels`). Pelaksanaan
menambah **empat** jadual dan dua lajur:

| Tambahan | Sebab |
|---|---|
| `device_hours` | PRD minta "kiraan unik per jam" (US-4) **dan** retention 30 hari agregat, tetapi skema 4-jadual tidak boleh membina unik per jam selepas detail dipangkas. |
| `device_tokens` | Token peranti mesti disimpan sebagai hash, bukan dalam `.env` tunggal, supaya putaran token (`/admin`) berfungsi tanpa restart. |
| `ap_registry` | Kesan "AP baharu" (US-6) + anti-spam 1 jam memerlukan memori BSSID yang terselamat daripada prune detail. |
| `config` | Polisi retention boleh diubah dari `/admin` tanpa edit fail. |
| `scans.firmware`, `scans.reboot` | Diagnostik (§1.2) — penting apabila nod di lapangan. |

Tiada jadual PRD dibuang atau dinamakan semula.

### 8.2 Retention (PRD §4)

| Data | Simpan | Mekanisme |
|---|---|---|
| `scans`, `aps` (detail) | 7 hari | Prune harian (cron 03:00 tempatan) |
| `device_hours` (agregat) | 30 hari | Prune harian |
| `devices` | 30 hari (ikut `last_seen`) | Prune harian |
| `ap_registry` | 90 hari (ikut `first_seen`) | Prune harian |
| `channels` | Semasa sahaja | Ditulis ganti setiap ingest |
| `config`, `device_tokens` | Kekal | — |

Prune dijalankan dalam satu transaksi; `VACUUM` mingguan sahaja (mahal).

---

## 9. Perubahan Akan Datang

Kontrak ini **beku** untuk v1. Perubahan berikut dirancang untuk v2 (selepas ship):

- Berbilang nod ESP (kini `device` wujud dalam skema tetapi UI andaikan satu nod)
- Replay SSE dengan `Last-Event-ID`
- Eksport CSV (PRD §5 *"Kedalaman"*)
- Carian OUI vendor (kini Non-Goal)

Semua perubahan v1 mesti **tambahan sahaja** (field baharu, bukan penamaan semula).
