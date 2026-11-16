// Patient <-> doctor synchronisation tests. SCRATCH ONLY: fictional in-memory databases, random keys, ephemeral ports.
// Both "portals" call the same real routers over HTTP, so every check is against one backend and one database.
//   Run:  node --test tests/care-sync.test.mjs
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { makeCareEnv, P1, P2, DR_A, DR_B, NOW } from './helpers/careHarness.mjs'
import { RECORD_CONSENT_VERSION } from '../lib/recordConsent.js'

const envs = []
const env = async o => { const e = await makeCareEnv(o); envs.push(e); return e }
afterEach(async () => { while (envs.length) await envs.pop().close() })

const MONDAY = '2030-02-04'      // NOW is Friday 2030-02-01; doctor A (profile 1) works Mondays
const NEXT_MONDAY = '2030-02-11'
const PERIOD = { from: '2030-01-01', to: '2030-01-31', sections: ['cycles', 'wellness', 'predictions', 'questionnaire'] }

// Patient 1 books doctor A, doctor A accepts. Returns the appointment id.
async function bookAndAccept(e, { date = MONDAY, time = '9:00 AM' } = {}) {
  const b = await e.post('/doctors/book', { as: P1, body: { doctor_id: 1, date, time } })
  assert.equal(b.status, 201, b.text)
  const id = b.json.appointment_id
  const a = await e.patch(`/doctors/requests/${id}`, { as: DR_A, body: { status: 'accepted' } })
  assert.equal(a.status, 200, a.text)
  return id
}
const appt = async (e, id, as) => (await e.get(`/care/appointments/${id}`, { as })).json
const grantBody = (appointmentId, extra = {}) => ({
  appointmentId, categories: ['symptoms', 'pain'], purpose: 'consultation_review', rangeFrom: '2030-01-01', rangeTo: '2030-02-28',
  days: 30, consentVersion: RECORD_CONSENT_VERSION, consentAccepted: true, ...extra,
})
async function saveReport(e) {
  const p = await e.post('/reports/preview', { as: P1, body: PERIOD })
  const r = await e.post('/reports', { as: P1, body: { ...PERIOD, digest: p.json.digest } })
  assert.equal(r.status, 201, r.text)
  return r.json.reportId
}

describe('0. Gating and existing behaviour before the migration', () => {
  it('without the clinical schema /api/care is a generic 503 and booking/accepting still work exactly as before', async () => {
    const e = await env({ migrate: false })
    assert.deepEqual((await e.get('/care/status', { as: P1 })).json, { enabled: false, reason: 'schema' })
    assert.equal((await e.get('/care/activity', { as: P1 })).status, 503)
    const b = await e.post('/doctors/book', { as: P1, body: { doctor_id: 1, date: MONDAY, time: '9:00 AM' } })
    assert.equal(b.status, 201)
    const list = (await e.get('/doctors/requests', { as: DR_A })).json
    const row = list.find(r => r.appointment_id === b.json.appointment_id)
    assert.equal(row.unread, true)
    assert.equal(row.version, undefined, 'no new fields before the migration')
    assert.equal((await e.patch(`/doctors/requests/${b.json.appointment_id}`, { as: DR_A, body: { status: 'accepted' } })).status, 200)
    assert.equal((await e.get('/doctors/bookings', { as: P1 })).json.find(x => x.appointment_id === b.json.appointment_id).status, 'accepted')
  })
  it('requires a valid token and the right role', async () => {
    const e = await env()
    assert.equal((await e.get('/care/activity')).status, 401)
    assert.equal((await e.get('/care/doctor/dashboard', { as: P1 })).status, 403)
    assert.equal((await e.get('/care/grants', { as: DR_A })).status, 403)
    assert.equal((await e.post('/care/therapy-sessions', { as: DR_A, body: {} })).status, 403)
  })
})

