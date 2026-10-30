// Report Audit API tests (step 1). SCRATCH ONLY: fictional in-memory databases, random in-memory keys, ephemeral
// 127.0.0.1 ports. Nothing here opens the real database or reads .env.
//   Run:  node --test tests/report-api.test.mjs
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { makeEnv, saveReport, confirmAppointment, consentBody, PERIOD, MARKER, KEY_B, TEST_SECRET } from './helpers/apiHarness.mjs'
import { CONSENT_TEXT, CONSENT_SHA256 } from '../lib/reportConsent.js'
import { applyReportSchema } from '../db/reportSchema.js'

const envs = []
const env = async o => { const e = await makeEnv(o); envs.push(e); return e }
afterEach(async () => { while (envs.length) await envs.pop().close() })

// Patient 1 owns a saved report and has a confirmed appointment with doctor user 3 (profile id 1).
async function shared(o) {
  const e = await env(o); confirmAppointment(e)
  const reportId = await saveReport(e)
  const s = await e.post(`/${reportId}/shares`, { as: 1, body: consentBody(e) })
  return { e, reportId, shareId: s.json.shareId, s }
}
const startReview = (e, shareId) => e.post(`/inbox/${shareId}/status`, { as: 3, body: { status: 'under_review' } })

describe('1. Feature gating and authentication', () => {
  it('reports "not configured" and answers a generic 503 when the key is missing or invalid; no plaintext is touched', async () => {
    for (const key of [null]) {
      const e = await env({ key })
      confirmAppointment(e)
      assert.deepEqual((await e.get('/status', { as: 1 })).json, { enabled: false, reason: 'key' })
      for (const p of ['/', '/consent', '/eligible-doctors']) { const r = await e.get(p, { as: 1 }); assert.equal(r.status, 503); assert.equal(r.json.code, 'NOT_CONFIGURED') }
      assert.equal((await e.post('/preview', { as: 1, body: PERIOD })).status, 503)
      assert.equal((await e.get('/inbox', { as: 3 })).status, 503)
    }
  })
  it('is disabled with reason "schema" until the report tables exist', async () => {
    const e = await env({ migrate: false })
    assert.deepEqual((await e.get('/status', { as: 1 })).json, { enabled: false, reason: 'schema' })
    assert.equal((await e.get('/', { as: 1 })).status, 503)
  })
  it('is enabled when key and schema are present', async () => {
    const e = await env(); assert.deepEqual((await e.get('/status', { as: 1 })).json, { enabled: true, uploads: true })
  })
  it('requires a valid JWT: none=401, malformed/forged/expired=403', async () => {
    const e = await env()
    assert.equal((await e.get('/status')).status, 401)
    assert.equal((await e.get('/status', { rawToken: 'not-a-jwt' })).status, 403)
    assert.equal((await e.get('/status', { rawToken: jwt.sign({ userId: 1, role: 'user' }, 'some-other-secret') })).status, 403)
    assert.equal((await e.get('/status', { rawToken: jwt.sign({ userId: 1, role: 'user' }, TEST_SECRET, { expiresIn: -10 }) })).status, 403)
    assert.equal((await e.get('/status', { rawToken: jwt.sign({ userId: 999, role: 'user' }, TEST_SECRET) })).status, 403)
  })
  it('takes the role from the database, never from the token', async () => {
    const e = await env()
    const claimsDoctor = jwt.sign({ userId: 1, role: 'doctor' }, TEST_SECRET)   // user 1 is a patient in the database
    assert.equal((await e.get('/inbox', { rawToken: claimsDoctor })).status, 403)
    const claimsPatient = jwt.sign({ userId: 3, role: 'user' }, TEST_SECRET)    // user 3 is a doctor in the database
    assert.equal((await e.get('/eligible-doctors', { rawToken: claimsPatient })).status, 403)
  })
  it('keeps patient and doctor routes apart', async () => {
    const e = await env()
    for (const [m, p] of [['get', '/'], ['get', '/consent'], ['get', '/eligible-doctors'], ['post', '/preview']]) assert.equal((await e[m](p, { as: 3, body: PERIOD })).status, 403, p)
    for (const p of ['/inbox', '/inbox/summary']) assert.equal((await e.get(p, { as: 1 })).status, 403, p)
  })
})

