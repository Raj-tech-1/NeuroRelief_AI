# Heat safety cap for the ESP32 firmware

Status: **prepared, not yet connected.** The app and backend already enforce these limits (Device panel slider and auto-stop; `POST /api/care/therapy-sessions` rejects anything above them). This document defines how the same cap reaches the band over BLE, so the firmware enforces it too once BLE is connected.

## Rules

| | Limit | Enforcement |
|---|---|---|
| Heat temperature | **absolute cap 40.0 °C**; standard plan 38–39 °C; a doctor's plan may only narrow it | **hard** (block / cut power) |
| Heat duration | **max 20 min per session**; a plan may set less | **hard** (auto-stop) |
| TENS frequency | 1–150 Hz | recommendation only (separate commercial device) |
| TENS intensity | no numeric limit: "strong but comfortable, never painful" | guidance only |

Source of truth in code: `neurorelief-backend/lib/therapyLimits.js` (`SYSTEM_LIMITS`, `DEFAULT_PLAN`, `effectiveLimits`, `blePayload`).

## The firmware must never trust the app alone

1. Compile the absolute cap into the firmware: `ABS_MAX_DECI_C = 400` (40.0 °C) and `ABS_MAX_SEC = 1200` (20 min). No payload can raise these.
2. Cut heater power if the DS18B20 skin-side reading exceeds the active max (with your hysteresis), and also if the sensor fails or reads out of range. Fail safe means heater off.
3. Stop the heater when the session time reaches the active max seconds, even if the app is disconnected.
4. With **no valid payload** (none received, bad magic/version/CRC, or expired), use the standard plan: **39.0 °C, 1200 s**.
5. A payload can only restrict: `active_max = min(payload_max, ABS_MAX)` and `active_sec = min(payload_sec, ABS_MAX_SEC)`.

## Getting the payload

The app fetches it for the signed-in patient:

```
GET /api/therapy-plan/device-limits      (patient token)
-> { "limits": {...}, "payloadHex": "4e5201900184037c01...", "format": "nr-limits-v1" }
```

and writes the 18 bytes to the band's limits characteristic (proposed UUIDs below) on connect and whenever the plan changes.

| Item | Proposed UUID |
|---|---|
| NeuroRelief service | `6e520001-6e72-4c69-6d69-747300000000` |
| Limits characteristic (write, 18 bytes) | `6e520002-6e72-4c69-6d69-747300000000` |
| Active limits (read/notify, same 18 bytes) | `6e520003-6e72-4c69-6d69-747300000000` |

## Payload format `nr-limits-v1` (little-endian, 18 bytes)

| Offset | Type | Field |
|---|---|---|
| 0 | u8 | `'N'` (0x4E) |
| 1 | u8 | `'R'` (0x52) |
| 2 | u8 | format version = 1 |
| 3 | u16 | heat max, 0.1 °C (e.g. 390 = 39.0 °C) |
| 5 | u16 | heat max seconds per session |
| 7 | u16 | heat min, 0.1 °C (informational) |
| 9 | u32 | plan id (0 = standard plan) |
| 13 | u32 | valid until, unix seconds (0 = no expiry) |
| 17 | u8 | CRC-8, poly 0x07, init 0x00, over bytes 0–16 |

Example (doctor's plan 38–40 °C, 15 min, plan 1): `4e5201900184037c0101000000c2f3226b55`, which decodes to 40.0 °C, 900 s, plan 1.

## Reference parsing (C)

```c
#define ABS_MAX_DECI_C 400   /* 40.0 C: compiled-in, never raised by a payload */
#define ABS_MAX_SEC    1200  /* 20 min */
#define STD_MAX_DECI_C 390   /* standard plan when there is no valid payload */

typedef struct { uint16_t max_deci_c; uint16_t max_sec; uint32_t plan_id; uint32_t valid_until; } nr_limits_t;

static uint8_t crc8(const uint8_t *p, size_t n) {
  uint8_t c = 0;
  while (n--) { c ^= *p++; for (int i = 0; i < 8; i++) c = (c & 0x80) ? (uint8_t)((c << 1) ^ 0x07) : (uint8_t)(c << 1); }
  return c;
}
static uint16_t rd16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }
static uint32_t rd32(const uint8_t *p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }

/* Returns the limits to enforce. Anything invalid falls back to the standard plan. now = unix seconds (0 if unknown). */
nr_limits_t nr_limits_from_payload(const uint8_t *b, size_t len, uint32_t now) {
  nr_limits_t std = { STD_MAX_DECI_C, ABS_MAX_SEC, 0, 0 };
  if (len != 18 || b[0] != 'N' || b[1] != 'R' || b[2] != 1 || crc8(b, 17) != b[17]) return std;
  nr_limits_t l = { rd16(b + 3), rd16(b + 5), rd32(b + 9), rd32(b + 13) };
  if (l.valid_until && now && now > l.valid_until) return std;          /* expired plan */
  if (l.max_deci_c > ABS_MAX_DECI_C) l.max_deci_c = ABS_MAX_DECI_C;    /* can only restrict */
  if (l.max_sec == 0 || l.max_sec > ABS_MAX_SEC) l.max_sec = ABS_MAX_SEC;
  return l;
}
```

## Test vectors

| Payload hex | Expected |
|---|---|
| `4e5201900184037c0101000000c2f3226b55` | 40.0 °C, 900 s, plan 1 |
| same with last byte changed | CRC fails → standard plan 39.0 °C, 1200 s |
| heat max 0x01C2 (45.0 °C), valid CRC | clamped to 40.0 °C |