describe('1-2. Appointment requests and confirmation sync between portals', () => {
  it('patient books -> doctor sees the request; doctor accepts -> patient sees confirmation with the same date and time', async () => {
    const e = await env()
    const b = await e.post('/doctors/book', { as: P1, body: { doctor_id: 1, date: MONDAY, time: '10:00 AM' } })
    const id = b.json.appointment_id
    const req = (await e.get('/doctors/requests', { as: DR_A })).json.find(r => r.appointment_id === id)
    assert.equal(req.status, 'pending'); assert.equal(req.unread, true); assert.equal(req.patient_name, 'Fixture Patient One')
    assert.equal(req.date, MONDAY); assert.equal(req.time, '10:00 AM'); assert.equal(req.version, 1)
    // The doctor of another practice never sees it
    assert.equal((await e.get('/doctors/requests', { as: DR_B })).json.some(r => r.appointment_id === id), false)
    const feedD = (await e.get('/care/activity', { as: DR_A })).json.items
    assert.ok(feedD.some(i => i.type === 'requested' && i.appointmentId === id))

    await e.patch(`/doctors/requests/${id}`, { as: DR_A, body: { status: 'accepted' } })
    const mine = (await e.get('/doctors/bookings', { as: P1 })).json.find(x => x.appointment_id === id)
    assert.equal(mine.status, 'accepted'); assert.equal(mine.date, MONDAY); assert.equal(mine.time, '10:00 AM'); assert.equal(mine.version, 2)
    const feedP = (await e.get('/care/activity', { as: P1 })).json.items
    assert.ok(feedP.some(i => i.type === 'accepted' && i.appointmentId === id && i.counterpart === 'Dr. Fixture Alpha'))
    // The patient's own actions never show up in the patient's notification feed
    assert.equal(feedP.some(i => i.type === 'requested'), false)
  })

  it('doctor proposes a new time: nothing moves until the patient accepts; both see the proposal and the result', async () => {
    const e = await env()
    const id = await bookAndAccept(e)
    const before = await appt(e, id, DR_A)
    const p = await e.post(`/care/doctor/appointments/${id}/propose`, { as: DR_A, body: { date: NEXT_MONDAY, time: '2:00 PM', version: before.version } })
    assert.equal(p.status, 200, p.text)
    const seen = await appt(e, id, P1)
    assert.equal(seen.date, MONDAY, 'slot unchanged while the proposal is open')
    assert.equal(seen.status, 'accepted')
    assert.deepEqual(seen.proposal, { date: NEXT_MONDAY, time: '2:00 PM', byDoctor: true })
    assert.ok((await e.get('/care/activity', { as: P1 })).json.items.some(i => i.type === 'reschedule_proposed'))
    const ok = await e.post(`/care/appointments/${id}/proposal`, { as: P1, body: { accept: true, version: seen.version } })
    assert.equal(ok.status, 200, ok.text)
    const after = await appt(e, id, DR_A)
    assert.equal(after.date, NEXT_MONDAY); assert.equal(after.time, '2:00 PM'); assert.equal(after.status, 'accepted'); assert.equal(after.proposal, null)
    assert.ok((await e.get('/care/activity', { as: DR_A })).json.items.some(i => i.type === 'proposal_accepted'))
    assert.equal((await e.get('/doctors/bookings', { as: P1 })).json.find(x => x.appointment_id === id).date, NEXT_MONDAY)
  })

  it('patient reschedule goes back to pending and reappears as unread for the doctor; cancellation syncs', async () => {
    const e = await env()
    const id = await bookAndAccept(e)
    const v = (await appt(e, id, P1)).version
    const r = await e.post(`/care/appointments/${id}/reschedule`, { as: P1, body: { date: NEXT_MONDAY, time: '11:00 AM', version: v } })
    assert.equal(r.status, 200, r.text)
    const req = (await e.get('/doctors/requests', { as: DR_A })).json.find(x => x.appointment_id === id)
    assert.equal(req.status, 'pending'); assert.equal(req.unread, true); assert.equal(req.date, NEXT_MONDAY)
    const c = await e.post(`/doctors/bookings/${id}/cancel`, { as: P1 })
    assert.equal(c.status, 200)
    assert.equal((await e.get('/doctors/requests', { as: DR_A })).json.find(x => x.appointment_id === id).status, 'cancelled')
    assert.ok((await e.get('/care/activity', { as: DR_A })).json.items.some(i => i.type === 'cancelled_by_patient'))
  })

  it('stale versions are rejected (concurrent edits never silently overwrite) and double accepts are refused', async () => {
    const e = await env()
    const id = await bookAndAccept(e)
    const v = (await appt(e, id, DR_A)).version
    const first = await e.post(`/care/doctor/appointments/${id}/propose`, { as: DR_A, body: { date: NEXT_MONDAY, time: '9:00 AM', version: v } })
    assert.equal(first.status, 200)
    const second = await e.post(`/care/appointments/${id}/reschedule`, { as: P1, body: { date: NEXT_MONDAY, time: '3:00 PM', version: v } })
    assert.equal(second.status, 409); assert.equal(second.json.code, 'STALE')
    assert.equal((await e.post(`/care/doctor/appointments/${id}/cancel`, { as: DR_A, body: {} })).json.code, 'VERSION_REQUIRED')
    assert.equal((await e.patch(`/doctors/requests/${id}`, { as: DR_A, body: { status: 'accepted' } })).status, 409)
  })

  it('doctor cancels and completes; a future appointment cannot be completed; slot clashes are refused', async () => {
    const e = await env()
    const id = await bookAndAccept(e)
    const v = (await appt(e, id, DR_A)).version
    assert.equal((await e.post(`/care/doctor/appointments/${id}/complete`, { as: DR_A, body: { version: v } })).json.code, 'NOT_YET')
    // Fixture appointment 2 (patient 2 with doctor B, 2030-01-08, accepted) is in the past and can be completed
    const v2 = (await appt(e, 2, DR_B)).version
    const done = await e.post('/care/doctor/appointments/2/complete', { as: DR_B, body: { version: v2 } })
    assert.equal(done.status, 200); assert.equal(done.json.status, 'completed')
    assert.equal((await e.get('/doctors/bookings', { as: P2 })).json.find(x => x.appointment_id === 2).status, 'completed')
    const cancel = await e.post(`/care/doctor/appointments/${id}/cancel`, { as: DR_A, body: { version: v } })
    assert.equal(cancel.status, 200)
    assert.equal((await e.get('/doctors/bookings', { as: P1 })).json.find(x => x.appointment_id === id).status, 'cancelled_by_doctor')
    // Clash: patient 2 cannot take a slot patient 1 holds
    await bookAndAccept(e, { date: NEXT_MONDAY, time: '9:00 AM' })
    const clash = await e.post('/doctors/book', { as: P2, body: { doctor_id: 1, date: NEXT_MONDAY, time: '9:00 AM' } })
    assert.equal(clash.status, 409)
  })
})

