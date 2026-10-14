// ArsyWatch firmware — ESP8266 WiFi air monitor (Fasa 1)
// Stardance Challenge 2026
//
// Contract: docs/api.md §1.2 (FROZEN). Field names, types and ranges below are
// copied from that document; the server validator (server/src/validate.js) is
// the authority and this file must never drift from it.
//
// ---------------------------------------------------------------------------
// HARDWARE FACTS THIS CODE IS BUILT AROUND (verified against the installed
// NONOS SDK headers, not assumed):
//
//  1. The ESP8266 is 2.4 GHz only. It physically cannot hear 5 GHz, so channels
//     never exceed 13 here. (docs/api.md allows 1..196 for 5 GHz radios; ours
//     never emits those.)
//
//  2. The promiscuous callback signature is `void(*)(uint8 *buf, uint16 len)`
//     (tools/sdk/include/user_interface.h). RSSI is a PHY-layer value and is
//     NOT part of the 802.11 frame bytes. The ESP8266 NONOS SDK defines no
//     `rx_ctrl` / `wifi_promiscuous_pkt_t` — that is an ESP32 feature. So a
//     beacon parsed from the promiscuous buffer gives ssid/bssid/channel/enc,
//     but NOT rssi.
//
//     The contract REQUIRES `rssi` as an integer in -100..0. The only real RSSI
//     source on this chip is the managed scan (`WiFi.RSSI(i)`). We therefore
//     take the AP list from the managed scan and use beacon parsing to enrich
//     it (real SSID for hidden APs, WPA3 detection the scan cannot see). We
//     never fabricate an RSSI: an AP with no measured signal is not emitted.
//
//  3. Free heap is ~40-50 KB and BearSSL defaults to a 16 KB receive buffer.
//     We shrink the TLS window and guard the heap before every POST.
//
//  4. Promiscuous mode hears one channel at a time, so we hop 1..13.
// ---------------------------------------------------------------------------

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <WiFiClientSecureBearSSL.h>
#include <user_interface.h>   // wifi_promiscuous_*, wifi_set_channel

#include "config.h"

// Real secrets win; the committed template keeps a fresh clone compiling.
// The placeholder path is announced at runtime (setup()) rather than with a
// #warning, so a fresh clone still builds with zero compiler warnings.
#if __has_include("secrets.h")
#include "secrets.h"
#define AW_SECRETS_PLACEHOLDER 0
#else
#include "secrets.example.h"
#define AW_SECRETS_PLACEHOLDER 1
#endif

// ===========================================================================
// Encryption model (docs/api.md §1.2 enc enum)
// ===========================================================================
enum : uint8_t {
  ENC_OPEN = 0,
  ENC_WEP,
  ENC_WPA,
  ENC_WPA2,
  ENC_WPA3,
  ENC_WPA2_WPA3,
  ENC_UNKNOWN,
};

static const char *const ENC_STR[] = {
    "open", "wep", "wpa", "wpa2", "wpa3", "wpa2/wpa3", "unknown",
};

// ===========================================================================
// Capture state. Written by the promiscuous callback, read by the main loop
// only after promiscuous mode is disabled (a barrier enforced in
// runPromiscuousCapture()).
// ===========================================================================

// APs seen in BEACON frames. Bounded: 32 * ~48B ≈ 1.5 KB.
struct BeaconAp {
  uint8_t bssid[6];
  char    ssid[33];
  uint8_t ssidLen;
  uint8_t channel;
  uint8_t enc;
};

static BeaconAp g_beaconAps[32];
static uint8_t  g_beaconApCount;

// Unique source MACs from PROBE REQUEST frames. 200 * 6B = 1.2 KB.
static uint8_t  g_macs[AW_MAX_MACS][6];
static uint16_t g_macCount;

// Channel currently being sniffed. Owned by the main loop (runPromiscuousCapture)
// and read by the ISR, so a corrupt/absent DS Parameter Set still lands on the
// right channel without an SDK call from interrupt context.
static volatile uint8_t g_currentChannel = AW_CHANNEL_FIRST;

