// Therapy safety limits: one source of truth for the backend, the Device panel and (via BLE) the ESP32 firmware.
//
//   HEAT is software-controlled, so its limits are HARD-ENFORCED (blocked, never just warned):
//     - absolute cap 40 °C and 20 minutes per session, which no plan can exceed
//     - without a doctor's plan the standard plan applies: 38-39 °C, 20 min
//     - a doctor's plan can only narrow these (max <= 40 °C, <= 20 min)
//   TENS comes from a separate device and stays a RECOMMENDATION (warn only): frequency 1-150 Hz and the guidance
//   "strong but comfortable, never painful" (there is deliberately no numeric intensity limit).
//
// The firmware must also clamp to its own compiled-in absolute cap (40 °C / 20 min) and treat the BLE payload only as
// a further restriction; see docs/FIRMWARE_SAFETY_CAP.md.

export const SYSTEM_LIMITS = Object.freeze({
  heatAbsMaxC: 40,       // never exceeded, by any plan or device setting
  heatAbsMinC: 35,       // lowest heat setting a plan may recommend
  heatMaxMinutes: 20,    // per session
  tensFreqMin: 1,
  tensFreqMax: 150,
  sessionsPerDayMax: 6,
  planMaxDays: 180,
})

export const DEFAULT_PLAN = Object.freeze({ heatMinC: 38, heatMaxC: 39, heatMaxMinutes: 20, tensFreqMin: 1, tensFreqMax: 150, sessionsPerDay: null })

export const TENS_GUIDANCE = 'Strong but comfortable, never painful.'

export class PlanError extends Error {
  constructor(status, code, message, field = null) { super(message); this.name = 'PlanError'; this.status = status; this.code = code; this.field = field }
}

// The patient's active plan (newest), or null. A plan is active until it is revoked, superseded or past valid_until.
export function activePlan(db, patientId, now = new Date()) {
  const exists = db.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'therapy_plans'")
  if (!exists) return null
  return db.get(
    `SELECT p.*, d.display_name AS doctor_name FROM therapy_plans p LEFT JOIN doctor_profiles d ON d.user_id = p.doctor_user_id
     WHERE p.patient_id = ? AND p.status = 'active' AND p.valid_until > ? ORDER BY p.plan_id DESC LIMIT 1`,
    [patientId, now.toISOString()])
}

// Limits that apply right now: the doctor's plan if there is one, otherwise the standard plan; always within the
// absolute caps (applied again here even though a stored plan was already validated).
export function effectiveLimits(db, patientId, now = new Date()) {
  const p = activePlan(db, patientId, now)
  const src = p
    ? { heatMinC: p.heat_min_c, heatMaxC: p.heat_max_c, heatMaxMinutes: p.heat_max_minutes, tensFreqMin: p.tens_freq_min, tensFreqMax: p.tens_freq_max, sessionsPerDay: p.sessions_per_day }
    : DEFAULT_PLAN
  const heatMaxC = Math.min(SYSTEM_LIMITS.heatAbsMaxC, src.heatMaxC)
  return {
    source: p ? 'doctor_plan' : 'standard',
    planId: p?.plan_id ?? null,
    doctorName: p?.doctor_name ?? null,
    validUntil: p?.valid_until ?? null,
    heatMinC: Math.min(heatMaxC, Math.max(SYSTEM_LIMITS.heatAbsMinC, src.heatMinC)),
    heatMaxC,
    heatMaxMinutes: Math.min(SYSTEM_LIMITS.heatMaxMinutes, src.heatMaxMinutes),
    tensFreqMin: Math.max(SYSTEM_LIMITS.tensFreqMin, src.tensFreqMin),
    tensFreqMax: Math.min(SYSTEM_LIMITS.tensFreqMax, src.tensFreqMax),
    sessionsPerDay: src.sessionsPerDay ?? null,
    tensGuidance: TENS_GUIDANCE,
    absolute: { heatMaxC: SYSTEM_LIMITS.heatAbsMaxC, heatMaxMinutes: SYSTEM_LIMITS.heatMaxMinutes },
    enforcement: { heat: 'hard', tens: 'recommendation' },
  }
}

