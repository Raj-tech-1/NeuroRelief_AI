// Harness for the patient <-> doctor synchronisation tests. SCRATCH ONLY: a fresh in-memory fictional database (the
// shared fixture), random in-memory keys, ephemeral 127.0.0.1 port. The REAL routers (doctors, care, reports) are mounted
// together, exactly as server.js does, so both "portals" talk to one backend and one database.
import crypto from 'node:crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import { sqlReady, TEST_SECRET, NOW } from './apiHarness.mjs'
import { buildFixtureDb } from './fixture.mjs'

const { createReportsRouter } = await import('../../routes/reports.js')
const { createDoctorsRouter } = await import('../../routes/doctors.js')
const { createCareRouter } = await import('../../routes/care.js')
const { createAuthenticator } = await import('../../middleware/auth.js')
const { applyReportSchema } = await import('../../db/reportSchema.js')
const { applyClinicalSchema } = await import('../../db/clinicalSchema.js')
const reportSvc = await import('../../lib/reportService.js')

export { NOW }
// Fixture people: 1 & 2 patients, 3 (profile 1, Mondays) and 4 (profile 2, Tuesdays) doctors, 5 plain user.
export const P1 = 1, P2 = 2, DR_A = 3, DR_B = 4

// Same behaviour as db/database.js: run() "saves" (db.export(), which also resets SQLite's change counter) after every
// write; transaction() saves once after COMMIT. Using it here keeps the tests faithful to the real server.
function appAdapter(db) {
  const all = (sql, params = []) => {
    const st = db.prepare(sql); if (params.length) st.bind(params)
    const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out
  }
  const get = (sql, params) => all(sql, params)[0] ?? null
  const lastId = () => db.exec('SELECT last_insert_rowid()')[0].values[0][0]
  const run = (sql, params = []) => { db.run(sql, params); const id = lastId(); db.export(); return { lastInsertRowid: id } }
  const transaction = fn => {
    db.run('BEGIN')
    try {
      const r = fn({ all, get, run: (sql, params = []) => { db.run(sql, params); return { lastInsertRowid: lastId() } } })
      db.run('COMMIT'); db.export(); return r
    } catch (e) { try { db.run('ROLLBACK') } catch { /* none */ } throw e }
  }
  return { all, get, run, transaction }
}

export async function makeCareEnv({ migrate = true, clock } = {}) {
  const SQL = await sqlReady()
  const db = buildFixtureDb(SQL)
  applyReportSchema(db)
  if (migrate) applyClinicalSchema(db)
  const dbx = appAdapter(db)
  const key = crypto.randomBytes(32)
  const state = { now: clock ?? NOW }
  const ctx = { db: dbx, key: () => ({ key, keyId: 'k1' }), now: () => state.now, files: null }
  const authenticate = createAuthenticator({ secret: TEST_SECRET, getUser: id => dbx.get('SELECT user_id, role FROM users WHERE user_id = ?', [id]) })
  const app = express()
  app.use(express.json())
  app.use('/api/doctors', createDoctorsRouter({ db: dbx, authenticate, now: ctx.now }))
  app.use('/api/reports', createReportsRouter({ authenticate, ctx, limits: { generalPerMinute: 10_000, heavyPer10Min: 10_000 } }))
  app.use('/api/care', createCareRouter({
    authenticate, ctx, limits: { generalPerMinute: 10_000, writesPer10Min: 10_000 },
    reportSummary: id => (reportSvc.featureStatus(ctx).enabled ? reportSvc.doctorInboxSummary(ctx, id) : null),
  }))
  const server = await new Promise(res => { const s = app.listen(0, '127.0.0.1', () => res(s)) })
  const base = `http://127.0.0.1:${server.address().port}/api`
  const token = (userId, role = 'user') => jwt.sign({ userId, role }, TEST_SECRET, { expiresIn: '1h' })
  const call = async (method, path, { as, body } = {}) => {
    const headers = { 'Content-Type': 'application/json' }
    if (as) headers.Authorization = `Bearer ${token(as)}`
    const r = await fetch(base + path, { method, headers, body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body) })
    const text = await r.text()
    let json = null; try { json = JSON.parse(text) } catch { /* not json */ }
    return { status: r.status, json, text }
  }
  return {
    db, dbx, ctx, state, base,
    get: (p, o) => call('GET', p, o), post: (p, o) => call('POST', p, o), patch: (p, o) => call('PATCH', p, o),
    rows: (sql, params) => dbx.all(sql, params),
    // Every byte of the database, to prove plaintext never lands in it
    dump: () => Buffer.from(db.export()).toString('latin1'),
    close: () => new Promise(res => server.close(() => res())),
  }
}