// Published AP list (merged from managed scan + beacons). ≤ 20 entries.
struct ApOut {
  char     ssid[33];
  uint8_t  ssidLen;
  uint8_t  bssid[6];
  int16_t  rssi;
  uint8_t  channel;
  uint8_t  enc;
};

static ApOut   g_apOut[AW_MAX_APS];
static uint8_t g_apOutCount;

// Monotonic uptime that survives millis() wrapping at ~49 days.
static uint64_t g_uptimeMs = 0;
static uint32_t g_lastMillis = 0;

// ===========================================================================
// Small helpers (used from both IRAM and normal context)
// ===========================================================================
static inline bool macEq(const uint8_t *a, const uint8_t *b) {
  for (uint8_t i = 0; i < 6; i++)
    if (a[i] != b[i]) return false;
  return true;
}

static inline bool macIsMulticast(const uint8_t *m) { return (m[0] & 0x01) != 0; }

static inline bool macIsZero(const uint8_t *m) {
  for (uint8_t i = 0; i < 6; i++)
    if (m[i]) return false;
  return true;
}

// ===========================================================================
// Promiscuous-mode 802.11 parser — MUST be IRAM-safe: no String, no printf,
// no allocation, bounded work. All helpers below are IRAM_ATTR.
// ===========================================================================

// Append a MAC if unseen. Returns silently when the cap is reached.
static IRAM_ATTR void macAdd(const uint8_t *mac) {
  if (g_macCount >= AW_MAX_MACS) return;
  if (macIsZero(mac) || macIsMulticast(mac)) return;
  for (uint16_t i = 0; i < g_macCount; i++)
    if (macEq(g_macs[i], mac)) return;
  for (uint8_t k = 0; k < 6; k++) g_macs[g_macCount][k] = mac[k];
  g_macCount++;
}

// Insert/update a beacon-derived AP, keyed by BSSID.
static IRAM_ATTR void beaconAdd(const uint8_t *bssid, const uint8_t *ssid,
                                uint8_t ssidLen, uint8_t channel, uint8_t enc) {
  for (uint8_t i = 0; i < g_beaconApCount; i++) {
    if (macEq(g_beaconAps[i].bssid, bssid)) {
      // Refresh: a later, complete beacon may fill in what an earlier one missed.
      if (ssidLen && !g_beaconAps[i].ssidLen) {
        for (uint8_t k = 0; k < ssidLen && k < 32; k++)
          g_beaconAps[i].ssid[k] = (char)ssid[k];
        g_beaconAps[i].ssidLen = ssidLen;
      }
      if (channel) g_beaconAps[i].channel = channel;
      if (enc != ENC_UNKNOWN) g_beaconAps[i].enc = enc;
      return;
    }
  }
  if (g_beaconApCount >= (sizeof(g_beaconAps) / sizeof(g_beaconAps[0]))) return;
  BeaconAp &a = g_beaconAps[g_beaconApCount];
  for (uint8_t k = 0; k < 6; k++) a.bssid[k] = bssid[k];
  uint8_t n = ssidLen > 32 ? 32 : ssidLen;
  for (uint8_t k = 0; k < n; k++) a.ssid[k] = (char)ssid[k];
  a.ssidLen = n;
  a.channel = channel;
  a.enc = enc;
  g_beaconApCount++;
}

// Does an RSN IE advertise SAE (WPA3) and/or PSK (WPA2)? AKM suite = 00:0F:AC:xx
// Offsets are 32-bit so a corrupt, absurdly long pairwise-cipher list cannot
// wrap the running offset and desync the parse.
static IRAM_ATTR void rsnAkms(const uint8_t *ie, uint8_t len, bool &psk, bool &sae) {
  psk = sae = false;
  if (len < 2 + 4 + 2) return;
  uint32_t off = 2 + 4;                                  // version + group cipher
  uint32_t pwCount = ie[off] | (ie[off + 1] << 8);       // pairwise count
  off += 2 + pwCount * 4;
  if (off + 2 > len) return;
  uint32_t akCount = ie[off] | (ie[off + 1] << 8);
  off += 2;
  for (uint32_t i = 0; i < akCount; i++) {
    if (off + 4 > len) return;
    if (ie[off] == 0x00 && ie[off + 1] == 0x0F && ie[off + 2] == 0xAC) {
      if (ie[off + 3] == 2) psk = true;   // PSK
      if (ie[off + 3] == 8) sae = true;   // SAE
    }
    off += 4;
  }
}

