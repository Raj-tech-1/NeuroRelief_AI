// READ-ONLY verification of a Report Audit migration. It never writes, saves or modifies any file.
//
//   node scripts/verify-report-audit.js --before <backup.db> --after <migrated.db>
//   node scripts/verify-report-audit.js --integrity-only <file.db>
//   node scripts/verify-report-audit.js --migrations-only <file.db>   (both migration records exactly once, nothing unexpected)
//
// Compares every pre-existing table (schema text, row count and a SHA-256 over all row contents) between the
// backup and the migrated file, checks database integrity and foreign-key violations, and checks that the new
// report tables exist, are empty, and carry the expected triggers/indexes. Output is names, counts and
// pass/fail only; no row contents are printed. Exit code 0 = every check passed, 1 = something failed, 2 = bad usage.
import fs from 'node:fs'
import crypto from 'node:crypto'
import initSqlJs from 'sql.js'
import { inspectReportSchema, applyReportSchema, REPORT_SCHEMA_OBJECTS, MIGRATION_NAME } from '../db/reportSchema.js'
import { MIGRATION_NAME_002 } from '../db/reportSchema002.js'

const NEW_DATA_TABLES = ['report_originals', 'report_shares', 'report_versions', 'report_audit_events']
const EXPECTED_MIGRATIONS = [MIGRATION_NAME, MIGRATION_NAME_002]

function parseArgs(argv) {
  const a = { before: undefined, after: undefined, integrityOnly: undefined, migrationsOnly: undefined }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--before') a.before = argv[++i]
    else if (argv[i] === '--after') a.after = argv[++i]
    else if (argv[i] === '--integrity-only') a.integrityOnly = argv[++i]
    else if (argv[i] === '--migrations-only') a.migrationsOnly = argv[++i]
    else { console.error(`Unknown argument: ${argv[i]}`); process.exit(2) }
  }
  return a
}

