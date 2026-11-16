// Business rules for patient <-> doctor synchronisation (/api/care). Pure functions over an injected context:
//
//   ctx = { db: { all, get, run, transaction }, key: () => ({ key, keyId }) /* throws */, now: () => Date }
//
// Every function takes the AUTHENTICATED actor ({ id, role }) or user id first; ownership and relationships are always
// re-checked in SQL. Anything an actor may not see is answered with the same generic 404 (or 403 for missing consent).
// Rules that matter for safety:
//   - An appointment never grants access to health records. Only an active, unexpired record_access_grant does, and only
//     for its categories, date range, doctor and appointment.
//   - Private consultation notes are never returned to a patient (filtered in SQL, not in the UI).
//   - Every appointment change needs the version the client last saw; a stale version is a 409, never a silent overwrite.
import { encrypt, decrypt } from './reportCrypto.js'
import { getRecordConsent, RECORD_CONSENT_VERSION } from './recordConsent.js'
import { CLINICAL_SCHEMA_OBJECTS, APPOINTMENT_COLUMNS, RECORD_CATEGORIES, GRANT_PURPOSES } from '../db/clinicalSchema.js'
import { checkSlot, SlotError, isoDay, validDate, TIME_SLOTS, byWhen } from './appointmentRules.js'

export class CareError extends Error {
  constructor(status, code, message) { super(message); this.name = 'CareError'; this.status = status; this.code = code }
}
const E = (status, code, message) => new CareError(status, code, message)
const notFound = () => E(404, 'NOT_FOUND', 'Not found.')
const isId = v => Number.isInteger(v) && v > 0

export const MAX_NOTE_CHARS = 4000
export const MAX_MESSAGE_CHARS = 2000
export const REPORT_GRACE_DAYS = 30          // report and message access after a consultation is completed
export const MAX_GRANT_DAYS = 90

// ---------------------------------------------------------------- feature status
export function schemaReady(db) {
  try {
    const have = new Set(db.all('SELECT name FROM sqlite_master').map(r => r.name))
    const needed = [...CLINICAL_SCHEMA_OBJECTS.tables, ...CLINICAL_SCHEMA_OBJECTS.triggers, ...CLINICAL_SCHEMA_OBJECTS.indexes]
    if (needed.some(n => !have.has(n))) return false
    const cols = new Set(db.all('PRAGMA table_info(appointments)').map(c => c.name))
    return APPOINTMENT_COLUMNS.every(c => cols.has(c.name))
  } catch { return false }
}
function keyReady(ctx) { try { ctx.key(); return true } catch { return false } }

export function featureStatus(ctx) {
  if (!schemaReady(ctx.db)) return { enabled: false, reason: 'schema' }
  return { enabled: true, notes: keyReady(ctx) }
}
function getKey(ctx) {
  try { return ctx.key() } catch { throw E(503, 'NOTES_UNAVAILABLE', 'Notes and messages are not available right now.') }
}