// Walk the tagged parameters of a management frame and derive SSID/channel/enc.
static IRAM_ATTR void parseIes(const uint8_t *ie, uint16_t len, uint8_t &channel,
                               uint8_t &enc, const uint8_t *&ssid, uint8_t &ssidLen,
                               bool privacy) {
  channel = 0;
  ssid = nullptr;
  ssidLen = 0;
  bool hasRsn = false, hasWpa = false, psk = false, sae = false;

  uint16_t i = 0;
  while (i + 2 <= len) {
    uint8_t id = ie[i];
    uint8_t l = ie[i + 1];
    if (i + 2 + l > len) break;             // truncated IE — stop
    const uint8_t *body = ie + i + 2;

    if (id == 0) {                          // SSID
      ssid = body;
      ssidLen = l > 32 ? 32 : l;
    } else if (id == 3 && l >= 1) {         // DS Parameter Set -> channel
      channel = body[0];
    } else if (id == 48) {                  // RSN -> WPA2/WPA3
      hasRsn = true;
      rsnAkms(body, l, psk, sae);
    } else if (id == 221 && l >= 4) {       // Vendor specific -> WPA1
      if (body[0] == 0x00 && body[1] == 0x50 && body[2] == 0xF2 && body[3] == 0x01)
        hasWpa = true;
    }
    i += 2 + l;
  }

  if (hasRsn) {
    if (sae && psk)      enc = ENC_WPA2_WPA3;
    else if (sae)        enc = ENC_WPA3;
    else                 enc = ENC_WPA2;
  } else if (hasWpa) {
    enc = ENC_WPA;
  } else if (privacy) {
    enc = ENC_WEP;
  } else {
    enc = ENC_OPEN;
  }
}

// Parse one captured 802.11 frame. We only care about management frames:
//   subtype 4 = PROBE REQUEST  -> source MAC for unique-device counting
//   subtype 8 = BEACON         -> AP metadata
//   subtype 5 = PROBE RESPONSE -> also AP metadata (helps fill the table)
static IRAM_ATTR void parseMgmt(const uint8_t *buf, uint16_t len) {
  if (len < 24) return;

  uint16_t fc = buf[0] | (buf[1] << 8);
  uint8_t type = (fc >> 2) & 0x3;
  uint8_t subtype = (fc >> 4) & 0xF;
  if (type != 0) return;                    // management only

  const uint8_t *addr1 = buf + 4;           // RA / DA
  const uint8_t *addr2 = buf + 10;          // TA / SA
  const uint8_t *addr3 = buf + 16;          // BSSID (beacon/probe-resp)

  if (subtype == 4) {                       // probe request
    macAdd(addr2);
    return;
  }

  if (subtype == 8 || subtype == 5) {       // beacon / probe response
    if (len < 36) return;
    uint16_t cap = buf[34] | (buf[35] << 8);
    bool privacy = (cap & 0x0010) != 0;
    uint8_t channel = 0, enc = ENC_UNKNOWN;
    const uint8_t *ssid = nullptr;
    uint8_t ssidLen = 0;
    parseIes(buf + 36, (uint16_t)(len - 36), channel, enc, ssid, ssidLen, privacy);
    if (channel < 1 || channel > 14) channel = g_currentChannel;  // no DS IE / bogus
    beaconAdd(addr3, ssid, ssidLen, channel, enc);
    (void)addr1;
  }
}

static IRAM_ATTR void promiscuousCb(uint8_t *buf, uint16_t len) {
  if (!buf || len < 24) return;
  parseMgmt(buf, len);
}

// ===========================================================================
// WiFi lifecycle — never blocks forever (docs/api.md §1.2 requirement)
// ===========================================================================
static bool waitForConnect(uint32_t timeoutMs) {
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - t0 > timeoutMs) return false;
    ESP.wdtFeed();
    delay(50);
  }
  return true;
}