describe('2. Eligible doctors come only from confirmed appointments', () => {
  it('lists nothing for a pending appointment and the doctor once it is accepted', async () => {
    const e = await env()
    assert.deepEqual((await e.get('/eligible-doctors', { as: 1 })).json, [])
    confirmAppointment(e)
    const r = (await e.get('/eligible-doctors', { as: 1 })).json
    assert.equal(r.length, 1)
    assert.deepEqual(r[0], { doctorId: 1, name: 'Dr. Fixture Alpha', specialty: 'Gynecology', demo: true, appointment: { id: 1, date: '2030-01-07', time: '9:00 AM', status: 'accepted' } })
  })
  it('excludes declined and cancelled appointments, and other patients\' appointments', async () => {
    const e = await env(); confirmAppointment(e)
    for (const st of ['declined', 'cancelled']) { e.db.run('UPDATE appointments SET status=? WHERE appointment_id=1', [st]); assert.deepEqual((await e.get('/eligible-doctors', { as: 1 })).json, []) }
    assert.equal((await e.get('/eligible-doctors', { as: 2 })).json.length, 1)   // patient 2 has their own accepted appointment with doctor 4
    assert.equal((await e.get('/eligible-doctors', { as: 2 })).json[0].name, 'Dr. Fixture Beta')
  })
  it('excludes an appointment whose doctor account is no longer a doctor', async () => {
    const e = await env(); confirmAppointment(e); e.db.run("UPDATE users SET role='user' WHERE user_id=3")
    assert.deepEqual((await e.get('/eligible-doctors', { as: 1 })).json, [])
  })
})

describe('3. Report generation uses only the patient\'s own recorded data', () => {
  it('previews without saving anything', async () => {
    const e = await env()
    const r = await e.post('/preview', { as: 1, body: PERIOD })
    assert.equal(r.status, 200); assert.equal(r.json.snapshot.sections.cycles.count, 1); assert.equal(r.json.snapshot.sections.wellness.count, 1)
    assert.equal(r.json.snapshot.sections.predictions.source, 'ai_prediction'); assert.deepEqual(r.json.snapshot.notices, ['system_generated', 'ai_not_diagnosis', 'not_doctor_verified'])
    assert.equal(e.rows('SELECT COUNT(*) n FROM report_originals')[0].n, 0)
  })
  it('never includes free text unless asked, and never includes the template AI summary', async () => {
    const e = await env()
    const off = await e.post('/preview', { as: 1, body: PERIOD })
    assert.ok(!off.text.includes(MARKER)); assert.ok(!off.text.includes('TEMPLATE-SUMMARY'))
    const on = await e.post('/preview', { as: 1, body: { ...PERIOD, includeNotes: true } })
    assert.ok(on.text.includes(MARKER)); assert.ok(!on.text.includes('TEMPLATE-SUMMARY'))
    assert.notEqual(off.json.digest, on.json.digest)
  })
  it('contains only the caller\'s rows (patient 2 has none of patient 1\'s data)', async () => {
    const e = await env()
    const r = await e.post('/preview', { as: 2, body: { ...PERIOD, includeNotes: true } })
    assert.equal(r.json.totalItems, 0); assert.ok(!r.text.includes(MARKER))
    assert.equal((await e.post('/', { as: 2, body: { ...PERIOD, digest: r.json.digest } })).status, 422)
  })
  it('validates the period, sections and flags', async () => {
    const e = await env(); const bad = async b => assert.equal((await e.post('/preview', { as: 1, body: b })).status, 400, JSON.stringify(b))
    await bad({ ...PERIOD, from: '2030-02-30' }); await bad({ ...PERIOD, from: 'x' }); await bad({ ...PERIOD, from: '2030-02-01', to: '2030-01-01' })
    await bad({ ...PERIOD, to: '2030-03-01' })                       // future
    await bad({ ...PERIOD, from: '2027-01-01' })                     // > 730 days
    await bad({ ...PERIOD, sections: [] }); await bad({ ...PERIOD, sections: ['cycles', 'users'] }); await bad({ ...PERIOD, sections: ['cycles', 'cycles'] })
    await bad({ ...PERIOD, includeNotes: 'yes' })
  })
  it('saves only after a matching preview, and rejects a stale or missing digest', async () => {
    const e = await env()
    assert.equal((await e.post('/', { as: 1, body: PERIOD })).status, 400)
    assert.equal((await e.post('/', { as: 1, body: { ...PERIOD, digest: 'a'.repeat(64) } })).status, 409)
    const p = await e.post('/preview', { as: 1, body: PERIOD })
    e.db.run("INSERT INTO wellness_records (user_id, date, mood) VALUES (1, '2030-01-20', 'Added later')")
    const r = await e.post('/', { as: 1, body: { ...PERIOD, digest: p.json.digest } })
    assert.equal(r.status, 409); assert.equal(r.json.code, 'DATA_CHANGED')
    const p2 = await e.post('/preview', { as: 1, body: PERIOD })
    const ok = await e.post('/', { as: 1, body: { ...PERIOD, digest: p2.json.digest } })
    assert.equal(ok.status, 201); assert.equal(ok.json.title, 'Health summary 2030-01-01 to 2030-01-31')
  })
  it('lists reports as Draft until they are shared', async () => {
    const e = await env(); const id = await saveReport(e)
    const list = (await e.get('/', { as: 1 })).json
    assert.equal(list.length, 1); assert.equal(list[0].reportId, id); assert.equal(list[0].status, 'draft')
    const open = await e.get(`/${id}`, { as: 1 })
    assert.equal(open.status, 200); assert.equal(open.json.snapshot.sections.cycles.items[0].start_date, '2030-01-01'); assert.equal(open.json.status, 'draft')
  })
})