// ---------------------------------------------------------------- audit + events
function writeAudit(db, e) {
  db.run(
    `INSERT INTO clinical_audit_events (event_type, outcome, actor_user_id, actor_role, patient_id, appointment_id, grant_id, note_id, detail_code)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [e.type, e.outcome || 'ok', e.actor?.id ?? null, e.actor?.role ?? null, e.patientId ?? null, e.appointmentId ?? null,
     e.grantId ?? null, e.noteId ?? null, e.detail ?? null])
}
// Disclosure audit: must succeed, otherwise nothing is returned.
function auditOrFail(ctx, e) {
  try { ctx.db.transaction(tx => writeAudit(tx, e)) } catch { throw E(500, 'AUDIT_FAILED', 'The request could not be completed.') }
}
// Denials are recorded at most once per actor+reason per minute.
function denied(ctx, actor, detail, ids = {}) {
  try {
    const dup = ctx.db.get(
      "SELECT 1 AS x FROM clinical_audit_events WHERE event_type = 'access_denied' AND actor_user_id = ? AND detail_code = ? AND created_at >= datetime('now', '-60 seconds') LIMIT 1",
      [actor.id, detail])
    if (!dup) ctx.db.transaction(tx => writeAudit(tx, { type: 'access_denied', outcome: 'denied', actor, detail, ...ids }))
  } catch { /* a failed denial log never turns a denial into an allow */ }
}

function addEvent(tx, appt, actor, type, slot = {}) {
  tx.run(
    `INSERT INTO appointment_events (appointment_id, actor_user_id, actor_role, event_type, from_date, from_time, to_date, to_time)
     VALUES (?,?,?,?,?,?,?,?)`,
    [appt.appointment_id, actor.id, actor.role, type, slot.fromDate ?? null, slot.fromTime ?? null, slot.toDate ?? null, slot.toTime ?? null])
}

// Called by routes/doctors.js for the existing book / accept / decline / cancel actions. No-op before the migration,
// so those endpoints behave exactly as they always have until the schema exists.
export function recordLegacyEvent(db, { appointmentId, actor, type, toDate, toTime }) {
  if (!schemaReady(db)) return
  try {
    db.transaction(tx => {
      tx.run(`UPDATE appointments SET updated_by = ?${type === 'requested' ? '' : ', version = version + 1'} WHERE appointment_id = ?`, [actor.id, appointmentId])
      addEvent(tx, { appointment_id: appointmentId }, actor, type, { toDate, toTime })
    })
  } catch (err) { console.error('Appointment event not recorded:', err?.name || 'Error') }
}

// Version-checked appointment update inside a transaction. Returns nothing; throws 409 if someone changed it first.
function updateAppointment(tx, apptId, expectedVersion, set, params, actorId) {
  tx.run(
    `UPDATE appointments SET ${set}, version = version + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP
     WHERE appointment_id = ? AND version = ?`, [...params, actorId, apptId, expectedVersion])
  if (Number(tx.get('SELECT changes() AS n').n) !== 1) throw E(409, 'STALE', 'This appointment was updated elsewhere. Please refresh and try again.')
}

// ---------------------------------------------------------------- appointment access
const APPT_COLS = `a.appointment_id, a.patient_id, a.doctor_user_id, a.requested_date, a.requested_time, a.price, a.status,
  a.created_at, a.updated_at, a.version, a.completed_at, a.proposed_date, a.proposed_time, a.proposed_by,
  u.name AS patient_name, p.doctor_id, p.display_name AS doctor_name, p.specialty, p.days, p.user_id AS profile_user_id`

function loadAppointment(ctx, apptId) {
  return ctx.db.get(
    `SELECT ${APPT_COLS} FROM appointments a JOIN users u ON u.user_id = a.patient_id
     LEFT JOIN doctor_profiles p ON p.user_id = a.doctor_user_id WHERE a.appointment_id = ?`, [apptId])
}

// The appointment if the actor is one of its two parties; otherwise a logged, generic 404.
function partyAppointment(ctx, actor, apptId) {
  if (!isId(apptId)) throw notFound()
  const a = loadAppointment(ctx, apptId)
  const ok = a && ((actor.role === 'user' && a.patient_id === actor.id) || (actor.role === 'doctor' && a.doctor_user_id === actor.id))
  if (!ok) { denied(ctx, actor, 'appt_not_party', { appointmentId: apptId }); throw notFound() }
  return a
}

const daysSince = (ctx, ts) => ts ? (ctx.now().getTime() - new Date(String(ts).replace(' ', 'T') + (String(ts).endsWith('Z') ? '' : 'Z')).getTime()) / 86400000 : Infinity
// Completed consultations stay open for follow-up (notes, messages, reports) for REPORT_GRACE_DAYS.
export function withinGrace(ctx, a) {
  return a.status === 'accepted' || (a.status === 'completed' && daysSince(ctx, a.completed_at) <= REPORT_GRACE_DAYS)
}

function apptView(a, role) {
  const view = {
    appointmentId: a.appointment_id, status: a.status, date: a.requested_date, time: a.requested_time, price: a.price,
    version: a.version, createdAt: a.created_at, updatedAt: a.updated_at, completedAt: a.completed_at ?? null,
    proposal: a.proposed_date ? { date: a.proposed_date, time: a.proposed_time, byDoctor: a.proposed_by === a.doctor_user_id } : null,
    doctor: { doctorId: a.doctor_id, name: a.doctor_name, specialty: a.specialty },
  }
  if (role === 'doctor') view.patient = { patientId: a.patient_id, name: a.patient_name }
  return view
}

const EVENT_VIEW = e => ({
  eventId: e.event_id, appointmentId: e.appointment_id, type: e.event_type, actorRole: e.actor_role,
  from: e.from_date ? { date: e.from_date, time: e.from_time } : null, to: e.to_date ? { date: e.to_date, time: e.to_time } : null,
  createdAt: e.created_at,
})

export function getAppointment(ctx, actor, apptId) {
  const a = partyAppointment(ctx, actor, apptId)
  const events = ctx.db.all('SELECT * FROM appointment_events WHERE appointment_id = ? ORDER BY event_id', [a.appointment_id]).map(EVENT_VIEW)
  const unread = Number(ctx.db.get(
    'SELECT COUNT(*) AS n FROM appointment_messages WHERE appointment_id = ? AND sender_user_id <> ? AND read_at IS NULL', [a.appointment_id, actor.id]).n)
  return { ...apptView(a, actor.role), events, unreadMessages: unread, canMessage: canMessage(ctx, a), canAddNotes: actor.role === 'doctor' && withinGrace(ctx, a) }
}

function slotError(err) {
  if (err instanceof SlotError) return E(err.status, err.code, err.message)
  return err
}
const profileOf = a => ({ user_id: a.doctor_user_id, display_name: a.doctor_name, days: a.days })
const needVersion = body => {
  const v = body?.version
  if (!Number.isInteger(v) || v < 1) throw E(400, 'VERSION_REQUIRED', 'Please refresh: this action needs the latest appointment version.')
  return v
}

// ---------------------------------------------------------------- appointment lifecycle (patient)
// Patient moves their own request/appointment to a new slot. It goes back to 'pending' for the doctor to confirm.
export function patientReschedule(ctx, patientId, apptId, body) {
  const actor = { id: patientId, role: 'user' }
  const a = partyAppointment(ctx, actor, apptId)
  const version = needVersion(body)
  if (!['pending', 'accepted'].includes(a.status)) throw E(409, 'ILLEGAL_TRANSITION', `A ${a.status} appointment cannot be rescheduled.`)
  if (!a.doctor_name) throw E(409, 'DOCTOR_UNAVAILABLE', 'This doctor is not available for online booking.')
  let date
  try { date = checkSlot(ctx.db, { profile: profileOf(a), date: body?.date, time: body?.time, now: ctx.now(), excludeId: a.appointment_id, patientId }) } catch (e) { throw slotError(e) }
  if (date === a.requested_date && body.time === a.requested_time) throw E(400, 'SAME_SLOT', 'Choose a different date or time.')
  ctx.db.transaction(tx => {
    updateAppointment(tx, a.appointment_id, version,
      "requested_date = ?, requested_time = ?, status = 'pending', doctor_seen = 0, proposed_date = NULL, proposed_time = NULL, proposed_by = NULL",
      [date, body.time], patientId)
    addEvent(tx, a, actor, 'rescheduled_by_patient', { fromDate: a.requested_date, fromTime: a.requested_time, toDate: date, toTime: body.time })
    writeAudit(tx, { type: 'appointment_changed', actor, patientId, appointmentId: a.appointment_id, detail: 'rescheduled_by_patient' })
  })
  return getAppointment(ctx, actor, a.appointment_id)
}

// Patient accepts or declines a time the doctor proposed. Accepting moves the slot and confirms the appointment.
export function patientRespondProposal(ctx, patientId, apptId, body) {
  const actor = { id: patientId, role: 'user' }
  const a = partyAppointment(ctx, actor, apptId)
  const version = needVersion(body)
  if (!a.proposed_date || a.proposed_by !== a.doctor_user_id) throw E(409, 'NO_PROPOSAL', 'There is no proposed time to respond to.')
  if (!['pending', 'accepted'].includes(a.status)) throw E(409, 'ILLEGAL_TRANSITION', `A ${a.status} appointment cannot be changed.`)
  if (typeof body?.accept !== 'boolean') throw E(400, 'INVALID_INPUT', 'Say whether you accept the proposed time.')
  if (body.accept) {
    try { checkSlot(ctx.db, { profile: profileOf(a), date: a.proposed_date, time: a.proposed_time, now: ctx.now(), excludeId: a.appointment_id, patientId }) } catch (e) { throw slotError(e) }
  }
  ctx.db.transaction(tx => {
    if (body.accept) {
      updateAppointment(tx, a.appointment_id, version,
        "requested_date = proposed_date, requested_time = proposed_time, status = 'accepted', proposed_date = NULL, proposed_time = NULL, proposed_by = NULL",
        [], patientId)
      addEvent(tx, a, actor, 'proposal_accepted', { fromDate: a.requested_date, fromTime: a.requested_time, toDate: a.proposed_date, toTime: a.proposed_time })
    } else {
      updateAppointment(tx, a.appointment_id, version, 'proposed_date = NULL, proposed_time = NULL, proposed_by = NULL', [], patientId)
      addEvent(tx, a, actor, 'proposal_declined', { toDate: a.proposed_date, toTime: a.proposed_time })
    }
    writeAudit(tx, { type: 'appointment_changed', actor, patientId, appointmentId: a.appointment_id, detail: body.accept ? 'proposal_accepted' : 'proposal_declined' })
  })
  return getAppointment(ctx, actor, a.appointment_id)
}

// ---------------------------------------------------------------- appointment lifecycle (doctor)
// Doctor proposes a new time. Nothing moves until the patient explicitly accepts it.
export function doctorPropose(ctx, doctorId, apptId, body) {
  const actor = { id: doctorId, role: 'doctor' }
  const a = partyAppointment(ctx, actor, apptId)
  const version = needVersion(body)
  if (!['pending', 'accepted'].includes(a.status)) throw E(409, 'ILLEGAL_TRANSITION', `A ${a.status} appointment cannot be rescheduled.`)
  let date
  try { date = checkSlot(ctx.db, { profile: profileOf(a), date: body?.date, time: body?.time, now: ctx.now(), excludeId: a.appointment_id }) } catch (e) { throw slotError(e) }
  if (date === a.requested_date && body.time === a.requested_time) throw E(400, 'SAME_SLOT', 'Choose a different date or time.')
  ctx.db.transaction(tx => {
    updateAppointment(tx, a.appointment_id, version, 'proposed_date = ?, proposed_time = ?, proposed_by = ?, doctor_seen = 1', [date, body.time, doctorId], doctorId)
    addEvent(tx, a, actor, 'reschedule_proposed', { fromDate: a.requested_date, fromTime: a.requested_time, toDate: date, toTime: body.time })
    writeAudit(tx, { type: 'appointment_changed', actor, patientId: a.patient_id, appointmentId: a.appointment_id, detail: 'reschedule_proposed' })
  })
  return getAppointment(ctx, actor, a.appointment_id)
}

export function doctorComplete(ctx, doctorId, apptId, body) {
  const actor = { id: doctorId, role: 'doctor' }
  const a = partyAppointment(ctx, actor, apptId)
  const version = needVersion(body)
  if (a.status !== 'accepted') throw E(409, 'ILLEGAL_TRANSITION', `A ${a.status} appointment cannot be completed.`)
  if (a.requested_date > isoDay(ctx.now())) throw E(409, 'NOT_YET', 'An appointment can be completed on or after its date.')
  ctx.db.transaction(tx => {
    updateAppointment(tx, a.appointment_id, version,
      "status = 'completed', completed_at = CURRENT_TIMESTAMP, proposed_date = NULL, proposed_time = NULL, proposed_by = NULL", [], doctorId)
    addEvent(tx, a, actor, 'completed')
    writeAudit(tx, { type: 'appointment_changed', actor, patientId: a.patient_id, appointmentId: a.appointment_id, detail: 'completed' })
  })
  return getAppointment(ctx, actor, a.appointment_id)
}

export function doctorCancel(ctx, doctorId, apptId, body) {
  const actor = { id: doctorId, role: 'doctor' }
  const a = partyAppointment(ctx, actor, apptId)
  const version = needVersion(body)
  if (!['pending', 'accepted'].includes(a.status)) throw E(409, 'ILLEGAL_TRANSITION', `A ${a.status} appointment cannot be cancelled.`)
  ctx.db.transaction(tx => {
    updateAppointment(tx, a.appointment_id, version,
      "status = 'cancelled_by_doctor', proposed_date = NULL, proposed_time = NULL, proposed_by = NULL", [], doctorId)
    addEvent(tx, a, actor, 'cancelled_by_doctor', { fromDate: a.requested_date, fromTime: a.requested_time })
    writeAudit(tx, { type: 'appointment_changed', actor, patientId: a.patient_id, appointmentId: a.appointment_id, detail: 'cancelled_by_doctor' })
  })
  return getAppointment(ctx, actor, a.appointment_id)
}

// ---------------------------------------------------------------- encryption helpers (notes / messages)
function aadFor(kind, ids) {
  for (const v of Object.values(ids)) if (!isId(v)) throw E(500, 'SERVER_ERROR', 'The request could not be completed.')
  return Buffer.from(`nr-clin|v1|${kind}|${Object.entries(ids).map(([k, v]) => `${k}:${v}`).join('|')}`, 'utf8')
}
const nextId = (tx, table) => Number(tx.get(`SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = '${table}'), 0) + 1 AS n`).n)
function open(ctx, row, kind, ids) {
  const { key, keyId } = getKey(ctx)
  if (row.key_id !== keyId) throw E(500, 'INTEGRITY', 'A stored record could not be verified.')
  try { return decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, { key, aad: aadFor(kind, ids) }).toString('utf8') }
  catch { throw E(500, 'INTEGRITY', 'A stored record could not be verified.') }
}
function cleanText(v, max) {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length >= 1 && t.length <= max ? t : null
}

// ---------------------------------------------------------------- consultation notes
const NOTE_KINDS = ['clinical_note', 'follow_up', 'summary']
function noteView(ctx, n, role) {
  const text = open(ctx, n, 'note', { noteId: n.note_id, appointmentId: n.appointment_id, authorId: n.doctor_user_id })
  const v = {
    noteId: n.note_id, appointmentId: n.appointment_id, kind: n.kind, visibility: n.visibility, text,
    followUpStatus: n.follow_up_status ?? null, dueDate: n.due_date ?? null, createdAt: n.created_at, updatedAt: n.updated_at,
  }
  if (role === 'doctor') { v.patientId = n.patient_id; v.patientName = n.patient_name }
  else { v.doctorName = n.doctor_name }
  return v
}

export function doctorAddNote(ctx, doctorId, apptId, body) {
  const actor = { id: doctorId, role: 'doctor' }
  const a = partyAppointment(ctx, actor, apptId)
  if (!withinGrace(ctx, a)) throw E(409, 'APPT_INACTIVE', 'Notes can be added to confirmed or recently completed consultations only.')
  const kind = body?.kind
  if (!NOTE_KINDS.includes(kind)) throw E(400, 'INVALID_INPUT', 'Choose a note type.')
  const visibility = kind === 'follow_up' ? 'patient' : body?.visibility
  if (!['private', 'patient'].includes(visibility)) throw E(400, 'INVALID_INPUT', 'Choose who can see this note.')
  const text = cleanText(body?.text, MAX_NOTE_CHARS)
  if (!text) throw E(400, 'INVALID_INPUT', `A note of 1 to ${MAX_NOTE_CHARS} characters is required.`)
  let dueDate = null
  if (kind === 'follow_up' && body?.dueDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) || Number.isNaN(Date.parse(body.dueDate + 'T00:00:00Z'))) throw E(400, 'INVALID_INPUT', 'Invalid due date.')
    dueDate = body.dueDate
  }
  const { key, keyId } = getKey(ctx)
  const noteId = ctx.db.transaction(tx => {
    const id = nextId(tx, 'consultation_notes')
    const env = encrypt(text, { key, aad: aadFor('note', { noteId: id, appointmentId: a.appointment_id, authorId: doctorId }) })
    tx.run(
      `INSERT INTO consultation_notes (appointment_id, doctor_user_id, patient_id, kind, visibility, follow_up_status, due_date, ciphertext, iv, auth_tag, key_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [a.appointment_id, doctorId, a.patient_id, kind, visibility, kind === 'follow_up' ? 'open' : null, dueDate, env.ciphertext, env.iv, env.authTag, keyId])
    const got = Number(tx.get('SELECT MAX(note_id) AS id FROM consultation_notes').id)
    if (got !== id) throw E(409, 'RETRY', 'Please try again.')
    if (visibility === 'patient') addEvent(tx, a, actor, kind === 'follow_up' ? 'follow_up_added' : 'note_shared')
    writeAudit(tx, { type: 'note_created', actor, patientId: a.patient_id, appointmentId: a.appointment_id, noteId: id, detail: `${kind}.${visibility}` })
    return id
  })
  return { noteId, visibility, kind }
}

