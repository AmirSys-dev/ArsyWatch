# Deploy ArsyWatch ke VPS (AWS, 2 vCPU / 1GB RAM)

> Semua fail dalam folder ini dijalankan **di VPS**, bukan di laptop.
> Belum diuji pada VPS sebenar — ini persediaan, bukan pengesahan.

---

## Bentuk keseluruhan

```
                    ┌──────────────────────── VPS (2 vCPU / 1GB) ────────────────────────┐
                    │                                                                     │
  Pelayar ──HTTPS──►│ nginx ──fail statik──► /var/www/arsywatch/out/   (dashboard)        │
  (443)             │   │                                                                 │
                    │   └──/api/──► 127.0.0.1:8787  Express + SQLite  (arsywatch.service) │
                    │                                                                     │
  ESP8266 ──HTTPS──►│ nginx ──/api/v1/ingest──► 127.0.0.1:8787                           │
  (443, cert dipin) │   (server_name api.<domain>)                                        │
                    └─────────────────────────────────────────────────────────────────────┘
```

Dua nama hos, dua sijil, satu proses Express:

| Nama hos | Sijil | Untuk |
|---|---|---|
| `<domain>` | Let's Encrypt (dipercayai pelayar) | Dashboard awam + API baca |
| `api.<domain>` | Self-signed, **fingerprint dipin pada ESP** | Ingest ESP sahaja |

Sebab dipisahkan: renewal Let's Encrypt setiap ~60 hari akan menukar fingerprint, dan
kalau ESP bergantung pada sijil itu, ingest akan mati senyap. PRD §4 "Dua sijil, dua peranan".

---

## Langkah deploy

### 1. Sediakan VPS (sekali sahaja)

```bash
# sebagai root atau user dengan sudo
apt update && apt upgrade -y
apt install -y nginx certbot python3-certbot-nginx curl build-essential

# Node 20 LTS (better-sqlite3 perlu compiler untuk native module)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# user servis tanpa login
useradd --system --home /var/lib/arsywatch --shell /usr/sbin/nologin arsywatch
mkdir -p /var/lib/arsywatch /var/www/arsywatch
chown -R arsywatch:arsywatch /var/lib/arsywatch
```

### 2. Hantar kod

```bash
# dari laptop
scp -r server arsywatch@<VPS_IP>:/opt/arsywatch/
# dashboard/out/ dihantar selepas `npm run build` (lihat bawah)
scp -r dashboard/out arsywatch@<VPS_IP>:/var/www/arsywatch/
```

### 3. Bina dashboard (di laptop, bukan VPS)

```bash
cd dashboard
npm ci
npm run build          # output: dashboard/out/
```

Eksport statik — VPS tidak jalankan Node untuk dashboard langsung.

### 4. Pasang dependensi server (di VPS)

```bash
cd /opt/arsywatch/server
npm ci --omit=dev
```

### 5. Konfigurasi `.env` (di VPS)

```bash
cp .env.example .env
# edit, kemudian kunci kebenaran
chmod 600 .env
chown arsywatch:arsywatch .env
```

Jana nilai rahsia yang kuat:

```bash
# MAC_SALT — WAJIB kuat. Hanya ~2^48 MAC wujud, jadi salt lemah boleh di-brute-force.
openssl rand -hex 32

# DEVICE_TOKEN
openssl rand -base64 32

# ADMIN_PASS
openssl rand -base64 24
```

### 6. systemd

```bash
cp deploy/systemd/arsywatch.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now arsywatch
systemctl status arsywatch
journalctl -u arsywatch -f
```

### 7. nginx

```bash
cp deploy/nginx/arsywatch.conf /etc/nginx/sites-available/arsywatch
# ganti <domain> dengan domain sebenar
sed -i 's/<domain>/DOMAIN_ANDA/g' /etc/nginx/sites-available/arsywatch
ln -s /etc/nginx/sites-available/arsywatch /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 8. Sijil

```bash
# Dashboard: Let's Encrypt
certbot --nginx -d DOMAIN_ANDA

# Ingest: self-signed, sah 10 tahun (ESP pin fingerprint, bukan CA)
mkdir -p /etc/ssl/arsywatch
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout /etc/ssl/arsywatch/api.key \
  -out /etc/ssl/arsywatch/api.crt \
  -subj "/CN=api.DOMAIN_ANDA"

# fingerprint SHA-1 untuk dimasukkan ke firmware secrets.h
openssl x509 -in /etc/ssl/arsywatch/api.crt -noout -fingerprint -sha1
```

### 9. Cron prune

Prune sudah berjalan dalam proses Express (`src/prune.js`, `schedulePrune`). Tiada
cron OS diperlukan. Ia dijadual sendiri setiap hari pada `PRUNE_HOUR` (default 03:00).

---

## Pengesahan selepas deploy

```bash
# 1. Express hidup?
curl -s localhost:8787/api/v1/health

# 2. nginx hantar dashboard?
curl -sI https://DOMAIN_ANDA | head -1        # harap: HTTP/2 200

# 3. API melalui nginx?
curl -s https://DOMAIN_ANDA/api/v1/aps

# 4. SSE tidak dibuffer? (perlu kekal terbuka, cetak event)
curl -N https://DOMAIN_ANDA/api/v1/events
#    kalau ia tergantung tanpa cetak 'event: hello', proxy_buffering masih on

# 5. Ingest menolak token salah?
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://api.DOMAIN_ANDA/api/v1/ingest -H 'Authorization: Bearer wrong' -d '{}'
#    harap: 401

# 6. Ingest terima token betul? (guna token sebenar dari .env)
curl -s -X POST https://api.DOMAIN_ANDA/api/v1/ingest \
  -H "Authorization: Bearer $DEVICE_TOKEN" -H 'Content-Type: application/json' \
  -d '{"device":"arsywatch-01","uptime_ms":1,"aps":[],"macs":[]}'
#    harap: 201

# 7. Memori (kekal bawah ~100MB)
systemctl status arsywatch | grep Memory
```

---

## Beban memori yang dijangkakan

| Proses | RSS |
|---|---|
| Express + better-sqlite3 | 60–80 MB |
| nginx | ~10 MB |
| Dashboard | 0 MB (fail statik) |
| **Jumlah** | **~90 MB / 1024 MB** |

Kalau Express melebihi 150MB, itu tanda bug (kemungkinan besar kebocoran dalam SSE hub).

---

## Perkara yang perlu diberi perhatian

1. **`MAC_SALT` mesti kuat.** Hanya ~2^48 MAC wujud — salt lemah bermakna hash boleh
   di-brute-force. Server **enggan mula** dalam production kalau salt tidak selamat.
2. **Fingerprint sijil berubah kalau sijil dijana semula.** Kalau `api.crt` dijana
   semula, ESP mesti di-flash semula dengan fingerprint baharu.
3. **`proxy_buffering off` wajib** untuk `/api/v1/events`. Tanpa itu SSE tersekat dan
   dashboard nampak beku walaupun data sampai.
4. **Firewall:** buka 80, 443, 22 sahaja. Express di 8787 hanya localhost — jangan
   dedahkan terus.