describe('4. Ownership: other patients and doctors cannot reach a report', () => {
  it('answers identically for someone else\'s report and for an id that does not exist', async () => {
    const e = await env(); const id = await saveReport(e)
    const other = await e.get(`/${id}`, { as: 2 }), none = await e.get('/9999', { as: 2 })
    assert.equal(other.status, 404); assert.equal(other.text, none.text)
    assert.equal((await e.get(`/${id}/activity`, { as: 2 })).status, 404)
    assert.equal((await e.post(`/${id}/shares`, { as: 2, body: consentBody(e) })).status, 404)
    assert.equal((await e.get(`/${id}`, { as: 3 })).status, 403)   // a doctor cannot use the patient route at all
    assert.equal((await e.get('/abc', { as: 1 })).status, 404)
  })
  it('hides someone else\'s share and cannot be revoked by another patient', async () => {
    const { e, shareId } = await shared()
    assert.equal((await e.get(`/shares/${shareId}`, { as: 2 })).status, 404)
    assert.equal((await e.post(`/shares/${shareId}/revoke`, { as: 2 })).status, 404)
    assert.equal(e.rows('SELECT status FROM report_shares')[0].status, 'submitted')
  })
})

describe('5. Sharing needs a confirmed appointment and explicit consent-v1', () => {
  it('refuses a doctor with no appointment, a pending appointment, someone else\'s appointment or the wrong doctor', async () => {
    const e = await env(); const id = await saveReport(e)
    const share = (body) => e.post(`/${id}/shares`, { as: 1, body })
    assert.equal((await share(consentBody(e))).status, 403)                       // appointment still pending
    confirmAppointment(e)
    assert.equal((await share(consentBody(e, { doctorId: 2 }))).status, 403)      // doctor 4: no appointment with patient 1
    assert.equal((await share(consentBody(e, { appointmentId: 2 }))).status, 403) // appointment 2 belongs to patient 2 and doctor 4
    assert.equal((await share(consentBody(e, { doctorId: 99 }))).status, 403)
    assert.equal((await share(consentBody(e, { doctorId: 'x' }))).status, 400)
    assert.equal(e.rows('SELECT COUNT(*) n FROM report_shares')[0].n, 0)
    assert.equal((await share(consentBody(e))).status, 201)
  })
  it('requires explicit consent of the current version', async () => {
    const e = await env(); confirmAppointment(e); const id = await saveReport(e)
    const share = body => e.post(`/${id}/shares`, { as: 1, body })
    assert.equal((await share(consentBody(e, { consentAccepted: false }))).json.code, 'CONSENT_REQUIRED')
    assert.equal((await share(consentBody(e, { consentAccepted: 'true' }))).json.code, 'CONSENT_REQUIRED')
    assert.equal((await share({ doctorId: 1, appointmentId: 1, consentVersion: 'consent-v1' })).json.code, 'CONSENT_REQUIRED')
    assert.equal((await share(consentBody(e, { consentVersion: 'consent-v0' }))).json.code, 'CONSENT_VERSION_MISMATCH')
    assert.equal(e.rows('SELECT COUNT(*) n FROM report_shares')[0].n, 0)
  })
  it('records the server\'s consent text, doctor name and title, ignoring anything the client sends', async () => {
    const e = await env(); confirmAppointment(e); const id = await saveReport(e)
    const r = await e.post(`/${id}/shares`, { as: 1, body: consentBody(e, { consentText: 'client wording', consentDoctorName: 'Someone Else', consent_text: 'x', doctorName: 'Y' }) })
    assert.equal(r.status, 201); assert.equal(r.json.status, 'submitted')
    const s = e.rows('SELECT * FROM report_shares')[0]
    assert.equal(s.consent_text, CONSENT_TEXT); assert.equal(s.consent_text_sha256, CONSENT_SHA256); assert.equal(s.consent_doctor_name, 'Dr. Fixture Alpha')
    assert.equal(s.consent_report_title, 'Health summary 2030-01-01 to 2030-01-31'); assert.equal(s.appointment_id, 1); assert.equal(s.doctor_user_id, 3); assert.equal(s.patient_id, 1)
  })
  it('rejects a duplicate active share and lists the report as Submitted', async () => {
    const { e, reportId } = await shared()
    const dup = await e.post(`/${reportId}/shares`, { as: 1, body: consentBody(e) })
    assert.equal(dup.status, 409); assert.equal(dup.json.code, 'ALREADY_SHARED')
    const row = (await e.get('/', { as: 1 })).json[0]
    assert.equal(row.status, 'submitted'); assert.equal(row.shares[0].doctorName, 'Dr. Fixture Alpha'); assert.equal(row.shares[0].doctorId, 1)   // public doctor id, so the UI can mark already-shared doctors
  })
  it('serves the consent text from the server', async () => {
    const e = await env(); const c = (await e.get('/consent', { as: 1 })).json
    assert.deepEqual(c, { version: 'consent-v1', language: 'en', text: CONSENT_TEXT })
  })
})

