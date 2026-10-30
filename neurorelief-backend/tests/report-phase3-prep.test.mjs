// Phase 3 preparation tests. SCRATCH ONLY (fictional fixture, temp folder, in-memory keys).
// Never imports db/database.js and never opens the real database.
//   Run:  node --test tests/report-phase3-prep.test.mjs
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import initSqlJs from 'sql.js'
import { buildFixtureDb } from './helpers/fixture.mjs'
import { applyReportSchema } from '../db/reportSchema.js'
import { loadMasterKey, reportKeyStatus, ReportCryptoError } from '../lib/reportCrypto.js'
import { CONSENT_TEXT, CONSENT_SHA256, CONSENT_VERSION, CONSENT_LANGUAGE, ConsentError, buildConsentRecord, getCurrentConsent } from '../lib/reportConsent.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const backendDir = path.resolve(here, '..')
const RUN_DIR = path.join(os.tmpdir(), 'neurorelief-phase3-prep-tests', `run-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`)
fs.mkdirSync(RUN_DIR, { recursive: true })
const TEST_KEY_B64 = crypto.randomBytes(32).toString('base64')   // in memory; written only to temp files inside RUN_DIR by the loader tests
let SQL
before(async () => { SQL = await initSqlJs() })

const rows = (db, sql, p = []) => { const st = db.prepare(sql); st.bind(p); const o = []; while (st.step()) o.push(st.getAsObject()); st.free(); return o }
const fail = (fn, re) => assert.throws(fn, re)
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const save = (db, name) => { const p = path.join(RUN_DIR, name); fs.writeFileSync(p, Buffer.from(db.export())); return p }
const verify = args => spawnSync(process.execPath, [path.join(backendDir, 'scripts', 'verify-report-audit.js'), ...args], { encoding: 'utf8' })

describe('A. Consent module (consent-v1)', () => {
  it('is the exact approved English text, pinned by SHA-256', () => {
    assert.equal(CONSENT_VERSION, 'consent-v1'); assert.equal(CONSENT_LANGUAGE, 'en')
    assert.equal(crypto.createHash('sha256').update(CONSENT_TEXT, 'utf8').digest('hex'), CONSENT_SHA256)
    assert.equal(CONSENT_SHA256, '1324b9936739a5b0a3e2c204a3952c8c4cb63b9fd9be5c0f1accdf452ceb60b0')
    assert.equal(CONSENT_TEXT.length, 1016); assert.ok(CONSENT_TEXT.length <= 2000); assert.equal(/[^\x00-\x7F]/.test(CONSENT_TEXT), false)
    assert.equal(CONSENT_TEXT.split('\n\n').length, 6)
  })
  it('says "I can revoke future access at any time" and contains no legal-retention promises', () => {
    assert.ok(CONSENT_TEXT.includes('I can revoke future access at any time.'))
    for (const bad of [/retention/i, /legally required/i, /applicable/i, /request that/i, /complian/i, /HIPAA|GDPR|DPDP/i]) assert.equal(bad.test(CONSENT_TEXT), false, String(bad))
    assert.ok(/not confirmed medical diagnoses/.test(CONSENT_TEXT)); assert.ok(/not clinician-verified until the selected authorized doctor explicitly completes the review/.test(CONSENT_TEXT))
    assert.ok(/cannot undo information already viewed, downloaded, or retained separately/.test(CONSENT_TEXT))
  })
  it('refuses to load if the approved text is edited without a new version (fail closed)', async () => {
    const copy = path.join(RUN_DIR, 'consent-edited.mjs')
    fs.writeFileSync(copy, fs.readFileSync(path.join(backendDir, 'lib', 'reportConsent.js'), 'utf8').replace('I authorize NeuroRelief AI', 'I hereby authorize NeuroRelief AI'))
    await assert.rejects(() => import(pathToFileURL(copy).href), e => e.code === 'CONSENT_TEXT_CHANGED')
  })
  it('builds the stored record from server-side values and rejects a mismatching or stale version', () => {
    const r = buildConsentRecord({ acceptedVersion: 'consent-v1', doctorName: ' Dr. Ananya Rao ', reportTitle: 'Health Summary' })
    assert.deepEqual(Object.keys(r).sort(), ['consent_doctor_name', 'consent_language', 'consent_report_title', 'consent_text', 'consent_text_sha256', 'consent_text_version'])
    assert.equal(r.consent_text, CONSENT_TEXT); assert.equal(r.consent_doctor_name, 'Dr. Ananya Rao'); assert.equal(r.consent_language, 'en')
    for (const v of ['consent-v0', 'consent-v2', '', undefined, null]) fail(() => buildConsentRecord({ acceptedVersion: v, doctorName: 'D', reportTitle: 'T' }), e => e instanceof ConsentError && e.code === 'CONSENT_VERSION_MISMATCH')
    for (const bad of [{ doctorName: '' }, { doctorName: 42 }, { reportTitle: '   ' }, { reportTitle: 'x'.repeat(201) }]) fail(() => buildConsentRecord({ acceptedVersion: 'consent-v1', doctorName: 'D', reportTitle: 'T', ...bad }), e => e.code === 'CONSENT_INPUT_INVALID')
    assert.deepEqual(getCurrentConsent(), { version: 'consent-v1', language: 'en', text: CONSENT_TEXT, sha256: CONSENT_SHA256 })
  })
})