static bool ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  Serial.printf("[wifi] connecting to \"%s\"\n", WIFI_SSID);
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  if (waitForConnect(AW_CONNECT_TIMEOUT_MS)) {
    Serial.printf("[wifi] up: %s rssi=%d dBm ch=%u\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI(),
                  (unsigned)WiFi.channel());
    return true;
  }
  Serial.println("[wifi] connect timed out - will retry next cycle");
  return false;
}

// ===========================================================================
// Phase A — managed scan: the only real RSSI source on this chip.
// ===========================================================================
static uint8_t scanEncToEnum(uint8_t t) {
  switch (t) {
    case ENC_TYPE_NONE: return ENC_OPEN;
    case ENC_TYPE_WEP:  return ENC_WEP;
    case ENC_TYPE_TKIP: return ENC_WPA;
    case ENC_TYPE_CCMP: return ENC_WPA2;
    case ENC_TYPE_AUTO: return ENC_WPA2;   // WPA/WPA2 mixed: report strongest
    default:            return ENC_UNKNOWN;
  }
}

static void runManagedScan() {
  g_apOutCount = 0;

  int8_t n = WiFi.scanNetworks(/*async=*/false, /*show_hidden=*/true);
  if (n == WIFI_SCAN_FAILED || n < 0) {
    Serial.println("[scan] managed scan failed");
    WiFi.scanDelete();
    return;
  }
  Serial.printf("[scan] %d APs\n", (int)n);

  for (int8_t i = 0; i < n && g_apOutCount < AW_MAX_APS; i++) {
    int32_t rssi = WiFi.RSSI(i);
    if (rssi < -100) rssi = -100;          // clamp to the contract range
    if (rssi > 0)    rssi = 0;

    uint8_t *bssid = WiFi.BSSID(i);
    if (!bssid) continue;

    ApOut &ap = g_apOut[g_apOutCount];
    for (uint8_t k = 0; k < 6; k++) ap.bssid[k] = bssid[k];
    ap.rssi = (int16_t)rssi;
    int32_t ch = WiFi.channel(i);
    ap.channel = (ch >= 1 && ch <= 14) ? (uint8_t)ch : 1;
    ap.enc = scanEncToEnum(WiFi.encryptionType(i));

    String s = WiFi.SSID(i);
    ap.ssidLen = s.length() > 32 ? 32 : (uint8_t)s.length();
    for (uint8_t k = 0; k < ap.ssidLen; k++) ap.ssid[k] = s[k];
    ap.ssid[ap.ssidLen] = '\0';
    g_apOutCount++;
  }
  WiFi.scanDelete();   // release the SDK scan buffer before we grab TLS buffers
}

// Fold this cycle's beacon observations into the published AP list. Runs AFTER
// runPromiscuousCapture() so it sees the SAME cycle's beacons (capture clears the
// table at its start, so enriching before it would use the previous cycle's data).
// Matched strictly by BSSID - a beacon never invents an AP the scan did not see.
static void enrichFromBeacons() {
  for (uint8_t i = 0; i < g_apOutCount; i++) {
    for (uint8_t b = 0; b < g_beaconApCount; b++) {
      if (!macEq(g_apOut[i].bssid, g_beaconAps[b].bssid)) continue;
      // Real SSID for an AP the scan reported as hidden.
      if (g_apOut[i].ssidLen == 0 && g_beaconAps[b].ssidLen) {
        g_apOut[i].ssidLen = g_beaconAps[b].ssidLen;
        for (uint8_t k = 0; k < g_apOut[i].ssidLen; k++)
          g_apOut[i].ssid[k] = g_beaconAps[b].ssid[k];
        g_apOut[i].ssid[g_apOut[i].ssidLen] = '\0';
      }
      // WPA3 only appears in the RSN IE, never in the scan's encryption enum.
      uint8_t be = g_beaconAps[b].enc;
      if (be == ENC_WPA3 || be == ENC_WPA2_WPA3) g_apOut[i].enc = be;
      if (g_beaconAps[b].channel && g_beaconAps[b].channel <= 14)
        g_apOut[i].channel = g_beaconAps[b].channel;
      break;
    }
  }
}

