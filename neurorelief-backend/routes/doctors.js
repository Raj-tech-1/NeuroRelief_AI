import { Router } from 'express'
import { all, get, run, transaction } from '../db/database.js'
import { authenticateToken, requireRole } from '../middleware/auth.js'
import { TIME_SLOTS, parseDays, validDate, weekdayOf, checkSlot, SlotError, isoDay } from '../lib/appointmentRules.js'
import { recordLegacyEvent, schemaReady } from '../lib/clinicalService.js'

// Allowed status changes, per actor. Anything not listed is rejected.
// (Reschedule, complete and doctor-cancel live in /api/care and need the clinical schema.)
const DOCTOR_TRANSITIONS = { pending: ['accepted', 'declined'] }
const PATIENT_TRANSITIONS = { pending: ['cancelled'], accepted: ['cancelled'] }
const ALL_STATUSES = ['pending', 'accepted', 'declined', 'cancelled', 'cancelled_by_doctor', 'completed']

const ID_RE = /^[1-9]\d*$/

function profileToPublic(p) {
  return {
    id: p.doctor_id, name: p.display_name, specialty: p.specialty, rating: p.rating,
    experience: p.experience, description: p.description, price: p.price,
    phone: p.phone, days: parseDays(p.days), bookable: true, demo: p.is_demo === 1
  }
}

// Legacy clients sent only a weekday name ("Mon"); resolve it to the next such date.
function nextDateForWeekday(name, now) {
  const target = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name)
  if (target < 0) return null
  const d = new Date(isoDay(now) + 'T00:00:00Z')
  let diff = (target - d.getUTCDay() + 7) % 7
  if (diff === 0) diff = 7
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().split('T')[0]
}

// Extra fields that exist only after the clinical migration (version for safe concurrent edits, doctor proposals).
function syncFields(a, synced) {
  if (!synced) return {}
  return {
    version: a.version, completed_at: a.completed_at ?? null,
    proposal: a.proposed_date ? { date: a.proposed_date, time: a.proposed_time, by_doctor: a.proposed_by === a.doctor_user_id } : null,
  }
}

/**
 * db: { all, get, run, transaction } — the application database by default; tests inject a scratch one.
 * now: () => Date
 */