describe('6. Doctor inbox: only the selected doctor, only while the appointment stands', () => {
  it('shows the report to the selected doctor only', async () => {
    const { e, shareId } = await shared()
    const inbox = (await e.get('/inbox', { as: 3 })).json
    assert.equal(inbox.length, 1); assert.equal(inbox[0].patientName, 'Fixture Patient One'); assert.equal(inbox[0].status, 'submitted'); assert.equal(inbox[0].limited, false)
    assert.equal(inbox[0].consent.version, 'consent-v1'); assert.equal(inbox[0].consent.language, 'en'); assert.match(inbox[0].consent.at, /^\d{4}-\d{2}-\d{2} /); assert.equal(inbox[0].consent.text, undefined)   // version and time only; no consent text in the view
    assert.deepEqual((await e.get('/inbox', { as: 4 })).json, [])
    assert.deepEqual((await e.get('/inbox/summary', { as: 3 })).json, { submitted: 1, underReview: 0 })
    const other = await e.get(`/inbox/${shareId}`, { as: 4 }), none = await e.get('/inbox/9999', { as: 4 })
    assert.equal(other.status, 404); assert.equal(other.text, none.text)
    for (const m of ['status', 'notes']) assert.equal((await e.post(`/inbox/${shareId}/${m}`, { as: 4, body: { status: 'under_review', note: 'x' } })).status, 404)
    assert.equal(e.rows('SELECT status FROM report_shares')[0].status, 'submitted')
  })
  it('lets the selected doctor read the shared snapshot, and nothing else of the patient', async () => {
    const { e, shareId } = await shared()
    const r = await e.get(`/inbox/${shareId}`, { as: 3 })
    assert.equal(r.status, 200); assert.equal(r.json.snapshot.sections.cycles.count, 1); assert.equal(r.json.limited, false); assert.equal(r.json.appointment.status, 'accepted')
    assert.ok(!r.text.includes('patient1@fixture.invalid')); assert.ok(!r.text.includes(MARKER))
  })
  it('filters by status and patient name', async () => {
    const { e } = await shared()
    assert.equal((await e.get('/inbox?status=submitted', { as: 3 })).json.length, 1)
    assert.equal((await e.get('/inbox?status=verified', { as: 3 })).json.length, 0)
    assert.equal((await e.get('/inbox?q=patient%20one', { as: 3 })).json.length, 1)
    assert.equal((await e.get('/inbox?q=nobody', { as: 3 })).json.length, 0)
    assert.equal((await e.get('/inbox?status=bogus', { as: 3 })).status, 400)
  })
  it('stops showing content when the patient cancels the appointment', async () => {
    const { e, shareId } = await shared()
    e.db.run("UPDATE appointments SET status='cancelled' WHERE appointment_id=1")
    const r = await e.get(`/inbox/${shareId}`, { as: 3 })
    assert.equal(r.status, 200); assert.equal(r.json.limited, true); assert.equal(r.json.limitedReason, 'appointment_inactive'); assert.equal(r.json.snapshot, undefined)
    assert.equal((await startReview(e, shareId)).status, 409)
    assert.deepEqual((await e.get('/inbox/summary', { as: 3 })).json, { submitted: 0, underReview: 0 })
  })
})