// ===========================================================================
// Phase B — promiscuous channel hop for probe-request MACs (and beacons).
// ===========================================================================
static void runPromiscuousCapture() {
  g_macCount = 0;
  g_beaconApCount = 0;

  // Hopping calls wifi_set_channel(), which pulls the radio off the AP's channel
  // and tears the STA association. We therefore bracket the sniff with an
  // explicit disconnect/reconnect instead of leaving the link half-dead and
  // hoping ensureWifi() notices: the reconnect is charged to this function, not
  // to the next cycle's budget, so a slow re-join cannot silently eat a cycle.
  // Sniff is ~3.9s (13 x 300ms) inside a 30s budget, so the headroom is ample.
  const bool wasConnected = (WiFi.status() == WL_CONNECTED);
  if (wasConnected) WiFi.disconnect(false /* keep radio on, keep creds */);

  wifi_set_promiscuous_rx_cb(promiscuousCb);
  wifi_promiscuous_enable(1);

  for (uint8_t ch = AW_CHANNEL_FIRST; ch <= AW_CHANNEL_LAST; ch++) {
    g_currentChannel = ch;      // ISR reads this to label frames with no DS IE
    wifi_set_channel(ch);
    uint32_t t0 = millis();
    while (millis() - t0 < AW_CHANNEL_DWELL_MS) {
      ESP.wdtFeed();
      delay(10);
    }
  }

  wifi_promiscuous_enable(0);
  wifi_set_promiscuous_rx_cb(nullptr);
  delay(20);   // let any in-flight callback finish before we read the tables

  Serial.printf("[sniff] %u macs, %u beacon-aps\n",
                (unsigned)g_macCount, (unsigned)g_beaconApCount);

  // Rejoin before publishing. ensureWifi() in loop() is still a safety net, but
  // the association is expected to be gone by this point, so we restore it here.
  if (wasConnected && WiFi.status() != WL_CONNECTED) {
    Serial.println("[sniff] rejoining after hop");
    ensureWifi();
  }
}

// ===========================================================================
// Streaming JSON writer — HTTP/1.1 chunked transfer encoding.
//
// The body is never assembled in one buffer: each fragment is emitted as its
// own chunk. This keeps peak RAM at a few hundred bytes regardless of how many
// APs or MACs are in the payload (docs/api.md heap note / PRD §Had Teknikal).
// ===========================================================================
static bool chunkWrite(WiFiClientSecure &c, const char *data, size_t len) {
  char hdr[10];
  int hn = snprintf(hdr, sizeof(hdr), "%x\r\n", (unsigned)len);
  if (c.write((const uint8_t *)hdr, hn) != (size_t)hn) return false;
  if (len && c.write((const uint8_t *)data, len) != len) return false;
  if (c.write((const uint8_t *)"\r\n", 2) != 2) return false;
  return true;
}

static bool chunkWriteStr(WiFiClientSecure &c, const char *s) {
  return chunkWrite(c, s, strlen(s));
}

// Emit the terminating zero-length chunk. This MUST be written raw, never
// through chunkWrite(): passing "0\r\n\r\n" to chunkWrite() wraps it as a
// 5-byte DATA chunk, so the server never sees a terminator and the request
// hangs until timeout. Verified: the double-encoded form produces no HTTP
// response at all; the raw form returns 201.
static bool chunkTerminate(WiFiClientSecure &c) {
  return c.write((const uint8_t *)"0\r\n\r\n", 5) == 5;
}

