// ArsyWatch firmware — non-secret tunables.
//
// Anything credential-shaped lives in include/secrets.h (gitignored). This
// header is safe to commit and holds only the constants that describe the
// scan/publish behaviour, all traceable to docs/api.md and ArsyWatch-PRD.md.
#pragma once

#include <stdint.h>

// --- identity ---------------------------------------------------------------
// semver, sent as `firmware` (docs/api.md §1.2 — diagnostic only).
#define AW_FIRMWARE_VERSION "1.0.0"

// --- cadence ----------------------------------------------------------------
// One scan cycle = one ingest. HTTPS on ESP8266 costs ~1-2s, so the PRD fixes
// the interval at 30s (not 5s) — ArsyWatch-PRD.md §Had Teknikal ESP8266.
#define AW_SCAN_INTERVAL_MS 30000UL

// --- promiscuous capture ----------------------------------------------------
// Promiscuous mode hears one channel at a time, so we hop. Dwell ~300ms per
// channel (ArsyWatch-PRD.md US-1). 13 channels × 300ms ≈ 3.9s, well inside 30s.
#define AW_CHANNEL_FIRST 1
#define AW_CHANNEL_LAST 13        // 2.4 GHz only; ESP8266 physically cannot see 5 GHz
#define AW_CHANNEL_DWELL_MS 300

// --- contract caps (docs/api.md §1.2) ---------------------------------------
#define AW_MAX_APS 20             // aps array max 20
#define AW_MAX_MACS 200           // macs array max 200

// --- network / TLS ----------------------------------------------------------
#define AW_CONNECT_TIMEOUT_MS 15000UL
#define AW_HTTP_TIMEOUT_MS 12000UL

// BearSSL buffer sizes. The library default is 16384/512 ≈ 17 KB of heap, which
// is most of our ~40 KB budget. The ingest response is < 1 KB, so shrink the
// receive window hard. (setBufferSizes clamps to a 512 floor.)
#define AW_TLS_RX_BUF 2048
#define AW_TLS_TX_BUF 512

// --- safety -----------------------------------------------------------------
// Below this, skip the cycle's POST rather than risk an OOM reboot mid-TLS.
#define AW_MIN_FREE_HEAP 12000

// --- ingest path (docs/api.md §1) -------------------------------------------
#define AW_INGEST_PATH "/api/v1/ingest"