describe('7. Review lifecycle', () => {
  it('walks submitted -> under review -> changes requested, and the patient sees the feedback', async () => {
    const { e, shareId } = await shared()
    assert.equal((await e.post(`/inbox/${shareId}/status`, { as: 3, body: { status: 'verified', confirm: true, note: 'n' } })).status, 409)   // cannot skip review
    assert.equal((await e.post(`/inbox/${shareId}/notes`, { as: 3, body: { note: 'too early' } })).json.code, 'NOT_UNDER_REVIEW')
    assert.equal((await startReview(e, shareId)).json.status, 'under_review')
    assert.equal((await e.post(`/inbox/${shareId}/status`, { as: 3, body: { status: 'changes_requested' } })).json.code, 'NOTE_REQUIRED')
    const cr = await e.post(`/inbox/${shareId}/status`, { as: 3, body: { status: 'changes_requested', note: `Please add sleep data ${MARKER}` } })
    assert.equal(cr.status, 200); assert.equal(cr.json.status, 'changes_requested')
    const view = (await e.get(`/shares/${shareId}`, { as: 1 })).json
    assert.equal(view.status, 'changes_requested'); assert.equal(view.notes.length, 1); assert.ok(view.notes[0].text.includes(MARKER))
    assert.equal((await e.get('/', { as: 1 })).json[0].status, 'changes_requested')
  })
  it('marks Verified only after review, with a note and explicit confirmation, by the selected doctor', async () => {
    const { e, shareId } = await shared()
    await startReview(e, shareId)
    const verify = body => e.post(`/inbox/${shareId}/status`, { as: 3, body: { status: 'verified', ...body } })
    assert.equal((await verify({})).json.code, 'CONFIRM_REQUIRED')
    assert.equal((await verify({ confirm: true })).json.code, 'NOTE_REQUIRED')
    assert.equal((await verify({ confirm: 'yes', note: 'ok' })).json.code, 'CONFIRM_REQUIRED')
    assert.equal(e.rows('SELECT status FROM report_shares')[0].status, 'under_review')
    assert.equal((await e.post(`/inbox/${shareId}/status`, { as: 1, body: { status: 'verified', confirm: true, note: 'x' } })).status, 403)   // patient cannot verify
    assert.equal((await e.post(`/inbox/${shareId}/status`, { as: 4, body: { status: 'verified', confirm: true, note: 'x' } })).status, 404)   // other doctor cannot
    const ok = await verify({ confirm: true, note: 'Reviewed and consistent with the consultation.' })
    assert.equal(ok.status, 200); assert.equal(ok.json.status, 'verified')
    const s = e.rows('SELECT status, verified_at FROM report_shares')[0]; assert.equal(s.status, 'verified'); assert.ok(s.verified_at)
    assert.equal((await e.get(`/shares/${shareId}`, { as: 1 })).json.verifiedAt, s.verified_at)
  })
  it('treats Verified as final: no more status changes or notes', async () => {
    const { e, shareId } = await shared()
    await startReview(e, shareId)
    await e.post(`/inbox/${shareId}/status`, { as: 3, body: { status: 'verified', confirm: true, note: 'done' } })
    for (const st of ['under_review', 'changes_requested', 'verified']) assert.equal((await e.post(`/inbox/${shareId}/status`, { as: 3, body: { status: st, note: 'x', confirm: true } })).status, 409, st)
    assert.equal((await e.post(`/inbox/${shareId}/notes`, { as: 3, body: { note: 'late' } })).json.code, 'NOT_UNDER_REVIEW')
    assert.equal((await e.post(`/inbox/${shareId}/status`, { as: 3, body: { status: 'bogus' } })).status, 400)
  })
  it('validates notes (1-4000 characters, text only)', async () => {
    const { e, shareId } = await shared(); await startReview(e, shareId)
    for (const note of ['', '   ', 5, null, 'x'.repeat(4001)]) assert.equal((await e.post(`/inbox/${shareId}/notes`, { as: 3, body: { note } })).status, 400, String(note).slice(0, 10))
    assert.equal((await e.post(`/inbox/${shareId}/notes`, { as: 3, body: { note: 'x'.repeat(4000) } })).status, 201)
  })
  it('lets the patient send a revision after changes were requested, linked to the earlier review', async () => {
    const { e, shareId } = await shared(); await startReview(e, shareId)
    await e.post(`/inbox/${shareId}/status`, { as: 3, body: { status: 'changes_requested', note: 'Add more detail' } })
    const second = await saveReport(e, 1, { ...PERIOD, from: '2029-12-01' })
    assert.equal((await e.post(`/${second}/shares`, { as: 1, body: consentBody(e, { previousShareId: 9999 }) })).json.code, 'INVALID_PREVIOUS_SHARE')
    const ok = await e.post(`/${second}/shares`, { as: 1, body: consentBody(e, { previousShareId: shareId }) })
    assert.equal(ok.status, 201)
    assert.equal(e.rows('SELECT previous_share_id p FROM report_shares WHERE share_id=?', [ok.json.shareId])[0].p, shareId)
  })
})