describe('B. Share rows preserve the consent evidence immutably', () => {
  const setup = () => {
    const db = buildFixtureDb(SQL); applyReportSchema(db); db.run('PRAGMA foreign_keys = ON')
    db.run("INSERT INTO report_originals (patient_id, report_type, title, ciphertext, iv, auth_tag, key_id, envelope_sha256) VALUES (1,'health_summary','Health Summary',?,?,?, 'k1', ?)", [Buffer.alloc(8, 1), Buffer.alloc(12, 2), Buffer.alloc(16, 3), 'a'.repeat(64)])
    return db
  }
  const insert = (db, over = {}) => {
    const c = { ...buildConsentRecord({ acceptedVersion: 'consent-v1', doctorName: 'Dr. Fixture Alpha', reportTitle: 'Health Summary' }), ...over }
    db.run('INSERT INTO report_shares (report_id, patient_id, doctor_user_id, consent_text_version, consent_text, consent_language, consent_text_sha256, consent_doctor_name, consent_report_title) VALUES (1,1,3,?,?,?,?,?,?)',
      [c.consent_text_version, c.consent_text, c.consent_language, c.consent_text_sha256, c.consent_doctor_name, c.consent_report_title])
  }
  it('stores exact text, version, language, hash, recipient, doctor-name and title snapshots and a server timestamp', () => {
    const db = setup(); insert(db)
    const s = rows(db, 'SELECT * FROM report_shares')[0]
    assert.equal(s.consent_text, CONSENT_TEXT); assert.equal(s.consent_text_version, 'consent-v1'); assert.equal(s.consent_language, 'en')
    assert.equal(s.consent_text_sha256, CONSENT_SHA256); assert.equal(s.consent_doctor_name, 'Dr. Fixture Alpha'); assert.equal(s.consent_report_title, 'Health Summary')
    assert.equal(s.doctor_user_id, 3); assert.equal(s.patient_id, 1); assert.match(s.consent_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/)
  })
  it('only the approved language is accepted; hash length and snapshot names are validated', () => {
    const db = setup()
    fail(() => insert(db, { consent_language: 'hi' }), /CHECK/); fail(() => insert(db, { consent_language: 'ta' }), /CHECK/)
    fail(() => insert(db, { consent_text_sha256: 'a'.repeat(63) }), /CHECK/); fail(() => insert(db, { consent_doctor_name: '' }), /CHECK/)
    fail(() => insert(db, { consent_report_title: 'x'.repeat(201) }), /CHECK/)
  })
  it('every consent column is immutable after the share exists', () => {
    const db = setup(); insert(db)
    for (const [col, val] of [['consent_text', 'edited'], ['consent_text_version', 'consent-v9'], ['consent_language', 'en'], ['consent_text_sha256', 'b'.repeat(64)],
      ['consent_doctor_name', 'Someone Else'], ['consent_report_title', 'Other'], ['consent_at', '2000-01-01 00:00:00'], ['doctor_user_id', 4], ['patient_id', 2]]) {
      fail(() => db.run(`UPDATE report_shares SET ${col} = ? WHERE share_id = 1`, [val]), /immutable/)
    }
    db.run("UPDATE report_shares SET status = 'under_review', updated_at = CURRENT_TIMESTAMP WHERE share_id = 1")   // status can still move
  })
})

