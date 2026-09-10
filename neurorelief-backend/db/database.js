import initSqlJs from 'sql.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, 'neurorelief.db')

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

export { initDB, all, get, run, save }