describe('8. Revocation cuts off future access', () => {
  it('stops the doctor immediately but keeps the patient\'s history', async () => {
    const { e, shareId } = await shared(); await startReview(e, shareId)
    await e.post(`/inbox/${shareId}/notes`, { as: 3, body: { note: 'first note' } })
    const r = await e.post(`/shares/${shareId}/revoke`, { as: 1 })
    assert.equal(r.status, 200); assert.equal(r.json.status, 'revoked')
    const open = await e.get(`/inbox/${shareId}`, { as: 3 })
    assert.equal(open.status, 200); assert.equal(open.json.limited, true); assert.equal(open.json.limitedReason, 'revoked'); assert.equal(open.json.snapshot, undefined); assert.equal(open.json.notes, undefined)
    assert.equal((await e.post(`/inbox/${shareId}/notes`, { as: 3, body: { note: 'after' } })).json.code, 'SHARE_INACTIVE')
    assert.equal((await e.post(`/inbox/${shareId}/status`, { as: 3, body: { status: 'verified', confirm: true, note: 'x' } })).json.code, 'SHARE_INACTIVE')
    assert.equal((await e.get('/inbox/summary', { as: 3 })).json.underReview, 0)
    const mine = (await e.get(`/shares/${shareId}`, { as: 1 })).json
    assert.equal(mine.status, 'revoked'); assert.equal(mine.notes[0].text, 'first note')
    assert.equal((await e.post(`/shares/${shareId}/revoke`, { as: 1 })).json.code, 'ALREADY_REVOKED')
  })
  it('allows a fresh share after revocation, and the revoked one stays revoked', async () => {
    const { e, reportId, shareId } = await shared()
    await e.post(`/shares/${shareId}/revoke`, { as: 1 })
    const again = await e.post(`/${reportId}/shares`, { as: 1, body: consentBody(e) })
    assert.equal(again.status, 201); assert.notEqual(again.json.shareId, shareId)
    assert.equal(e.rows('SELECT status FROM report_shares WHERE share_id=?', [shareId])[0].status, 'revoked')
  })
})

