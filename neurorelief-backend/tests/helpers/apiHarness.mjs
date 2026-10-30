// Harness for the Report Audit API tests. SCRATCH ONLY: every environment is a fresh in-memory fictional database
// (built from the CREATE TABLE statements in database.js's source text), served by the real router on 127.0.0.1 with an
// ephemeral port. database.js is imported only for its path-neutral exports and is never initialised, so no file is opened.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import jwt from 'jsonwebtoken'
import initSqlJs from 'sql.js'
import { buildFixtureDb } from './fixture.mjs'

export const TEST_SECRET = crypto.randomBytes(24).toString('hex')   // in memory only
process.env.JWT_SECRET = TEST_SECRET
const { createReportsRouter } = await import('../../routes/reports.js')
const { createAuthenticator } = await import('../../middleware/auth.js')
const { applyReportSchema } = await import('../../db/reportSchema.js')
const { createFileStore } = await import('../../lib/reportFiles.js')

export const MARKER = 'ZZ-FICTIONAL-MARKER-7f3a91'
export const KEY_A = crypto.randomBytes(32)
export const KEY_B = crypto.randomBytes(32)
export const NOW = new Date('2030-02-01T12:00:00Z')

let SQL
export async function sqlReady() { SQL ??= await initSqlJs(); return SQL }

export function adapter(db, { failAudit = false } = {}) {
  const all = (sql, params = []) => {
    const st = db.prepare(sql); if (params.length) st.bind(params)
    const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out
  }
  const get = (sql, params) => all(sql, params)[0] ?? null
  const guard = sql => { if (failAudit && /INSERT INTO report_audit_events/i.test(sql)) throw new Error('simulated audit failure') }
  const run = (sql, params = []) => { guard(sql); db.run(sql, params); return { lastInsertRowid: db.exec('SELECT last_insert_rowid()')[0].values[0][0] } }
  const transaction = fn => {
    db.run('BEGIN')
    try { const r = fn({ all, get, run }); db.run('COMMIT'); return r } catch (e) { try { db.run('ROLLBACK') } catch { /* none */ } throw e }
  }
  return { all, get, run, transaction }
}

// opts: migrate (default true), key (Buffer|null|'invalid'), keyId, failAudit, limits, clock, files (false = no upload storage)
// Uploaded PDFs go to a fresh temp directory (outside the project and OneDrive) that close() removes.
export async function makeEnv(opts = {}) {
  await sqlReady()
  const db = buildFixtureDb(SQL)
  if (opts.migrate !== false) applyReportSchema(db)
  const dbx = adapter(db, { failAudit: opts.failAudit })
  // fictional patient data for patient 1 (fixture already has a cycle, prediction, wellness row and a scan)
  db.run("UPDATE menstrual_cycles SET notes = ? WHERE user_id = 1", [`${MARKER} cycle note`])
  db.run("UPDATE wellness_records SET note = ? WHERE user_id = 1", [`${MARKER} wellness note`])
  db.run("UPDATE scans SET symptom_description = ?, ai_summary = ? WHERE user_id = 1", [`${MARKER} description`, 'TEMPLATE-SUMMARY-SHOULD-NEVER-APPEAR'])
  const filesDir = opts.files === false ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'nr-scratch-files-'))
  const files = filesDir ? createFileStore({ dir: filesDir }) : null
  const state = { key: opts.key === undefined ? KEY_A : opts.key, keyId: opts.keyId ?? 'k1' }
  const { ReportCryptoError } = await import('../../lib/reportCrypto.js')
  const ctx = {
    db: dbx,
    now: () => opts.clock ?? NOW,
    files,
    key: () => {
      if (state.key === null) throw new ReportCryptoError('KEY_MISSING', 'missing')
      return { key: state.key, keyId: state.keyId }
    },
  }
  const authenticate = createAuthenticator({ secret: TEST_SECRET, getUser: id => dbx.get('SELECT user_id, role FROM users WHERE user_id = ?', [id]) })
  const app = express()
  app.use('/api/reports', createReportsRouter({ authenticate, ctx, limits: opts.limits }))
  const server = await new Promise(res => { const s = app.listen(0, '127.0.0.1', () => res(s)) })
  const base = `http://127.0.0.1:${server.address().port}/api/reports`
  const token = (userId, role = 'user', extra = {}) => jwt.sign({ userId, role }, TEST_SECRET, { expiresIn: '1h', ...extra })
  const call = async (method, path, { as, body, rawToken } = {}) => {
    const headers = { 'Content-Type': 'application/json' }
    const t = rawToken ?? (as ? token(as) : null)
    if (t) headers.Authorization = `Bearer ${t}`
    if (self.beforeRequest) { const f = self.beforeRequest; self.beforeRequest = null; f() }
    const r = await fetch(base + path, { method, headers, body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body) })
    const text = await r.text()
    let json = null; try { json = JSON.parse(text) } catch { /* not json */ }
    return { status: r.status, json, text, headers: r.headers }
  }
  const self = {
    db, dbx, ctx, state, call, token, base, beforeRequest: null,
    get: (p, o) => call('GET', p, o), post: (p, o) => call('POST', p, o),
    rows: (sql, params) => dbx.all(sql, params),
    filesDir,
    close: () => new Promise(res => server.close(() => { if (filesDir) fs.rmSync(filesDir, { recursive: true, force: true }); res() })),
  }
  return self
}

export const PERIOD = { from: '2030-01-01', to: '2030-01-31', sections: ['cycles', 'wellness', 'predictions', 'questionnaire'] }

// Patient 1 saves a report (preview -> save). Returns the report id.
export async function saveReport(env, as = 1, body = PERIOD) {
  const p = await env.post('/preview', { as, body })
  const r = await env.post('/', { as, body: { ...body, digest: p.json.digest } })
  return r.json.reportId
}
// Make patient 1 <-> doctor 3 a confirmed appointment (fixture has it pending).
export const confirmAppointment = env => env.db.run("UPDATE appointments SET status='accepted' WHERE patient_id=1 AND doctor_user_id=3")
export const consentBody = (env, extra = {}) => ({ doctorId: 1, appointmentId: 1, consentVersion: 'consent-v1', consentAccepted: true, ...extra })
