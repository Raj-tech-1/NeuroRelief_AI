import initSqlJs from 'sql.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// NEURORELIEF_DB_PATH lets tests boot the server against a disposable database. It is honoured ONLY for a file named
// "*.scratch.db" (never the real database); anything else makes startup fail. Unset = the normal database, unchanged.
function resolveDbPath() {
  const override = process.env.NEURORELIEF_DB_PATH
  if (override === undefined || override === '') return path.join(__dirname, 'neurorelief.db')
  const resolved = path.resolve(override)
  if (!/\.scratch\.db$/i.test(resolved) || path.dirname(resolved).toLowerCase() === __dirname.toLowerCase()) {
    throw new Error('NEURORELIEF_DB_PATH must be a "*.scratch.db" file outside the database folder.')
  }
  return resolved
}
const DB_PATH = resolveDbPath()

let db = null

// Initialize database
async function initDB() {
  const SQL = await initSqlJs()

  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      age INTEGER,
      height REAL,
      weight REAL,
      bmi REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS menstrual_cycles (
      cycle_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      cycle_length INTEGER DEFAULT 28,
      flow TEXT DEFAULT 'Medium',
      mood TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS symptoms (
      symptom_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      severity INTEGER,
      body_area TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS wellness_records (
      record_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      mood TEXT,
      energy INTEGER,
      stress INTEGER,
      sleep_quality INTEGER,
      sleep_hours REAL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS predictions (
      pred_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      predicted_severity TEXT,
      confidence REAL,
      recommended_tens_intensity INTEGER,
      recommended_heat_temp REAL,
      input_features TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS scans (
      scan_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      life_stage TEXT,
      body_areas TEXT,
      severity INTEGER,
      symptom_description TEXT,
      medications TEXT,
      notes TEXT,
      ai_summary TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS reports (
      report_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      file_name TEXT,
      file_path TEXT,
      upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      type TEXT,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `)

  // Bookable doctors: one profile per real doctor account (users.role = 'doctor')
  db.run(`
    CREATE TABLE IF NOT EXISTS doctor_profiles (
      doctor_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      specialty TEXT NOT NULL,
      rating REAL,
      experience TEXT,
      description TEXT,
      price INTEGER NOT NULL DEFAULT 0,
      phone TEXT,
      days TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS appointments (
      appointment_id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      doctor_user_id INTEGER NOT NULL,
      requested_date TEXT NOT NULL,
      requested_time TEXT NOT NULL,
      price INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES users(user_id),
      FOREIGN KEY (doctor_user_id) REFERENCES users(user_id)
    )
  `)

  // Migration: appointments.doctor_seen (0 = doctor has not opened this request yet)
  const apptCols = all('PRAGMA table_info(appointments)').map(c => c.name)
  if (!apptCols.includes('doctor_seen')) {
    db.run('ALTER TABLE appointments ADD COLUMN doctor_seen INTEGER NOT NULL DEFAULT 0')
  }

  // Migration: doctor_profiles.is_demo (1 = fictional demo clinician, shown with a 'Demo clinician' label)
  const profileCols = all('PRAGMA table_info(doctor_profiles)').map(c => c.name)
  if (!profileCols.includes('is_demo')) {
    db.run('ALTER TABLE doctor_profiles ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0')
  }
  // Migration: users.role (existing accounts default to 'user')
  const userCols = all('PRAGMA table_info(users)').map(c => c.name)
  if (!userCols.includes('role')) {
    db.run("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
  }

  save()
  console.log('Database initialized: tables ready')
  return db
}

// Save DB to file
function save() {
  if (db) {
    const data = db.export()
    const buffer = Buffer.from(data)
    fs.writeFileSync(DB_PATH, buffer)
  }
}

// Helper: run query and return rows as objects
function all(sql, params = []) {
  const stmt = db.prepare(sql)
  if (params.length) stmt.bind(params)
  const rows = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

// Helper: run query and return first row as object
function get(sql, params = []) {
  const rows = all(sql, params)
  return rows.length > 0 ? rows[0] : null
}

// Helper: run INSERT/UPDATE/DELETE and return lastInsertRowid
function run(sql, params = []) {
  db.run(sql, params)
  const lastId = db.exec("SELECT last_insert_rowid() as id")[0]?.values[0][0]
  save() // Auto-save after every write
  return { lastInsertRowid: lastId }
}

// Runs fn atomically: BEGIN ... COMMIT (or ROLLBACK if fn throws) with ONE file save at the end.
// fn receives { all, get, run } that see the uncommitted changes and do not save per statement.
function transaction(fn) {
  db.run('BEGIN')
  try {
    const tx = {
      all, get,
      run(sql, params = []) {
        db.run(sql, params)
        return { lastInsertRowid: db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0] }
      },
    }
    const result = fn(tx)
    db.run('COMMIT')
    save()
    return result
  } catch (err) {
    try { db.run('ROLLBACK') } catch { /* nothing to roll back */ }
    throw err
  }
}

export { initDB, all, get, run, save, transaction }
