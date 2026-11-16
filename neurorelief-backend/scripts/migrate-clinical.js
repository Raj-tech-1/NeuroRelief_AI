// Applies the additive clinical-sync schema (db/clinicalSchema.js) and prints a verification report.
//
//   Rehearsal (default, safe): copies the real database to a temporary *.scratch.db OUTSIDE the project, migrates the
//   copy, verifies it, and deletes the copy. The real database is only READ.
//       node scripts/migrate-clinical.js --rehearse [--report <file.md>] [--keep]
//
//   Scratch: migrate an explicitly named scratch database (same guard as the Report Audit tooling).
//       node scripts/migrate-clinical.js --scratch --db <path\to\x.scratch.db> [--check]
//
//   Backup only (reads the real database, writes a verified copy):
//       node scripts/migrate-clinical.js --backup-only [--backup-dir <dir>]
//
//   Rollback rehearsal (copies only): backup -> migrate -> restore -> prove the restored file is identical.
//       node scripts/migrate-clinical.js --rehearse-rollback
//
//   Production (ONLY after the owner has approved the rehearsal report):
//       node scripts/migrate-clinical.js --production --i-have-approval [--backup-dir <dir>] [--report <file.md>]
//   It refuses while the backend is answering on PORT (the running server keeps the database in memory and would
//   overwrite the migration on its next write), takes a fresh timestamped, verified backup, migrates,
//   verifies that every existing row is byte-for-byte unchanged, and only then writes the file atomically.
//
//   Restore (recovery): puts a verified backup back in place of the real database.
//       node scripts/migrate-clinical.js --restore --from <backup.db> --i-have-approval [--backup-dir <dir>]
//   It refuses while the backend is running, checks the backup (integrity + its .sha256 file), saves the current
//   database as one more backup first, then writes atomically and confirms the SHA-256 matches the backup.
//
// Backups go to %LOCALAPPDATA%\NeuroRelief\backups by default (outside OneDrive, so sync cannot interfere), each with a
// .sha256 file next to it.
//
// The report contains table names, row counts and SHA-256 digests only — never record content.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import initSqlJs from 'sql.js'
import { assertScratchDatabase, openScratchDatabase, saveScratchDatabase, ScratchGuardError, PRODUCTION_DB_FILE } from '../db/scratchGuard.js'
import { applyClinicalSchema, inspectClinicalSchema, MIGRATION_NAME, APPOINTMENT_COLUMNS, CLINICAL_SCHEMA_OBJECTS } from '../db/clinicalSchema.js'

function parseArgs(argv) {
  const out = { mode: 'rehearse', check: false, db: undefined, report: undefined, keep: false, approval: false, backupDir: undefined, from: undefined }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--rehearse') out.mode = 'rehearse'
    else if (a === '--scratch') out.mode = 'scratch'
    else if (a === '--production') out.mode = 'production'
    else if (a === '--backup-only') out.mode = 'backup'
    else if (a === '--restore') out.mode = 'restore'
    else if (a === '--rehearse-rollback') out.mode = 'rehearse-rollback'
    else if (a === '--backup-dir') out.backupDir = argv[++i]
    else if (a === '--from') out.from = argv[++i]
    else if (a === '--i-have-approval') out.approval = true
    else if (a === '--check') out.check = true
    else if (a === '--keep') out.keep = true
    else if (a === '--db') out.db = argv[++i]
    else if (a === '--report') out.report = argv[++i]
    else { console.error(`Unknown argument: ${a}`); process.exit(2) }
  }
  return out
}