// Validates a doctor's plan input against the absolute caps. Returns normalised values or throws PlanError.
export function validatePlan(b = {}) {
  const num = (v, field, lo, hi, step = 0.5) => {
    const n = typeof v === 'number' ? v : Number.NaN
    if (!Number.isFinite(n) || n < lo || n > hi) throw new PlanError(400, 'OUT_OF_RANGE', `${field} must be between ${lo} and ${hi}.`, field)
    return Math.round(n / step) * step
  }
  const L = SYSTEM_LIMITS
  const heatMinC = num(b.heatMinC, 'heatMinC', L.heatAbsMinC, L.heatAbsMaxC)
  const heatMaxC = num(b.heatMaxC, 'heatMaxC', L.heatAbsMinC, L.heatAbsMaxC)
  if (heatMinC > heatMaxC) throw new PlanError(400, 'OUT_OF_RANGE', 'The lowest heat cannot be above the highest heat.', 'heatMinC')
  const heatMaxMinutes = num(b.heatMaxMinutes, 'heatMaxMinutes', 1, L.heatMaxMinutes, 1)
  const tensFreqMin = num(b.tensFreqMin, 'tensFreqMin', L.tensFreqMin, L.tensFreqMax, 1)
  const tensFreqMax = num(b.tensFreqMax, 'tensFreqMax', L.tensFreqMin, L.tensFreqMax, 1)
  if (tensFreqMin > tensFreqMax) throw new PlanError(400, 'OUT_OF_RANGE', 'The lowest TENS frequency cannot be above the highest.', 'tensFreqMin')
  const sessionsPerDay = b.sessionsPerDay == null || b.sessionsPerDay === '' ? null : num(b.sessionsPerDay, 'sessionsPerDay', 1, L.sessionsPerDayMax, 1)
  const validDays = num(b.validDays ?? 30, 'validDays', 1, L.planMaxDays, 1)
  return { heatMinC, heatMaxC, heatMaxMinutes, tensFreqMin, tensFreqMax, sessionsPerDay, validDays }
}

// ---- BLE payload for the ESP32 (little-endian, 18 bytes) ----
//   0  u8  'N' (0x4E)          1  u8  'R' (0x52)          2  u8  format version (1)
//   3  u16 heat max, 0.1 °C    5  u16 heat max seconds    7  u16 heat min, 0.1 °C
//   9  u32 plan id (0 = standard plan)                    13 u32 valid until (unix seconds, 0 = no expiry)
//   17 u8  CRC-8 (poly 0x07, init 0x00) over bytes 0-16
export const BLE_FORMAT_VERSION = 1
export function crc8(buf) {
  let c = 0
  for (const b of buf) {
    c ^= b
    for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff
  }
  return c
}
export function blePayload(limits) {
  const buf = Buffer.alloc(18)
  buf.writeUInt8(0x4e, 0); buf.writeUInt8(0x52, 1); buf.writeUInt8(BLE_FORMAT_VERSION, 2)
  buf.writeUInt16LE(Math.round(Math.min(SYSTEM_LIMITS.heatAbsMaxC, limits.heatMaxC) * 10), 3)
  buf.writeUInt16LE(Math.min(SYSTEM_LIMITS.heatMaxMinutes, limits.heatMaxMinutes) * 60, 5)
  buf.writeUInt16LE(Math.round(limits.heatMinC * 10), 7)
  buf.writeUInt32LE(limits.planId || 0, 9)
  buf.writeUInt32LE(limits.validUntil ? Math.floor(Date.parse(limits.validUntil) / 1000) : 0, 13)
  buf.writeUInt8(crc8(buf.subarray(0, 17)), 17)
  return buf
}
