// Phase 2 tests: report encryption, additive schema, migration guard. SCRATCH ONLY.
//
// - Never imports db/database.js (which would open the real database) and never opens the real database file.
// - The fixture is built from the CREATE TABLE statements found in database.js's SOURCE TEXT, filled with
//   clearly fictional rows, and saved to a temp folder as "*.scratch.db".
// - Test keys are random, in memory only, and never written to disk or printed.
//   Run:  node --test tests/report-infra.test.mjs
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import initSqlJs from 'sql.js'
import { buildFixtureDb as buildFixtureDbShared } from './helpers/fixture.mjs'
import { buildConsentRecord, CONSENT_VERSION } from '../lib/reportConsent.js'
import { applyReportSchema, inspectReportSchema, REPORT_SCHEMA_OBJECTS } from '../db/reportSchema.js'
import { assertScratchDatabase, openScratchDatabase, saveScratchDatabase, ScratchGuardError, PRODUCTION_DB_FILE } from '../db/scratchGuard.js'
import {
  loadMasterKey, reportKeyStatus, encryptReportSnapshot, decryptReportSnapshot, encrypt, decrypt, buildAad, ReportCryptoError,
} from '../lib/reportCrypto.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const backendDir = path.resolve(here, '..')
const RUN_DIR = path.join(os.tmpdir(), 'neurorelief-phase2-tests', `run-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`)
fs.mkdirSync(RUN_DIR, { recursive: true })
const MARKER = 'ZZ-FICTIONAL-MARKER-7f3a91'            // appears only in fictional plaintext snapshots
const TEST_KEY = crypto.randomBytes(32)                 // in memory only
const TEST_KEY_B64 = TEST_KEY.toString('base64')

let SQL
before(async () => { SQL = await initSqlJs() })

// ---------- helpers ----------
const rows = (db, sql, params = []) => {
  const st = db.prepare(sql); st.bind(params); const out = []
  while (st.step()) out.push(st.getAsObject())
  st.free(); return out
}
const one = (db, sql, params) => rows(db, sql, params)[0]
const fail = (fn, re) => assert.throws(fn, re)
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex')

const buildFixtureDb = () => buildFixtureDbShared(SQL)
let fixtureCount = 0
function writeScratch(db, name = `fixture-${++fixtureCount}`) {
  const p = path.join(RUN_DIR, `${name}.scratch.db`)
  fs.writeFileSync(p, Buffer.from(db.export()))
  return p
}
const existingDump = db => ['users', 'doctor_profiles', 'appointments', 'scans', 'menstrual_cycles', 'predictions', 'reports', 'wellness_records']
  .map(t => `${t}:${JSON.stringify(rows(db, `SELECT * FROM ${t} ORDER BY 1`))}`).join('\n')
const migrated = () => { const db = buildFixtureDb(); applyReportSchema(db); db.run('PRAGMA foreign_keys = ON'); return db }

function insertOriginal(db, patientId = 1, secret = `${MARKER} fictional report body`) {
  const env = encryptReportSnapshot({ note: secret }, { key: TEST_KEY, patientId, reportType: 'health_summary' })
  db.run('INSERT INTO report_originals (patient_id, report_type, title, ciphertext, iv, auth_tag, key_id, envelope_sha256) VALUES (?,?,?,?,?,?,?,?)',
    [patientId, 'health_summary', 'Health Summary', env.ciphertext, env.iv, env.authTag, 'k1', env.envelopeSha256])
  return Number(one(db, 'SELECT MAX(report_id) id FROM report_originals').id)
}
const share = (db, reportId, patientId, doctorId, extra = {}) => {
  const c = buildConsentRecord({ acceptedVersion: CONSENT_VERSION, doctorName: 'Dr. Fixture', reportTitle: 'Health Summary' })
  db.run('INSERT INTO report_shares (report_id, patient_id, doctor_user_id, consent_text_version, consent_text, consent_language, consent_text_sha256, consent_doctor_name, consent_report_title) VALUES (?,?,?,?,?,?,?,?,?)',
    [reportId, patientId, doctorId, extra.v ?? c.consent_text_version, extra.text ?? c.consent_text, c.consent_language, c.consent_text_sha256, c.consent_doctor_name, c.consent_report_title])
}
const lastShare = db => Number(one(db, 'SELECT MAX(share_id) id FROM report_shares').id)
const noteVersion = (db, shareId, authorId, no) => {
  const e = encrypt('fictional review note', { key: TEST_KEY, aad: buildAad({ patientId: 1, reportType: 'health_summary' }) })
  db.run('INSERT INTO report_versions (share_id, version_no, kind, author_user_id, note_ciphertext, note_iv, note_auth_tag, key_id) VALUES (?,?,?,?,?,?,?,?)',
    [shareId, no, 'doctor_note', authorId, e.ciphertext, e.iv, e.authTag, 'k1'])
}

