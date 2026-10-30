// Business rules for the Report Audit workflow. Pure functions over an injected context so they can run against a
// scratch database in tests and against the application database in the server:
//
//   ctx = { db: { all, get, run, transaction }, key: () => ({ key, keyId }) /* throws ReportCryptoError */, now: () => Date }
//
// Every function takes the AUTHENTICATED user id as its first argument; ids and ownership are always re-checked in SQL.
// Anything a caller is not allowed to see is reported as the same generic 404. Disclosure paths write their audit event
// before returning data; if the audit write fails nothing is returned.
import { buildConsentRecord, getCurrentConsent, ConsentError } from './reportConsent.js'
import { buildRecordAad, encrypt, decrypt, envelopeSha256, ReportCryptoError } from './reportCrypto.js'
import { buildSnapshot, parseOptions, reportTitle, SnapshotError } from './reportSnapshot.js'
import { REPORT_SCHEMA_OBJECTS } from '../db/reportSchema.js'
import { SCHEMA_002_COLUMNS } from '../db/reportSchema002.js'
import { decodePdf, cleanFileName, FileError } from './reportFiles.js'
import crypto from 'node:crypto'

export class ServiceError extends Error {
  constructor(status, code, message) { super(message); this.name = 'ServiceError'; this.status = status; this.code = code }
}
const E = (status, code, message) => new ServiceError(status, code, message)
const notFound = () => E(404, 'NOT_FOUND', 'Not found.')

export const MAX_NOTE_CHARS = 4000
export const SHARE_STATUSES = ['submitted', 'under_review', 'changes_requested', 'verified', 'revoked']
const DOCTOR_TARGETS = { submitted: ['under_review'], under_review: ['changes_requested', 'verified'] }
const isId = v => Number.isInteger(v) && v > 0

// ---------- feature status ----------
export function featureStatus(ctx) {
  try { ctx.key() } catch { return { enabled: false, reason: 'key' } }
  const have = new Set(ctx.db.all('SELECT name FROM sqlite_master').map(r => r.name))
  const needed = [...REPORT_SCHEMA_OBJECTS.tables, ...REPORT_SCHEMA_OBJECTS.triggers, ...REPORT_SCHEMA_OBJECTS.indexes]
  if (needed.some(n => !have.has(n))) return { enabled: false, reason: 'schema' }
  const cols = new Set(ctx.db.all('PRAGMA table_info(report_shares)').map(c => c.name))
  if (SCHEMA_002_COLUMNS.some(c => !cols.has(c.name))) return { enabled: false, reason: 'schema' }
  return { enabled: true, uploads: !!ctx.files }   // uploads: an encrypted private file directory is configured
}

function getKey(ctx) {
  try { return ctx.key() } catch (err) {
    if (err instanceof ReportCryptoError) throw E(503, 'NOT_CONFIGURED', 'Report Audit is not available right now.')
    throw err
  }
}

// ---------- audit ----------
function writeAudit(db, e) {
  db.run(
    'INSERT INTO report_audit_events (event_type, outcome, actor_user_id, actor_role, report_id, share_id, version_id, detail_code) VALUES (?,?,?,?,?,?,?,?)',
    [e.type, e.outcome || 'ok', e.actorId ?? null, e.role ?? null, e.reportId ?? null, e.shareId ?? null, e.versionId ?? null, e.detail ?? null])
}
// Disclosure audit: must succeed, otherwise nothing is returned.
function auditOrFail(ctx, e) {
  try { ctx.db.transaction(tx => writeAudit(tx, e)) } catch { throw E(500, 'AUDIT_FAILED', 'The request could not be completed.') }
}
// Denials are recorded at most once per actor+reason per minute so repeated probing cannot bloat the database.
function denied(ctx, actor, detail, ids = {}) {
  try {
    const dup = ctx.db.get(
      "SELECT 1 AS x FROM report_audit_events WHERE event_type = 'access_denied' AND actor_user_id = ? AND detail_code = ? AND created_at >= datetime('now', '-60 seconds') LIMIT 1",
      [actor.id, detail])
    if (!dup) writeAudit(ctx.db, { type: 'access_denied', outcome: 'denied', actorId: actor.id, role: actor.role, detail, ...ids })
  } catch { /* a failed denial record never changes the response */ }
  return notFound()
}

