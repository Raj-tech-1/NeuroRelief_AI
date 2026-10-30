// Applies the additive Report Audit schema to an EXPLICITLY NAMED SCRATCH database (Phase 2: test-only).
//
//   node scripts/migrate-report-audit.js --scratch --db <path\to\something.scratch.db> [--check]
//
// It refuses to run on the production database or without --scratch (see db/scratchGuard.js), never defaults to
// any path, never deletes or recreates existing tables, and prints table names and row counts only (no content).
// --check reports what is missing and writes nothing.
import fs from 'node:fs'
import { assertScratchDatabase, openScratchDatabase, saveScratchDatabase, ScratchGuardError } from '../db/scratchGuard.js'
import { applyReportSchema, inspectReportSchema, MIGRATION_NAME } from '../db/reportSchema.js'
import { MIGRATION_NAME_002 } from '../db/reportSchema002.js'

function parseArgs(argv) {
  const out = { scratch: false, check: false, db: undefined }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--scratch') out.scratch = true
    else if (a === '--check') out.check = true
    else if (a === '--db') out.db = argv[++i]
    else { console.error(`Unknown argument: ${a}`); process.exit(2) }
  }
  return out
}

function tableCounts(db) {
  const r = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  const names = r[0] ? r[0].values.map(v => v[0]) : []
  return Object.fromEntries(names.map(n => [n, db.exec(`SELECT COUNT(*) FROM "${n}"`)[0].values[0][0]]))
}

const args = parseArgs(process.argv.slice(2))
let real
try {
  real = assertScratchDatabase(args.db, { scratch: args.scratch })
} catch (err) {
  console.error(err instanceof ScratchGuardError ? err.message : 'Refusing to run: invalid arguments.')
  process.exit(1)
}

const db = await openScratchDatabase(real)
try {
  const before = tableCounts(db)
  if (args.check) {
    const { present, missing } = inspectReportSchema(db)
    console.log(`Check only (nothing written). Present: ${present.length}, missing: ${missing.length}.`)
    if (missing.length) console.log(`Missing: ${missing.join(', ')}`)
    process.exit(0)
  }
  const result = applyReportSchema(db)
  saveScratchDatabase(db, real)
  const after = tableCounts(db)
  const changed = Object.keys(before).filter(t => before[t] !== after[t])
  for (const name of [MIGRATION_NAME, MIGRATION_NAME_002]) {
    const n = db.exec(`SELECT COUNT(*) FROM schema_migrations WHERE name = '${name}'`)[0].values[0][0]
    if (n !== 1) throw new Error(`migration ${name} is recorded ${n} time(s), expected exactly once`)
  }
  console.log(`Migrations ${MIGRATION_NAME} and ${MIGRATION_NAME_002} applied to the scratch database (each recorded once). Schema objects present: ${result.present.length}, missing: ${result.missing.length}.`)
  console.log(`Pre-existing tables: ${Object.keys(before).length}; row counts changed in existing tables: ${changed.length ? changed.join(', ') : 'none'}.`)
  console.log(`Scratch file: ${real} (${fs.statSync(real).size} bytes)`)
} catch (err) {
  console.error(`Migration failed: ${err.message}`)
  process.exit(1)
} finally {
  db.close()
}
