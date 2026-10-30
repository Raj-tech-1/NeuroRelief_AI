import { Router } from 'express'
import { all, get, run } from '../db/database.js'
import { authenticateToken, requireRole } from '../middleware/auth.js'

const router = Router()

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TIME_SLOTS = ['9:00 AM', '10:00 AM', '11:00 AM', '2:00 PM', '3:00 PM', '4:00 PM']
const MAX_DAYS_AHEAD = 60
const ACTIVE_STATUSES = ['pending', 'accepted']

// Allowed status changes, per actor. Anything not listed is rejected.
const DOCTOR_TRANSITIONS = { pending: ['accepted', 'declined'] }
const PATIENT_TRANSITIONS = { pending: ['cancelled'], accepted: ['cancelled'] }

const ID_RE = /^[1-9]\d*$/

function parseDays(s) {
  return (s || '').split(',').map(d => d.trim()).filter(Boolean)
}

function profileToPublic(p) {
  return {
    id: p.doctor_id, name: p.display_name, specialty: p.specialty, rating: p.rating,
    experience: p.experience, description: p.description, price: p.price,
    phone: p.phone, days: parseDays(p.days), bookable: true, demo: p.is_demo === 1
  }
}

function todayUTC() {
  return new Date().toISOString().split('T')[0]
}

// Returns the validated YYYY-MM-DD string, or null. Rejects impossible dates (e.g. 2026-02-30).
function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(s + 'T00:00:00Z')
  if (Number.isNaN(d.getTime()) || d.toISOString().split('T')[0] !== s) return null
  return s
}

function weekdayOf(dateStr) {
  return WEEKDAYS[new Date(dateStr + 'T00:00:00Z').getUTCDay()]
}

// Legacy clients sent only a weekday name ("Mon"); resolve it to the next such date.
function nextDateForWeekday(name) {
  const target = WEEKDAYS.indexOf(name)
  if (target < 0) return null
  const d = new Date(todayUTC() + 'T00:00:00Z')
  let diff = (target - d.getUTCDay() + 7) % 7
  if (diff === 0) diff = 7
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().split('T')[0]
}

function appointmentRowForPatient(a) {
  return {
    booking_id: a.appointment_id, appointment_id: a.appointment_id,
    doctor_id: a.doctor_id, doctor_name: a.doctor_name, specialty: a.specialty,
    date: a.date, day: weekdayOf(a.date), time: a.time, price: a.price,
    status: a.status, created_at: a.created_at
  }
}

// GET /api/doctors — every profile is backed by a doctor account and is bookable; demo clinicians carry demo: true
router.get('/', (req, res) => {
  res.json(all('SELECT * FROM doctor_profiles ORDER BY display_name').map(profileToPublic))
})

// ---------------- Patient endpoints ----------------

// POST /api/doctors/book — send an appointment REQUEST (status is always 'pending').
// Only doctor_id, date (or legacy weekday "day") and time are read from the body.
router.post('/book', authenticateToken, requireRole('user'), (req, res) => {
  const { doctor_id, time } = req.body
  const idStr = String(doctor_id ?? '')

  if (!ID_RE.test(idStr)) {
    return res.status(404).json({ error: 'This doctor is not available for online booking.' })
  }
  const profile = get('SELECT p.* FROM doctor_profiles p JOIN users u ON u.user_id = p.user_id WHERE p.doctor_id = ? AND u.role = ?', [Number(idStr), 'doctor'])
  if (!profile) {
    return res.status(404).json({ error: 'This doctor is not available for online booking.' })
  }

  const date = validDate(req.body.date) || (req.body.date == null ? nextDateForWeekday(req.body.day) : null)
  if (!date) return res.status(400).json({ error: 'A valid appointment date (YYYY-MM-DD) is required.' })
  const today = todayUTC()
  const latest = new Date(Date.now() + MAX_DAYS_AHEAD * 86400000).toISOString().split('T')[0]
  if (date < today) return res.status(400).json({ error: 'Appointment date cannot be in the past.' })
  if (date > latest) return res.status(400).json({ error: `Appointments can be requested up to ${MAX_DAYS_AHEAD} days ahead.` })
  if (!parseDays(profile.days).includes(weekdayOf(date))) {
    return res.status(400).json({ error: `${profile.display_name} does not take appointments on ${weekdayOf(date)}.` })
  }
  if (!TIME_SLOTS.includes(time)) {
    return res.status(400).json({ error: 'Please choose one of the available time slots.' })
  }

  const clash = get(
    `SELECT patient_id FROM appointments WHERE doctor_user_id = ? AND requested_date = ? AND requested_time = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})`,
    [profile.user_id, date, time, ...ACTIVE_STATUSES]
  )
  if (clash) {
    return res.status(409).json({
      error: clash.patient_id === req.userId
        ? 'You already have a request for this doctor at that time.'
        : 'That time slot is no longer available. Please pick another.'
    })
  }

  const result = run(
    'INSERT INTO appointments (patient_id, doctor_user_id, requested_date, requested_time, price, status) VALUES (?, ?, ?, ?, ?, ?)',
    [req.userId, profile.user_id, date, time, profile.price, 'pending']
  )

  res.status(201).json({
    booking_id: result.lastInsertRowid, appointment_id: result.lastInsertRowid,
    message: 'Appointment request sent', status: 'pending',
    doctor_name: profile.display_name, specialty: profile.specialty,
    date, time, price: profile.price
  })
})

