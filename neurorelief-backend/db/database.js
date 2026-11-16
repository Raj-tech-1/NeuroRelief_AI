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
  // Personal calibration observations (routes/predict.js). base_score is always the RAW model score.
  db.run(`
    CREATE TABLE IF NOT EXISTS calibration (
      cal_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      base_score REAL NOT NULL,
      actual_pain REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  // Migration: predictions.base_severity_score (the raw model score, before personal calibration)
  const predCols = all('PRAGMA table_info(predictions)').map(c => c.name)
  if (!predCols.includes('base_severity_score')) {
    db.run('ALTER TABLE predictions ADD COLUMN base_severity_score REAL')
  }

  // Migration: doctor verification. Existing and script-provisioned doctors are 'approved'; a public application
  // (POST /api/auth/doctor-apply) is 'pending' and its account has role 'doctor_applicant' until an admin approves it.
  const docCols = all('PRAGMA table_info(doctor_profiles)').map(c => c.name)
  const addDocCol = (name, def) => { if (!docCols.includes(name)) db.run(`ALTER TABLE doctor_profiles ADD COLUMN ${name} ${def}`) }
  addDocCol('verification_status', "TEXT NOT NULL DEFAULT 'approved'")   // pending | approved | rejected
  addDocCol('licence_number', 'TEXT')          // medical registration / licence number (checked manually by an admin)
  addDocCol('licence_authority', 'TEXT')       // issuing council, e.g. a State Medical Council
  addDocCol('applied_at', 'DATETIME')
  addDocCol('reviewed_at', 'DATETIME')
  addDocCol('reviewed_by', 'INTEGER')
  addDocCol('review_reason', 'TEXT')           // rejection reason code
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS uq_doctor_licence ON doctor_profiles(licence_number) WHERE licence_number IS NOT NULL')

  // General audit log: append-only, codes only (never emails, passwords or health content)
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      log_id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL CHECK (length(action) <= 40 AND action NOT GLOB '*[^a-z0-9_.]*'),
      outcome TEXT NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok','denied','failed')),
      actor_user_id INTEGER,
      actor_role TEXT,
      target_type TEXT CHECK (target_type IS NULL OR target_type IN ('user','doctor_profile')),
      target_id INTEGER,
      detail_code TEXT CHECK (detail_code IS NULL OR (length(detail_code) <= 40 AND detail_code NOT GLOB '*[^a-z0-9_.-]*')),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  db.run('CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)')
  db.run("CREATE TRIGGER IF NOT EXISTS trg_audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END")
  db.run("CREATE TRIGGER IF NOT EXISTS trg_audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log entries cannot be deleted'); END")

  // Relief Journal (lib/journalService.js): what the patient tried and how pain changed. There is deliberately NO dose
  // column: medicines are logged by name and time only. Medicine name and note are stored encrypted (AES-256-GCM).
  db.run(`
    CREATE TABLE IF NOT EXISTS relief_entries (
      entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      occurred_at TEXT NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]'),
      pain_before INTEGER NOT NULL CHECK (pain_before BETWEEN 0 AND 10),
      pain_after INTEGER CHECK (pain_after IS NULL OR pain_after BETWEEN 0 AND 10),
      methods TEXT NOT NULL CHECK (length(methods) BETWEEN 1 AND 120 AND methods NOT GLOB '*[^a-z,]*'),
      medicine_taken_at TEXT CHECK (medicine_taken_at IS NULL OR medicine_taken_at GLOB '[0-9][0-9]:[0-9][0-9]'),
      ciphertext BLOB, iv BLOB, auth_tag BLOB, key_id TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `)
  db.run('CREATE INDEX IF NOT EXISTS idx_relief_user ON relief_entries(user_id, occurred_at)')

  // Doctor therapy plans (lib/therapyLimits.js, routes/therapyPlan.js). A plan is never edited: a new plan supersedes
  // the previous one. Heat limits are hard caps (<= 40 °C, <= 20 min); TENS values are recommendations only.
  db.run(`
    CREATE TABLE IF NOT EXISTS therapy_plans (
      plan_id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      doctor_user_id INTEGER NOT NULL,
      appointment_id INTEGER NOT NULL,
      heat_min_c REAL NOT NULL CHECK (heat_min_c BETWEEN 35 AND 40),
      heat_max_c REAL NOT NULL CHECK (heat_max_c BETWEEN 35 AND 40 AND heat_max_c >= heat_min_c),
      heat_max_minutes INTEGER NOT NULL CHECK (heat_max_minutes BETWEEN 1 AND 20),
      tens_freq_min INTEGER NOT NULL CHECK (tens_freq_min BETWEEN 1 AND 150),
      tens_freq_max INTEGER NOT NULL CHECK (tens_freq_max BETWEEN 1 AND 150 AND tens_freq_max >= tens_freq_min),
      sessions_per_day INTEGER CHECK (sessions_per_day IS NULL OR sessions_per_day BETWEEN 1 AND 6),
      valid_until TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','revoked')),
      ciphertext BLOB, iv BLOB, auth_tag BLOB, key_id TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      FOREIGN KEY (patient_id) REFERENCES users(user_id),
      FOREIGN KEY (doctor_user_id) REFERENCES users(user_id)
    )
  `)
  db.run('CREATE INDEX IF NOT EXISTS idx_therapy_plans_patient ON therapy_plans(patient_id, status)')
  // Plan values are immutable; only status/ended_at may change (to supersede or revoke)
  db.run(`CREATE TRIGGER IF NOT EXISTS trg_therapy_plans_immutable BEFORE UPDATE OF patient_id, doctor_user_id, appointment_id,
          heat_min_c, heat_max_c, heat_max_minutes, tens_freq_min, tens_freq_max, sessions_per_day, valid_until, ciphertext, created_at
          ON therapy_plans BEGIN SELECT RAISE(ABORT, 'therapy plan values are immutable'); END`)

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
