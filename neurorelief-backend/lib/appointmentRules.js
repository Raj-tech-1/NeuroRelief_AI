// Appointment slot rules shared by booking (routes/doctors.js) and rescheduling (lib/clinicalService.js),
// so every path validates dates, weekdays, slots and clashes the same way.

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const TIME_SLOTS = ['9:00 AM', '10:00 AM', '11:00 AM', '2:00 PM', '3:00 PM', '4:00 PM']
export const MAX_DAYS_AHEAD = 60
// Statuses that occupy a slot. A doctor's proposed time is not held: it is re-checked when the patient accepts it.
export const ACTIVE_STATUSES = ['pending', 'accepted']

export function parseDays(s) {
  return (s || '').split(',').map(d => d.trim()).filter(Boolean)
}

// Returns the validated YYYY-MM-DD string, or null. Rejects impossible dates (e.g. 2026-02-30).
export function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(s + 'T00:00:00Z')
  if (Number.isNaN(d.getTime()) || d.toISOString().split('T')[0] !== s) return null
  return s
}

export function weekdayOf(dateStr) {
  return WEEKDAYS[new Date(dateStr + 'T00:00:00Z').getUTCDay()]
}

// The calendar date (YYYY-MM-DD) in the server's local timezone. toISOString() would give the UTC date, which is
// still "yesterday" in India before 05:30 local time.
export const isoDay = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export class SlotError extends Error {
  constructor(status, code, message) { super(message); this.name = 'SlotError'; this.status = status; this.code = code }
}

/**
 * Checks that `date`/`time` is a bookable slot for this doctor profile and that nobody else holds it.
 * excludeId: the appointment being moved (it may keep / re-use its own slot).
 */
export function checkSlot(db, { profile, date, time, now = new Date(), excludeId = null, patientId = null }) {
  const d = validDate(date)
  if (!d) throw new SlotError(400, 'INVALID_DATE', 'A valid appointment date (YYYY-MM-DD) is required.')
  const today = isoDay(now)
  const latest = isoDay(new Date(now.getTime() + MAX_DAYS_AHEAD * 86400000))
  if (d < today) throw new SlotError(400, 'PAST_DATE', 'Appointment date cannot be in the past.')
  if (d > latest) throw new SlotError(400, 'TOO_FAR', `Appointments can be requested up to ${MAX_DAYS_AHEAD} days ahead.`)
  if (!parseDays(profile.days).includes(weekdayOf(d))) {
    throw new SlotError(400, 'DAY_UNAVAILABLE', `${profile.display_name} does not take appointments on ${weekdayOf(d)}.`)
  }
  if (!TIME_SLOTS.includes(time)) throw new SlotError(400, 'INVALID_SLOT', 'Please choose one of the available time slots.')
  const marks = ACTIVE_STATUSES.map(() => '?').join(',')
  const clash = db.get(
    `SELECT patient_id FROM appointments WHERE doctor_user_id = ? AND requested_date = ? AND requested_time = ? AND status IN (${marks})
     ${excludeId ? 'AND appointment_id <> ?' : ''}`,
    [profile.user_id, d, time, ...ACTIVE_STATUSES, ...(excludeId ? [excludeId] : [])])
  if (clash) {
    throw new SlotError(409, 'SLOT_TAKEN', clash.patient_id === patientId
      ? 'You already have a request for this doctor at that time.'
      : 'That time slot is no longer available. Please pick another.')
  }
  return d
}

export const byWhen = (a, b) => a.date.localeCompare(b.date) || TIME_SLOTS.indexOf(a.time) - TIME_SLOTS.indexOf(b.time)