// GET /api/doctors/bookings — the logged-in patient's own requests
router.get('/bookings', authenticateToken, (req, res) => {
  const rows = all(
    `SELECT a.appointment_id, p.doctor_id, p.display_name AS doctor_name, p.specialty,
            a.requested_date AS date, a.requested_time AS time, a.price, a.status, a.created_at
     FROM appointments a LEFT JOIN doctor_profiles p ON p.user_id = a.doctor_user_id
     WHERE a.patient_id = ? ORDER BY a.created_at DESC, a.appointment_id DESC`,
    [req.userId]
  )
  res.json(rows.map(appointmentRowForPatient))
})

// POST /api/doctors/bookings/:id/cancel — patient cancels their own pending/accepted request
router.post('/bookings/:id/cancel', authenticateToken, requireRole('user'), (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Appointment not found.' })
  const appt = get('SELECT appointment_id, status FROM appointments WHERE appointment_id = ? AND patient_id = ?', [Number(req.params.id), req.userId])
  if (!appt) return res.status(404).json({ error: 'Appointment not found.' })
  if (!(PATIENT_TRANSITIONS[appt.status] || []).includes('cancelled')) {
    return res.status(409).json({ error: `A ${appt.status} appointment cannot be cancelled.` })
  }
  run("UPDATE appointments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE appointment_id = ? AND patient_id = ? AND status = ?", [appt.appointment_id, req.userId, appt.status])
  res.json({ appointment_id: appt.appointment_id, status: 'cancelled' })
})

// ---------------- Doctor endpoints (doctor accounts only) ----------------

// GET /api/doctors/me — the signed-in doctor's own public profile
router.get('/me', authenticateToken, requireRole('doctor'), (req, res) => {
  const p = get('SELECT * FROM doctor_profiles WHERE user_id = ?', [req.userId])
  if (!p) return res.status(404).json({ error: 'No doctor profile is linked to this account.' })
  res.json(profileToPublic(p))
})

// POST /api/doctors/requests/seen — mark all of this doctor's new requests as read
router.post('/requests/seen', authenticateToken, requireRole('doctor'), (req, res) => {
  run('UPDATE appointments SET doctor_seen = 1 WHERE doctor_user_id = ? AND doctor_seen = 0', [req.userId])
  res.json({ message: 'All requests marked as read' })
})

// POST /api/doctors/requests/:id/seen — mark one of this doctor's requests as read
router.post('/requests/:id/seen', authenticateToken, requireRole('doctor'), (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Request not found.' })
  const appt = get('SELECT appointment_id FROM appointments WHERE appointment_id = ? AND doctor_user_id = ?', [Number(req.params.id), req.userId])
  if (!appt) return res.status(404).json({ error: 'Request not found.' })
  run('UPDATE appointments SET doctor_seen = 1 WHERE appointment_id = ? AND doctor_user_id = ?', [appt.appointment_id, req.userId])
  res.json({ appointment_id: appt.appointment_id, unread: false })
})

// GET /api/doctors/requests[?status=pending] — only requests addressed to this doctor.
// Patient identity is limited to the display name; no health data and no email.
// `unread` is true for a pending request the doctor has not opened yet (drives the notification bell).
router.get('/requests', authenticateToken, requireRole('doctor'), (req, res) => {
  const { status } = req.query
  const params = [req.userId]
  let filter = ''
  if (status !== undefined) {
    if (!['pending', 'accepted', 'declined', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter.' })
    }
    filter = ' AND a.status = ?'
    params.push(status)
  }
  const rows = all(
    `SELECT a.appointment_id, u.name AS patient_name, a.requested_date AS date, a.requested_time AS time,
            a.price, a.status, a.created_at, a.doctor_seen
     FROM appointments a JOIN users u ON u.user_id = a.patient_id
     WHERE a.doctor_user_id = ?${filter}`,
    params
  )
  // Chronological: by date, then by slot order (plain text sorting would put "10:00 AM" before "9:00 AM")
  rows.sort((a, b) => a.date.localeCompare(b.date) || TIME_SLOTS.indexOf(a.time) - TIME_SLOTS.indexOf(b.time))
  res.json(rows.map(({ doctor_seen, ...r }) => ({ ...r, unread: doctor_seen === 0 && r.status === 'pending' })))
})

// PATCH /api/doctors/requests/:id  { status: 'accepted' | 'declined' }
router.patch('/requests/:id', authenticateToken, requireRole('doctor'), (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Request not found.' })
  const appt = get('SELECT appointment_id, status FROM appointments WHERE appointment_id = ? AND doctor_user_id = ?', [Number(req.params.id), req.userId])
  if (!appt) return res.status(404).json({ error: 'Request not found.' })

  const next = req.body.status
  if (!(DOCTOR_TRANSITIONS[appt.status] || []).includes(next)) {
    return res.status(409).json({ error: `A ${appt.status} request cannot be changed to '${next}'.` })
  }
  run('UPDATE appointments SET status = ?, doctor_seen = 1, updated_at = CURRENT_TIMESTAMP WHERE appointment_id = ? AND doctor_user_id = ? AND status = ?', [next, appt.appointment_id, req.userId, appt.status])
  res.json({ appointment_id: appt.appointment_id, status: next })
})

export default router