// =====================================================================
describe('1. Encryption (AES-256-GCM, built-in crypto)', () => {
  const ctx = { key: TEST_KEY, patientId: 1, reportType: 'health_summary' }

  it('round-trips a snapshot', () => {
    const env = encryptReportSnapshot({ a: 1, text: MARKER }, ctx)
    assert.equal(env.alg, 'aes-256-gcm'); assert.equal(env.iv.length, 12); assert.equal(env.authTag.length, 16)
    assert.ok(!env.ciphertext.toString('utf8').includes(MARKER), 'ciphertext must not contain the plaintext')
    assert.deepEqual(JSON.parse(decryptReportSnapshot(env, ctx)), { a: 1, text: MARKER })
  })
  it('fails closed with the wrong key', () => {
    const env = encryptReportSnapshot('secret body', ctx)
    fail(() => decryptReportSnapshot(env, { ...ctx, key: crypto.randomBytes(32) }), e => e instanceof ReportCryptoError && e.code === 'DECRYPT_FAILED')
  })
  it('rejects altered ciphertext, altered tag and altered IV', () => {
    const env = encryptReportSnapshot('secret body', ctx)
    const flip = b => { const c = Buffer.from(b); c[0] ^= 0x01; return c }
    fail(() => decryptReportSnapshot({ ...env, ciphertext: flip(env.ciphertext) }, ctx), /damaged or the key/)
    fail(() => decryptReportSnapshot({ ...env, authTag: flip(env.authTag) }, ctx), /damaged or the key/)
    fail(() => decryptReportSnapshot({ ...env, iv: flip(env.iv) }, ctx), /damaged or the key/)
    fail(() => decryptReportSnapshot({ ...env, ciphertext: env.ciphertext.subarray(0, env.ciphertext.length - 1) }, ctx), /damaged or the key/)
    fail(() => decryptReportSnapshot({ ...env, authTag: env.authTag.subarray(0, 8) }, ctx), /damaged or the key/)
  })
  it('binds the record identity: a ciphertext moved to another patient or type fails', () => {
    const env = encryptReportSnapshot('secret body', ctx)
    fail(() => decryptReportSnapshot(env, { ...ctx, patientId: 2 }), /damaged or the key/)
    fail(() => decryptReportSnapshot(env, { ...ctx, reportType: 'other_type' }), /damaged or the key/)
  })
  it('uses a unique random IV and fresh ciphertext for every encryption', () => {
    const ivs = new Set(), cts = new Set()
    for (let i = 0; i < 5000; i++) { const e = encryptReportSnapshot('identical plaintext', ctx); ivs.add(e.iv.toString('hex')); cts.add(e.ciphertext.toString('hex')) }
    assert.equal(ivs.size, 5000); assert.equal(cts.size, 5000)
  })
  it('error messages never contain the key or the plaintext', () => {
    const env = encryptReportSnapshot(MARKER, ctx)
    try { decryptReportSnapshot(env, { ...ctx, key: crypto.randomBytes(32) }); assert.fail('should throw') } catch (e) {
      assert.ok(!e.message.includes(MARKER)); assert.ok(!e.message.includes(TEST_KEY_B64)); assert.ok(!String(e.stack).includes(MARKER))
    }
  })
  it('rejects a key that is not 32 bytes', () => {
    fail(() => encrypt('x', { key: Buffer.alloc(16, 1), aad: buildAad({ patientId: 1, reportType: 'health_summary' }) }), e => e.code === 'KEY_INVALID')
  })
})