// ---------- decrypt helpers ----------
function integrityFailure(ctx, actor, ids) {
  try { writeAudit(ctx.db, { type: 'report_opened', outcome: 'error', actorId: actor.id, role: actor.role, detail: 'integrity', ...ids }) } catch { /* ignore */ }
  return E(500, 'INTEGRITY_FAILURE', 'This report could not be verified and was not shown.')
}
function openSnapshot(ctx, row, actor, ids) {
  const { key, keyId } = getKey(ctx)
  try {
    if (row.key_id !== keyId) throw new Error('key id')
    const env = { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }
    if (envelopeSha256(env) !== row.envelope_sha256) throw new Error('hash')
    const plain = decrypt(env, { key, aad: buildRecordAad('snapshot', { patientId: row.patient_id, reportId: row.report_id }) })
    return JSON.parse(plain.toString('utf8'))
  } catch { throw integrityFailure(ctx, actor, ids) }
}
function openNotes(ctx, shareId, actor) {
  const rows = ctx.db.all(
    "SELECT version_id, version_no, author_user_id, note_ciphertext, note_iv, note_auth_tag, key_id, created_at FROM report_versions WHERE share_id = ? AND kind = 'doctor_note' ORDER BY version_no",
    [shareId])
  if (!rows.length) return []
  const { key, keyId } = getKey(ctx)
  try {
    return rows.map(r => {
      if (r.key_id !== keyId) throw new Error('key id')
      const text = decrypt({ ciphertext: r.note_ciphertext, iv: r.note_iv, authTag: r.note_auth_tag },
        { key, aad: buildRecordAad('note', { shareId, versionNo: r.version_no, authorId: r.author_user_id }) }).toString('utf8')
      return { versionNo: r.version_no, createdAt: r.created_at, text }
    })
  } catch { throw integrityFailure(ctx, actor, { shareId }) }
}

const today = ctx => ctx.now().toISOString().slice(0, 10)
const wrapSnapshotErrors = fn => { try { return fn() } catch (err) { if (err instanceof SnapshotError) throw E(400, err.code, err.message); throw err } }

// =====================================================================
// Patient
// =====================================================================
export const getConsent = () => { const c = getCurrentConsent(); return { version: c.version, language: c.language, text: c.text } }

export function eligibleDoctors(ctx, patientId) {
  const rows = ctx.db.all(
    `SELECT a.appointment_id, a.requested_date AS date, a.requested_time AS time, a.status,
            p.doctor_id, p.display_name, p.specialty, p.is_demo
     FROM appointments a
     JOIN users u ON u.user_id = a.doctor_user_id AND u.role = 'doctor'
     JOIN doctor_profiles p ON p.user_id = a.doctor_user_id
     WHERE a.patient_id = ? AND a.status = 'accepted'`, [patientId])
  const t = today(ctx), byDoctor = new Map()
  for (const r of rows) {
    const cur = byDoctor.get(r.doctor_id)
    // the nearest upcoming appointment, else the most recent past one
    const better = !cur || (r.date >= t ? (cur.date < t || r.date < cur.date) : (cur.date < t && r.date > cur.date))
    if (better) byDoctor.set(r.doctor_id, r)
  }
  return [...byDoctor.values()]
    .sort((a, b) => a.display_name.localeCompare(b.display_name))
    .map(r => ({ doctorId: r.doctor_id, name: r.display_name, specialty: r.specialty, demo: r.is_demo === 1,
                 appointment: { id: r.appointment_id, date: r.date, time: r.time, status: r.status } }))
}

export function previewReport(ctx, patientId, body) {
  return wrapSnapshotErrors(() => {
    const opts = parseOptions(body, today(ctx))
    const { snapshot, totalItems, digest } = buildSnapshot(ctx.db, patientId, opts, ctx.now().toISOString())
    return { snapshot, totalItems, digest, title: reportTitle(opts) }
  })
}