const NOTE_JOIN = `SELECT n.*, u.name AS patient_name, p.display_name AS doctor_name FROM consultation_notes n
  JOIN users u ON u.user_id = n.patient_id LEFT JOIN doctor_profiles p ON p.user_id = n.doctor_user_id`

// Doctor: all of their own notes (optionally for one appointment / patient / kind)
export function doctorNotes(ctx, doctorId, query = {}) {
  const where = ['n.doctor_user_id = ?']
  const params = [doctorId]
  const apptId = query.appointmentId !== undefined ? Number(query.appointmentId) : null
  const patientId = query.patientId !== undefined ? Number(query.patientId) : null
  if (apptId !== null) { if (!isId(apptId)) throw E(400, 'INVALID_INPUT', 'Invalid appointment.'); where.push('n.appointment_id = ?'); params.push(apptId) }
  if (patientId !== null) { if (!isId(patientId)) throw E(400, 'INVALID_INPUT', 'Invalid patient.'); where.push('n.patient_id = ?'); params.push(patientId) }
  if (query.kind !== undefined) { if (!NOTE_KINDS.includes(query.kind)) throw E(400, 'INVALID_INPUT', 'Invalid note type.'); where.push('n.kind = ?'); params.push(query.kind) }
  const rows = ctx.db.all(`${NOTE_JOIN} WHERE ${where.join(' AND ')} ORDER BY n.created_at DESC, n.note_id DESC LIMIT 200`, params)
  return rows.map(n => noteView(ctx, n, 'doctor'))
}