export function createDoctorsRouter({ db = { all, get, run, transaction }, authenticate = authenticateToken, now = () => new Date() } = {}) {
  const router = Router()
  const synced = () => schemaReady(db)
  // Note: the read-then-update in each handler below is synchronous (sql.js), so no other request can run in between;
  // the status condition in each UPDATE keeps it safe. (SELECT changes() cannot be used here: the application's run()
  // saves the file after every write, which resets SQLite's change counter.)
  const event = (appointmentId, actor, type, slot = {}) => recordLegacyEvent(db, { appointmentId, actor, type, toDate: slot.date, toTime: slot.time })
  const extraCols = () => synced() ? ', a.version, a.completed_at, a.proposed_date, a.proposed_time, a.proposed_by, a.doctor_user_id' : ''

  // GET /api/doctors — every profile is backed by a doctor account and is bookable; demo clinicians carry demo: true
  router.get('/', (req, res) => {
    res.json(db.all('SELECT * FROM doctor_profiles ORDER BY display_name').map(profileToPublic))
  })

  // ---------------- Patient endpoints ----------------

  // POST /api/doctors/book — send an appointment REQUEST (status is always 'pending').
  // Only doctor_id, date (or legacy weekday "day") and time are read from the body.
  router.post('/book', authenticate, requireRole('user'), (req, res) => {
    const { doctor_id, time } = req.body
    const idStr = String(doctor_id ?? '')

    if (!ID_RE.test(idStr)) {
      return res.status(404).json({ error: 'This doctor is not available for online booking.' })
    }
    const profile = db.get('SELECT p.* FROM doctor_profiles p JOIN users u ON u.user_id = p.user_id WHERE p.doctor_id = ? AND u.role = ?', [Number(idStr), 'doctor'])
    if (!profile) {
      return res.status(404).json({ error: 'This doctor is not available for online booking.' })
    }

    const rawDate = validDate(req.body.date) || (req.body.date == null ? nextDateForWeekday(req.body.day, now()) : null)
    if (!rawDate) return res.status(400).json({ error: 'A valid appointment date (YYYY-MM-DD) is required.' })
    let date
    try {
      date = checkSlot(db, { profile, date: rawDate, time, now: now(), patientId: req.userId })
    } catch (err) {
      if (err instanceof SlotError) return res.status(err.status).json({ error: err.message })
      throw err
    }

    const result = db.run(
      'INSERT INTO appointments (patient_id, doctor_user_id, requested_date, requested_time, price, status) VALUES (?, ?, ?, ?, ?, ?)',
      [req.userId, profile.user_id, date, time, profile.price, 'pending']
    )
    event(result.lastInsertRowid, { id: req.userId, role: 'user' }, 'requested', { date, time })

    res.status(201).json({
      booking_id: result.lastInsertRowid, appointment_id: result.lastInsertRowid,
      message: 'Appointment request sent', status: 'pending',
      doctor_name: profile.display_name, specialty: profile.specialty,
      date, time, price: profile.price
    })
  })

  // GET /api/doctors/bookings — the logged-in patient's own requests
  router.get('/bookings', authenticate, (req, res) => {
    const s = synced()
    const rows = db.all(
      `SELECT a.appointment_id, p.doctor_id, p.display_name AS doctor_name, p.specialty,
              a.requested_date AS date, a.requested_time AS time, a.price, a.status, a.created_at, a.updated_at${extraCols()}
       FROM appointments a LEFT JOIN doctor_profiles p ON p.user_id = a.doctor_user_id
       WHERE a.patient_id = ? ORDER BY a.created_at DESC, a.appointment_id DESC`,
      [req.userId]
    )
    res.json(rows.map(a => ({
      booking_id: a.appointment_id, appointment_id: a.appointment_id,
      doctor_id: a.doctor_id, doctor_name: a.doctor_name, specialty: a.specialty,
      date: a.date, day: weekdayOf(a.date), time: a.time, price: a.price,
      status: a.status, created_at: a.created_at, updated_at: a.updated_at, ...syncFields(a, s)
    })))
  })

  // POST /api/doctors/bookings/:id/cancel — patient cancels their own pending/accepted request
  router.post('/bookings/:id/cancel', authenticate, requireRole('user'), (req, res) => {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Appointment not found.' })
    const appt = db.get('SELECT appointment_id, status, requested_date, requested_time FROM appointments WHERE appointment_id = ? AND patient_id = ?', [Number(req.params.id), req.userId])
    if (!appt) return res.status(404).json({ error: 'Appointment not found.' })
    if (!(PATIENT_TRANSITIONS[appt.status] || []).includes('cancelled')) {
      return res.status(409).json({ error: `A ${appt.status} appointment cannot be cancelled.` })
    }
    db.run("UPDATE appointments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE appointment_id = ? AND patient_id = ? AND status = ?", [appt.appointment_id, req.userId, appt.status])
    event(appt.appointment_id, { id: req.userId, role: 'user' }, 'cancelled_by_patient', { date: appt.requested_date, time: appt.requested_time })
    res.json({ appointment_id: appt.appointment_id, status: 'cancelled' })
  })

  // ---------------- Doctor endpoints (doctor accounts only) ----------------

  // GET /api/doctors/me — the signed-in doctor's own public profile
  router.get('/me', authenticate, requireRole('doctor'), (req, res) => {
    const p = db.get('SELECT * FROM doctor_profiles WHERE user_id = ?', [req.userId])
    if (!p) return res.status(404).json({ error: 'No doctor profile is linked to this account.' })
    res.json(profileToPublic(p))
  })

  // POST /api/doctors/requests/seen — mark all of this doctor's new requests as read
  router.post('/requests/seen', authenticate, requireRole('doctor'), (req, res) => {
    db.run('UPDATE appointments SET doctor_seen = 1 WHERE doctor_user_id = ? AND doctor_seen = 0', [req.userId])
    res.json({ message: 'All requests marked as read' })
  })

  // POST /api/doctors/requests/:id/seen — mark one of this doctor's requests as read
  router.post('/requests/:id/seen', authenticate, requireRole('doctor'), (req, res) => {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Request not found.' })
    const appt = db.get('SELECT appointment_id FROM appointments WHERE appointment_id = ? AND doctor_user_id = ?', [Number(req.params.id), req.userId])
    if (!appt) return res.status(404).json({ error: 'Request not found.' })
    db.run('UPDATE appointments SET doctor_seen = 1 WHERE appointment_id = ? AND doctor_user_id = ?', [appt.appointment_id, req.userId])
    res.json({ appointment_id: appt.appointment_id, unread: false })
  })

  // GET /api/doctors/requests[?status=pending] — only requests addressed to this doctor.
  // Patient identity is limited to the display name (and the id the Doctor Portal needs to group requests);
  // no health data and no email. `unread` is true for a pending request the doctor has not opened yet.
  router.get('/requests', authenticate, requireRole('doctor'), (req, res) => {
    const { status } = req.query
    const params = [req.userId]
    let filter = ''
    if (status !== undefined) {
      if (!ALL_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Invalid status filter.' })
      }
      filter = ' AND a.status = ?'
      params.push(status)
    }
    const s = synced()
    const rows = db.all(
      `SELECT a.appointment_id, a.patient_id, u.name AS patient_name, a.requested_date AS date, a.requested_time AS time,
              a.price, a.status, a.created_at, a.updated_at, a.doctor_seen${extraCols()}
       FROM appointments a JOIN users u ON u.user_id = a.patient_id
       WHERE a.doctor_user_id = ?${filter}`,
      params
    )
    // Chronological: by date, then by slot order (plain text sorting would put "10:00 AM" before "9:00 AM")
    rows.sort((a, b) => a.date.localeCompare(b.date) || TIME_SLOTS.indexOf(a.time) - TIME_SLOTS.indexOf(b.time))
    res.json(rows.map(({ doctor_seen, version, completed_at, proposed_date, proposed_time, proposed_by, doctor_user_id, ...r }) => ({
      ...r, unread: doctor_seen === 0 && r.status === 'pending',
      ...syncFields({ version, completed_at, proposed_date, proposed_time, proposed_by, doctor_user_id }, s),
    })))
  })

  // PATCH /api/doctors/requests/:id  { status: 'accepted' | 'declined' }
  router.patch('/requests/:id', authenticate, requireRole('doctor'), (req, res) => {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Request not found.' })
    const appt = db.get('SELECT appointment_id, status, requested_date, requested_time FROM appointments WHERE appointment_id = ? AND doctor_user_id = ?', [Number(req.params.id), req.userId])
    if (!appt) return res.status(404).json({ error: 'Request not found.' })

    const next = req.body.status
    if (!(DOCTOR_TRANSITIONS[appt.status] || []).includes(next)) {
      return res.status(409).json({ error: `A ${appt.status} request cannot be changed to '${next}'.` })
    }
    db.run('UPDATE appointments SET status = ?, doctor_seen = 1, updated_at = CURRENT_TIMESTAMP WHERE appointment_id = ? AND doctor_user_id = ? AND status = ?', [next, appt.appointment_id, req.userId, appt.status])
    event(appt.appointment_id, { id: req.userId, role: 'doctor' }, next, { date: appt.requested_date, time: appt.requested_time })
    res.json({ appointment_id: appt.appointment_id, status: next })
  })

  return router
}

export default createDoctorsRouter()