describe('2. Key configuration (fails closed; value never revealed)', () => {
  it('loads a valid base64 32-byte key and a key id', () => {
    const { key, keyId } = loadMasterKey({ REPORT_MASTER_KEY: TEST_KEY_B64, REPORT_MASTER_KEY_ID: 'k7' })
    assert.ok(key.equals(TEST_KEY)); assert.equal(keyId, 'k7')
    assert.equal(loadMasterKey({ REPORT_MASTER_KEY: TEST_KEY_B64 }).keyId, 'k1')
    assert.equal(reportKeyStatus({ REPORT_MASTER_KEY: TEST_KEY_B64 }), 'valid')
  })
  it('missing / empty key -> KEY_MISSING (never generates one)', () => {
    for (const env of [{}, { REPORT_MASTER_KEY: '' }, { REPORT_MASTER_KEY: '   ' }]) {
      fail(() => loadMasterKey(env), e => e.code === 'KEY_MISSING')
      assert.equal(reportKeyStatus(env), 'missing')
    }
  })
  it('malformed keys -> KEY_INVALID, and the message does not echo the supplied value', () => {
    const bad = ['not-base64-secret-value-123', crypto.randomBytes(16).toString('base64'), crypto.randomBytes(48).toString('base64'),
      Buffer.alloc(32, 7).toString('base64'), Buffer.alloc(32, 0).toString('base64'), TEST_KEY_B64.slice(0, -1), TEST_KEY.toString('hex'), TEST_KEY_B64 + 'AAAA']
    for (const v of bad) {
      try { loadMasterKey({ REPORT_MASTER_KEY: v }); assert.fail('should throw for ' + v.slice(0, 6)) } catch (e) {
        assert.equal(e.code, 'KEY_INVALID'); assert.ok(!e.message.includes(v), 'message must not echo the value')
      }
      assert.equal(reportKeyStatus({ REPORT_MASTER_KEY: v }), 'invalid')
    }
  })
  it('rejects an unsafe key id', () => {
    fail(() => loadMasterKey({ REPORT_MASTER_KEY: TEST_KEY_B64, REPORT_MASTER_KEY_ID: 'bad id!' }), e => e.code === 'KEY_ID_INVALID')
  })
  it('the crypto module has no logging and does not write the environment or touch the database', () => {
    const code = fs.readFileSync(path.join(backendDir, 'lib', 'reportCrypto.js'), 'utf8')
    assert.ok(!/console\./.test(code)); assert.ok(!/process\.env(\.\w+|\[[^\]]+\])\s*=(?!=)/.test(code), 'must not assign to process.env'); assert.ok(!/writeFile|database\.js|sql\.js/.test(code))
  })
})

describe('3. Migration guard (scratch-only)', () => {
  const refuse = (p, opts, re) => assert.throws(() => assertScratchDatabase(p, opts), e => e instanceof ScratchGuardError && re.test(e.message))
  let good
  before(() => { good = writeScratch(buildFixtureDb(), 'guard-good') })

  it('accepts a real, existing *.scratch.db with --scratch', () => { assert.equal(assertScratchDatabase(good, { scratch: true }), fs.realpathSync(good)) })
  it('requires the explicit scratch flag', () => { refuse(good, {}, /test-only mode/); refuse(good, { scratch: false }, /test-only mode/) })
  it('rejects a missing, empty or non-string path (never defaults to a database)', () => {
    refuse(undefined, { scratch: true }, /path is required/); refuse('', { scratch: true }, /path is required/); refuse('   ', { scratch: true }, /path is required/)
    refuse(path.join(RUN_DIR, 'does-not-exist.scratch.db'), { scratch: true }, /does not exist/)
    refuse(RUN_DIR, { scratch: true }, /not a file/)
  })
  it('rejects the production database path (computed from db/database.js location)', () => {
    assert.equal(PRODUCTION_DB_FILE, path.join(backendDir, 'db', 'neurorelief.db'))
    refuse(PRODUCTION_DB_FILE, { scratch: true }, /production database/)
    refuse(path.join(backendDir, 'db', '..', 'db', 'neurorelief.db'), { scratch: true }, /production database/)
    refuse(PRODUCTION_DB_FILE.toUpperCase(), { scratch: true }, /production database|does not exist/)
  })
  it('rejects anything inside the production db directory (backups, other files)', () => {
    refuse(path.join(backendDir, 'db', 'database.js'), { scratch: true }, /inside the production database directory/)
  })
  it('rejects the production file name and any file not named *.scratch.db, even in a temp folder', () => {
    const named = path.join(RUN_DIR, 'neurorelief.db'); fs.copyFileSync(good, named)
    refuse(named, { scratch: true }, /production database name/)
    const other = path.join(RUN_DIR, 'copy.db'); fs.copyFileSync(good, other)
    refuse(other, { scratch: true }, /\.scratch\.db/)
  })
  it('rejects when NODE_ENV is production', () => {
    const old = process.env.NODE_ENV; process.env.NODE_ENV = 'production'
    try { refuse(good, { scratch: true }, /production/) } finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old }
  })
  it('CLI: refuses without --scratch, with a missing path, and with the production path (exit code 1, no write)', () => {
    const cli = path.join(backendDir, 'scripts', 'migrate-report-audit.js')
    const run = a => spawnSync(process.execPath, [cli, ...a], { encoding: 'utf8' })
    for (const a of [['--db', good], ['--scratch'], ['--scratch', '--db', PRODUCTION_DB_FILE], ['--scratch', '--db', path.join(RUN_DIR, 'nope.scratch.db')]]) {
      const r = run(a); assert.equal(r.status, 1, a.join(' ')); assert.match(r.stderr, /Refusing to run/)
    }
    assert.equal(run(['--bogus']).status, 2)
  })
})

