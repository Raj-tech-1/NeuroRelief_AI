// Small pure helpers shared by the Doctor Portal views. Everything here works on the existing
// appointment-request fields ({ appointment_id, patient_name, date, time, status, created_at, unread }).

export function todayLocal() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function isoOf(year, monthIndex, day) {
  const pad = n => String(n).padStart(2, '0')
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`
}

// Time slots are stored as '9:00 AM'
export function minutesOf(time) {
  const m = /^(\d+):(\d+) (AM|PM)$/.exec(time)
  if (!m) return 0
  return ((Number(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0)) * 60 + Number(m[2])
}

export const byWhen = (a, b) => a.date.localeCompare(b.date) || minutesOf(a.time) - minutesOf(b.time)

// True while the appointment has not started yet (a slot earlier today counts as past)
export function isStillAhead(r, now = new Date()) {
  const today = todayLocal()
  if (r.date > today) return true
  if (r.date < today) return false
  return minutesOf(r.time) >= now.getHours() * 60 + now.getMinutes()
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = Array.from(parts[0])[0]
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] : ''
  return (first + last).toUpperCase()
}

// The API layer throws the backend's English message. These are the auth/permission rejections
// (see middleware/auth.js); they get their own "access denied" screen instead of a generic error.
export const isAccessDenied = raw => /invalid or expired token|do not have permission|access denied|no token provided/i.test(raw || '')

export const SORTS = {
  soonest: (a, b) => byWhen(a, b),
  latest: (a, b) => byWhen(b, a),
  newest: (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || b.appointment_id - a.appointment_id,
}