export function createReport(ctx, patientId, body) {
  const { key, keyId } = getKey(ctx)
  const opts = wrapSnapshotErrors(() => parseOptions(body, today(ctx)))
  const { snapshot, totalItems, digest } = buildSnapshot(ctx.db, patientId, opts, ctx.now().toISOString())
  if (typeof body?.digest !== 'string') throw E(400, 'INVALID_INPUT', 'Preview the report before saving it.')
  if (totalItems === 0) throw E(422, 'NO_DATA', 'There are no records in the chosen period and sections.')
  if (body.digest !== digest) throw E(409, 'DATA_CHANGED', 'Your records changed since the preview. Please review the report again.')
  const title = reportTitle(opts)
  return ctx.db.transaction(tx => {
    const reportId = Number(tx.get('SELECT COALESCE(MAX(report_id), 0) + 1 AS id FROM report_originals').id)
    const env = encrypt(JSON.stringify(snapshot), { key, aad: buildRecordAad('snapshot', { patientId, reportId }) })
    tx.run(
      'INSERT INTO report_originals (report_id, patient_id, report_type, title, ciphertext, iv, auth_tag, key_id, envelope_sha256) VALUES (?,?,?,?,?,?,?,?,?)',
      [reportId, patientId, 'health_summary', title, env.ciphertext, env.iv, env.authTag, keyId, envelopeSha256(env)])
    writeAudit(tx, { type: 'report_created', actorId: patientId, role: 'user', reportId })
    return { reportId, title, createdAt: tx.get('SELECT created_at FROM report_originals WHERE report_id = ?', [reportId]).created_at }
  })
}

const shareSummary = s => ({
  shareId: s.share_id, reportId: s.report_id, status: s.status, doctorName: s.consent_doctor_name, doctorId: s.doctor_profile_id ?? null,
  submittedAt: s.submitted_at, updatedAt: s.updated_at, verifiedAt: s.verified_at ?? null,
  revokedAt: s.revoked_at ?? null, previousShareId: s.previous_share_id ?? null, appointmentId: s.appointment_id ?? null,
})
// doctor_profile_id is the public doctor id (the same one /api/doctors lists), so the UI can tell which doctors a report is already shared with
const SHARE_COLS = 'share_id, report_id, status, consent_doctor_name, submitted_at, updated_at, verified_at, revoked_at, previous_share_id, appointment_id, (SELECT p.doctor_id FROM doctor_profiles p WHERE p.user_id = report_shares.doctor_user_id) AS doctor_profile_id'

// ---------- uploaded PDF reports ----------
// An uploaded report is an ordinary report record whose (encrypted) snapshot describes the file instead of listing
// records; sharing, consent, review and revocation are exactly the same. The PDF itself lives encrypted in the private
// file store. The storage name stays inside the encrypted snapshot and is never returned to a browser.
export const MAX_UPLOAD_TITLE = 120
const UPLOAD_KIND = 'uploaded_pdf'
const publicSnapshot = snap => { const { storageName, ...rest } = snap; return rest }

function kindOf(ctx, reportId, patientId) {
  try {
    const row = ctx.db.get('SELECT * FROM report_originals WHERE report_id = ? AND patient_id = ?', [reportId, patientId])
    const { key, keyId } = ctx.key()
    if (!row || row.key_id !== keyId) return null
    const plain = decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, { key, aad: buildRecordAad('snapshot', { patientId, reportId }) })
    return JSON.parse(plain.toString('utf8')).kind || 'health_summary'
  } catch { return null }
}

const wrapFileErrors = fn => { try { return fn() } catch (err) { if (err instanceof FileError) throw E(err.status, err.code, err.message); throw err } }