describe('3. Symptoms and health records are visible only with explicit, scoped consent', () => {
  it('an accepted appointment alone gives no access; a grant gives exactly its categories and range; revoke blocks at once', async () => {
    const e = await env()
    const id = await bookAndAccept(e)
    assert.equal((await e.post('/care/symptoms', { as: P1, body: { date: '2030-01-20', type: 'Cramps', severity: 7, bodyArea: 'Lower abdomen', description: 'ZZ-SYMPTOM-TEXT' } })).status, 201)
    assert.equal((await e.post('/care/symptoms', { as: P1, body: { date: '2029-12-01', type: 'Headache', severity: 3 } })).status, 201)

    const none = await e.get(`/care/doctor/patients/${P1}/records?category=symptoms`, { as: DR_A })
    assert.equal(none.status, 403); assert.equal(none.json.code, 'NO_CONSENT')
    assert.equal(none.text.includes('ZZ-SYMPTOM-TEXT'), false)

    const g = await e.post('/care/grants', { as: P1, body: grantBody(id) })
    assert.equal(g.status, 201, g.text)
    const ok = await e.get(`/care/doctor/patients/${P1}/records?category=symptoms`, { as: DR_A })
    assert.equal(ok.status, 200)
    assert.deepEqual(ok.json.rows.map(r => r.type), ['Cramps'], 'only rows inside the granted date range')
    const pain = await e.get(`/care/doctor/patients/${P1}/records?category=pain`, { as: DR_A })
    assert.equal(pain.json.rows[0].pain, 7)
    assert.equal((await e.get(`/care/doctor/patients/${P1}/records?category=wellness`, { as: DR_A })).status, 403, 'category not granted')
    assert.equal((await e.get(`/care/doctor/patients/${P1}/records?category=cycles`, { as: DR_A })).status, 403)

    const pts = (await e.get('/care/doctor/patients', { as: DR_A })).json
    assert.deepEqual(pts.find(p => p.patientId === P1).access.categories, ['pain', 'symptoms'])
    assert.ok(e.rows("SELECT * FROM clinical_audit_events WHERE event_type = 'record_viewed' AND detail_code = 'symptoms'").length >= 1)
    assert.ok(e.rows("SELECT * FROM clinical_audit_events WHERE event_type = 'access_denied'").length >= 1)

    const rv = await e.post(`/care/grants/${g.json.grantId}/revoke`, { as: P1 })
    assert.equal(rv.status, 200)
    assert.equal((await e.get(`/care/doctor/patients/${P1}/records?category=symptoms`, { as: DR_A })).status, 403, 'revocation is immediate')
    assert.equal((await e.post(`/care/grants/${g.json.grantId}/revoke`, { as: P1 })).status, 409)
    assert.throws(() => e.db.run("UPDATE record_access_grants SET status = 'active', revoked_at = NULL WHERE grant_id = ?", [g.json.grantId]), /revoked grant is final/)
  })

  it('consent must be explicit and current; grants expire; patients cannot grant on appointments that are not confirmed', async () => {
    const e = await env()
    const id = await bookAndAccept(e)
    assert.equal((await e.post('/care/grants', { as: P1, body: grantBody(id, { consentAccepted: false }) })).json.code, 'CONSENT_REQUIRED')
    assert.equal((await e.post('/care/grants', { as: P1, body: grantBody(id, { consentVersion: 'v0' }) })).json.code, 'CONSENT_VERSION_MISMATCH')
    assert.equal((await e.post('/care/grants', { as: P1, body: grantBody(id, { categories: ['everything'] }) })).status, 400)
    assert.equal((await e.post('/care/grants', { as: P1, body: grantBody(1) })).status, 403, 'fixture appointment 1 is still pending')
    assert.equal((await e.post('/care/grants', { as: P1, body: grantBody(2) })).status, 404, 'another patient\'s appointment')
    const g = await e.post('/care/grants', { as: P1, body: grantBody(id, { days: 1 }) })
    assert.equal(g.status, 201)
    const stored = e.rows('SELECT consent_text, consent_sha256 FROM record_access_grants WHERE grant_id = ?', [g.json.grantId])[0]
    assert.match(stored.consent_text, /does not give a doctor access/)
    e.state.now = new Date(NOW.getTime() + 2 * 86400000)
    assert.equal((await e.get(`/care/doctor/patients/${P1}/records?category=symptoms`, { as: DR_A })).status, 403, 'expired')
    assert.equal((await e.get('/care/grants', { as: P1 })).json[0].status, 'expired')
  })

  it('therapy sessions: heating and TENS are separate kinds; TENS is always a manual record; retries are idempotent', async () => {
    const e = await env()
    const heat = await e.post('/care/therapy-sessions', { as: P1, body: { kind: 'heat', startedAt: '2030-01-20T10:00:00Z', durationSeconds: 900, heatTempC: 38, painBefore: 6, painAfter: 3, clientRef: 'h-1' } })
    assert.equal(heat.status, 201); assert.equal(heat.json.source, 'device_panel')
    const again = await e.post('/care/therapy-sessions', { as: P1, body: { kind: 'heat', startedAt: '2030-01-20T10:00:00Z', durationSeconds: 900, heatTempC: 38, clientRef: 'h-1' } })
    assert.equal(again.json.duplicate, true)
    const tens = await e.post('/care/therapy-sessions', { as: P1, body: { kind: 'tens', startedAt: '2030-01-21T10:00:00Z', durationSeconds: 600, tensIntensity: 30, tensFrequency: 50 } })
    assert.equal(tens.json.source, 'manual_record')
    assert.equal((await e.post('/care/therapy-sessions', { as: P1, body: { kind: 'tens', startedAt: '2030-01-21T10:00:00Z', durationSeconds: 60, heatTempC: 40 } })).status, 400)
    assert.equal((await e.post('/care/therapy-sessions', { as: P1, body: { kind: 'heat', startedAt: '2030-01-21T10:00:00Z', durationSeconds: 60, tensIntensity: 40 } })).status, 400)
    assert.throws(() => e.db.run("INSERT INTO therapy_sessions (user_id, kind, source, started_at, duration_seconds) VALUES (1,'tens','device_panel','2030-01-01',1)"))
    assert.equal((await e.get('/care/therapy-sessions', { as: P1 })).json.length, 2)
    // A doctor with a heat-only grant sees heat sessions but not TENS sessions
    const id = await bookAndAccept(e)
    await e.post('/care/grants', { as: P1, body: grantBody(id, { categories: ['heat_sessions'] }) })
    const h = await e.get(`/care/doctor/patients/${P1}/records?category=heat_sessions`, { as: DR_A })
    assert.equal(h.json.rows.length, 1); assert.equal(h.json.rows[0].heat_temp_c, 38)
    assert.equal((await e.get(`/care/doctor/patients/${P1}/records?category=tens_sessions`, { as: DR_A })).status, 403)
  })
})

