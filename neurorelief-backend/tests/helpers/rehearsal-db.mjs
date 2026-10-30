// Helper for scripts/rehearse-report-audit-migration.ps1. FICTIONAL, DISPOSABLE files only; refuses anything near the real database.
//   node tests/helpers/rehearsal-db.mjs make <out.db>
//   node tests/helpers/rehearsal-db.mjs tamper <migrated.scratch.db> <drop002 | dup001 | extra | drop001>
//   node tests/helpers/rehearsal-db.mjs inspect <file.db>      (read-only JSON summary: integrity, table and row counts)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import initSqlJs from 'sql.js'
import { fileURLToPath } from 'node:url'
import { buildFixtureDb } from './fixture.mjs'

const realDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db').toLowerCase()
const [mode, file, how] = process.argv.slice(2)
const resolved = file ? path.resolve(file).toLowerCase() : ''
if (!file || resolved.startsWith(realDir + path.sep) && !/rehearsal/i.test(resolved)) { console.error('refusing path'); process.exit(1) }
if (/neurorelief-backend[\\/]db[\\/]neurorelief\.db$/i.test(resolved)) { console.error('refusing the real database'); process.exit(1) }

const SQL = await initSqlJs()
if (mode === 'make') {
  fs.writeFileSync(file, Buffer.from(buildFixtureDb(SQL).export()))
  console.log('fixture written')
} else if (mode === 'inspect') {
  // read-only: prints structure and counts as JSON (no row content)
  const db = new SQL.Database(fs.readFileSync(file))
  const one = sql => { const r = db.exec(sql); return r[0] ? r[0].values[0][0] : null }
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")[0].values.map(v => v[0])
  console.log(JSON.stringify({
    integrity: one('PRAGMA integrity_check'), tables: tables.length,
    reportTables: tables.filter(t => /^report_|^schema_migrations$/.test(t)).length,
    users: one('SELECT COUNT(*) FROM users'), doctorProfiles: one('SELECT COUNT(*) FROM doctor_profiles'), appointments: one('SELECT COUNT(*) FROM appointments'),
  }))
} else if (mode === 'tamper') {
  const db = new SQL.Database(fs.readFileSync(file))
  if (how === 'drop002') db.run("DELETE FROM schema_migrations WHERE name = 'report-audit-002'")
  else if (how === 'drop001') db.run("DELETE FROM schema_migrations WHERE name = 'report-audit-001'")
  else if (how === 'extra') db.run("INSERT INTO schema_migrations (name) VALUES ('report-audit-003')")
  else if (how === 'dup001') {
    db.run('ALTER TABLE schema_migrations RENAME TO schema_migrations_old')
    db.run('CREATE TABLE schema_migrations (name TEXT, applied_at DATETIME)')
    db.run("INSERT INTO schema_migrations (name) VALUES ('report-audit-001'), ('report-audit-001'), ('report-audit-002')")
  } else { console.error('unknown tamper mode'); process.exit(2) }
  fs.writeFileSync(file, Buffer.from(db.export()))
  console.log(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase())   // the new file hash
}