export function doctorUpdateNote(ctx, doctorId, noteId, body) {
  const actor = { id: doctorId, role: 'doctor' }
  if (!isId(noteId)) throw notFound()
  const n = ctx.db.get('SELECT * FROM consultation_notes WHERE note_id = ? AND doctor_user_id = ?', [noteId, doctorId])
  if (!n) { denied(ctx, actor, 'note_not_owned'); throw notFound() }
  const changes = []
  if (body?.visibility !== undefined) {
    if (!['private', 'patient'].includes(body.visibility)) throw E(400, 'INVALID_INPUT', 'Invalid visibility.')
    if (n.kind === 'follow_up' && body.visibility !== 'patient') throw E(400, 'INVALID_INPUT', 'Follow-up instructions are always visible to the patient.')
    if (body.visibility !== n.visibility) changes.push(['visibility', body.visibility, 'note_visibility_changed'])
  }
  if (body?.followUpStatus !== undefined) {
    if (n.kind !== 'follow_up' || !['open', 'done'].includes(body.followUpStatus)) throw E(400, 'INVALID_INPUT', 'Invalid follow-up status.')
    if (body.followUpStatus !== n.follow_up_status) changes.push(['follow_up_status', body.followUpStatus, 'note_status_changed'])
  }
  if (!changes.length) return { noteId, unchanged: true }
  ctx.db.transaction(tx => {
    for (const [col, val, type] of changes) {
      tx.run(`UPDATE consultation_notes SET ${col} = ?, updated_at = CURRENT_TIMESTAMP WHERE note_id = ? AND doctor_user_id = ?`, [val, noteId, doctorId])
      writeAudit(tx, { type, actor, patientId: n.patient_id, appointmentId: n.appointment_id, noteId, detail: String(val) })
    }
    if (changes.some(c => c[0] === 'visibility' && c[1] === 'patient')) addEvent(tx, n, actor, 'note_shared')
  })
  return { noteId, updated: changes.map(c => c[0]) }
}

// Patient: only notes marked patient-visible, for their own appointments (the filter is in SQL).
export function patientNotes(ctx, patientId, apptId) {
  const actor = { id: patientId, role: 'user' }
  const a = partyAppointment(ctx, actor, apptId)
  const rows = ctx.db.all(`${NOTE_JOIN} WHERE n.appointment_id = ? AND n.patient_id = ? AND n.visibility = 'patient' ORDER BY n.created_at, n.note_id`,
    [a.appointment_id, patientId])
  if (rows.length) auditOrFail(ctx, { type: 'note_viewed', actor, patientId, appointmentId: a.appointment_id, detail: 'patient_view' })
  return rows.map(n => noteView(ctx, n, 'user'))
}

export function patientFollowUps(ctx, patientId) {
  const rows = ctx.db.all(`${NOTE_JOIN} WHERE n.patient_id = ? AND n.visibility = 'patient' AND n.kind = 'follow_up' ORDER BY n.follow_up_status, n.due_date, n.note_id DESC LIMIT 100`, [patientId])
  return rows.map(n => noteView(ctx, n, 'user'))
}

export function doctorFollowUps(ctx, doctorId) {
  const rows = ctx.db.all(`${NOTE_JOIN} WHERE n.doctor_user_id = ? AND n.kind = 'follow_up' ORDER BY n.follow_up_status, COALESCE(n.due_date, '9999') , n.note_id DESC LIMIT 200`, [doctorId])
  return rows.map(n => noteView(ctx, n, 'doctor'))
}

// ---------------------------------------------------------------- messages
function canMessage(ctx, a) {
  return a.status === 'pending' || withinGrace(ctx, a)
}