describe('9. Tampering, wrong keys and failed audit all fail closed', () => {
  // Simulates someone editing the database file: the immutability triggers are lifted for the edit and restored before the next request
  // (with the triggers missing the feature would switch itself off, which is tested separately below).
  const dropImmutability = e => {
    e.db.run('DROP TRIGGER trg_report_originals_no_update'); e.db.run('DROP TRIGGER trg_report_versions_no_update')
    e.beforeRequest = () => applyReportSchema(e.db)
  }
  it('switches itself off if a safety trigger has been removed from the database', async () => {
    const e = await env(); e.db.run('DROP TRIGGER trg_report_audit_no_delete')
    assert.deepEqual((await e.get('/status', { as: 1 })).json, { enabled: false, reason: 'schema' })
    assert.equal((await e.get('/', { as: 1 })).status, 503)
  })
  it('refuses an altered report: generic error, no content, an error event', async () => {
    const { e, reportId, shareId } = await shared(); dropImmutability(e)
    e.db.run('UPDATE report_originals SET ciphertext = ? WHERE report_id = ?', [Buffer.from(e.rows('SELECT ciphertext FROM report_originals')[0].ciphertext.map((b, i) => i === 0 ? b ^ 1 : b)), reportId])
    for (const r of [await e.get(`/${reportId}`, { as: 1 }), await e.get(`/inbox/${shareId}`, { as: 3 })]) {
      assert.equal(r.status, 500); assert.equal(r.json.code, 'INTEGRITY_FAILURE'); assert.ok(!r.text.includes('start_date')); assert.ok(!r.text.includes('cycles'))
    }
    assert.ok(e.rows("SELECT 1 FROM report_audit_events WHERE outcome='error' AND detail_code='integrity'").length >= 2)
  })
  it('refuses a report whose stored hash, IV or tag was changed', async () => {
    for (const col of ['envelope_sha256', 'iv', 'auth_tag']) {
      const { e, reportId } = await shared(); dropImmutability(e)
      const cur = e.rows(`SELECT ${col} v FROM report_originals`)[0].v
      const next = typeof cur === 'string' ? 'f'.repeat(64) : Buffer.from(cur.map((b, i) => i === 0 ? b ^ 1 : b))
      e.db.run(`UPDATE report_originals SET ${col} = ? WHERE report_id = ?`, [next, reportId])
      assert.equal((await e.get(`/${reportId}`, { as: 1 })).json.code, 'INTEGRITY_FAILURE', col)
    }
  })
  it('refuses a report copied onto another record or another patient', async () => {
    const e = await env(); const a = await saveReport(e), b = await saveReport(e, 1, { ...PERIOD, from: '2029-12-01' }); dropImmutability(e)
    const rowA = e.rows('SELECT ciphertext, iv, auth_tag, envelope_sha256 FROM report_originals WHERE report_id=?', [a])[0]
    e.db.run('UPDATE report_originals SET ciphertext=?, iv=?, auth_tag=?, envelope_sha256=? WHERE report_id=?', [rowA.ciphertext, rowA.iv, rowA.auth_tag, rowA.envelope_sha256, b])
    assert.equal((await e.get(`/${b}`, { as: 1 })).json.code, 'INTEGRITY_FAILURE')           // other report of the same patient
    dropImmutability(e); e.db.run('UPDATE report_originals SET patient_id=2 WHERE report_id=?', [a])
    assert.equal((await e.get(`/${a}`, { as: 2 })).json.code, 'INTEGRITY_FAILURE')           // other patient
  })
  it('refuses an altered or relocated review note', async () => {
    const { e, shareId } = await shared(); await startReview(e, shareId)
    await e.post(`/inbox/${shareId}/notes`, { as: 3, body: { note: 'authentic note' } }); dropImmutability(e)
    e.db.run('UPDATE report_versions SET note_ciphertext = ?', [Buffer.from(e.rows('SELECT note_ciphertext c FROM report_versions')[0].c.map((b, i) => i === 0 ? b ^ 1 : b))])
    assert.equal((await e.get(`/shares/${shareId}`, { as: 1 })).json.code, 'INTEGRITY_FAILURE')
    assert.equal((await e.get(`/inbox/${shareId}`, { as: 3 })).json.code, 'INTEGRITY_FAILURE')
  })
  it('does not decrypt with the wrong key or a different key id', async () => {
    const { e, reportId } = await shared()
    e.state.key = KEY_B; assert.equal((await e.get(`/${reportId}`, { as: 1 })).json.code, 'INTEGRITY_FAILURE')
    e.state.key = crypto.randomBytes(32); e.state.keyId = 'k2'; assert.equal((await e.get(`/${reportId}`, { as: 1 })).json.code, 'INTEGRITY_FAILURE')
  })
  it('goes to 503 with no plaintext when the key disappears after reports exist', async () => {
    const { e, reportId, shareId } = await shared(); e.state.key = null
    for (const [p, as] of [[`/${reportId}`, 1], [`/inbox/${shareId}`, 3], ['/', 1]]) { const r = await e.get(p, { as }); assert.equal(r.status, 503, p); assert.ok(!r.text.includes('start_date')) }
    assert.equal((await e.get('/status', { as: 1 })).json.enabled, false)
  })
  it('discloses nothing when the audit record cannot be written', async () => {
    const e = await env({ failAudit: true }); confirmAppointment(e)
    const p = await e.post('/preview', { as: 1, body: PERIOD })
    assert.equal(p.status, 200)                                                               // preview stores and discloses no stored record
    assert.equal((await e.post('/', { as: 1, body: { ...PERIOD, digest: p.json.digest } })).status, 500)   // creation is audited in the same transaction
    assert.equal(e.rows('SELECT COUNT(*) n FROM report_originals')[0].n, 0)                    // ...and rolled back
  })
  it('does not return a stored report if reading it cannot be audited', async () => {
    const { e, reportId } = await shared(); e.dbx.run  // same adapter object is used by the router
    const real = e.dbx.transaction; e.dbx.transaction = () => { throw new Error('audit down') }
    const r = await e.get(`/${reportId}`, { as: 1 })
    e.dbx.transaction = real
    assert.equal(r.status, 500); assert.equal(r.json.code, 'AUDIT_FAILED'); assert.ok(!r.text.includes('start_date'))
  })
  it('stores no plaintext in the report record', async () => {
    const e = await env(); const id = await saveReport(e, 1, { ...PERIOD }); const row = e.rows('SELECT * FROM report_originals WHERE report_id=?', [id])[0]
    const blob = Buffer.concat([row.ciphertext, row.iv, row.auth_tag]).toString('latin1')
    for (const s of ['cycles', 'start_date', 'health_summary', '2030-01', 'Fictional', MARKER]) assert.ok(!blob.includes(s), s)
  })
})