describe('4-6. Report Audit across both portals (existing consent and security preserved)', () => {
  it('share -> doctor receives -> review + verify -> patient sees status and notes -> revoke blocks the doctor', async () => {
    const e = await env()
    const id = await bookAndAccept(e)
    const reportId = await saveReport(e)
    const s = await e.post(`/reports/${reportId}/shares`, { as: P1, body: { doctorId: 1, appointmentId: id, consentVersion: 'consent-v1', consentAccepted: true } })
    assert.equal(s.status, 201, s.text)
    const shareId = s.json.shareId
    const inbox = (await e.get('/reports/inbox', { as: DR_A })).json
    assert.equal(inbox[0].shareId, shareId); assert.equal(inbox[0].limited, false)
    assert.equal((await e.get('/reports/inbox', { as: DR_B })).json.length, 0, 'other doctors receive nothing')
    assert.equal((await e.get('/care/doctor/dashboard', { as: DR_A })).json.reports.awaiting, 1)

    assert.equal((await e.post(`/reports/inbox/${shareId}/status`, { as: DR_A, body: { status: 'under_review' } })).status, 200)
    assert.equal((await e.post(`/reports/inbox/${shareId}/notes`, { as: DR_A, body: { note: 'Reviewed, looks consistent.' } })).status, 201)
    assert.equal((await e.post(`/reports/inbox/${shareId}/status`, { as: DR_A, body: { status: 'verified', confirm: true } })).status, 200)
    const mine = (await e.get(`/reports/shares/${shareId}`, { as: P1 })).json
    assert.equal(mine.status, 'verified'); assert.equal(mine.notes[0].text, 'Reviewed, looks consistent.')
    assert.ok((await e.get('/care/activity', { as: P1 })).json.items.some(i => i.type === 'report_verified'))

    assert.equal((await e.post(`/reports/shares/${shareId}/revoke`, { as: P1 })).status, 200)
    const after = await e.get(`/reports/inbox/${shareId}`, { as: DR_A })
    assert.equal(after.json.limited, true); assert.equal(after.json.snapshot, undefined, 'no report content after revocation')
    assert.ok((await e.get('/care/activity', { as: DR_A })).json.items.some(i => i.type === 'share_revoked'))
  })

  it('a report stays reviewable for 30 days after the consultation is completed, then becomes limited', async () => {
    const e = await env()
    e.db.run("UPDATE appointments SET status = 'accepted' WHERE appointment_id = 1")       // fixture: patient 1 + doctor A, 2030-01-07
    const reportId = await saveReport(e)
    const shareId = (await e.post(`/reports/${reportId}/shares`, { as: P1, body: { doctorId: 1, appointmentId: 1, consentVersion: 'consent-v1', consentAccepted: true } })).json.shareId
    const v = (await appt(e, 1, DR_A)).version
    assert.equal((await e.post('/care/doctor/appointments/1/complete', { as: DR_A, body: { version: v } })).status, 200)
    e.db.run("UPDATE appointments SET completed_at = ? WHERE appointment_id = 1", ['2030-01-20 09:00:00'])   // 12 days before NOW
    const open = await e.get(`/reports/inbox/${shareId}`, { as: DR_A })
    assert.equal(open.json.limited, false); assert.ok(open.json.snapshot)
    e.db.run("UPDATE appointments SET completed_at = ? WHERE appointment_id = 1", ['2029-12-20 09:00:00'])   // 43 days before NOW
    const closed = await e.get(`/reports/inbox/${shareId}`, { as: DR_A })
    assert.equal(closed.json.limited, true); assert.equal(closed.json.limitedReason, 'appointment_inactive')
  })
})