export function createUploadedReport(ctx, patientId, body) {
  if (!ctx.files) throw E(503, 'UPLOADS_UNAVAILABLE', 'Uploading a report is not available right now.')
  const { key, keyId } = getKey(ctx)
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (title.length < 1 || title.length > MAX_UPLOAD_TITLE) throw E(400, 'INVALID_INPUT', `A title of 1 to ${MAX_UPLOAD_TITLE} characters is required.`)
  const fileName = cleanFileName(body?.fileName)
  if (!fileName) throw E(415, 'NOT_A_PDF', 'Only PDF files are accepted.')
  const pdf = wrapFileErrors(() => decodePdf(body?.dataBase64))
  let storageName = null
  try {
    return ctx.db.transaction(tx => {
      const reportId = Number(tx.get('SELECT COALESCE(MAX(report_id), 0) + 1 AS id FROM report_originals').id)
      storageName = wrapFileErrors(() => ctx.files.write(pdf, { key, patientId, reportId }))
      const snapshot = {
        version: 1, kind: UPLOAD_KIND, generatedAt: ctx.now().toISOString(), storageName,
        file: { name: fileName, size: pdf.length, sha256: crypto.createHash('sha256').update(pdf).digest('hex') },
        notices: ['patient_uploaded', 'not_doctor_verified'],
      }
      const env = encrypt(JSON.stringify(snapshot), { key, aad: buildRecordAad('snapshot', { patientId, reportId }) })
      tx.run(
        'INSERT INTO report_originals (report_id, patient_id, report_type, title, ciphertext, iv, auth_tag, key_id, envelope_sha256) VALUES (?,?,?,?,?,?,?,?,?)',
        [reportId, patientId, 'health_summary', title, env.ciphertext, env.iv, env.authTag, keyId, envelopeSha256(env)])
      writeAudit(tx, { type: 'report_created', actorId: patientId, role: 'user', reportId, detail: 'upload' })
      return { reportId, title, kind: UPLOAD_KIND, createdAt: tx.get('SELECT created_at FROM report_originals WHERE report_id = ?', [reportId]).created_at }
    })
  } catch (err) {
    if (storageName) ctx.files.remove(storageName)   // no orphan file if the record could not be saved
    throw err
  }
}

// Decrypts the stored PDF after the caller's access was checked. Returns { bytes, name }.
function readUploadedFile(ctx, row, snapshot, actor, ids) {
  if (snapshot.kind !== UPLOAD_KIND || !ctx.files) throw notFound()
  const { key } = getKey(ctx)
  try {
    const bytes = ctx.files.read(snapshot.storageName, { key, patientId: row.patient_id, reportId: row.report_id })
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== snapshot.file.sha256) throw new Error('hash')
    return { bytes, name: snapshot.file.name }
  } catch { throw integrityFailure(ctx, actor, ids) }
}

export function patientReportFile(ctx, patientId, reportId) {
  const actor = { id: patientId, role: 'user' }
  const row = ctx.db.get('SELECT * FROM report_originals WHERE report_id = ? AND patient_id = ?', [reportId, patientId])
  if (!row) throw denied(ctx, actor, 'report_not_owned')
  const snapshot = openSnapshot(ctx, row, actor, { reportId })
  const file = readUploadedFile(ctx, row, snapshot, actor, { reportId })
  auditOrFail(ctx, { type: 'original_downloaded', actorId: patientId, role: 'user', reportId, detail: 'owner_file' })
  return file
}

export function doctorShareFile(ctx, doctorId, shareId) {
  const actor = { id: doctorId, role: 'doctor' }
  const { s, reason } = doctorAccess(ctx, doctorId, shareId)
  if (reason) throw denied(ctx, actor, reason === 'revoked' ? 'share_revoked' : 'appt_inactive', { reportId: s.report_id, shareId })
  const row = ctx.db.get('SELECT * FROM report_originals WHERE report_id = ?', [s.report_id])
  if (!row) throw notFound()
  const snapshot = openSnapshot(ctx, row, actor, { reportId: s.report_id, shareId })
  const file = readUploadedFile(ctx, row, snapshot, actor, { reportId: s.report_id, shareId })
  auditOrFail(ctx, { type: 'original_downloaded', actorId: doctorId, role: 'doctor', reportId: s.report_id, shareId, detail: 'doctor_file' })
  return file
}