// Escape a JSON string body into dst; returns bytes written (always NUL-terminated).
//
// Output is restricted to printable ASCII. 802.11 SSIDs are ARBITRARY BYTES, and
// the server measures Buffer.byteLength(ssid, 'utf8') AFTER express decodes the
// body — so an invalid UTF-8 byte becomes U+FFFD (3 bytes on re-encode). A 32-byte
// SSID of 0xFF would decode to 96 bytes, trip the server's 32-byte cap, and 422
// the ENTIRE scan cycle — every AP and every MAC — because of one neighbour.
// Emitting ASCII only keeps byte-length == character-length, so 32 bytes stays 32.
// Non-printable / non-ASCII bytes become '?' rather than risking a dropped cycle.
static size_t jsonEscape(char *dst, size_t cap, const char *src, size_t srcLen) {
  if (cap == 0) return 0;
  size_t o = 0;
  for (size_t i = 0; i < srcLen && o + 2 < cap; i++) {
    uint8_t ch = (uint8_t)src[i];
    switch (ch) {
      case '"':  dst[o++] = '\\'; dst[o++] = '"';  break;
      case '\\': dst[o++] = '\\'; dst[o++] = '\\'; break;
      case '\n': dst[o++] = '\\'; dst[o++] = 'n';  break;
      case '\r': dst[o++] = '\\'; dst[o++] = 'r';  break;
      case '\t': dst[o++] = '\\'; dst[o++] = 't';  break;
      default:
        // Keep printable ASCII as-is; anything else becomes '?'.
        dst[o++] = (ch >= 0x20 && ch <= 0x7E) ? (char)ch : '?';
    }
  }
  dst[o] = '\0';
  return o;
}

static void macToStr(const uint8_t *m, char *out) {   // out must be >= 18 bytes
  snprintf(out, 18, "%02X:%02X:%02X:%02X:%02X:%02X", m[0], m[1], m[2], m[3], m[4], m[5]);
}

// ===========================================================================
// Phase C — publish one scan cycle to /api/v1/ingest
// ===========================================================================
static bool publishScan() {
  if (ESP.getFreeHeap() < AW_MIN_FREE_HEAP) {
    Serial.printf("[post] skipped: heap %u < %u\n",
                  (unsigned)ESP.getFreeHeap(), (unsigned)AW_MIN_FREE_HEAP);
    return false;
  }

  BearSSL::WiFiClientSecure client;
  client.setBufferSizes(AW_TLS_RX_BUF, AW_TLS_TX_BUF);   // ~2.5 KB, not 16 KB
  // Stream::setTimeout takes MILLISECONDS (cores/esp8266/Stream.h). Dividing by
  // 1000 here made it 12 ms, which aborts the TCP connect on any real-world RTT.
  client.setTimeout(AW_HTTP_TIMEOUT_MS);

  // Certificate fingerprint pinning. NEVER setInsecure().
  // A placeholder / wrong fingerprint makes the handshake fail closed.
  if (!client.setFingerprint(API_CERT_FINGERPRINT)) {
    Serial.println("[post] fingerprint string invalid - aborting");
    return false;
  }

  Serial.printf("[post] connecting %s:%d\n", API_HOST, (int)API_PORT);
  if (!client.connect(API_HOST, API_PORT)) {
    Serial.println("[post] TLS connect failed (cert pin mismatch or no network)");
    return false;
  }

  // --- request line + headers ---
  client.printf("POST %s HTTP/1.1\r\n", AW_INGEST_PATH);
  client.printf("Host: %s\r\n", API_HOST);
  client.printf("Authorization: Bearer %s\r\n", DEVICE_TOKEN);
  client.print("Content-Type: application/json\r\n");
  client.print("Transfer-Encoding: chunked\r\n");
  client.print("Connection: close\r\n");
  client.print("User-Agent: arsywatch/" AW_FIRMWARE_VERSION "\r\n");
  client.print("\r\n");

  // --- body, streamed ---
  char buf[384];
  bool ok = true;
  int n;

  // snprintf returns the length it WOULD have written, which exceeds the buffer
  // on truncation. Using that as a write length reads past the end of buf, so
  // every count is clamped to what actually fits.
  n = snprintf(buf, sizeof(buf), "{\"device\":\"%s\",\"uptime_ms\":%llu,\"firmware\":\"%s\",\"aps\":[",
               DEVICE_ID, (unsigned long long)g_uptimeMs, AW_FIRMWARE_VERSION);
  if (n < 0) n = 0;
  if ((size_t)n > sizeof(buf) - 1) n = (int)(sizeof(buf) - 1);
  ok &= chunkWrite(client, buf, (size_t)n);

  for (uint8_t i = 0; i < g_apOutCount && ok; i++) {
    const ApOut &ap = g_apOut[i];
    char esc[200];
    jsonEscape(esc, sizeof(esc), ap.ssid, ap.ssidLen);
    char bssid[18];
    macToStr(ap.bssid, bssid);
    n = snprintf(buf, sizeof(buf),
                 "%s{\"ssid\":\"%s\",\"bssid\":\"%s\",\"rssi\":%d,\"channel\":%u,\"enc\":\"%s\"}",
                 i ? "," : "", esc, bssid, (int)ap.rssi, (unsigned)ap.channel,
                 ENC_STR[ap.enc]);
    if (n < 0) n = 0;
    if ((size_t)n > sizeof(buf) - 1) n = (int)(sizeof(buf) - 1);
    ok &= chunkWrite(client, buf, (size_t)n);
  }

  ok &= chunkWriteStr(client, "],\"macs\":[");

  for (uint16_t i = 0; i < g_macCount && ok; i++) {
    char mac[18];
    macToStr(g_macs[i], mac);
    n = snprintf(buf, sizeof(buf), "%s\"%s\"", i ? "," : "", mac);
    if (n < 0) n = 0;
    if ((size_t)n > sizeof(buf) - 1) n = (int)(sizeof(buf) - 1);
    ok &= chunkWrite(client, buf, (size_t)n);
  }

  ok &= chunkWriteStr(client, "]}");
  ok &= chunkTerminate(client);   // zero-length chunk — see chunkTerminate()

  if (!ok) {
    Serial.println("[post] body write failed");
    client.stop();
    return false;
  }

  // --- read the status line ---
  uint32_t t0 = millis();
  while (client.available() == 0) {
    if (millis() - t0 > AW_HTTP_TIMEOUT_MS) { Serial.println("[post] no response"); client.stop(); return false; }
    ESP.wdtFeed();
    delay(10);
  }
  char status[32] = {0};
  size_t si = 0;
  while (client.available() && si < sizeof(status) - 1) {
    char c = (char)client.read();
    if (c == '\n') break;
    if (c != '\r') status[si++] = c;
  }
  status[si] = '\0';

  bool good = strstr(status, " 201") != nullptr || strstr(status, " 200") != nullptr;
  Serial.printf("[post] %s -> %s\n", good ? "OK" : "ERR", status);
  client.stop();
  return good;
}