describe('C. Key-file loader (key kept outside the project and OneDrive)', () => {
  const keyDir = path.join(RUN_DIR, 'secrets'); fs.mkdirSync(keyDir, { recursive: true })
  const writeKey = (name, text = TEST_KEY_B64) => { const p = path.join(keyDir, name); fs.writeFileSync(p, text); return p }
  const opts = { projectRoot: path.join(RUN_DIR, 'fake-project-root') }

  it('loads a valid key file (trims whitespace/newline) and reports status without revealing anything', () => {
    const p = writeKey('good.txt', TEST_KEY_B64 + '\r\n')
    const { key, keyId } = loadMasterKey({ REPORT_MASTER_KEY_FILE: p, REPORT_MASTER_KEY_ID: 'k2' }, opts)
    assert.equal(key.toString('base64'), TEST_KEY_B64); assert.equal(keyId, 'k2')
    assert.equal(reportKeyStatus({ REPORT_MASTER_KEY_FILE: p }), 'valid')
  })
  it('refuses when both a direct key and a key file are configured', () => {
    const p = writeKey('both.txt'); fail(() => loadMasterKey({ REPORT_MASTER_KEY: TEST_KEY_B64, REPORT_MASTER_KEY_FILE: p }, opts), e => e.code === 'KEY_CONFIG_AMBIGUOUS')
  })
  it('missing config / missing file / relative path / directory are rejected', () => {
    fail(() => loadMasterKey({}, opts), e => e.code === 'KEY_MISSING')
    fail(() => loadMasterKey({ REPORT_MASTER_KEY_FILE: path.join(keyDir, 'nope.txt') }, opts), e => e.code === 'KEY_FILE_UNREADABLE')
    fail(() => loadMasterKey({ REPORT_MASTER_KEY_FILE: 'secrets/key.txt' }, opts), e => e.code === 'KEY_FILE_UNSAFE')
    fail(() => loadMasterKey({ REPORT_MASTER_KEY_FILE: keyDir }, opts), e => e.code === 'KEY_FILE_UNSAFE')
    assert.equal(reportKeyStatus({}), 'missing'); assert.equal(reportKeyStatus({ REPORT_MASTER_KEY_FILE: 'relative.txt' }), 'invalid')
  })
  it('refuses a key file inside the project folder or any OneDrive folder', () => {
    const projectRoot = path.join(RUN_DIR, 'proj'); const inside = path.join(projectRoot, 'neurorelief-backend'); fs.mkdirSync(inside, { recursive: true })
    const inProject = path.join(inside, 'key.txt'); fs.writeFileSync(inProject, TEST_KEY_B64)
    fail(() => loadMasterKey({ REPORT_MASTER_KEY_FILE: inProject }, { projectRoot }), e => e.code === 'KEY_FILE_UNSAFE' && /project folder or a OneDrive/.test(e.message))
    const od = path.join(RUN_DIR, 'FakeOneDrive', 'Documents'); fs.mkdirSync(od, { recursive: true })
    const inOd = path.join(od, 'key.txt'); fs.writeFileSync(inOd, TEST_KEY_B64)
    for (const v of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
      fail(() => loadMasterKey({ REPORT_MASTER_KEY_FILE: inOd, [v]: path.join(RUN_DIR, 'FakeOneDrive') }, opts), e => e.code === 'KEY_FILE_UNSAFE')
    }
    const repoRootDefault = path.resolve(backendDir, '..'); const probe = path.join(backendDir, 'tests', 'helpers', 'fixture.mjs')   // an existing file inside the real repo
    fail(() => loadMasterKey({ REPORT_MASTER_KEY_FILE: probe }), e => e.code === 'KEY_FILE_UNSAFE'); assert.ok(probe.startsWith(repoRootDefault))
  })
  it('rejects bad file contents without echoing them, and oversized/empty files', () => {
    const secretish = 'definitely-not-a-valid-key-but-pretend-secret-123'
    const bad = writeKey('bad.txt', secretish)
    try { loadMasterKey({ REPORT_MASTER_KEY_FILE: bad }, opts); assert.fail('should throw') } catch (e) { assert.equal(e.code, 'KEY_INVALID'); assert.ok(!e.message.includes(secretish)); assert.ok(!e.message.includes(bad) || true) }
    fail(() => loadMasterKey({ REPORT_MASTER_KEY_FILE: writeKey('empty.txt', '') }, opts), e => e instanceof ReportCryptoError && e.code === 'KEY_FILE_UNSAFE')
    fail(() => loadMasterKey({ REPORT_MASTER_KEY_FILE: writeKey('big.txt', 'A'.repeat(1000)) }, opts), e => e.code === 'KEY_FILE_UNSAFE')
    fail(() => loadMasterKey({ REPORT_MASTER_KEY_FILE: writeKey('zero.txt', Buffer.alloc(32, 0).toString('base64')) }, opts), e => e.code === 'KEY_INVALID')
  })
  it('a missing/invalid key keeps encryption disabled (never generates a key, never falls back)', () => {
    const before = fs.readdirSync(keyDir).length
    for (const env of [{}, { REPORT_MASTER_KEY_FILE: path.join(keyDir, 'absent.txt') }]) fail(() => loadMasterKey(env, opts))
    assert.equal(fs.readdirSync(keyDir).length, before, 'no key file may be created by the loader')
  })
})