const q = (db, sql) => { const r = db.exec(sql); return r[0] ? r[0].values : [] }
const tables = db => q(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(v => v[0])
const columns = (db, t) => q(db, `PRAGMA table_info("${t}")`).map(v => v[1])

// Row count + digest of every existing row (only the columns that existed before), ordered by rowid.
function fingerprint(db, onlyColumns = null) {
  const out = {}
  for (const t of tables(db)) {
    const cols = (onlyColumns?.[t] ?? columns(db, t)).map(c => `"${c}"`).join(', ')
    const h = crypto.createHash('sha256')
    // The one row this migration adds to schema_migrations is excluded so the ORIGINAL rows can be compared exactly
    const where = t === 'schema_migrations' ? ` WHERE name <> '${MIGRATION_NAME}'` : ''
    const stmt = db.prepare(`SELECT ${cols} FROM "${t}"${where} ORDER BY rowid`)
    let n = 0
    while (stmt.step()) {
      n++
      h.update(JSON.stringify(stmt.get().map(v => (v instanceof Uint8Array ? `b64:${Buffer.from(v).toString('base64')}` : v))))
      h.update('\n')
    }
    stmt.free()
    out[t] = { rows: n, sha256: h.digest('hex') }
  }
  return out
}

function verify(db, before, beforeCols) {
  const problems = []
  const after = fingerprint(db, beforeCols)
  for (const t of Object.keys(before)) {
    if (!after[t]) problems.push(`table ${t} disappeared`)
    else if (after[t].rows !== before[t].rows) problems.push(`table ${t}: row count ${before[t].rows} -> ${after[t].rows}`)
    else if (after[t].sha256 !== before[t].sha256) problems.push(`table ${t}: existing row content changed`)
  }
  const integrity = q(db, 'PRAGMA integrity_check').map(v => v[0]).join(', ')
  if (integrity !== 'ok') problems.push(`integrity_check: ${integrity}`)
  const fk = q(db, 'PRAGMA foreign_key_check')
  const { missing } = inspectClinicalSchema(db)
  if (missing.length) problems.push(`missing schema objects: ${missing.join(', ')}`)
  const recorded = q(db, `SELECT COUNT(*) FROM schema_migrations WHERE name = '${MIGRATION_NAME}'`)[0][0]
  if (recorded !== 1) problems.push(`migration recorded ${recorded} time(s)`)
  // Defaults on existing appointments: version 1, everything else NULL
  const bad = q(db, 'SELECT COUNT(*) FROM appointments WHERE version <> 1 OR updated_by IS NOT NULL OR completed_at IS NOT NULL OR proposed_date IS NOT NULL OR proposed_by IS NOT NULL')[0][0]
  if (bad) problems.push(`${bad} existing appointment(s) did not get the expected defaults`)
  return { after, integrity, fkViolations: fk.length, problems }
}

function report({ mode, source, before, result, backup, idempotent }) {
  const lines = []
  lines.push(`# Clinical-sync migration verification (${MIGRATION_NAME})`, '')
  lines.push(`- Mode: **${mode}**`, `- Source database: \`${source}\``, `- Generated: ${new Date().toISOString()}`)
  if (backup) lines.push(`- Backup taken before migration: \`${backup}\``)
  lines.push(`- Result: **${result.problems.length ? 'FAILED' : 'PASSED'}**`, '')
  if (result.problems.length) { lines.push('## Problems', ...result.problems.map(p => `- ${p}`), '') }
  lines.push('## Checks', `- SQLite integrity_check: ${result.integrity}`, `- Foreign-key violations: ${result.fkViolations}`,
    `- Migration recorded exactly once: ${result.problems.some(p => p.startsWith('migration recorded')) ? 'no' : 'yes'}`,
    `- Re-running the migration changes nothing (idempotent): ${idempotent ? 'yes' : 'NO'}`, '')
  lines.push('## Existing tables (unchanged rows)', '', '| Table | Rows before | Rows after | Existing rows identical |', '|---|---:|---:|---|')
  for (const t of Object.keys(before)) {
    const a = result.after[t]
    lines.push(`| ${t} | ${before[t].rows} | ${a?.rows ?? '—'} | ${a && a.sha256 === before[t].sha256 && a.rows === before[t].rows ? 'yes' : 'NO'} |`)
  }
  lines.push('', `\`schema_migrations\` gains exactly one row (\`${MIGRATION_NAME}\`); its existing rows are compared above without it.`)
  lines.push('', '## Schema changes', '', '**New columns on `appointments`** (existing rows get the default shown):')
  for (const c of APPOINTMENT_COLUMNS) lines.push(`- \`${c.name}\` ${c.ddl}${c.ddl.includes('DEFAULT') ? '' : ' (NULL)'}`)
  lines.push('', `**New tables (${CLINICAL_SCHEMA_OBJECTS.tables.length}):** ${CLINICAL_SCHEMA_OBJECTS.tables.map(t => `\`${t}\``).join(', ')}`)
  lines.push(`**New triggers (${CLINICAL_SCHEMA_OBJECTS.triggers.length}):** ${CLINICAL_SCHEMA_OBJECTS.triggers.map(t => `\`${t}\``).join(', ')}`)
  lines.push(`**New indexes (${CLINICAL_SCHEMA_OBJECTS.indexes.length}):** ${CLINICAL_SCHEMA_OBJECTS.indexes.map(t => `\`${t}\``).join(', ')}`)
  lines.push('', 'No table is dropped, rebuilt or renamed; no existing row is updated or deleted; no data is inserted except the `schema_migrations` row.')
  return lines.join('\n')
}

async function migrateInMemory(db) {
  const beforeCols = Object.fromEntries(tables(db).map(t => [t, columns(db, t)]))
  const before = fingerprint(db)
  applyClinicalSchema(db)
  const result = verify(db, before, beforeCols)
  // Idempotency: a second run must not change anything
  const snap = fingerprint(db)
  applyClinicalSchema(db)
  const snap2 = fingerprint(db)
  const idempotent = JSON.stringify(snap) === JSON.stringify(snap2)
  if (!idempotent) result.problems.push('second run changed the database')
  return { before, result, idempotent }
}

function emit(text, file) {
  console.log(text)
  if (file) { fs.writeFileSync(file, text + '\n'); console.log(`\nReport written to ${file}`) }
}

async function serverIsRunning() {
  const port = process.env.PORT || 8000
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500)
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: ctl.signal })
    clearTimeout(t)
    return r.ok
  } catch { return false }
}

const args = parseArgs(process.argv.slice(2))
const SQL = await initSqlJs()

const digest = buf => crypto.createHash('sha256').update(buf).digest('hex')
const stampNow = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)

function defaultBackupDir() {
  if (args.backupDir) return path.resolve(args.backupDir)
  if (!process.env.LOCALAPPDATA) { console.error('Refusing to run: LOCALAPPDATA is not set; pass --backup-dir <dir>.'); process.exit(1) }
  return path.join(process.env.LOCALAPPDATA, 'NeuroRelief', 'backups')
}

// Opens a database file in memory (the file is only read) and checks it: integrity, foreign keys, row counts.
function checkFile(file) {
  const db = new SQL.Database(fs.readFileSync(file))
  try {
    const integrity = q(db, 'PRAGMA integrity_check').map(v => v[0]).join(', ')
    const fkViolations = q(db, 'PRAGMA foreign_key_check').length
    const counts = Object.fromEntries(tables(db).map(t => [t, q(db, `SELECT COUNT(*) FROM "${t}"`)[0][0]]))
    const clinical = inspectClinicalSchema(db).present.length > 0
    return { integrity, fkViolations, counts, clinical }
  } finally { db.close() }
}

// Copies `source` to a new timestamped file in `dir` (never overwrites), then proves the copy is exact and sound.
function takeBackup(source, dir, label) {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `neurorelief-backup-${stampNow()}-${label}.db`)
  const srcBefore = digest(fs.readFileSync(source))
  fs.copyFileSync(source, file, fs.constants.COPYFILE_EXCL)
  const sha = digest(fs.readFileSync(file))
  const srcAfter = digest(fs.readFileSync(source))
  if (sha !== srcBefore || srcAfter !== srcBefore) throw new Error('Backup verification failed: the database changed while it was being copied, or the copy differs. Nothing was changed.')
  const check = checkFile(file)
  if (check.integrity !== 'ok') throw new Error(`Backup verification failed: integrity_check = ${check.integrity}. Nothing was changed.`)
  fs.writeFileSync(`${file}.sha256`, `${sha}  ${path.basename(file)}\n`, { flag: 'wx' })
  return { file, sha, ...check }
}

// Writes `backupFile` over `target` atomically, after verifying it; saves the current target as a backup first.
function restoreFile(target, backupFile, safetyDir) {
  const buf = fs.readFileSync(backupFile)
  const sha = digest(buf)
  const sidecar = `${backupFile}.sha256`
  if (fs.existsSync(sidecar) && fs.readFileSync(sidecar, 'utf8').split(/\s+/)[0] !== sha) throw new Error('Refusing to restore: the backup does not match its .sha256 file.')
  const check = checkFile(backupFile)
  if (check.integrity !== 'ok') throw new Error(`Refusing to restore: backup integrity_check = ${check.integrity}.`)
  const safety = takeBackup(target, safetyDir, 'pre-restore')
  const tmp = `${target}.tmp`
  fs.writeFileSync(tmp, buf)
  fs.renameSync(tmp, target)
  const now = digest(fs.readFileSync(target))
  if (now !== sha) throw new Error(`Restore verification failed (expected ${sha}, found ${now}). The previous database is saved at ${safety.file}.`)
  return { sha, safety: safety.file, ...checkFile(target) }
}

const printCheck = (label, c) => {
  console.log(`${label}: integrity_check=${c.integrity}, foreign-key violations=${c.fkViolations}, clinical schema present=${c.clinical ? 'yes' : 'no'}`)
  console.log('  rows: ' + Object.entries(c.counts).map(([t, n]) => `${t}=${n}`).join(', '))
}

if (args.mode === 'backup') {
  try {
    const b = takeBackup(PRODUCTION_DB_FILE, defaultBackupDir(), 'pre-clinical-sync')
    console.log(`Source:  ${PRODUCTION_DB_FILE}`)
    console.log(`Backup:  ${b.file}`)
    console.log(`SHA-256: ${b.sha} (source and backup identical; also saved to ${path.basename(b.file)}.sha256)`)
    printCheck('Backup check', b)
    process.exit(0)
  } catch (err) { console.error(err.message); process.exit(1) }
}

if (args.mode === 'rehearse-rollback') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-clinical-rollback-'))
  const copy = path.join(dir, 'rollback.scratch.db')
  let ok = false
  try {
    fs.copyFileSync(PRODUCTION_DB_FILE, copy)                              // the real database is only read
    assertScratchDatabase(copy, { scratch: true })
    const original = digest(fs.readFileSync(copy))
    console.log(`1. Copied the real database to ${copy} (SHA-256 ${original})`)
    const b = takeBackup(copy, path.join(dir, 'backups'), 'pre-clinical-sync')
    console.log(`2. Backup taken and verified: ${path.basename(b.file)} (SHA-256 ${b.sha})`)
    const db = new SQL.Database(fs.readFileSync(copy))
    const { result } = await migrateInMemory(db)
    if (result.problems.length) throw new Error('Migration on the copy failed: ' + result.problems.join('; '))
    fs.writeFileSync(copy, Buffer.from(db.export())); db.close()
    const migrated = checkFile(copy)
    console.log(`3. Copy migrated (SHA-256 now ${digest(fs.readFileSync(copy))}; clinical schema present=${migrated.clinical ? 'yes' : 'no'}; integrity=${migrated.integrity})`)
    const r = restoreFile(copy, b.file, path.join(dir, 'backups'))
    console.log(`4. Restored from the backup (the migrated copy was saved first as ${path.basename(r.safety)})`)
    ok = r.sha === original && r.integrity === 'ok' && !r.clinical && r.fkViolations === 0
    console.log(`5. Restored SHA-256 ${r.sha} ${r.sha === original ? '== original (byte-for-byte identical)' : '!= ORIGINAL'}`)
    printCheck('   Restored check', r)
    console.log(`\nRollback rehearsal: ${ok ? 'PASSED' : 'FAILED'}`)
  } catch (err) { console.error(err.message) }
  if (args.keep) console.log(`Rehearsal files kept in ${dir}`)
  else fs.rmSync(dir, { recursive: true, force: true })
  process.exit(ok ? 0 : 1)
}

if (args.mode === 'restore') {
  if (!args.approval) { console.error('Refusing to run: restoring the real database needs --i-have-approval.'); process.exit(1) }
  if (!args.from || !fs.existsSync(args.from)) { console.error('Refusing to run: --from <backup.db> must name an existing backup file.'); process.exit(1) }
  if (await serverIsRunning()) { console.error('Refusing to run: the backend is running. Stop it first.'); process.exit(1) }
  try {
    const r = restoreFile(PRODUCTION_DB_FILE, path.resolve(args.from), defaultBackupDir())
    console.log(`Restored ${PRODUCTION_DB_FILE} from ${path.resolve(args.from)}`)
    console.log(`SHA-256: ${r.sha} (matches the backup)`)
    console.log(`The database as it was just before the restore is saved at ${r.safety}`)
    printCheck('Restored check', r)
    process.exit(0)
  } catch (err) { console.error(err.message); process.exit(1) }
}

if (args.mode === 'scratch') {
  let real
  try { real = assertScratchDatabase(args.db, { scratch: true }) } catch (err) {
    console.error(err instanceof ScratchGuardError ? err.message : 'Refusing to run: invalid arguments.'); process.exit(1)
  }
  const db = await openScratchDatabase(real)
  if (args.check) { const r = inspectClinicalSchema(db); console.log(`Check only. Present: ${r.present.length}, missing: ${r.missing.length}`); process.exit(0) }
  const { before, result, idempotent } = await migrateInMemory(db)
  if (result.problems.length) { emit(report({ mode: 'scratch', source: real, before, result, idempotent }), args.report); process.exit(1) }
  saveScratchDatabase(db, real)
  emit(report({ mode: 'scratch', source: real, before, result, idempotent }), args.report)
  process.exit(0)
}

if (args.mode === 'rehearse') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-clinical-rehearsal-'))
  const copy = path.join(dir, 'rehearsal.scratch.db')
  fs.copyFileSync(PRODUCTION_DB_FILE, copy)               // the real database is only read
  const real = assertScratchDatabase(copy, { scratch: true })
  const db = new SQL.Database(fs.readFileSync(real))
  const { before, result, idempotent } = await migrateInMemory(db)
  saveScratchDatabase(db, real)
  emit(report({ mode: 'rehearsal on a copy (real database not modified)', source: PRODUCTION_DB_FILE, before, result, idempotent }), args.report)
  if (args.keep) console.log(`\nMigrated copy kept at ${real}`)
  else fs.rmSync(dir, { recursive: true, force: true })
  process.exit(result.problems.length ? 1 : 0)
}

if (args.mode === 'production') {
  if (!args.approval) { console.error('Refusing to run: production migration needs --i-have-approval (the owner must approve the rehearsal report first).'); process.exit(1) }
  if (await serverIsRunning()) { console.error('Refusing to run: the backend is running. Stop it first (it would overwrite the migration from memory).'); process.exit(1) }
  let backup
  try {
    const b = takeBackup(PRODUCTION_DB_FILE, defaultBackupDir(), 'pre-clinical-sync')
    backup = b.file
    console.log(`Backup taken and verified: ${b.file}\nSHA-256: ${b.sha}\n`)
  } catch (err) { console.error(err.message); process.exit(1) }
  const original = fs.readFileSync(PRODUCTION_DB_FILE)
  if (digest(original) !== digest(fs.readFileSync(backup))) {
    console.error('The database changed after the backup was taken; nothing was changed.'); process.exit(1)
  }
  const db = new SQL.Database(original)
  const { before, result, idempotent } = await migrateInMemory(db)
  if (result.problems.length) {
    emit(report({ mode: 'production (ABORTED, nothing written)', source: PRODUCTION_DB_FILE, before, result, backup, idempotent }), args.report)
    process.exit(1)
  }
  const tmp = `${PRODUCTION_DB_FILE}.tmp`
  fs.writeFileSync(tmp, Buffer.from(db.export()))
  fs.renameSync(tmp, PRODUCTION_DB_FILE)
  emit(report({ mode: 'production', source: PRODUCTION_DB_FILE, before, result, backup, idempotent }), args.report)
  process.exit(0)
}