// ===========================================================================
// Cycle pacing
// ===========================================================================
static void waitForNextCycle(uint32_t startMs) {
  while (millis() - startMs < AW_SCAN_INTERVAL_MS) {
    ESP.wdtFeed();
    delay(50);
  }
}

// ===========================================================================
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.printf("\nArsyWatch firmware %s - device \"%s\"\n",
                AW_FIRMWARE_VERSION, DEVICE_ID);
  Serial.printf("[boot] reset=%s heap=%u\n",
                ESP.getResetReason().c_str(), (unsigned)ESP.getFreeHeap());
#if AW_SECRETS_PLACEHOLDER
  Serial.println("[boot] !! using secrets.example.h placeholders - no ingest will succeed");
#endif

  // Software watchdog: if a cycle ever wedges, the chip reboots instead of
  // hanging in the field. Feed it on every blocking wait (above).
  ESP.wdtEnable(0);   // 0 => default timeout

  g_lastMillis = millis();
  ensureWifi();       // best-effort; loop() retries without blocking forever
}

void loop() {
  uint32_t cycleStart = millis();

  // advance the wrap-safe uptime counter
  uint32_t now = millis();
  g_uptimeMs += (uint32_t)(now - g_lastMillis);
  g_lastMillis = now;

  if (ensureWifi()) {
    runManagedScan();          // Phase A: AP list with real RSSI
    runPromiscuousCapture();   // Phase B: probe-request MACs + beacons
    enrichFromBeacons();       // merge THIS cycle's beacons into the AP list
    ensureWifi();              // hopping may have dropped the link; re-join
    publishScan();             // Phase C: POST /api/v1/ingest
  } else {
    Serial.println("[loop] no wifi - skipping cycle");
  }

  waitForNextCycle(cycleStart);
}