describe('10. Audit trail', () => {
  it('records each step with codes only', async () => {
    const { e, reportId, shareId } = await shared(); await startReview(e, shareId)
    await e.post(`/inbox/${shareId}/notes`, { as: 3, body: { note: `secret ${MARKER}` } })
    await e.get(`/inbox/${shareId}`, { as: 3 }); await e.get(`/${reportId}`, { as: 1 })
    await e.post(`/inbox/${shareId}/status`, { as: 3, body: { status: 'changes_requested', note: 'again' } })
    await e.post(`/shares/${shareId}/revoke`, { as: 1 })
    const types = e.rows('SELECT event_type FROM report_audit_events ORDER BY event_id').map(r => r.event_type)
    for (const t of ['report_created', 'consent_recorded', 'share_submitted', 'status_changed', 'review_created', 'report_opened', 'share_revoked']) assert.ok(types.includes(t), t)
    const dump = JSON.stringify(e.rows('SELECT * FROM report_audit_events')); assert.ok(!dump.includes(MARKER)); assert.ok(!dump.includes('secret'))
    const act = (await e.get(`/${reportId}/activity`, { as: 1 })).json
    assert.ok(act.length >= 6); assert.ok(act.every(a => !('actorId' in a)))
    assert.equal((await e.get(`/${reportId}/activity`, { as: 2 })).status, 404)
  })
  it('records denials once a minute per reason instead of for every probe', async () => {
    const { e } = await shared()
    for (let i = 0; i < 6; i++) await e.get('/inbox/9999', { as: 4 })
    assert.equal(e.rows("SELECT COUNT(*) n FROM report_audit_events WHERE event_type='access_denied' AND actor_user_id=4")[0].n, 1)
  })
  it('records a denied share attempt', async () => {
    const e = await env(); const id = await saveReport(e)
    await e.post(`/${id}/shares`, { as: 1, body: consentBody(e) })
    assert.equal(e.rows("SELECT COUNT(*) n FROM report_audit_events WHERE detail_code='not_eligible' AND outcome='denied'")[0].n, 1)
  })
})

describe('11. Rate limiting', () => {
  it('answers 429 after the limit and still protects every route', async () => {
    const e = await env({ limits: { heavyPer10Min: 2, generalPerMinute: 1000 } })
    for (let i = 0; i < 2; i++) assert.equal((await e.post('/preview', { as: 1, body: PERIOD })).status, 200)
    const r = await e.post('/preview', { as: 1, body: PERIOD })
    assert.equal(r.status, 429); assert.equal(r.json.code, 'RATE_LIMITED'); assert.ok(r.headers.get('retry-after'))
  })
})

describe('12. The database enforces the same rules as the API', () => {
  const insert = (e, o = {}) => e.db.run(
    `INSERT INTO report_shares (report_id, patient_id, doctor_user_id, consent_text_version, consent_text, consent_text_sha256, consent_doctor_name, consent_report_title, appointment_id, previous_share_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`, [o.report ?? 1, 1, o.doctor ?? 3, 'consent-v1', CONSENT_TEXT, CONSENT_SHA256, 'Dr', 'T', o.appt ?? null, o.prev ?? null])
  it('rejects a share whose appointment is not accepted, or belongs to someone else', async () => {
    const { e } = await shared(); e.db.run("UPDATE report_shares SET status='revoked', revoked_at=CURRENT_TIMESTAMP WHERE share_id=1")
    e.db.run("UPDATE appointments SET status='pending' WHERE appointment_id=1")
    assert.throws(() => insert(e, { appt: 1 }), /confirmed appointment/)
    assert.throws(() => insert(e, { appt: 2 }), /confirmed appointment/)
    e.db.run("UPDATE appointments SET status='accepted' WHERE appointment_id=1"); insert(e, { appt: 1 })
  })
  it('rejects illegal transitions and verification without a note', async () => {
    const { e, shareId } = await shared()
    assert.throws(() => e.db.run("UPDATE report_shares SET status='verified', verified_at=CURRENT_TIMESTAMP WHERE share_id=?", [shareId]), /illegal status transition/)
    e.db.run("UPDATE report_shares SET status='under_review' WHERE share_id=?", [shareId])
    assert.throws(() => e.db.run("UPDATE report_shares SET status='verified', verified_at=CURRENT_TIMESTAMP WHERE share_id=?", [shareId]), /doctor note/)
    assert.throws(() => e.db.run("UPDATE report_shares SET verified_at=CURRENT_TIMESTAMP WHERE share_id=?", [shareId]), /verified_at/)
    assert.throws(() => e.db.run("UPDATE report_shares SET appointment_id=2 WHERE share_id=?", [shareId]), /immutable/)
  })
})