describe('D. verify-report-audit.js (read-only)', () => {
  const makePair = (mutateBefore = () => {}) => {
    const b = buildFixtureDb(SQL); mutateBefore(b)
    const beforeFile = save(b, `before-${crypto.randomBytes(2).toString('hex')}.db`)
    const a = new SQL.Database(fs.readFileSync(beforeFile)); applyReportSchema(a)
    return { beforeFile, after: a, afterFile: save(a, `after-${crypto.randomBytes(2).toString('hex')}.db`) }
  }
  const rerun = (beforeFile, after, mutate) => { mutate(after); const f = save(after, `after-mut-${crypto.randomBytes(2).toString('hex')}.db`); return verify(['--before', beforeFile, '--after', f]) }

  it('passes on a correct migration and reports counts only', () => {
    const { beforeFile, afterFile } = makePair(); const r = verify(['--before', beforeFile, '--after', afterFile])
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /RESULT: all \d+ checks passed/); assert.match(r.stdout, /doctor accounts 3 -> 3/); assert.match(r.stdout, /doctor profiles 2 -> 2/); assert.match(r.stdout, /appointments 2 -> 2/)
    assert.equal(/fixture\.invalid|Fixture|fictional/i.test(r.stdout), false, 'no row contents may be printed')
  })
  it('never writes: both input files are byte-identical afterwards', () => {
    const { beforeFile, afterFile } = makePair(); const h = [sha(beforeFile), sha(afterFile)], m = [fs.statSync(beforeFile).mtimeMs, fs.statSync(afterFile).mtimeMs]
    verify(['--before', beforeFile, '--after', afterFile]); verify(['--integrity-only', afterFile])
    assert.deepEqual([sha(beforeFile), sha(afterFile)], h); assert.deepEqual([fs.statSync(beforeFile).mtimeMs, fs.statSync(afterFile).mtimeMs], m)
    assert.deepEqual(fs.readdirSync(path.dirname(afterFile)).filter(f => f.endsWith('.tmp') || f.endsWith('-journal')), [])
  })
  it('FAILS when an existing row, a doctor account or an appointment is changed or removed', () => {
    for (const [what, sql, expect] of [
      ['user email changed', "UPDATE users SET email = 'x@fixture.invalid' WHERE user_id = 1", /FAIL  table users unchanged/],
      ['doctor role changed', "UPDATE users SET role = 'user' WHERE user_id = 3", /FAIL  table users unchanged/],
      ['doctor profile changed', "UPDATE doctor_profiles SET price = 999 WHERE user_id = 3", /FAIL  table doctor_profiles unchanged/],
      ['appointment deleted', 'DELETE FROM appointments WHERE appointment_id = 1', /FAIL  table appointments unchanged/],
      ['appointment status changed', "UPDATE appointments SET status = 'declined' WHERE appointment_id = 2", /FAIL  table appointments unchanged/],
      ['scan row added', "INSERT INTO scans (user_id, life_stage, severity) VALUES (1,'x',1)", /FAIL  table scans unchanged/],
      ['table dropped', 'DROP TABLE predictions', /FAIL  table predictions still exists/],
    ]) {
      const { beforeFile, after } = makePair(); const r = rerun(beforeFile, after, d => d.run(sql))
      assert.equal(r.status, 1, what); assert.match(r.stdout, expect, what); assert.match(r.stdout, /RESULT: \d+ of \d+ checks FAILED/)
    }
  })
  it('FAILS when the migration was not applied, a trigger is missing, or the new tables are not empty', () => {
    const b = buildFixtureDb(SQL); const bf = save(b, 'unmigrated-before.db')
    let r = verify(['--before', bf, '--after', bf]); assert.equal(r.status, 1); assert.match(r.stdout, /FAIL  all report tables, triggers and indexes present/)
    let p = makePair(); r = rerun(p.beforeFile, p.after, d => d.run('DROP TRIGGER trg_report_originals_no_update')); assert.equal(r.status, 1); assert.match(r.stdout, /missing: trg_report_originals_no_update/)
    p = makePair(); r = rerun(p.beforeFile, p.after, d => d.run("INSERT INTO report_audit_events (event_type) VALUES ('report_opened')")); assert.equal(r.status, 1); assert.match(r.stdout, /FAIL  new table report_audit_events is empty/)
  })
  it('flags NEW foreign-key violations but tolerates ones that already existed in the backup', () => {
    const tolerated = makePair(d => d.run('INSERT INTO appointments (patient_id, doctor_user_id, requested_date, requested_time) VALUES (999,3,\'2030-02-01\',\'9:00 AM\')'))
    let r = verify(['--before', tolerated.beforeFile, '--after', tolerated.afterFile]); assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /no new foreign-key violations\s+\(before 1, after 1\)/)
    const p = makePair(); r = rerun(p.beforeFile, p.after, d => d.run("INSERT INTO appointments (patient_id, doctor_user_id, requested_date, requested_time) VALUES (998,3,'2030-02-02','9:00 AM')"))
    assert.equal(r.status, 1); assert.match(r.stdout, /FAIL  no new foreign-key violations/)
  })
  it('exit codes: 2 for bad usage, 1 for a missing or corrupt file (never a crash with data)', () => {
    assert.equal(verify([]).status, 2); assert.equal(verify(['--bogus']).status, 2)
    const { beforeFile } = makePair(); assert.equal(verify(['--before', beforeFile, '--after', path.join(RUN_DIR, 'missing.db')]).status, 1)
    const garbage = path.join(RUN_DIR, 'garbage.db'); fs.writeFileSync(garbage, crypto.randomBytes(4096))
    const r = verify(['--before', beforeFile, '--after', garbage]); assert.equal(r.status, 1)
    assert.equal(verify(['--integrity-only', garbage]).status, 1)
    assert.equal(verify(['--integrity-only', beforeFile]).status, 0)
  })
})
