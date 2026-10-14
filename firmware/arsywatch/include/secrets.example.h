// ArsyWatch firmware — secrets TEMPLATE.
//
// Copy this file to include/secrets.h and fill in real values. secrets.h is
// listed in .gitignore and must never be committed. main.cpp pulls in
// secrets.h when present and silently falls back to this template otherwise,
// so the project always compiles (with placeholder values) on a fresh clone.
#pragma once

// --- WiFi (2.4 GHz only) ----------------------------------------------------
#define WIFI_SSID "your-2.4ghz-ssid"
#define WIFI_PASS "your-wifi-password"

// --- ingest endpoint --------------------------------------------------------
// nginx terminates TLS in front of Express; the ESP pins the cert below.
#define API_HOST "api.arsy.example.com"
#define API_PORT 443

// --- device identity --------------------------------------------------------
// Must match ^[a-z0-9][a-z0-9-]{0,31}$ (docs/api.md §1.2).
#define DEVICE_ID "arsywatch-01"

// Bearer token for POST /api/v1/ingest. The server stores only its SHA-256.
#define DEVICE_TOKEN "replace-with-provisioned-device-token"

// --- pinned certificate fingerprint ----------------------------------------
// SHA-1 fingerprint of the ingest leaf certificate, 20 bytes. Accepts either
// colon- or space-separated hex. Generate it on the VPS with:
//
//   openssl s_client -connect api.arsy.example.com:443 </dev/null 2>/dev/null
//   (pipe the output through: openssl x509 -noout -fingerprint -sha1)
//
// The firmware calls setFingerprint() with this value and NEVER setInsecure().
// If it does not match, the handshake fails closed (no data is sent).
#define API_CERT_FINGERPRINT "00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00"