let SQL
async function openReadOnly(file) {
  if (typeof file !== 'string' || !file || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('database file not found')
  SQL ||= await initSqlJs()
  return new SQL.Database(fs.readFileSync(file))      // in-memory copy; nothing is ever written back
}
const rows = (db, sql) => { const r = db.exec(sql); return r[0] ? r[0].values : [] }
const scalar = (db, sql) => { const r = rows(db, sql); return r.length ? r[0][0] : null }
const tableNames = db => rows(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(r => r[0])
const norm = v => (v instanceof Uint8Array ? `b:${Buffer.from(v).toString('hex')}` : v === null ? 'null' : `${typeof v}:${v}`)

function contentFingerprint(db, table) {
  const h = crypto.createHash('sha256'); let n = 0
  const st = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`)
  while (st.step()) { h.update(JSON.stringify(st.get().map(norm))); h.update('\n'); n++ }
  st.free()
  return { count: n, hash: h.digest('hex') }
}
const tableSql = (db, t) => scalar(db, `SELECT sql FROM sqlite_master WHERE type='table' AND name='${t}'`)
const integrity = db => rows(db, 'PRAGMA integrity_check').map(r => r[0]).join(';')
const fkViolations = db => rows(db, 'PRAGMA foreign_key_check').length

// Both migrations must be recorded EXACTLY once (a missing or duplicated record fails), and nothing else may be recorded.
function checkMigrationRecords(db, label) {
  const names = tableNames(db)
  const recs = names.includes('schema_migrations') ? rows(db, 'SELECT name FROM schema_migrations').map(r => r[0]) : []
  check(label + ': schema_migrations table present', names.includes('schema_migrations'))
  for (const m of EXPECTED_MIGRATIONS) {
    const n = recs.filter(x => x === m).length
    check(label + ': migration ' + m + ' recorded exactly once', n === 1, n + ' record(s)')
  }
  const unexpected = recs.filter(x => !EXPECTED_MIGRATIONS.includes(x))
  check(label + ': no unexpected migration records', unexpected.length === 0, unexpected.length ? unexpected.length + ' unexpected' : 'none')
}

// The exact CREATE text of every Report Audit table, trigger and index must equal what the migration code produces.
// The reference is built in memory from the migration code itself (never from the file being checked).
function checkDefinitions(after) {
  const ref = new SQL.Database()
  ref.run('CREATE TABLE users (user_id INTEGER PRIMARY KEY, role TEXT)')
  ref.run('CREATE TABLE doctor_profiles (doctor_id INTEGER PRIMARY KEY, user_id INTEGER)')
  ref.run('CREATE TABLE appointments (appointment_id INTEGER PRIMARY KEY)')
  applyReportSchema(ref)
  const all = [...REPORT_SCHEMA_OBJECTS.tables, ...REPORT_SCHEMA_OBJECTS.triggers, ...REPORT_SCHEMA_OBJECTS.indexes]
  const sqlOf = (db, n) => scalar(db, "SELECT sql FROM sqlite_master WHERE name='" + n + "'")
  const wrong = all.filter(n => sqlOf(ref, n) === null || sqlOf(ref, n) !== sqlOf(after, n))
  check('definitions of all ' + all.length + ' Report Audit tables, triggers and indexes match the migration code exactly', wrong.length === 0, wrong.length ? 'differ or missing: ' + wrong.join(', ') : 'identical')
  ref.close()

  // migration-002 columns: type, nullability, default and foreign keys
  const info = rows(after, 'PRAGMA table_info(report_shares)')          // cid, name, type, notnull, dflt_value, pk
  const fks = rows(after, 'PRAGMA foreign_key_list(report_shares)')     // id, seq, table, from, to, ...
  const expect = { appointment_id: ['INTEGER', 'appointments', 'appointment_id'], previous_share_id: ['INTEGER', 'report_shares', 'share_id'], verified_at: ['DATETIME', null, null] }
  for (const [col, [type, refTable, refCol]] of Object.entries(expect)) {
    const c = info.find(r => r[1] === col)
    const fk = fks.find(r => r[3] === col)
    const ok = !!c && c[2] === type && c[3] === 0 && c[4] === null && c[5] === 0 &&
      (refTable ? !!fk && fk[2] === refTable && fk[4] === refCol : !fk)
    check('report_shares.' + col + ': ' + type + ', nullable, no default' + (refTable ? ', references ' + refTable + '(' + refCol + ')' : ', no foreign key'), ok)
  }
}

// Behavioural check of the migration-002 rules on an IN-MEMORY clone with synthetic rows. The clone is never exported or saved.
function expectThrows(fn, re) { try { fn() } catch (e) { return re.test(String(e.message)) } return false }
async function triggerSmoke(file) {
  const c = await openReadOnly(file)
  try {
    const free = id => scalar(c, 'SELECT COUNT(*) FROM users WHERE user_id = ' + id) === 0
    if (!free(990001) || !free(990002)) { check('trigger behaviour smoke test', false, 'synthetic ids are in use'); return }
    c.run("INSERT INTO users (user_id, name, email, password_hash, role) VALUES (990001, 's', 'smoke-patient@smoke.invalid', 'x', 'user'), (990002, 's', 'smoke-doctor@smoke.invalid', 'x', 'doctor')")
    c.run("INSERT INTO doctor_profiles (user_id, display_name, specialty) VALUES (990002, 's', 's')")
    c.run("INSERT INTO appointments (appointment_id, patient_id, doctor_user_id, requested_date, requested_time, status) VALUES (990011, 990001, 990002, '2030-01-01', '9:00 AM', 'pending'), (990012, 990001, 990002, '2030-01-02', '9:00 AM', 'accepted')")
    c.run("INSERT INTO report_originals (report_id, patient_id, report_type, title, ciphertext, iv, auth_tag, key_id, envelope_sha256) VALUES (990021, 990001, 'health_summary', 't', x'00', zeroblob(12), zeroblob(16), 'k', '" + 'a'.repeat(64) + "')")
    const share = appt => c.run("INSERT INTO report_shares (report_id, patient_id, doctor_user_id, consent_text_version, consent_text, consent_text_sha256, consent_doctor_name, consent_report_title, appointment_id) VALUES (990021, 990001, 990002, 'v', 't', '" + 'b'.repeat(64) + "', 'd', 't', " + appt + ')')
    check('smoke: a share tied to a PENDING appointment is refused', expectThrows(() => share(990011), /confirmed appointment/))
    let ok = true; try { share(990012) } catch { ok = false }
    check('smoke: a share tied to an ACCEPTED appointment is allowed', ok)
    const sid = scalar(c, 'SELECT MAX(share_id) FROM report_shares')
    check('smoke: submitted -> verified directly is refused', expectThrows(() => c.run("UPDATE report_shares SET status='verified', verified_at=CURRENT_TIMESTAMP WHERE share_id=" + sid), /illegal status transition/))
    c.run("UPDATE report_shares SET status='under_review' WHERE share_id=" + sid)
    check('smoke: verifying without a doctor note is refused', expectThrows(() => c.run("UPDATE report_shares SET status='verified', verified_at=CURRENT_TIMESTAMP WHERE share_id=" + sid), /doctor note/))
    check('smoke: verified_at cannot be set without status verified', expectThrows(() => c.run('UPDATE report_shares SET verified_at=CURRENT_TIMESTAMP WHERE share_id=' + sid), /verified_at/))
    check('smoke: the appointment link of a share is immutable', expectThrows(() => c.run('UPDATE report_shares SET appointment_id=990011 WHERE share_id=' + sid), /immutable/))
  } finally { c.close() }
}

const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`) }

const args = parseArgs(process.argv.slice(2))
try {
  if (args.integrityOnly) {
    const db = await openReadOnly(args.integrityOnly)
    const res = integrity(db)
    check('integrity_check', res === 'ok', res === 'ok' ? 'ok' : 'integrity problems reported')
    check('foreign_key_check (informational count)', true, `${fkViolations(db)} violation(s)`)
    check('required tables present (users, doctor_profiles, appointments)', ['users', 'doctor_profiles', 'appointments'].every(t => tableNames(db).includes(t)))
  } else if (args.migrationsOnly) {
    checkMigrationRecords(await openReadOnly(args.migrationsOnly), 'database')
  } else if (args.before && args.after) {
    const before = await openReadOnly(args.before), after = await openReadOnly(args.after)
    console.log('Comparing backup (before) with migrated copy (after). Read-only; no content is printed.')

    check('backup integrity_check', integrity(before) === 'ok')
    check('migrated integrity_check', integrity(after) === 'ok')
    const fkB = fkViolations(before), fkA = fkViolations(after)
    check('no new foreign-key violations', fkA <= fkB, `before ${fkB}, after ${fkA}`)

    const bt = tableNames(before), at = tableNames(after)
    for (const t of bt) {
      if (!at.includes(t)) { check(`table ${t} still exists`, false); continue }
      const fb = contentFingerprint(before, t), fa = contentFingerprint(after, t)
      check(`table ${t} unchanged`, fb.hash === fa.hash && fb.count === fa.count && tableSql(before, t) === tableSql(after, t), `${fb.count} rows`)
    }
    const added = at.filter(t => !bt.includes(t)).sort()
    const expectedAdded = REPORT_SCHEMA_OBJECTS.tables.filter(t => !bt.includes(t)).sort()
    check('only the expected tables were added', JSON.stringify(added) === JSON.stringify(expectedAdded), `added: ${added.join(', ') || 'none'}`)

    const insp = inspectReportSchema(after)
    check('all report tables, triggers and indexes present', insp.missing.length === 0, insp.missing.length ? `missing: ${insp.missing.join(', ')}` : `${insp.present.length} objects`)
    for (const t of NEW_DATA_TABLES) if (at.includes(t) && !bt.includes(t)) check(`new table ${t} is empty`, scalar(after, `SELECT COUNT(*) FROM ${t}`) === 0)
    // The backup must be un-migrated (this is a first migration), and the result must carry BOTH migrations exactly once
    const priorRecs = bt.includes('schema_migrations') ? scalar(before, "SELECT COUNT(*) FROM schema_migrations WHERE name IN ('" + EXPECTED_MIGRATIONS.join("','") + "')") : 0
    check('backup has no Report Audit migration recorded yet (this is a first migration)', priorRecs === 0, priorRecs + ' record(s)')
    checkMigrationRecords(after, 'migrated')
    checkDefinitions(after)
    await triggerSmoke(args.after)

    // Human-readable summary of the data that matters most for this migration (counts only)
    const count = (db, sql) => scalar(db, sql)
    console.log(`Summary (before -> after): users ${count(before, 'SELECT COUNT(*) FROM users')} -> ${count(after, 'SELECT COUNT(*) FROM users')}, ` +
      `doctor accounts ${count(before, "SELECT COUNT(*) FROM users WHERE role='doctor'")} -> ${count(after, "SELECT COUNT(*) FROM users WHERE role='doctor'")}, ` +
      `doctor profiles ${count(before, 'SELECT COUNT(*) FROM doctor_profiles')} -> ${count(after, 'SELECT COUNT(*) FROM doctor_profiles')}, ` +
      `appointments ${count(before, 'SELECT COUNT(*) FROM appointments')} -> ${count(after, 'SELECT COUNT(*) FROM appointments')}`)
  } else {
    console.error('Usage: verify-report-audit.js --before <backup.db> --after <migrated.db>   |   --integrity-only <file.db>   |   --migrations-only <file.db>')
    process.exit(2)
  }
} catch (err) {
  console.error(`FAIL  verification could not run: ${err.message}`)
  process.exit(1)
}
const failed = results.filter(r => !r).length
console.log(failed === 0 ? `RESULT: all ${results.length} checks passed.` : `RESULT: ${failed} of ${results.length} checks FAILED.`)
process.exit(failed === 0 ? 0 : 1)