export function listReports(ctx, patientId) {
  const reports = ctx.db.all('SELECT report_id, title, created_at FROM report_originals WHERE patient_id = ? ORDER BY created_at DESC, report_id DESC', [patientId])
  const shares = ctx.db.all(`SELECT ${SHARE_COLS} FROM report_shares WHERE patient_id = ? ORDER BY share_id DESC`, [patientId])
  return reports.map(r => {
    const mine = shares.filter(s => s.report_id === r.report_id).map(shareSummary)
    const active = mine.find(s => s.status !== 'revoked')
    return { reportId: r.report_id, title: r.title, createdAt: r.created_at, status: active ? active.status : 'draft', shares: mine, kind: kindOf(ctx, r.report_id, patientId) }
  })
}

export function getReport(ctx, patientId, reportId) {
  const row = ctx.db.get('SELECT * FROM report_originals WHERE report_id = ? AND patient_id = ?', [reportId, patientId])
  if (!row) throw denied(ctx, { id: patientId, role: 'user' }, 'report_not_owned')
  const snapshot = openSnapshot(ctx, row, { id: patientId, role: 'user' }, { reportId })
  auditOrFail(ctx, { type: 'report_opened', actorId: patientId, role: 'user', reportId, detail: 'owner_view' })
  const publicView = publicSnapshot(snapshot)
  const shares = ctx.db.all(`SELECT ${SHARE_COLS} FROM report_shares WHERE report_id = ? AND patient_id = ? ORDER BY share_id DESC`, [reportId, patientId]).map(shareSummary)
  const active = shares.find(s => s.status !== 'revoked')
  return { reportId, title: row.title, createdAt: row.created_at, status: active ? active.status : 'draft', kind: publicView.kind || 'health_summary', snapshot: publicView, shares }
}