describe('7. Consultation notes, follow-ups and messages', () => {
  it('private notes never reach the patient; patient-visible follow-ups do; text is encrypted at rest', async () => {
    const e = await env()
    const id = await bookAndAccept(e)
    const priv = await e.post(`/care/doctor/appointments/${id}/notes`, { as: DR_A, body: { kind: 'clinical_note', visibility: 'private', text: 'ZZ-PRIVATE-DOCTOR-ONLY' } })
    assert.equal(priv.status, 201, priv.text)
    const fu = await e.post(`/care/doctor/appointments/${id}/notes`, { as: DR_A, body: { kind: 'follow_up', visibility: 'private', text: 'ZZ-FOLLOWUP: apply heat 15 min, review in 2 weeks', dueDate: '2030-02-05' } })
    assert.equal(fu.status, 201); assert.equal(fu.json.visibility, 'patient', 'follow-up instructions are always patient-visible')

    const forPatient = await e.get(`/care/appointments/${id}/notes`, { as: P1 })
    assert.deepEqual(forPatient.json.map(n => n.kind), ['follow_up'])
    assert.equal(forPatient.text.includes('ZZ-PRIVATE'), false)
    for (const p of ['/care/follow-ups', '/care/activity', `/care/appointments/${id}`, '/doctors/bookings']) {
      assert.equal((await e.get(p, { as: P1 })).text.includes('ZZ-PRIVATE'), false, p)
    }
    assert.equal((await e.get('/care/follow-ups', { as: P1 })).json[0].dueDate, '2030-02-05')
    assert.ok((await e.get('/care/activity', { as: P1 })).json.items.some(i => i.type === 'follow_up_added'))
    assert.equal((await e.get('/care/doctor/notes', { as: DR_A })).json.length, 2)
    assert.equal((await e.get('/care/doctor/dashboard', { as: DR_A })).json.followUps.dueNext7Days, 1)

    // Doctor shares the private note explicitly -> now visible; marking the follow-up done syncs too
    assert.equal((await e.patch(`/care/doctor/notes/${priv.json.noteId}`, { as: DR_A, body: { visibility: 'patient' } })).status, 200)
    assert.equal((await e.get(`/care/appointments/${id}/notes`, { as: P1 })).json.length, 2)
    await e.patch(`/care/doctor/notes/${fu.json.noteId}`, { as: DR_A, body: { followUpStatus: 'done' } })
    assert.equal((await e.get('/care/follow-ups', { as: P1 })).json[0].followUpStatus, 'done')
    assert.equal((await e.patch(`/care/doctor/notes/${fu.json.noteId}`, { as: DR_A, body: { visibility: 'private' } })).status, 400)

    const raw = e.dump()
    assert.equal(raw.includes('ZZ-PRIVATE-DOCTOR-ONLY'), false, 'note text is encrypted in the database')
    assert.equal(raw.includes('ZZ-FOLLOWUP'), false)
    assert.throws(() => e.db.run('DELETE FROM consultation_notes'), /cannot be deleted/)
  })

  it('messages flow both ways, are marked read, and are encrypted; a third party cannot read or post', async () => {
    const e = await env()
    const id = await bookAndAccept(e)
    assert.equal((await e.post(`/care/appointments/${id}/messages`, { as: P1, body: { text: 'ZZ-MSG-1 Can I bring my report?' } })).status, 201)
    assert.equal((await e.get('/care/doctor/dashboard', { as: DR_A })).json.unreadMessages, 1)
    const d = await e.get(`/care/appointments/${id}/messages`, { as: DR_A })
    assert.equal(d.json.messages[0].text, 'ZZ-MSG-1 Can I bring my report?'); assert.equal(d.json.messages[0].mine, false)
    assert.equal((await e.get('/care/doctor/dashboard', { as: DR_A })).json.unreadMessages, 0)
    await e.post(`/care/appointments/${id}/messages`, { as: DR_A, body: { text: 'Yes, please do.' } })
    assert.equal((await e.get(`/care/appointments/${id}/messages`, { as: P1 })).json.messages.length, 2)
    assert.ok((await e.get('/care/activity', { as: P1 })).json.items.some(i => i.type === 'message_sent'))
    assert.equal(e.dump().includes('ZZ-MSG-1'), false)
    for (const as of [DR_B, P2]) {
      assert.equal((await e.get(`/care/appointments/${id}/messages`, { as })).status, 404)
      assert.equal((await e.post(`/care/appointments/${id}/messages`, { as, body: { text: 'x' } })).status, 404)
    }
  })
})

