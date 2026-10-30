// Tests for the migration verifier and the staged runner script. SCRATCH ONLY: fictional databases in a temp folder.
//   Run:  node --test tests/report-runner.test.mjs
// - The verifier is run as a child process against tampered copies and must FAIL for every defect below.
// - The PowerShell runner is checked statically here (it is rehearsed end to end by scripts/rehearse-report-audit-migration.ps1).
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import initSqlJs from 'sql.js'
import { buildFixtureDb } from './helpers/fixture.mjs'
import { applyReportSchema, REPORT_SCHEMA_STATEMENTS, MIGRATION_NAME } from '../db/reportSchema.js'
import { SCHEMA_002_STATEMENTS } from '../db/reportSchema002.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const backend = path.resolve(here, '..')
const RUN = path.join(os.tmpdir(), 'neurorelief-runner-tests', `run-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`)
fs.mkdirSync(RUN, { recursive: true })
let SQL, n = 0
before(async () => { SQL = await initSqlJs() })

const save = (db, name) => { const p = path.join(RUN, `${name}-${++n}.scratch.db`); fs.writeFileSync(p, Buffer.from(db.export())); return p }
const verify = (...args) => { const r = spawnSync(process.execPath, [path.join(backend, 'scripts', 'verify-report-audit.js'), ...args], { cwd: backend, encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr } }
const pair = mutate => {            // a backup (fixture) and a migrated copy, optionally tampered
  const before = buildFixtureDb(SQL), backup = save(before, 'backup')
  const after = buildFixtureDb(SQL); applyReportSchema(after); if (mutate) mutate(after)
  return { backup, after: save(after, 'after') }
}
const failsWith = (res, re) => { assert.equal(res.code, 1, res.out); assert.match(res.out, re) }

describe('Migration verifier: both migrations, definitions and behaviour', () => {
  it('passes on a correct migration and reports every new check', () => {
    const { backup, after } = pair()
    const r = verify('--before', backup, '--after', after)
    assert.equal(r.code, 0, r.out)
    for (const re of [
      /migrated: migration report-audit-001 recorded exactly once/, /migrated: migration report-audit-002 recorded exactly once/, /no unexpected migration records/,
      /definitions of all 30 Report Audit tables, triggers and indexes match the migration code exactly/,
      /report_shares\.appointment_id: INTEGER, nullable, no default, references appointments\(appointment_id\)/, /report_shares\.previous_share_id: INTEGER, nullable, no default, references report_shares\(share_id\)/, /report_shares\.verified_at: DATETIME/,
      /smoke: a share tied to a PENDING appointment is refused/, /smoke: a share tied to an ACCEPTED appointment is allowed/, /smoke: submitted -> verified directly is refused/, /smoke: verifying without a doctor note is refused/,
      /backup has no Report Audit migration recorded yet/,
    ]) assert.match(r.out, re)
    assert.ok(!/FAIL/.test(r.out))
  })
  it('never writes to the files it checks (hashes identical before and after)', () => {
    const { backup, after } = pair(); const h = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
    const before = [h(backup), h(after)]; verify('--before', backup, '--after', after)
    assert.deepEqual([h(backup), h(after)], before)
  })
  it('FAILS when migration report-audit-002 is not recorded', () => {
    const { backup, after } = pair(db => db.run("DELETE FROM schema_migrations WHERE name = 'report-audit-002'"))
    failsWith(verify('--before', backup, '--after', after), /FAIL  migrated: migration report-audit-002 recorded exactly once  \(0 record/)
  })
  it('FAILS when migration report-audit-001 is not recorded', () => {
    const { backup, after } = pair(db => db.run("DELETE FROM schema_migrations WHERE name = 'report-audit-001'"))
    failsWith(verify('--before', backup, '--after', after), /FAIL  migrated: migration report-audit-001 recorded exactly once  \(0 record/)
  })
  it('FAILS when a migration is recorded MORE THAN ONCE (table rebuilt without its primary key)', () => {
    const { backup, after } = pair(db => {
      db.run('ALTER TABLE schema_migrations RENAME TO schema_migrations_old')
      db.run('CREATE TABLE schema_migrations (name TEXT, applied_at DATETIME)')
      db.run("INSERT INTO schema_migrations (name) VALUES ('report-audit-001'), ('report-audit-001'), ('report-audit-002')")
    })
    failsWith(verify('--before', backup, '--after', after), /FAIL  migrated: migration report-audit-001 recorded exactly once  \(2 record/)
  })
  it('FAILS on an unexpected migration record', () => {
    const { backup, after } = pair(db => db.run("INSERT INTO schema_migrations (name) VALUES ('report-audit-003')"))
    failsWith(verify('--before', backup, '--after', after), /FAIL  migrated: no unexpected migration records/)
  })
  it('FAILS when only migration 001 was applied (no 002 columns, triggers or record)', () => {
    const before = buildFixtureDb(SQL), backup = save(before, 'backup')
    const after = buildFixtureDb(SQL)
    for (const s of REPORT_SCHEMA_STATEMENTS) after.run(s)
    after.run('INSERT INTO schema_migrations (name) VALUES (?)', [MIGRATION_NAME])
    const r = verify('--before', backup, '--after', save(after, 'only001'))
    failsWith(r, /FAIL  migrated: migration report-audit-002 recorded exactly once/)
    assert.match(r.out, /FAIL  report_shares\.appointment_id/); assert.match(r.out, /FAIL  all report tables, triggers and indexes present/)
  })
  it('FAILS when a migration-002 trigger is missing', () => {
    const { backup, after } = pair(db => db.run('DROP TRIGGER trg_report_shares_verified_at'))
    const r = verify('--before', backup, '--after', after)
    failsWith(r, /FAIL  all report tables, triggers and indexes present/); assert.match(r.out, /FAIL  definitions of all 30/)
  })
  it('FAILS when a trigger definition was weakened (same name, different body)', () => {
    const { backup, after } = pair(db => {
      db.run('DROP TRIGGER trg_report_shares_transition')
      db.run("CREATE TRIGGER trg_report_shares_transition BEFORE UPDATE OF status ON report_shares WHEN NEW.status <> OLD.status BEGIN SELECT 1; END")
    })
    const r = verify('--before', backup, '--after', after)
    failsWith(r, /FAIL  definitions of all 30 Report Audit tables, triggers and indexes match the migration code exactly  \(differ or missing: trg_report_shares_transition\)/)
    assert.match(r.out, /FAIL  smoke: submitted -> verified directly is refused/)   // the behaviour check catches it independently
  })
  it('FAILS when the migration-002 appointment check trigger is weakened', () => {
    const { backup, after } = pair(db => {
      db.run('DROP TRIGGER trg_report_shares_appt_insert')
      db.run('CREATE TRIGGER trg_report_shares_appt_insert BEFORE INSERT ON report_shares WHEN NEW.appointment_id IS NOT NULL BEGIN SELECT 1; END')
    })
    const r = verify('--before', backup, '--after', after)
    failsWith(r, /FAIL  definitions of all 30/); assert.match(r.out, /FAIL  smoke: a share tied to a PENDING appointment is refused/)
  })
  it('FAILS when the backup is already migrated (this must be a first migration)', () => {
    const migratedBackup = buildFixtureDb(SQL); applyReportSchema(migratedBackup)
    const after = buildFixtureDb(SQL); applyReportSchema(after)
    failsWith(verify('--before', save(migratedBackup, 'backup'), '--after', save(after, 'after')), /FAIL  backup has no Report Audit migration recorded yet/)
  })
  it('--migrations-only: passes with both records once, fails when one is missing', () => {
    const good = buildFixtureDb(SQL); applyReportSchema(good)
    assert.equal(verify('--migrations-only', save(good, 'good')).code, 0)
    const bad = buildFixtureDb(SQL); applyReportSchema(bad); bad.run("DELETE FROM schema_migrations WHERE name = 'report-audit-002'")
    failsWith(verify('--migrations-only', save(bad, 'bad')), /FAIL  database: migration report-audit-002 recorded exactly once/)
    assert.equal(verify('--migrations-only', save(buildFixtureDb(SQL), 'none')).code, 1)   // un-migrated database
  })
  it('migrate CLI names both migrations and records each once', () => {
    const p = save(buildFixtureDb(SQL), 'cli')
    const r = spawnSync(process.execPath, [path.join(backend, 'scripts', 'migrate-report-audit.js'), '--scratch', '--db', p], { cwd: backend, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /Migrations report-audit-001 and report-audit-002 applied to the scratch database \(each recorded once\)/)
    const again = spawnSync(process.execPath, [path.join(backend, 'scripts', 'migrate-report-audit.js'), '--scratch', '--db', p], { cwd: backend, encoding: 'utf8' })
    assert.equal(again.status, 0)   // idempotent
    const r2 = verify('--migrations-only', p); assert.equal(r2.code, 0, r2.out)
  })
})

describe('Staged runner (static checks of scripts/report-audit-migration.ps1)', () => {
  const ps = fs.readFileSync(path.join(backend, 'scripts', 'report-audit-migration.ps1'), 'utf8')
  const lines = ps.split(/\r?\n/)
  it('never deletes a backup: every Remove-Item targets only a staging copy', () => {
    const removals = lines.filter(l => /Remove-Item/.test(l) && !/^\s*#/.test(l))
    assert.ok(removals.length >= 2)
    for (const l of removals) assert.match(l, /Remove-Item -LiteralPath \$staging\b/, l.trim())
    assert.ok(!/Remove-Item[^\n]*(\$backup\b|backupPath|\.backup)/i.test(ps))
    assert.match(ps, /Move-Item -LiteralPath \$backup -Destination \$rejected/)          // a bad backup copy is set aside, not deleted
    assert.ok(!/Move-Item[^\n]*backupPath/i.test(ps))                                      // the recorded backup is only ever copied from
  })
  it('Swap checks both migration records BEFORE it stops anything or touches the database', () => {
    const swap = ps.slice(ps.indexOf("if ($Stage -eq 'Swap')"), ps.indexOf("if ($Stage -eq 'Rollback')"))
    const iMig = swap.indexOf("'--migrations-only', $s.migratedCopyPath"), iStop = swap.indexOf('Stop-Process'), iMove = swap.indexOf('Move-Item')
    assert.ok(iMig > 0 && iMig < iStop && iStop < iMove)
    assert.match(swap, /'--migrations-only', \$dbFull/)                                    // and again on the live file after the swap
    assert.match(swap, /Nothing was stopped or changed/)
  })
  it('Prepare also requires both migrations in the copy; Rollback checks and reports the backup', () => {
    assert.match(ps.slice(ps.indexOf("if ($Stage -eq 'Prepare')"), ps.indexOf("if ($Stage -eq 'Swap')")), /'--migrations-only', \$copy/)
    const rb = ps.slice(ps.indexOf("if ($Stage -eq 'Rollback')"))
    assert.match(rb, /Assert-BackupIntact \$s 'before restoring'/); assert.match(rb, /Say-BackupPreserved \$s/)
    assert.match(rb, /Restore-FromBackup \$s/)
  })
  it('restore COPIES the backup (Copy-Item) and verifies hashes before and after', () => {
    const fn = ps.slice(ps.indexOf('function Restore-FromBackup'), ps.indexOf('# ===', ps.indexOf('function Restore-FromBackup')))
    assert.match(fn, /Copy-Item -LiteralPath \$s\.backupPath/); assert.ok(!/Move-Item -LiteralPath \$s\.backupPath/.test(fn))
    assert.equal((fn.match(/Sha \$/g) || []).length >= 2, true)
  })
})