export function listMessages(ctx, actor, apptId) {
  const a = partyAppointment(ctx, actor, apptId)
  const rows = ctx.db.all('SELECT * FROM appointment_messages WHERE appointment_id = ? ORDER BY message_id', [a.appointment_id])
  const out = rows.map(m => ({
    messageId: m.message_id, mine: m.sender_user_id === actor.id, senderRole: m.sender_role,
    text: open(ctx, m, 'message', { messageId: m.message_id, appointmentId: m.appointment_id, senderId: m.sender_user_id }),
    createdAt: m.created_at, readAt: m.read_at ?? null,
  }))
  if (rows.some(m => m.sender_user_id !== actor.id && !m.read_at)) {
    ctx.db.transaction(tx => {
      tx.run('UPDATE appointment_messages SET read_at = CURRENT_TIMESTAMP WHERE appointment_id = ? AND sender_user_id <> ? AND read_at IS NULL', [a.appointment_id, actor.id])
      writeAudit(tx, { type: 'messages_viewed', actor, patientId: a.patient_id, appointmentId: a.appointment_id })
    })
  }
  return { messages: out, canMessage: canMessage(ctx, a) }
}

export function sendMessage(ctx, actor, apptId, body) {
  const a = partyAppointment(ctx, actor, apptId)
  if (!canMessage(ctx, a)) throw E(409, 'APPT_INACTIVE', 'Messages are closed for this appointment.')
  const text = cleanText(body?.text, MAX_MESSAGE_CHARS)
  if (!text) throw E(400, 'INVALID_INPUT', `A message of 1 to ${MAX_MESSAGE_CHARS} characters is required.`)
  const { key, keyId } = getKey(ctx)
  const messageId = ctx.db.transaction(tx => {
    const id = nextId(tx, 'appointment_messages')
    const env = encrypt(text, { key, aad: aadFor('message', { messageId: id, appointmentId: a.appointment_id, senderId: actor.id }) })
    tx.run('INSERT INTO appointment_messages (appointment_id, sender_user_id, sender_role, ciphertext, iv, auth_tag, key_id) VALUES (?,?,?,?,?,?,?)',
      [a.appointment_id, actor.id, actor.role, env.ciphertext, env.iv, env.authTag, keyId])
    if (Number(tx.get('SELECT MAX(message_id) AS id FROM appointment_messages').id) !== id) throw E(409, 'RETRY', 'Please try again.')
    addEvent(tx, a, actor, 'message_sent')
    writeAudit(tx, { type: 'message_sent', actor, patientId: a.patient_id, appointmentId: a.appointment_id })
    return id
  })
  return { messageId }
}

// Conversations for the inbox: one row per appointment the actor is party to that has messages or is open.
export function conversations(ctx, actor) {
  const col = actor.role === 'doctor' ? 'a.doctor_user_id' : 'a.patient_id'
  const rows = ctx.db.all(
    `SELECT ${APPT_COLS},
       (SELECT COUNT(*) FROM appointment_messages m WHERE m.appointment_id = a.appointment_id) AS total,
       (SELECT COUNT(*) FROM appointment_messages m WHERE m.appointment_id = a.appointment_id AND m.sender_user_id <> ? AND m.read_at IS NULL) AS unread,
       (SELECT MAX(created_at) FROM appointment_messages m WHERE m.appointment_id = a.appointment_id) AS last_at
     FROM appointments a JOIN users u ON u.user_id = a.patient_id LEFT JOIN doctor_profiles p ON p.user_id = a.doctor_user_id
     WHERE ${col} = ? ORDER BY COALESCE(last_at, a.updated_at) DESC LIMIT 100`, [actor.id, actor.id])
  return rows.filter(r => r.total > 0 || canMessage(ctx, r)).map(r => ({
    ...apptView(r, actor.role), messageCount: Number(r.total), unread: Number(r.unread), lastMessageAt: r.last_at ?? null, canMessage: canMessage(ctx, r),
  }))
}

// ---------------------------------------------------------------- record access grants (patient consent)
export const getConsent = () => { const c = getRecordConsent(); return { version: c.version, language: c.language, text: c.text, categories: RECORD_CATEGORIES, purposes: GRANT_PURPOSES, maxDays: MAX_GRANT_DAYS } }

const grantActive = (ctx, g) => g.status === 'active' && String(g.expires_at) > ctx.now().toISOString()
function grantView(ctx, g) {
  return {
    grantId: g.grant_id, appointmentId: g.appointment_id, doctorName: g.doctor_name, patientName: g.patient_name,
    categories: String(g.categories).split(','), purpose: g.purpose, rangeFrom: g.range_from, rangeTo: g.range_to,
    expiresAt: g.expires_at, status: g.status === 'active' && !grantActive(ctx, g) ? 'expired' : g.status,
    createdAt: g.created_at, revokedAt: g.revoked_at ?? null, consentVersion: g.consent_version,
  }
}
const GRANT_JOIN = `SELECT g.*, p.display_name AS doctor_name, u.name AS patient_name FROM record_access_grants g
  JOIN users u ON u.user_id = g.patient_id LEFT JOIN doctor_profiles p ON p.user_id = g.doctor_user_id`

