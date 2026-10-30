// Safety guard for migration/test tooling: it only ever works on an explicitly named SCRATCH database file.
// It refuses the production database by every route it can be named (same path, symlink, hard link, anything
// inside the production db directory, or the production file name).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import initSqlJs from 'sql.js'

// Same location database.js uses for the real database: <this directory>/neurorelief.db
const PRODUCTION_DB_DIR = path.dirname(fileURLToPath(import.meta.url))
const PRODUCTION_DB_FILE = path.join(PRODUCTION_DB_DIR, 'neurorelief.db')

export class ScratchGuardError extends Error {
  constructor(message) { super(`Refusing to run: ${message}`); this.name = 'ScratchGuardError' }
}

function sameFile(a, b) {
  try { const x = fs.statSync(a), y = fs.statSync(b); return x.ino !== 0 && x.ino === y.ino && x.dev === y.dev } catch { return false }
}

// Returns the resolved real path of a valid scratch database, or throws ScratchGuardError. Opens nothing.
export function assertScratchDatabase(dbPath, { scratch } = {}) {
  if (scratch !== true) throw new ScratchGuardError('test-only mode is required (pass --scratch).')
  if (typeof dbPath !== 'string' || dbPath.trim() === '') throw new ScratchGuardError('a database path is required (--db <file>).')
  if (process.env.NODE_ENV === 'production') throw new ScratchGuardError('NODE_ENV is production.')
  if (dbPath.includes('\0')) throw new ScratchGuardError('invalid path.')

  const resolved = path.resolve(dbPath)
  if (!fs.existsSync(resolved)) throw new ScratchGuardError('the database file does not exist (create a scratch fixture first).')
  if (!fs.statSync(resolved).isFile()) throw new ScratchGuardError('the path is not a file.')
  const real = fs.realpathSync(resolved)

  // 1. The production file, however it is reached.
  if (path.resolve(real).toLowerCase() === path.resolve(PRODUCTION_DB_FILE).toLowerCase() || sameFile(real, PRODUCTION_DB_FILE)) {
    throw new ScratchGuardError('that is the production database.')
  }
  // 2. Anything inside the production database directory (live DB, backups, copies).
  const prodDir = fs.existsSync(PRODUCTION_DB_DIR) ? fs.realpathSync(PRODUCTION_DB_DIR) : PRODUCTION_DB_DIR
  const rel = path.relative(prodDir, real)
  if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    throw new ScratchGuardError('the file is inside the production database directory.')
  }
  // 3. The production file name, and a mandatory scratch naming convention.
  if (path.basename(real).toLowerCase() === 'neurorelief.db') throw new ScratchGuardError('the file name is the production database name.')
  if (!/\.scratch\.db$/i.test(real)) throw new ScratchGuardError('a scratch database file name must end with ".scratch.db".')
  return real
}

export async function openScratchDatabase(realPath) {
  const SQL = await initSqlJs()
  return new SQL.Database(fs.readFileSync(realPath))
}

// Atomic write for scratch files only (the caller must have passed assertScratchDatabase).
export function saveScratchDatabase(db, realPath) {
  const tmp = `${realPath}.tmp`
  fs.writeFileSync(tmp, Buffer.from(db.export()))
  fs.renameSync(tmp, realPath)
}

export { PRODUCTION_DB_DIR, PRODUCTION_DB_FILE }