export function createShare(ctx, patientId, reportId, body) {
  const actor = { id: patientId, role: 'user' }
  const { doctorId, appointmentId, consentVersion, consentAccepted, previousShareId } = body || {}
  if (!isId(doctorId) || !isId(appointmentId) || typeof consentVersion !== 'string' ||
      (previousShareId !== undefined && previousShareId !== null && !isId(previousShareId))) {
    throw E(400, 'INVALID_INPUT', 'A doctor, an appointment and the consent version are required.')
  }
  if (consentAccepted !== true) throw E(400, 'CONSENT_REQUIRED', 'You must give your consent before sharing.')
  const report = ctx.db.get('SELECT report_id, title FROM report_originals WHERE report_id = ? AND patient_id = ?', [reportId, patientId])
  if (!report) throw denied(ctx, actor, 'report_not_owned')

  const profile = ctx.db.get(
    "SELECT p.user_id, p.display_name FROM doctor_profiles p JOIN users u ON u.user_id = p.user_id AND u.role = 'doctor' WHERE p.doctor_id = ?", [doctorId])
  const appt = profile && ctx.db.get(
    "SELECT appointment_id FROM appointments WHERE appointment_id = ? AND patient_id = ? AND doctor_user_id = ? AND status = 'accepted'",
    [appointmentId, patientId, profile.user_id])
  if (!profile || !appt) {
    denied(ctx, actor, 'not_eligible', { reportId })
    throw E(403, 'NOT_ELIGIBLE', 'You can only share a report with a doctor you have a confirmed appointment with.')
  }
  if (ctx.db.get("SELECT 1 AS x FROM report_shares WHERE report_id = ? AND doctor_user_id = ? AND status <> 'revoked'", [reportId, profile.user_id])) {
    throw E(409, 'ALREADY_SHARED', 'This report is already shared with this doctor.')
  }
  if (previousShareId && !ctx.db.get(
    "SELECT 1 AS x FROM report_shares WHERE share_id = ? AND patient_id = ? AND doctor_user_id = ? AND status = 'changes_requested'",
    [previousShareId, patientId, profile.user_id])) {
    throw E(400, 'INVALID_PREVIOUS_SHARE', 'That earlier review does not apply to this doctor.')
  }
  let consent
  try { consent = buildConsentRecord({ acceptedVersion: consentVersion, doctorName: profile.display_name, reportTitle: report.title }) } catch (err) {
    if (err instanceof ConsentError) throw E(400, err.code, err.message)
    throw err
  }
  try {
    return ctx.db.transaction(tx => {
      tx.run(
        `INSERT INTO report_shares (report_id, patient_id, doctor_user_id, consent_text_version, consent_text, consent_language, consent_text_sha256,
                                    consent_doctor_name, consent_report_title, appointment_id, previous_share_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [reportId, patientId, profile.user_id, consent.consent_text_version, consent.consent_text, consent.consent_language, consent.consent_text_sha256,
         consent.consent_doctor_name, consent.consent_report_title, appt.appointment_id, previousShareId ?? null])
      const shareId = Number(tx.get('SELECT MAX(share_id) AS id FROM report_shares').id)
      writeAudit(tx, { type: 'consent_recorded', actorId: patientId, role: 'user', reportId, shareId, detail: 'consent-v1' })
      writeAudit(tx, { type: 'share_submitted', actorId: patientId, role: 'user', reportId, shareId })
      return { shareId, status: 'submitted' }
    })
  } catch (err) {
    if (/UNIQUE/.test(err.message)) throw E(409, 'ALREADY_SHARED', 'This report is already shared with this doctor.')
    if (/confirmed appointment/.test(err.message)) throw E(403, 'NOT_ELIGIBLE', 'You can only share a report with a doctor you have a confirmed appointment with.')
    throw err
  }
}

export function revokeShare(ctx, patientId, shareId) {
  const s = ctx.db.get('SELECT share_id, report_id, status FROM report_shares WHERE share_id = ? AND patient_id = ?', [shareId, patientId])
  if (!s) throw denied(ctx, { id: patientId, role: 'user' }, 'share_not_owned')
  if (s.status === 'revoked') throw E(409, 'ALREADY_REVOKED', 'Access to this report has already been revoked.')
  ctx.db.transaction(tx => {
    tx.run("UPDATE report_shares SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, revoked_by_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE share_id = ? AND patient_id = ? AND status <> 'revoked'",
      [patientId, shareId, patientId])
    writeAudit(tx, { type: 'share_revoked', actorId: patientId, role: 'user', reportId: s.report_id, shareId })
  })
  return { shareId, status: 'revoked' }
}

export function getPatientShare(ctx, patientId, shareId) {
  const actor = { id: patientId, role: 'user' }
  const s = ctx.db.get(`SELECT ${SHARE_COLS} FROM report_shares WHERE share_id = ? AND patient_id = ?`, [shareId, patientId])
  if (!s) throw denied(ctx, actor, 'share_not_owned')
  const notes = openNotes(ctx, shareId, actor)
  auditOrFail(ctx, { type: 'report_opened', actorId: patientId, role: 'user', reportId: s.report_id, shareId, detail: 'share_view' })
  return { ...shareSummary(s), notes }
}

const EVENT_VIEW = e => ({ eventType: e.event_type, outcome: e.outcome, actorRole: e.actor_role, shareId: e.share_id, detail: e.detail_code, createdAt: e.created_at })
export function reportActivity(ctx, patientId, reportId) {
  if (!ctx.db.get('SELECT 1 AS x FROM report_originals WHERE report_id = ? AND patient_id = ?', [reportId, patientId])) {
    throw denied(ctx, { id: patientId, role: 'user' }, 'report_not_owned')
  }
  return ctx.db.all('SELECT event_type, outcome, actor_role, share_id, detail_code, created_at FROM report_audit_events WHERE report_id = ? ORDER BY event_id', [reportId]).map(EVENT_VIEW)
}

// =====================================================================
// Doctor
// =====================================================================
// Row for a share addressed to this doctor, plus whether content access is currently allowed.
function doctorAccess(ctx, doctorId, shareId) {
  const s = ctx.db.get(
    `SELECT s.*, u.name AS patient_name, a.status AS appt_status, a.requested_date AS appt_date, a.requested_time AS appt_time
     FROM report_shares s JOIN users u ON u.user_id = s.patient_id
     LEFT JOIN appointments a ON a.appointment_id = s.appointment_id
     WHERE s.share_id = ? AND s.doctor_user_id = ?`, [shareId, doctorId])
  if (!s) throw denied(ctx, { id: doctorId, role: 'doctor' }, 'share_not_addressed')
  let reason = null
  if (s.status === 'revoked') reason = 'revoked'
  else if (s.appt_status !== 'accepted') reason = 'appointment_inactive'
  return { s, reason }
}
const doctorShareView = (s, reason) => ({
  shareId: s.share_id, status: s.status, patientName: s.patient_name, title: s.consent_report_title,
  submittedAt: s.submitted_at, updatedAt: s.updated_at, verifiedAt: s.verified_at ?? null, previousShareId: s.previous_share_id ?? null,
  appointment: s.appt_date ? { date: s.appt_date, time: s.appt_time, status: s.appt_status } : null,
  limited: reason !== null, limitedReason: reason,
  consent: { version: s.consent_text_version, at: s.consent_at, language: s.consent_language },   // what the patient agreed to (the text itself stays server-side)
})

export function doctorInbox(ctx, doctorId, query = {}) {
  const { status, q } = query
  if (status !== undefined && !SHARE_STATUSES.includes(status)) throw E(400, 'INVALID_INPUT', 'Invalid status filter.')
  if (q !== undefined && (typeof q !== 'string' || q.length > 80)) throw E(400, 'INVALID_INPUT', 'Invalid search.')
  const rows = ctx.db.all(
    `SELECT s.*, u.name AS patient_name, a.status AS appt_status, a.requested_date AS appt_date, a.requested_time AS appt_time
     FROM report_shares s JOIN users u ON u.user_id = s.patient_id
     LEFT JOIN appointments a ON a.appointment_id = s.appointment_id
     WHERE s.doctor_user_id = ?${status ? ' AND s.status = ?' : ''} ORDER BY s.submitted_at DESC, s.share_id DESC`,
    status ? [doctorId, status] : [doctorId])
  const needle = (q || '').trim().toLowerCase()
  return rows.filter(r => !needle || r.patient_name.toLowerCase().includes(needle))
    .map(r => doctorShareView(r, r.status === 'revoked' ? 'revoked' : r.appt_status !== 'accepted' ? 'appointment_inactive' : null))
}

export function doctorInboxSummary(ctx, doctorId) {
  const rows = ctx.db.all(
    `SELECT s.status, COUNT(*) AS n FROM report_shares s JOIN appointments a ON a.appointment_id = s.appointment_id AND a.status = 'accepted'
     WHERE s.doctor_user_id = ? AND s.status IN ('submitted','under_review') GROUP BY s.status`, [doctorId])
  const n = st => rows.find(r => r.status === st)?.n ?? 0
  return { submitted: n('submitted'), underReview: n('under_review') }
}

export function doctorOpenShare(ctx, doctorId, shareId) {
  const actor = { id: doctorId, role: 'doctor' }
  const { s, reason } = doctorAccess(ctx, doctorId, shareId)
  if (reason) {
    denied(ctx, actor, reason === 'revoked' ? 'share_revoked' : 'appt_inactive', { reportId: s.report_id, shareId })
    return { ...doctorShareView(s, reason) }   // metadata only; no report content
  }
  const row = ctx.db.get('SELECT * FROM report_originals WHERE report_id = ?', [s.report_id])
  if (!row) throw notFound()
  const snapshot = openSnapshot(ctx, row, actor, { reportId: s.report_id, shareId })
  const notes = openNotes(ctx, shareId, actor)
  auditOrFail(ctx, { type: 'report_opened', actorId: doctorId, role: 'doctor', reportId: s.report_id, shareId, detail: 'doctor_view' })
  const publicView = publicSnapshot(snapshot)
  return { ...doctorShareView(s, null), kind: publicView.kind || 'health_summary', snapshot: publicView, notes }
}

function cleanNote(v) {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length >= 1 && t.length <= MAX_NOTE_CHARS ? t : null
}

function insertNote(tx, key, keyId, { shareId, authorId, reportId, text }) {
  const versionNo = Number(tx.get('SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM report_versions WHERE share_id = ?', [shareId]).n)
  const env = encrypt(text, { key, aad: buildRecordAad('note', { shareId, versionNo, authorId }) })
  tx.run('INSERT INTO report_versions (share_id, version_no, kind, author_user_id, note_ciphertext, note_iv, note_auth_tag, key_id) VALUES (?,?,?,?,?,?,?,?)',
    [shareId, versionNo, 'doctor_note', authorId, env.ciphertext, env.iv, env.authTag, keyId])
  const versionId = Number(tx.get('SELECT MAX(version_id) AS id FROM report_versions').id)
  writeAudit(tx, { type: 'review_created', actorId: authorId, role: 'doctor', reportId, shareId, versionId })
  return versionNo
}

export function doctorAddNote(ctx, doctorId, shareId, body) {
  const { s, reason } = doctorAccess(ctx, doctorId, shareId)
  if (reason) throw E(409, 'SHARE_INACTIVE', 'This report is no longer available for review.')
  if (s.status !== 'under_review') throw E(409, 'NOT_UNDER_REVIEW', 'Start the review before adding notes.')
  const text = cleanNote(body?.note)
  if (!text) throw E(400, 'INVALID_INPUT', `A note of 1 to ${MAX_NOTE_CHARS} characters is required.`)
  const { key, keyId } = getKey(ctx)
  const versionNo = ctx.db.transaction(tx => insertNote(tx, key, keyId, { shareId, authorId: doctorId, reportId: s.report_id, text }))
  return { shareId, versionNo }
}

export function doctorSetStatus(ctx, doctorId, shareId, body) {
  const { s, reason } = doctorAccess(ctx, doctorId, shareId)
  if (reason) throw E(409, 'SHARE_INACTIVE', 'This report is no longer available for review.')
  const target = body?.status
  if (!['under_review', 'changes_requested', 'verified'].includes(target)) throw E(400, 'INVALID_INPUT', 'Invalid status.')
  if (!(DOCTOR_TARGETS[s.status] || []).includes(target)) throw E(409, 'ILLEGAL_TRANSITION', `A ${s.status.replace('_', ' ')} report cannot be changed to ${target.replace('_', ' ')}.`)
  const note = body?.note === undefined || body?.note === null || body?.note === '' ? null : cleanNote(body.note)
  if (body?.note !== undefined && body?.note !== null && body?.note !== '' && !note) throw E(400, 'INVALID_INPUT', `A note of 1 to ${MAX_NOTE_CHARS} characters is required.`)
  if (target === 'changes_requested' && !note) throw E(400, 'NOTE_REQUIRED', 'Explain what the patient should change.')
  if (target === 'verified') {
    if (body?.confirm !== true) throw E(400, 'CONFIRM_REQUIRED', 'Confirm that you have completed your review.')
    const hasNote = ctx.db.get("SELECT 1 AS x FROM report_versions WHERE share_id = ? AND kind = 'doctor_note'", [shareId])
    if (!note && !hasNote) throw E(400, 'NOTE_REQUIRED', 'Add a review note before marking the report as verified.')
  }
  const keys = note ? getKey(ctx) : null
  ctx.db.transaction(tx => {
    if (note) insertNote(tx, keys.key, keys.keyId, { shareId, authorId: doctorId, reportId: s.report_id, text: note })
    tx.run(
      `UPDATE report_shares SET status = ?, ${target === 'verified' ? 'verified_at = CURRENT_TIMESTAMP,' : ''} updated_at = CURRENT_TIMESTAMP
       WHERE share_id = ? AND doctor_user_id = ? AND status = ?`, [target, shareId, doctorId, s.status])
    writeAudit(tx, { type: 'status_changed', actorId: doctorId, role: 'doctor', reportId: s.report_id, shareId, detail: target })
  })
  return { shareId, status: target }
}