describe('8. Another doctor (or patient) cannot reach these records', () => {
  it('doctor B is denied everything about patient 1, even after patient 1 has granted access to doctor A', async () => {
    const e = await env()
    const id = await bookAndAccept(e)
    await e.post('/care/symptoms', { as: P1, body: { date: '2030-01-20', type: 'Cramps', severity: 6 } })
    await e.post('/care/grants', { as: P1, body: grantBody(id, { categories: ['symptoms', 'cycles', 'wellness', 'predictions'] }) })
    await e.post(`/care/doctor/appointments/${id}/notes`, { as: DR_A, body: { kind: 'clinical_note', visibility: 'patient', text: 'note' } })
    for (const cat of ['symptoms', 'cycles', 'wellness', 'predictions', 'pain']) {
      assert.equal((await e.get(`/care/doctor/patients/${P1}/records?category=${cat}`, { as: DR_B })).status, 403, cat)
    }
    assert.equal((await e.get(`/care/appointments/${id}`, { as: DR_B })).status, 404)
    assert.equal((await e.get(`/care/doctor/notes?appointmentId=${id}`, { as: DR_B })).json.length, 0)
    assert.equal((await e.post(`/care/doctor/appointments/${id}/notes`, { as: DR_B, body: { kind: 'clinical_note', visibility: 'private', text: 'x' } })).status, 404)
    assert.equal((await e.post(`/care/doctor/appointments/${id}/propose`, { as: DR_B, body: { date: NEXT_MONDAY, time: '9:00 AM', version: 2 } })).status, 404)
    assert.equal((await e.get('/care/doctor/patients', { as: DR_B })).json.some(p => p.patientId === P1), false)
    // Patient 2 cannot see patient 1's appointment, notes or grants
    assert.equal((await e.get(`/care/appointments/${id}/notes`, { as: P2 })).status, 404)
    assert.equal((await e.get('/care/grants', { as: P2 })).json.length, 0)
    assert.equal((await e.post('/care/grants/1/revoke', { as: P2 })).status, 404)
    // Doctor A with a grant for patient 1 has none for patient 2
    assert.equal((await e.get(`/care/doctor/patients/${P2}/records?category=symptoms`, { as: DR_A })).status, 403)
    const denials = e.rows("SELECT actor_user_id, detail_code FROM clinical_audit_events WHERE outcome = 'denied'")
    assert.ok(denials.some(d => d.actor_user_id === DR_B))
    assert.ok(denials.every(d => !/[A-Z ]/.test(d.detail_code || '')), 'audit holds codes only')
  })

  it('the doctor dashboard counts come from the database only', async () => {
    const e = await env()
    const d0 = (await e.get('/care/doctor/dashboard', { as: DR_A })).json
    assert.equal(d0.today.total, 0); assert.equal(d0.patients.total, 1); assert.equal(d0.pendingRequests, 1)   // fixture: one pending request
    await bookAndAccept(e)
    const d1 = (await e.get('/care/doctor/dashboard', { as: DR_A })).json
    assert.equal(d1.patients.total, 1, 'same patient counted once'); assert.equal(d1.pendingRequests, 1)
  })
})