describe('4. Migration on a scratch database', () => {
  it('applies cleanly and preserves every pre-existing table and fictional record', () => {
    const db = buildFixtureDb(); const before = existingDump(db)
    const tablesBefore = rows(db, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map(r => r.name)
    const res = applyReportSchema(db)
    assert.deepEqual(res.missing, [])
    assert.equal(existingDump(db), before, 'existing data must be byte-identical')
    const tablesAfter = rows(db, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map(r => r.name)
    for (const t of tablesBefore) assert.ok(tablesAfter.includes(t), `existing table ${t} must remain`)
    for (const t of REPORT_SCHEMA_OBJECTS.tables) assert.ok(tablesAfter.includes(t))
    assert.equal(one(db, 'SELECT COUNT(*) n FROM schema_migrations').n, 2)
  })
  it('is repeatable: a second and third run add no duplicate objects', () => {
    const db = buildFixtureDb(); applyReportSchema(db)
    const snapshot = () => JSON.stringify(rows(db, 'SELECT type, name FROM sqlite_master ORDER BY type, name'))
    const first = snapshot(); applyReportSchema(db); applyReportSchema(db)
    assert.equal(snapshot(), first); assert.equal(one(db, 'SELECT COUNT(*) n FROM schema_migrations').n, 2)
  })
  it('refuses a non-NeuroRelief database and leaves it untouched (rolled back / not started)', () => {
    const db = new SQL.Database(); db.run('CREATE TABLE users (user_id INTEGER PRIMARY KEY)')   // no doctor_profiles
    fail(() => applyReportSchema(db), /does not look like a NeuroRelief database/)
    assert.equal(rows(db, "SELECT name FROM sqlite_master WHERE type='table'").length, 1)
  })
  it('--check mode reports missing objects and writes nothing', () => {
    const p = writeScratch(buildFixtureDb(), 'check-mode'); const h = sha(fs.readFileSync(p))
    const r = spawnSync(process.execPath, [path.join(backendDir, 'scripts', 'migrate-report-audit.js'), '--scratch', '--db', p, '--check'], { encoding: 'utf8' })
    assert.equal(r.status, 0); assert.match(r.stdout, /missing: [1-9]/); assert.equal(sha(fs.readFileSync(p)), h)
    const db = buildFixtureDb(); assert.ok(inspectReportSchema(db).missing.length > 0)
  })
  it('CLI migrates a scratch file, preserves existing rows, and a re-run is a no-op', async () => {
    const p = writeScratch(buildFixtureDb(), 'cli-migrate')
    const src = await openScratchDatabase(p); const before = existingDump(src); src.close()
    const cli = path.join(backendDir, 'scripts', 'migrate-report-audit.js')
    const r1 = spawnSync(process.execPath, [cli, '--scratch', '--db', p], { encoding: 'utf8' })
    assert.equal(r1.status, 0, r1.stderr); assert.match(r1.stdout, /row counts changed in existing tables: none/); assert.match(r1.stdout, /missing: 0/)
    const r2 = spawnSync(process.execPath, [cli, '--scratch', '--db', p], { encoding: 'utf8' }); assert.equal(r2.status, 0, r2.stderr)
    const after = await openScratchDatabase(p)
    assert.equal(existingDump(after), before); assert.equal(one(after, 'SELECT COUNT(*) n FROM schema_migrations').n, 2)
    assert.equal(inspectReportSchema(after).missing.length, 0); after.close()
  })
  it('migrated users and doctor accounts (login data) are unchanged', () => {
    const db = buildFixtureDb(); const accounts = () => JSON.stringify(rows(db, 'SELECT user_id, name, email, password_hash, role FROM users ORDER BY user_id') .concat(rows(db, 'SELECT * FROM doctor_profiles ORDER BY doctor_id')))
    const before = accounts(); applyReportSchema(db); assert.equal(accounts(), before)
  })
})

describe('5. Foreign keys and constraints', () => {
  it('reports sql.js foreign-key behaviour explicitly', t => {
    const db = new SQL.Database()
    const def = db.exec('PRAGMA foreign_keys')[0].values[0][0]
    t.diagnostic(`sql.js default PRAGMA foreign_keys = ${def} (the app's database.js never sets it)`)
    db.run('CREATE TABLE p (id INTEGER PRIMARY KEY); CREATE TABLE c (id INTEGER PRIMARY KEY, p INTEGER REFERENCES p(id))')
    db.run('PRAGMA foreign_keys = OFF'); db.run('INSERT INTO c (p) VALUES (99)')            // accepted when OFF
    db.run('DELETE FROM c'); db.run('PRAGMA foreign_keys = ON')
    assert.equal(db.exec('PRAGMA foreign_keys')[0].values[0][0], 1)
    fail(() => db.run('INSERT INTO c (p) VALUES (99)'), /FOREIGN KEY constraint failed/)
  })
  it('db.export() may reset the pragma, so it must be set again after every export or reload', t => {
    const db = new SQL.Database(); db.run('PRAGMA foreign_keys = ON'); db.export()
    t.diagnostic(`PRAGMA foreign_keys after db.export() = ${db.exec('PRAGMA foreign_keys')[0].values[0][0]}`)
    db.run('PRAGMA foreign_keys = ON'); assert.equal(db.exec('PRAGMA foreign_keys')[0].values[0][0], 1)
  })
  it('orphan rows are rejected when enforcement is ON', () => {
    const db = migrated()
    fail(() => db.run('INSERT INTO report_originals (patient_id, report_type, title, ciphertext, iv, auth_tag, key_id, envelope_sha256) VALUES (999,?,?,?,?,?,?,?)',
      ['health_summary', 'T', Buffer.alloc(4, 1), Buffer.alloc(12, 1), Buffer.alloc(16, 1), 'k1', 'a'.repeat(64)]), /FOREIGN KEY/)
    fail(() => db.run("INSERT INTO report_audit_events (event_type, actor_user_id) VALUES ('report_opened', 999)"), /FOREIGN KEY/)
  })
  it('column constraints reject bad IV/tag lengths, types, titles, hash length and algorithm', () => {
    const db = migrated()
    const ins = (over = {}) => { const v = { type: 'health_summary', title: 'T', ct: Buffer.alloc(4, 1), iv: Buffer.alloc(12, 1), tag: Buffer.alloc(16, 1), hash: 'a'.repeat(64), ...over }
      db.run('INSERT INTO report_originals (patient_id, report_type, title, ciphertext, iv, auth_tag, key_id, envelope_sha256) VALUES (1,?,?,?,?,?,?,?)', [v.type, v.title, v.ct, v.iv, v.tag, 'k1', v.hash]) }
    ins()   // a valid row is accepted
    fail(() => ins({ iv: Buffer.alloc(11) }), /CHECK/); fail(() => ins({ tag: Buffer.alloc(15) }), /CHECK/); fail(() => ins({ type: 'diagnosis' }), /CHECK/)
    fail(() => ins({ title: '' }), /CHECK/); fail(() => ins({ hash: 'abc' }), /CHECK/); fail(() => ins({ ct: Buffer.alloc(0) }), /CHECK/)
    fail(() => db.run("INSERT INTO report_originals (patient_id, report_type, title, ciphertext, iv, auth_tag, enc_alg, key_id, envelope_sha256) VALUES (1,'health_summary','T',?,?,?, 'aes-128-cbc','k1',?)", [Buffer.alloc(4, 1), Buffer.alloc(12, 1), Buffer.alloc(16, 1), 'a'.repeat(64)]), /CHECK/)
  })
})

describe('6. Original reports are immutable and stored encrypted', () => {
  it('no UPDATE or DELETE on an original', () => {
    const db = migrated(); const id = insertOriginal(db)
    fail(() => db.run("UPDATE report_originals SET title = 'Changed' WHERE report_id = ?", [id]), /immutable/)
    fail(() => db.run('UPDATE report_originals SET ciphertext = ? WHERE report_id = ?', [Buffer.alloc(4, 9), id]), /immutable/)
    fail(() => db.run('DELETE FROM report_originals WHERE report_id = ?', [id]), /cannot be deleted/)
  })
  it('the stored snapshot decrypts with the right key/identity and the database holds no plaintext copy', () => {
    const db = migrated(); const id = insertOriginal(db)
    const row = one(db, 'SELECT * FROM report_originals WHERE report_id = ?', [id])
    const env = { ciphertext: Buffer.from(row.ciphertext), iv: Buffer.from(row.iv), authTag: Buffer.from(row.auth_tag) }
    assert.match(decryptReportSnapshot(env, { key: TEST_KEY, patientId: 1, reportType: 'health_summary' }), new RegExp(MARKER))
    fail(() => decryptReportSnapshot(env, { key: TEST_KEY, patientId: 2, reportType: 'health_summary' }), /damaged or the key/)
    assert.equal(row.envelope_sha256, sha(Buffer.concat([env.ciphertext, env.iv, env.authTag])))
    const bytes = Buffer.from(db.export()); assert.equal(bytes.includes(Buffer.from(MARKER)), false, 'plaintext marker must not appear anywhere in the database file')
    assert.equal(bytes.includes(TEST_KEY), false, 'the key must not appear in the database file')
    assert.equal(rows(db, 'PRAGMA table_info(report_originals)').some(c => /plain|key$|secret/i.test(c.name)), false)
  })
})

describe('7. Consent and shares', () => {
  it('stores explicit, versioned consent and verifies the recipient from doctor_profiles', () => {
    const db = migrated(); const rid = insertOriginal(db, 1)
    share(db, rid, 1, 3, { v: 'consent-v2', text: 'Exact consent wording shown to the patient.' })
    const s = one(db, 'SELECT * FROM report_shares WHERE share_id = ?', [lastShare(db)])
    assert.equal(s.status, 'submitted'); assert.equal(s.consent_text_version, 'consent-v2'); assert.ok(s.consent_at); assert.ok(s.submitted_at); assert.equal(s.revoked_at, null)
  })
  it('rejects: other patient\'s report, non-doctor, doctor without profile, unknown user, self-share, non-initial status, empty consent', () => {
    const db = migrated(); const rid = insertOriginal(db, 1)
    fail(() => share(db, rid, 2, 3), /does not belong to this patient/)
    fail(() => share(db, rid, 1, 5), /not a doctor with a profile/)
    fail(() => share(db, rid, 1, 6), /not a doctor with a profile/)
    fail(() => share(db, rid, 1, 999), /not a doctor with a profile|FOREIGN KEY/)
    fail(() => share(db, rid, 1, 1), /not a doctor with a profile|own patient/)
    fail(() => db.run("INSERT INTO report_shares (report_id, patient_id, doctor_user_id, status, consent_text_version, consent_text, consent_text_sha256, consent_doctor_name, consent_report_title) VALUES (?,?,?,'verified','v','t',?, 'n', 't')", [rid, 1, 3, 'a'.repeat(64)]), /must start as submitted/)
    fail(() => share(db, rid, 1, 3, { text: '' }), /CHECK/); fail(() => share(db, rid, 1, 3, { v: '' }), /CHECK/)
  })
  it('allows only one active share per (report, doctor); a revoked share can be re-shared; sharing with a second doctor is independent', () => {
    const db = migrated(); const rid = insertOriginal(db, 1)
    share(db, rid, 1, 3); fail(() => share(db, rid, 1, 3), /UNIQUE/)
    share(db, rid, 1, 4)
    const first = Number(one(db, 'SELECT MIN(share_id) id FROM report_shares').id)
    db.run("UPDATE report_shares SET status='revoked', revoked_at=CURRENT_TIMESTAMP, revoked_by_user_id=1, updated_at=CURRENT_TIMESTAMP WHERE share_id=?", [first])
    share(db, rid, 1, 3)   // fresh share after revocation
    assert.equal(one(db, 'SELECT COUNT(*) n FROM report_shares WHERE report_id = ?', [rid]).n, 3)
  })
  it('status values are validated; identity and consent are immutable; revoked is final; no delete', () => {
    const db = migrated(); const rid = insertOriginal(db, 1); share(db, rid, 1, 3); const sid = lastShare(db)
    for (const s of ['under_review', 'changes_requested']) db.run('UPDATE report_shares SET status=?, updated_at=CURRENT_TIMESTAMP WHERE share_id=?', [s, sid])
    fail(() => db.run("UPDATE report_shares SET status='approved' WHERE share_id=?", [sid]), /CHECK|illegal/)
    fail(() => db.run('UPDATE report_shares SET doctor_user_id=4 WHERE share_id=?', [sid]), /immutable/)
    fail(() => db.run('UPDATE report_shares SET patient_id=2 WHERE share_id=?', [sid]), /immutable/)
    fail(() => db.run("UPDATE report_shares SET consent_text='changed' WHERE share_id=?", [sid]), /immutable/)
    fail(() => db.run("UPDATE report_shares SET status='revoked' WHERE share_id=?", [sid]), /CHECK/)   // revocation needs revoked_at
    db.run("UPDATE report_shares SET status='revoked', revoked_at=CURRENT_TIMESTAMP, revoked_by_user_id=1 WHERE share_id=?", [sid])
    fail(() => db.run("UPDATE report_shares SET status='under_review', revoked_at=NULL WHERE share_id=?", [sid]), /final|CHECK|illegal/)
    fail(() => db.run('DELETE FROM report_shares WHERE share_id=?', [sid]), /cannot be deleted/)
  })
})

describe('8. Versions are append-only and never overwrite the original', () => {
  it('appends sequential doctor notes and reviewed attachments; the original is unchanged', () => {
    const db = migrated(); const rid = insertOriginal(db, 1); share(db, rid, 1, 3); const sid = lastShare(db)
    const originalBefore = JSON.stringify(rows(db, 'SELECT * FROM report_originals WHERE report_id = ?', [rid]).map(r => ({ ...r, ciphertext: Buffer.from(r.ciphertext).toString('hex') })))
    noteVersion(db, sid, 3, 1)
    db.run("INSERT INTO report_versions (share_id, version_no, kind, author_user_id, attachment_name, storage_name, mime_type, size_bytes, content_sha256) VALUES (?,2,'reviewed_attachment',3,'reviewed.pdf','rnd-0001','application/pdf',1234,?)", [sid, 'b'.repeat(64)])
    noteVersion(db, sid, 3, 3)
    assert.deepEqual(rows(db, 'SELECT version_no, kind FROM report_versions WHERE share_id = ? ORDER BY version_no', [sid]).map(r => [r.version_no, r.kind]),
      [[1, 'doctor_note'], [2, 'reviewed_attachment'], [3, 'doctor_note']])
    const originalAfter = JSON.stringify(rows(db, 'SELECT * FROM report_originals WHERE report_id = ?', [rid]).map(r => ({ ...r, ciphertext: Buffer.from(r.ciphertext).toString('hex') })))
    assert.equal(originalAfter, originalBefore)
    assert.equal(one(db, 'SELECT COUNT(*) n FROM report_originals').n, 1)
  })
  it('cannot be updated or deleted, skip numbers, repeat numbers, or be authored by anyone but the recipient doctor', () => {
    const db = migrated(); const rid = insertOriginal(db, 1); share(db, rid, 1, 3); const sid = lastShare(db)
    noteVersion(db, sid, 3, 1)
    fail(() => db.run("UPDATE report_versions SET kind='doctor_note' WHERE share_id=?", [sid]), /append-only/)
    fail(() => db.run('DELETE FROM report_versions WHERE share_id=?', [sid]), /cannot be deleted/)
    fail(() => noteVersion(db, sid, 3, 3), /sequential/); fail(() => noteVersion(db, sid, 3, 1), /sequential|UNIQUE/)
    fail(() => noteVersion(db, sid, 4, 2), /only the recipient doctor/)      // another doctor
    fail(() => noteVersion(db, sid, 1, 2), /only the recipient doctor/)      // the patient
  })
  it('validates attachment metadata and blocks versions on a revoked share', () => {
    const db = migrated(); const rid = insertOriginal(db, 1); share(db, rid, 1, 3); const sid = lastShare(db)
    const att = (no, over = {}) => { const v = { mime: 'application/pdf', size: 100, hash: 'c'.repeat(64), storage: `rnd-${no}`, name: 'r.pdf', ...over }
      db.run("INSERT INTO report_versions (share_id, version_no, kind, author_user_id, attachment_name, storage_name, mime_type, size_bytes, content_sha256) VALUES (?,?,'reviewed_attachment',3,?,?,?,?,?)", [sid, no, v.name, v.storage, v.mime, v.size, v.hash]) }
    fail(() => att(1, { mime: 'text/html' }), /CHECK/); fail(() => att(1, { mime: 'image/svg+xml' }), /CHECK/)
    fail(() => att(1, { size: 5242881 }), /CHECK/); fail(() => att(1, { size: 0 }), /CHECK/); fail(() => att(1, { hash: 'short' }), /CHECK/); fail(() => att(1, { storage: null }), /CHECK|NOT NULL/)
    att(1, { mime: 'image/png' }); att(2, { mime: 'image/jpeg' })
    fail(() => att(3, { storage: 'rnd-1' }), /UNIQUE/)    // private file names are unique
    fail(() => db.run("INSERT INTO report_versions (share_id, version_no, kind, author_user_id) VALUES (?,3,'doctor_note',3)", [sid]), /CHECK/)   // note requires ciphertext
    db.run("UPDATE report_shares SET status='revoked', revoked_at=CURRENT_TIMESTAMP, revoked_by_user_id=1 WHERE share_id=?", [sid])
    fail(() => noteVersion(db, sid, 3, 3), /revoked share/)
  })
})

describe('9. Audit events', () => {
  it('records the intended relationships and cannot be altered', () => {
    const db = migrated(); const rid = insertOriginal(db, 1); share(db, rid, 1, 3); const sid = lastShare(db); noteVersion(db, sid, 3, 1)
    const vid = Number(one(db, 'SELECT MAX(version_id) id FROM report_versions').id)
    const ev = (type, actor, role, o = {}) => db.run('INSERT INTO report_audit_events (event_type, outcome, actor_user_id, actor_role, report_id, share_id, version_id, detail_code) VALUES (?,?,?,?,?,?,?,?)',
      [type, o.outcome ?? 'ok', actor, role, o.report ?? null, o.share ?? null, o.version ?? null, o.code ?? null])
    ev('report_created', 1, 'user', { report: rid }); ev('consent_recorded', 1, 'user', { report: rid, share: sid }); ev('share_submitted', 1, 'user', { report: rid, share: sid })
    ev('report_opened', 3, 'doctor', { report: rid, share: sid }); ev('status_changed', 3, 'doctor', { report: rid, share: sid, code: 'under_review' })
    ev('review_created', 3, 'doctor', { report: rid, share: sid, version: vid }); ev('version_downloaded', 1, 'user', { report: rid, share: sid, version: vid })
    ev('original_downloaded', 1, 'user', { report: rid }); ev('access_denied', 4, 'doctor', { report: rid, outcome: 'denied', code: 'not_recipient' }); ev('share_revoked', 1, 'user', { share: sid })
    const joined = rows(db, `SELECT e.event_type, u.name FROM report_audit_events e JOIN users u ON u.user_id = e.actor_user_id JOIN report_originals r ON r.report_id = e.report_id WHERE e.share_id = ? ORDER BY e.event_id`, [sid])
    assert.ok(joined.length >= 6)
    fail(() => db.run("UPDATE report_audit_events SET outcome='error' WHERE event_id=1"), /append-only/)
    fail(() => db.run('DELETE FROM report_audit_events'), /cannot be deleted/)
  })
  it('only accepts known event types, outcomes, roles and short code-like details (no sentences / health text)', () => {
    const db = migrated()
    const bad = (cols, vals) => fail(() => db.run(`INSERT INTO report_audit_events (${cols}) VALUES (${vals.map(() => '?').join(',')})`, vals), /CHECK/)
    bad('event_type', ['made_up_event']); bad('event_type, outcome', ['report_opened', 'maybe']); bad('event_type, actor_role', ['report_opened', 'superuser'])
    bad('event_type, detail_code', ['report_opened', 'patient has PCOS and severe pain']); bad('event_type, detail_code', ['report_opened', 'UPPER']); bad('event_type, detail_code', ['report_opened', 'x'.repeat(41)])
    db.run("INSERT INTO report_audit_events (event_type, detail_code) VALUES ('report_opened', 'under_review')")
  })
})

describe('10. Artifacts contain no secrets and no real records', () => {
  it('scans every file created in this run for keys, secret markers and the plaintext marker', async () => {
    const db = migrated(); insertOriginal(db, 1); writeScratch(db, 'artifact-final')
    const files = fs.readdirSync(RUN_DIR).map(f => path.join(RUN_DIR, f)).filter(f => fs.statSync(f).isFile())
    assert.ok(files.length >= 5)
    for (const f of files) {
      const bytes = fs.readFileSync(f)
      assert.equal(bytes.includes(Buffer.from(MARKER)), false, `${path.basename(f)} contains plaintext marker`)
      assert.equal(bytes.includes(TEST_KEY), false, `${path.basename(f)} contains the raw key`)
      assert.equal(bytes.includes(Buffer.from(TEST_KEY_B64)), false, `${path.basename(f)} contains the encoded key`)
      assert.equal(/REPORT_MASTER_KEY\s*=|AIza[0-9A-Za-z_-]{20}|JWT_SECRET|BEGIN (RSA )?PRIVATE KEY/.test(bytes.toString('latin1')), false, `${path.basename(f)} contains a secret-looking string`)
    }
    // fictional-only: every user email in the fixture ends in .invalid
    for (const f of files.filter(f => f.endsWith('.scratch.db'))) {
      const d = await openScratchDatabase(f)
      assert.ok(rows(d, 'SELECT email FROM users').every(r => r.email.endsWith('@fixture.invalid')), 'fixture users must be fictional'); d.close()
    }
  })
  it('the test tree itself contains no real-looking secrets', () => {
    for (const f of ['lib/reportCrypto.js', 'db/reportSchema.js', 'db/scratchGuard.js', 'scripts/migrate-report-audit.js', 'tests/report-infra.test.mjs']) {
      const t = fs.readFileSync(path.join(backendDir, f), 'utf8')
      assert.equal(/AIza[0-9A-Za-z_-]{20}/.test(t), false, f); assert.equal(/REPORT_MASTER_KEY\s*=\s*[A-Za-z0-9+/]{20}/.test(t), false, f)
    }
  })
  it('writes the scratch location for the report', t => { t.diagnostic(`scratch directory: ${RUN_DIR}`) })
})