export function createGrant(ctx, patientId, body) {
  const actor = { id: patientId, role: 'user' }
  const { appointmentId, categories, purpose, rangeFrom, rangeTo, days, consentVersion, consentAccepted } = body || {}
  if (consentAccepted !== true) throw E(400, 'CONSENT_REQUIRED', 'You must give your consent before sharing records.')
  if (consentVersion !== RECORD_CONSENT_VERSION) throw E(400, 'CONSENT_VERSION_MISMATCH', 'The consent text has changed. Please review the current consent and try again.')
  if (!isId(appointmentId)) throw E(400, 'INVALID_INPUT', 'Choose the appointment this access is for.')
  if (!Array.isArray(categories) || !categories.length || categories.some(c => !RECORD_CATEGORIES.includes(c))) throw E(400, 'INVALID_INPUT', 'Choose at least one record category.')
  if (!GRANT_PURPOSES.includes(purpose)) throw E(400, 'INVALID_INPUT', 'Choose a purpose.')
  const re = /^\d{4}-\d{2}-\d{2}$/
  if (!re.test(rangeFrom || '') || !re.test(rangeTo || '') || rangeFrom > rangeTo) throw E(400, 'INVALID_INPUT', 'Choose a valid date range.')
  if (!Number.isInteger(days) || days < 1 || days > MAX_GRANT_DAYS) throw E(400, 'INVALID_INPUT', `Access can last 1 to ${MAX_GRANT_DAYS} days.`)
  const a = partyAppointment(ctx, actor, appointmentId)
  if (!withinGrace(ctx, a)) throw E(403, 'NOT_ELIGIBLE', 'You can only share records with a doctor you have a confirmed appointment with.')
  const consent = getRecordConsent()
  const expiresAt = new Date(ctx.now().getTime() + days * 86400000).toISOString()
  const cats = [...new Set(categories)].sort().join(',')
  const grantId = ctx.db.transaction(tx => {
    tx.run(
      `INSERT INTO record_access_grants (patient_id, doctor_user_id, appointment_id, categories, purpose, range_from, range_to, expires_at,
                                         consent_version, consent_text, consent_sha256)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [patientId, a.doctor_user_id, a.appointment_id, cats, purpose, rangeFrom, rangeTo, expiresAt, consent.version, consent.text, consent.sha256])
    const id = Number(tx.get('SELECT MAX(grant_id) AS id FROM record_access_grants').id)
    writeAudit(tx, { type: 'grant_created', actor, patientId, appointmentId: a.appointment_id, grantId: id, detail: consent.version })
    return id
  })
  return grantView(ctx, ctx.db.get(`${GRANT_JOIN} WHERE g.grant_id = ?`, [grantId]))
}

export function patientGrants(ctx, patientId) {
  return ctx.db.all(`${GRANT_JOIN} WHERE g.patient_id = ? ORDER BY g.grant_id DESC`, [patientId]).map(g => grantView(ctx, g))
}

export function revokeGrant(ctx, patientId, grantId) {
  const actor = { id: patientId, role: 'user' }
  if (!isId(grantId)) throw notFound()
  const g = ctx.db.get('SELECT * FROM record_access_grants WHERE grant_id = ? AND patient_id = ?', [grantId, patientId])
  if (!g) { denied(ctx, actor, 'grant_not_owned'); throw notFound() }
  if (g.status === 'revoked') throw E(409, 'ALREADY_REVOKED', 'This access has already been revoked.')
  ctx.db.transaction(tx => {
    tx.run("UPDATE record_access_grants SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP WHERE grant_id = ? AND patient_id = ? AND status = 'active'", [grantId, patientId])
    writeAudit(tx, { type: 'grant_revoked', actor, patientId, appointmentId: g.appointment_id, grantId })
  })
  return { grantId, status: 'revoked' }
}

// ---------------------------------------------------------------- doctor: patients and permitted records
export function doctorPatients(ctx, doctorId) {
  const rows = ctx.db.all(
    // appts counts real appointments only (requested, confirmed or held); cancelled/declined requests are not counted
    `SELECT a.patient_id, u.name AS patient_name,
       SUM(CASE WHEN a.status IN ('pending','accepted','completed') THEN 1 ELSE 0 END) AS appts,
       MIN(a.created_at) AS first_at,
       MAX(CASE WHEN a.status IN ('accepted','completed') THEN a.requested_date END) AS last_confirmed
     FROM appointments a JOIN users u ON u.user_id = a.patient_id
     WHERE a.doctor_user_id = ? GROUP BY a.patient_id, u.name ORDER BY u.name`, [doctorId])
  const grants = ctx.db.all("SELECT * FROM record_access_grants WHERE doctor_user_id = ? AND status = 'active'", [doctorId]).filter(g => grantActive(ctx, g))
  const today = isoDay(ctx.now())
  return rows.map(r => {
    // Sorted by date AND slot order in JS: SQL text order would put "10:00 AM" before "9:00 AM"
    const next = ctx.db.all(
      "SELECT requested_date AS date, requested_time AS time, status FROM appointments WHERE doctor_user_id = ? AND patient_id = ? AND status IN ('pending','accepted') AND requested_date >= ?",
      [doctorId, r.patient_id, today]).sort(byWhen)[0]
    // Most recent confirmed visit before today (or completed), so "no upcoming appointment" still shows context
    const last = ctx.db.all(
      "SELECT requested_date AS date, requested_time AS time, status FROM appointments WHERE doctor_user_id = ? AND patient_id = ? AND (status = 'completed' OR (status = 'accepted' AND requested_date < ?))",
      [doctorId, r.patient_id, today]).sort(byWhen).pop()
    const mine = grants.filter(g => g.patient_id === r.patient_id)
    return {
      patientId: r.patient_id, name: r.patient_name, appointments: Number(r.appts || 0), firstContactAt: r.first_at, lastConfirmedDate: r.last_confirmed ?? null,
      nextAppointment: next || null,
      lastAppointment: last || null,   // status 'accepted' here means the visit date passed but it was not marked complete
      access: { active: mine.length > 0, categories: [...new Set(mine.flatMap(g => String(g.categories).split(',')))].sort(), expiresAt: mine.map(g => g.expires_at).sort().pop() ?? null },
    }
  })
}

const inRange = (col) => `${col} >= ? AND ${col} <= ?`
const tableExists = (ctx, name) => !!ctx.db.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", [name])

function readCategory(ctx, patientId, category, from, to) {
  const P = [patientId, from, to]
  switch (category) {
    case 'cycles':
      return ctx.db.all(`SELECT start_date, end_date, cycle_length, flow, mood, notes FROM menstrual_cycles WHERE user_id = ? AND ${inRange('start_date')} ORDER BY start_date DESC`, P)
    case 'symptoms':
      return ctx.db.all(`SELECT date, type, severity, body_area, description FROM symptoms WHERE user_id = ? AND ${inRange('date')} ORDER BY date DESC, symptom_id DESC`, P)
    case 'pain': {
      const out = ctx.db.all(`SELECT date, severity AS pain, 'symptom_log' AS source, type AS context FROM symptoms WHERE user_id = ? AND severity IS NOT NULL AND ${inRange('date')}`, P)
      for (const s of ctx.db.all(`SELECT substr(started_at, 1, 10) AS date, kind, pain_before, pain_after FROM therapy_sessions WHERE user_id = ? AND ${inRange('substr(started_at, 1, 10)')}`, P)) {
        if (s.pain_before != null) out.push({ date: s.date, pain: s.pain_before, source: `${s.kind}_session_before`, context: null })
        if (s.pain_after != null) out.push({ date: s.date, pain: s.pain_after, source: `${s.kind}_session_after`, context: null })
      }
      if (tableExists(ctx, 'calibration')) {
        for (const c of ctx.db.all(`SELECT substr(created_at, 1, 10) AS date, actual_pain FROM calibration WHERE user_id = ? AND ${inRange('substr(created_at, 1, 10)')}`, P)) {
          out.push({ date: c.date, pain: c.actual_pain, source: 'post_therapy_feedback', context: null })
        }
      }
      return out.sort((a, b) => b.date.localeCompare(a.date))
    }
    case 'wellness':
      return ctx.db.all(`SELECT date, mood, energy, stress, sleep_quality, sleep_hours, note FROM wellness_records WHERE user_id = ? AND ${inRange('date')} ORDER BY date DESC`, P)
    case 'predictions':
      return ctx.db.all(`SELECT date, predicted_severity, confidence, recommended_tens_intensity, recommended_heat_temp FROM predictions WHERE user_id = ? AND ${inRange('date')} ORDER BY date DESC, pred_id DESC`, P)
    case 'heat_sessions':
    case 'tens_sessions':
      return ctx.db.all(
        `SELECT started_at, duration_seconds, source, ${category === 'heat_sessions' ? 'heat_temp_c' : 'tens_intensity, tens_frequency'}, pain_before, pain_after
         FROM therapy_sessions WHERE user_id = ? AND kind = ? AND ${inRange('substr(started_at, 1, 10)')} ORDER BY started_at DESC`,
        [patientId, category === 'heat_sessions' ? 'heat' : 'tens', from, to])
    default:
      throw E(400, 'INVALID_INPUT', 'Invalid record category.')
  }
}

// Returns the rows of ONE category, only if an active grant from this patient to this doctor covers it.
export function doctorPatientRecords(ctx, doctorId, patientId, category) {
  const actor = { id: doctorId, role: 'doctor' }
  if (!isId(patientId)) throw notFound()
  if (!RECORD_CATEGORIES.includes(category)) throw E(400, 'INVALID_INPUT', 'Invalid record category.')
  const grants = ctx.db.all(
    `SELECT g.*, a.status AS appt_status, a.completed_at FROM record_access_grants g JOIN appointments a ON a.appointment_id = g.appointment_id
     WHERE g.doctor_user_id = ? AND g.patient_id = ? AND g.status = 'active' AND a.doctor_user_id = g.doctor_user_id AND a.patient_id = g.patient_id`,
    [doctorId, patientId])
  const usable = grants.filter(g => grantActive(ctx, g) && String(g.categories).split(',').includes(category)
    && withinGrace(ctx, { status: g.appt_status, completed_at: g.completed_at }))
  if (!usable.length) {
    denied(ctx, actor, `no_grant.${category}`, { patientId })
    throw E(403, 'NO_CONSENT', 'The patient has not given you access to these records.')
  }
  // Union of the permitted ranges (usually one grant)
  const from = usable.map(g => g.range_from).sort()[0]
  const to = usable.map(g => g.range_to).sort().pop()
  const rows = readCategory(ctx, patientId, category, from, to)
    .filter(r => usable.some(g => { const d = String(r.date || r.start_date || r.started_at || '').slice(0, 10); return d >= g.range_from && d <= g.range_to }))
  auditOrFail(ctx, { type: 'record_viewed', actor, patientId, grantId: usable[0].grant_id, appointmentId: usable[0].appointment_id, detail: category })
  return { category, rangeFrom: from, rangeTo: to, rows, grantIds: usable.map(g => g.grant_id) }
}

// ---------------------------------------------------------------- symptoms (existing table) and therapy sessions
export function addSymptom(ctx, patientId, body) {
  const { date, type, severity, bodyArea, description } = body || {}
  if (!validDate(date) || date > isoDay(ctx.now())) throw E(400, 'INVALID_INPUT', 'Choose a valid date (not in the future).')
  const t = cleanText(type, 60)
  if (!t) throw E(400, 'INVALID_INPUT', 'Choose a symptom.')
  if (!Number.isInteger(severity) || severity < 0 || severity > 10) throw E(400, 'INVALID_INPUT', 'Pain intensity must be 0 to 10.')
  const area = bodyArea == null || bodyArea === '' ? null : cleanText(bodyArea, 60)
  const desc = description == null || description === '' ? null : cleanText(description, 500)
  if (bodyArea && !area) throw E(400, 'INVALID_INPUT', 'Body area is too long.')
  if (description && !desc) throw E(400, 'INVALID_INPUT', 'Description must be 500 characters or fewer.')
  const r = ctx.db.run('INSERT INTO symptoms (user_id, date, type, severity, body_area, description) VALUES (?,?,?,?,?,?)', [patientId, date, t, severity, area, desc])
  return { symptomId: Number(r.lastInsertRowid) }
}
export function listSymptoms(ctx, patientId) {
  return ctx.db.all('SELECT symptom_id AS symptomId, date, type, severity, body_area AS bodyArea, description, created_at AS createdAt FROM symptoms WHERE user_id = ? ORDER BY date DESC, symptom_id DESC LIMIT 100', [patientId])
}

export function addTherapySession(ctx, patientId, body) {
  const { kind, startedAt, durationSeconds, heatTempC, tensIntensity, tensFrequency, painBefore, painAfter, clientRef } = body || {}
  if (!['heat', 'tens'].includes(kind)) throw E(400, 'INVALID_INPUT', 'Session type must be heat or tens.')
  const started = typeof startedAt === 'string' && !Number.isNaN(Date.parse(startedAt)) ? new Date(startedAt) : null
  if (!started || started.getTime() > ctx.now().getTime() + 5 * 60000) throw E(400, 'INVALID_INPUT', 'Invalid session start time.')
  if (!Number.isInteger(durationSeconds) || durationSeconds < 0 || durationSeconds > 86400) throw E(400, 'INVALID_INPUT', 'Invalid duration.')
  const opt = (v, lo, hi, int = true) => {
    if (v === undefined || v === null) return null
    if (typeof v !== 'number' || (int && !Number.isInteger(v)) || v < lo || v > hi) throw E(400, 'INVALID_INPUT', 'A session value is out of range.')
    return v
  }
  const row = {
    heat: kind === 'heat' ? opt(heatTempC, 20, 60, false) : null,
    ti: kind === 'tens' ? opt(tensIntensity, 0, 100) : null,
    tf: kind === 'tens' ? opt(tensFrequency, 1, 250) : null,
    pb: opt(painBefore, 0, 10), pa: opt(painAfter, 0, 10),
  }
  if (kind === 'heat' && (tensIntensity != null || tensFrequency != null)) throw E(400, 'INVALID_INPUT', 'Heat sessions do not carry TENS settings.')
  if (kind === 'tens' && heatTempC != null) throw E(400, 'INVALID_INPUT', 'TENS sessions do not carry a heat temperature.')
  const ref = clientRef == null ? null : (typeof clientRef === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(clientRef) ? clientRef : (() => { throw E(400, 'INVALID_INPUT', 'Invalid client reference.') })())
  if (ref) {
    const dup = ctx.db.get('SELECT session_id FROM therapy_sessions WHERE user_id = ? AND kind = ? AND client_ref = ?', [patientId, kind, ref])
    if (dup) return { sessionId: dup.session_id, duplicate: true }
  }
  // TENS comes from a separate commercial device that is not connected: always a manual record.
  const source = kind === 'tens' ? 'manual_record' : 'device_panel'
  const r = ctx.db.run(
    `INSERT INTO therapy_sessions (user_id, kind, source, started_at, duration_seconds, heat_temp_c, tens_intensity, tens_frequency, pain_before, pain_after, client_ref)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [patientId, kind, source, started.toISOString(), durationSeconds, row.heat, row.ti, row.tf, row.pb, row.pa, ref])
  return { sessionId: Number(r.lastInsertRowid), source }
}
export function listTherapySessions(ctx, patientId) {
  return ctx.db.all(
    `SELECT session_id AS sessionId, kind, source, started_at AS startedAt, duration_seconds AS durationSeconds, heat_temp_c AS heatTempC,
            tens_intensity AS tensIntensity, tens_frequency AS tensFrequency, pain_before AS painBefore, pain_after AS painAfter, created_at AS createdAt
     FROM therapy_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 200`, [patientId])
}

// ---------------------------------------------------------------- activity feed (both portals)
// Patient: what the doctor did. Doctor: what patients did. Optionally only events after `since`.
export function activity(ctx, actor, sinceId) {
  const since = sinceId !== undefined && sinceId !== null && sinceId !== '' ? Number(sinceId) : 0
  if (!Number.isInteger(since) || since < 0) throw E(400, 'INVALID_INPUT', 'Invalid cursor.')
  const mineCol = actor.role === 'doctor' ? 'a.doctor_user_id' : 'a.patient_id'
  const otherRole = actor.role === 'doctor' ? 'user' : 'doctor'
  const events = ctx.db.all(
    `SELECT e.*, u.name AS patient_name, p.display_name AS doctor_name FROM appointment_events e
     JOIN appointments a ON a.appointment_id = e.appointment_id JOIN users u ON u.user_id = a.patient_id
     LEFT JOIN doctor_profiles p ON p.user_id = a.doctor_user_id
     WHERE ${mineCol} = ? AND e.actor_role = ? AND e.event_id > ? ORDER BY e.event_id DESC LIMIT 50`,
    [actor.id, otherRole, since])
  const items = events.map(e => ({
    ...EVENT_VIEW(e), source: 'appointment',
    counterpart: actor.role === 'doctor' ? e.patient_name : e.doctor_name,
  }))
  // Report Audit status changes made by the other party (codes only; no content)
  if (tableExists(ctx, 'report_audit_events') && tableExists(ctx, 'report_shares')) {
    const col = actor.role === 'doctor' ? 's.doctor_user_id' : 's.patient_id'
    const types = actor.role === 'doctor' ? "('share_submitted','share_revoked')" : "('status_changed')"
    const rep = ctx.db.all(
      `SELECT r.event_id, r.event_type, r.detail_code, r.share_id, r.created_at, s.consent_report_title AS title, u.name AS patient_name, s.consent_doctor_name AS doctor_name
       FROM report_audit_events r JOIN report_shares s ON s.share_id = r.share_id JOIN users u ON u.user_id = s.patient_id
       WHERE ${col} = ? AND r.event_type IN ${types} AND r.outcome = 'ok' ORDER BY r.event_id DESC LIMIT 20`, [actor.id])
    for (const r of rep) {
      items.push({ eventId: `r${r.event_id}`, source: 'report', type: r.event_type === 'status_changed' ? `report_${r.detail_code}` : r.event_type,
        shareId: r.share_id, title: r.title, counterpart: actor.role === 'doctor' ? r.patient_name : r.doctor_name, createdAt: r.created_at })
    }
  }
  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  const latest = Number(ctx.db.get(
    `SELECT COALESCE(MAX(e.event_id), 0) AS n FROM appointment_events e JOIN appointments a ON a.appointment_id = e.appointment_id WHERE ${mineCol} = ?`,
    [actor.id]).n)
  return { items: items.slice(0, 50), cursor: latest }
}

// ---------------------------------------------------------------- doctor dashboard (real counts only)
export function doctorDashboard(ctx, doctorId, reportSummary = null) {
  const today = isoDay(ctx.now())
  const week = isoDay(new Date(ctx.now().getTime() + 7 * 86400000))
  const monthStart = today.slice(0, 8) + '01'
  const appts = ctx.db.all(
    `SELECT a.appointment_id, a.patient_id, u.name AS patient_name, a.requested_date AS date, a.requested_time AS time, a.status, a.version,
            a.proposed_date, a.proposed_time, a.created_at
     FROM appointments a JOIN users u ON u.user_id = a.patient_id WHERE a.doctor_user_id = ?`, [doctorId])
  const todays = appts.filter(a => a.date === today && ['pending', 'accepted', 'completed'].includes(a.status)).sort(byWhen)
  const patients = new Map()
  for (const a of appts) {
    if (a.status === 'declined') continue
    const cur = patients.get(a.patient_id)
    if (!cur || a.created_at < cur) patients.set(a.patient_id, a.created_at)
  }
  const followUps = ctx.db.all("SELECT due_date FROM consultation_notes WHERE doctor_user_id = ? AND kind = 'follow_up' AND follow_up_status = 'open'", [doctorId])
  const unread = Number(ctx.db.get(
    `SELECT COUNT(*) AS n FROM appointment_messages m JOIN appointments a ON a.appointment_id = m.appointment_id
     WHERE a.doctor_user_id = ? AND m.sender_user_id <> ? AND m.read_at IS NULL`, [doctorId, doctorId]).n)
  const consultsWithoutNotes = Number(ctx.db.get(
    `SELECT COUNT(*) AS n FROM appointments a WHERE a.doctor_user_id = ? AND a.status = 'completed'
     AND NOT EXISTS (SELECT 1 FROM consultation_notes n WHERE n.appointment_id = a.appointment_id)`, [doctorId]).n)
  const pastConfirmed = appts.filter(a => a.status === 'accepted' && a.date < today).length
  return {
    asOf: ctx.now().toISOString(),
    today: {
      total: todays.length,
      confirmed: todays.filter(a => a.status === 'accepted').length,
      pending: todays.filter(a => a.status === 'pending').length,
      completed: todays.filter(a => a.status === 'completed').length,
      schedule: todays.map(a => ({ appointmentId: a.appointment_id, patientId: a.patient_id, patientName: a.patient_name, time: a.time, status: a.status, version: a.version })),
    },
    patients: { total: patients.size, newThisMonth: [...patients.values()].filter(c => String(c).slice(0, 10) >= monthStart).length },
    reports: reportSummary ? { awaiting: (reportSummary.submitted || 0) + (reportSummary.underReview || 0), ...reportSummary } : null,
    followUps: {
      dueNext7Days: followUps.filter(f => f.due_date && f.due_date >= today && f.due_date <= week).length,
      overdue: followUps.filter(f => f.due_date && f.due_date < today).length,
      open: followUps.length,
    },
    pendingRequests: appts.filter(a => a.status === 'pending').length,
    proposalsAwaitingPatient: appts.filter(a => a.proposed_date && ['pending', 'accepted'].includes(a.status)).length,
    unreadMessages: unread,
    tasks: { consultsWithoutNotes, pastConfirmedToComplete: pastConfirmed },
  }
}

export { TIME_SLOTS }
