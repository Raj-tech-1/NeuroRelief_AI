// Migration clinical-sync-001 (additive): patient <-> doctor synchronisation.
//
// This module only contains DDL and a function that applies it to a sql.js Database handed in by the caller.
// It is NOT run at server startup: until it has been applied (scripts/migrate-clinical.js, after approval) every
// /api/care route answers a generic 503 and the existing appointment endpoints behave exactly as before.
//
// Nothing existing is dropped, rebuilt or rewritten:
//   appointments            + version, updated_by, completed_at, proposed_date, proposed_time, proposed_by (nullable / defaulted)
//   appointment_events      append-only history of every appointment change (no free text)
//   consultation_notes      doctor notes per appointment; visibility 'private' | 'patient'; text encrypted (AES-256-GCM)
//   appointment_messages    messages between the two parties of an appointment; text encrypted
//   record_access_grants    explicit, versioned patient consent for a doctor to see chosen record categories
//   therapy_sessions        heating and TENS sessions as separate kinds (TENS always 'manual_record')
//   clinical_audit_events   append-only access/change log; codes only, so no health data can be logged
// The existing `symptoms` table (already in database.js) is reused for symptom and pain-intensity entries.

export const MIGRATION_NAME = 'clinical-sync-001'

const abort = msg => `SELECT RAISE(ABORT, '${msg}');`

export const APPOINTMENT_COLUMNS = [
  { name: 'version', ddl: 'INTEGER NOT NULL DEFAULT 1' },
  { name: 'updated_by', ddl: 'INTEGER REFERENCES users(user_id)' },
  { name: 'completed_at', ddl: 'DATETIME' },
  { name: 'proposed_date', ddl: 'TEXT' },
  { name: 'proposed_time', ddl: 'TEXT' },
  { name: 'proposed_by', ddl: 'INTEGER REFERENCES users(user_id)' },
]

export const EVENT_TYPES = [
  'requested', 'accepted', 'declined', 'cancelled_by_patient', 'cancelled_by_doctor', 'rescheduled_by_patient',
  'reschedule_proposed', 'proposal_accepted', 'proposal_declined', 'completed', 'note_shared', 'follow_up_added',
  'message_sent',
]
// 'profile' (age, height, weight, BMI) needs consent records-consent-v2 or later
export const RECORD_CATEGORIES = ['cycles', 'symptoms', 'pain', 'wellness', 'predictions', 'heat_sessions', 'tens_sessions', 'profile']
export const GRANT_PURPOSES = ['consultation_review', 'follow_up_care']
export const AUDIT_EVENTS = [
  'record_viewed', 'grant_created', 'grant_revoked', 'note_created', 'note_visibility_changed', 'note_status_changed',
  'note_viewed', 'message_sent', 'messages_viewed', 'appointment_changed', 'access_denied',
]

const list = a => a.map(x => `'${x}'`).join(',')

export const CLINICAL_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
     name TEXT PRIMARY KEY,
     applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,

  // ---- Appointment history (append-only, ids and slots only) ----
  `CREATE TABLE IF NOT EXISTS appointment_events (
     event_id INTEGER PRIMARY KEY AUTOINCREMENT,
     appointment_id INTEGER NOT NULL,
     actor_user_id INTEGER NOT NULL,
     actor_role TEXT NOT NULL CHECK (actor_role IN ('user','doctor')),
     event_type TEXT NOT NULL CHECK (event_type IN (${list(EVENT_TYPES)})),
     from_date TEXT, from_time TEXT, to_date TEXT, to_time TEXT,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY (appointment_id) REFERENCES appointments(appointment_id),
     FOREIGN KEY (actor_user_id) REFERENCES users(user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_appt_events_appt ON appointment_events(appointment_id, event_id)`,
  `CREATE TRIGGER IF NOT EXISTS trg_appt_events_party BEFORE INSERT ON appointment_events
   BEGIN
     SELECT RAISE(ABORT, 'actor is not a party to this appointment')
       WHERE NOT EXISTS (SELECT 1 FROM appointments WHERE appointment_id = NEW.appointment_id
                         AND ((NEW.actor_role = 'user' AND patient_id = NEW.actor_user_id) OR (NEW.actor_role = 'doctor' AND doctor_user_id = NEW.actor_user_id)));
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_appt_events_no_update BEFORE UPDATE ON appointment_events BEGIN ${abort('appointment events are append-only')} END`,
  `CREATE TRIGGER IF NOT EXISTS trg_appt_events_no_delete BEFORE DELETE ON appointment_events BEGIN ${abort('appointment events cannot be deleted')} END`,

  // ---- Consultation notes (encrypted text; visibility decides whether the patient may read it) ----
  `CREATE TABLE IF NOT EXISTS consultation_notes (
     note_id INTEGER PRIMARY KEY AUTOINCREMENT,
     appointment_id INTEGER NOT NULL,
     doctor_user_id INTEGER NOT NULL,
     patient_id INTEGER NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('clinical_note','follow_up','summary')),
     visibility TEXT NOT NULL CHECK (visibility IN ('private','patient')),
     follow_up_status TEXT CHECK (follow_up_status IS NULL OR follow_up_status IN ('open','done')),
     due_date TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     ciphertext BLOB NOT NULL CHECK (length(ciphertext) > 0),
     iv BLOB NOT NULL CHECK (length(iv) = 12),
     auth_tag BLOB NOT NULL CHECK (length(auth_tag) = 16),
     key_id TEXT NOT NULL,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CHECK ((kind = 'follow_up') = (follow_up_status IS NOT NULL)),
     CHECK (kind <> 'follow_up' OR visibility = 'patient'),
     FOREIGN KEY (appointment_id) REFERENCES appointments(appointment_id),
     FOREIGN KEY (doctor_user_id) REFERENCES users(user_id),
     FOREIGN KEY (patient_id) REFERENCES users(user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_notes_appt ON consultation_notes(appointment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_doctor ON consultation_notes(doctor_user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_patient ON consultation_notes(patient_id, visibility)`,
  `CREATE TRIGGER IF NOT EXISTS trg_notes_validate BEFORE INSERT ON consultation_notes
   BEGIN
     SELECT RAISE(ABORT, 'note must be written by the appointment doctor for its patient')
       WHERE NOT EXISTS (SELECT 1 FROM appointments WHERE appointment_id = NEW.appointment_id
                         AND doctor_user_id = NEW.doctor_user_id AND patient_id = NEW.patient_id);
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_notes_immutable BEFORE UPDATE OF appointment_id, doctor_user_id, patient_id, kind, ciphertext, iv, auth_tag, key_id, created_at ON consultation_notes
   BEGIN ${abort('note identity and text are immutable')} END`,
  `CREATE TRIGGER IF NOT EXISTS trg_notes_no_delete BEFORE DELETE ON consultation_notes BEGIN ${abort('notes cannot be deleted')} END`,

  // ---- Appointment messages (encrypted text, only between the two parties) ----
  `CREATE TABLE IF NOT EXISTS appointment_messages (
     message_id INTEGER PRIMARY KEY AUTOINCREMENT,
     appointment_id INTEGER NOT NULL,
     sender_user_id INTEGER NOT NULL,
     sender_role TEXT NOT NULL CHECK (sender_role IN ('user','doctor')),
     ciphertext BLOB NOT NULL CHECK (length(ciphertext) > 0),
     iv BLOB NOT NULL CHECK (length(iv) = 12),
     auth_tag BLOB NOT NULL CHECK (length(auth_tag) = 16),
     key_id TEXT NOT NULL,
     read_at DATETIME,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY (appointment_id) REFERENCES appointments(appointment_id),
     FOREIGN KEY (sender_user_id) REFERENCES users(user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_appt ON appointment_messages(appointment_id, message_id)`,
  `CREATE TRIGGER IF NOT EXISTS trg_messages_party BEFORE INSERT ON appointment_messages
   BEGIN
     SELECT RAISE(ABORT, 'sender is not a party to this appointment')
       WHERE NOT EXISTS (SELECT 1 FROM appointments WHERE appointment_id = NEW.appointment_id
                         AND ((NEW.sender_role = 'user' AND patient_id = NEW.sender_user_id) OR (NEW.sender_role = 'doctor' AND doctor_user_id = NEW.sender_user_id)));
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_messages_immutable BEFORE UPDATE OF appointment_id, sender_user_id, sender_role, ciphertext, iv, auth_tag, key_id, created_at ON appointment_messages
   BEGIN ${abort('messages are immutable')} END`,
  `CREATE TRIGGER IF NOT EXISTS trg_messages_no_delete BEFORE DELETE ON appointment_messages BEGIN ${abort('messages cannot be deleted')} END`,

  // ---- Health-record access grants (explicit, versioned consent; revocation is final) ----
  `CREATE TABLE IF NOT EXISTS record_access_grants (
     grant_id INTEGER PRIMARY KEY AUTOINCREMENT,
     patient_id INTEGER NOT NULL,
     doctor_user_id INTEGER NOT NULL,
     appointment_id INTEGER NOT NULL,
     categories TEXT NOT NULL CHECK (length(categories) BETWEEN 1 AND 200 AND categories NOT GLOB '*[^a-z_,]*'),
     purpose TEXT NOT NULL CHECK (purpose IN (${list(GRANT_PURPOSES)})),
     range_from TEXT NOT NULL CHECK (range_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     range_to TEXT NOT NULL CHECK (range_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
     expires_at TEXT NOT NULL,
     consent_version TEXT NOT NULL,
     consent_text TEXT NOT NULL CHECK (length(consent_text) BETWEEN 1 AND 2000),
     consent_sha256 TEXT NOT NULL CHECK (length(consent_sha256) = 64),
     status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     revoked_at DATETIME,
     CHECK (range_from <= range_to),
     CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
     FOREIGN KEY (patient_id) REFERENCES users(user_id),
     FOREIGN KEY (doctor_user_id) REFERENCES users(user_id),
     FOREIGN KEY (appointment_id) REFERENCES appointments(appointment_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_grants_doctor ON record_access_grants(doctor_user_id, patient_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_grants_patient ON record_access_grants(patient_id, status)`,
  `CREATE TRIGGER IF NOT EXISTS trg_grants_validate BEFORE INSERT ON record_access_grants
   BEGIN
     SELECT RAISE(ABORT, 'no confirmed appointment links this patient and doctor')
       WHERE NOT EXISTS (SELECT 1 FROM appointments WHERE appointment_id = NEW.appointment_id AND patient_id = NEW.patient_id
                         AND doctor_user_id = NEW.doctor_user_id AND status IN ('accepted','completed'));
     SELECT RAISE(ABORT, 'a new grant must start active') WHERE NEW.status <> 'active';
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_grants_immutable BEFORE UPDATE OF patient_id, doctor_user_id, appointment_id, categories, purpose,
     range_from, range_to, expires_at, consent_version, consent_text, consent_sha256, created_at ON record_access_grants
   BEGIN ${abort('grant scope and consent are immutable')} END`,
  `CREATE TRIGGER IF NOT EXISTS trg_grants_revoked_final BEFORE UPDATE ON record_access_grants
   WHEN OLD.status = 'revoked'
   BEGIN ${abort('a revoked grant is final')} END`,
  `CREATE TRIGGER IF NOT EXISTS trg_grants_no_delete BEFORE DELETE ON record_access_grants BEGIN ${abort('grants cannot be deleted; revoke instead')} END`,

  // ---- Therapy sessions: heating and TENS are separate kinds ----
  `CREATE TABLE IF NOT EXISTS therapy_sessions (
     session_id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('heat','tens')),
     source TEXT NOT NULL CHECK (source IN ('device_panel','manual_record')),
     started_at TEXT NOT NULL,
     duration_seconds INTEGER NOT NULL CHECK (duration_seconds BETWEEN 0 AND 86400),
     heat_temp_c REAL CHECK (heat_temp_c IS NULL OR heat_temp_c BETWEEN 20 AND 60),
     tens_intensity INTEGER CHECK (tens_intensity IS NULL OR tens_intensity BETWEEN 0 AND 100),
     tens_frequency INTEGER CHECK (tens_frequency IS NULL OR tens_frequency BETWEEN 1 AND 250),
     pain_before INTEGER CHECK (pain_before IS NULL OR pain_before BETWEEN 0 AND 10),
     pain_after INTEGER CHECK (pain_after IS NULL OR pain_after BETWEEN 0 AND 10),
     client_ref TEXT CHECK (client_ref IS NULL OR length(client_ref) <= 64),
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CHECK (kind <> 'tens' OR source = 'manual_record'),
     CHECK (kind <> 'heat' OR (tens_intensity IS NULL AND tens_frequency IS NULL)),
     CHECK (kind <> 'tens' OR heat_temp_c IS NULL),
     FOREIGN KEY (user_id) REFERENCES users(user_id)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_therapy_client_ref ON therapy_sessions(user_id, kind, client_ref) WHERE client_ref IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_therapy_user ON therapy_sessions(user_id, started_at)`,

  // ---- Audit (append-only; codes only) ----
  `CREATE TABLE IF NOT EXISTS clinical_audit_events (
     event_id INTEGER PRIMARY KEY AUTOINCREMENT,
     event_type TEXT NOT NULL CHECK (event_type IN (${list(AUDIT_EVENTS)})),
     outcome TEXT NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok','denied')),
     actor_user_id INTEGER,
     actor_role TEXT CHECK (actor_role IS NULL OR actor_role IN ('user','doctor','admin')),
     patient_id INTEGER,
     appointment_id INTEGER,
     grant_id INTEGER,
     note_id INTEGER,
     detail_code TEXT CHECK (detail_code IS NULL OR (length(detail_code) <= 40 AND detail_code NOT GLOB '*[^a-z0-9_.-]*')),
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY (actor_user_id) REFERENCES users(user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_clin_audit_patient ON clinical_audit_events(patient_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_clin_audit_actor ON clinical_audit_events(actor_user_id, created_at)`,
  `CREATE TRIGGER IF NOT EXISTS trg_clin_audit_no_update BEFORE UPDATE ON clinical_audit_events BEGIN ${abort('audit events are append-only')} END`,
  `CREATE TRIGGER IF NOT EXISTS trg_clin_audit_no_delete BEFORE DELETE ON clinical_audit_events BEGIN ${abort('audit events cannot be deleted')} END`,
]

export const CLINICAL_SCHEMA_OBJECTS = {
  tables: ['appointment_events', 'consultation_notes', 'appointment_messages', 'record_access_grants', 'therapy_sessions', 'clinical_audit_events'],
  triggers: [
    'trg_appt_events_party', 'trg_appt_events_no_update', 'trg_appt_events_no_delete',
    'trg_notes_validate', 'trg_notes_immutable', 'trg_notes_no_delete',
    'trg_messages_party', 'trg_messages_immutable', 'trg_messages_no_delete',
    'trg_grants_validate', 'trg_grants_immutable', 'trg_grants_revoked_final', 'trg_grants_no_delete',
    'trg_clin_audit_no_update', 'trg_clin_audit_no_delete',
  ],
  indexes: [
    'idx_appt_events_appt', 'idx_notes_appt', 'idx_notes_doctor', 'idx_notes_patient', 'idx_messages_appt',
    'idx_grants_doctor', 'idx_grants_patient', 'uq_therapy_client_ref', 'idx_therapy_user', 'idx_clin_audit_patient', 'idx_clin_audit_actor',
  ],
}

function rows(db, sql) {
  const r = db.exec(sql)
  return r[0] ? r[0].values.map(v => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]]))) : []
}
const appointmentColumns = db => rows(db, 'PRAGMA table_info(appointments)').map(r => r.name)

export function inspectClinicalSchema(db) {
  const have = new Set(rows(db, 'SELECT name FROM sqlite_master').map(r => r.name))
  const all = [...CLINICAL_SCHEMA_OBJECTS.tables, ...CLINICAL_SCHEMA_OBJECTS.triggers, ...CLINICAL_SCHEMA_OBJECTS.indexes]
  const cols = have.has('appointments') ? appointmentColumns(db) : []
  const missingCols = APPOINTMENT_COLUMNS.filter(c => !cols.includes(c.name)).map(c => `column:appointments.${c.name}`)
  return { present: all.filter(n => have.has(n)), missing: [...all.filter(n => !have.has(n)), ...missingCols] }
}

// Applies the migration atomically; safe to run repeatedly. Requires the existing core tables.
export function applyClinicalSchema(db) {
  const have = new Set(rows(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map(r => r.name))
  for (const t of ['users', 'appointments', 'doctor_profiles', 'symptoms']) {
    if (!have.has(t)) throw new Error(`Required existing table "${t}" is missing; this does not look like a NeuroRelief database.`)
  }
  db.run('BEGIN')
  try {
    const cols = appointmentColumns(db)
    for (const c of APPOINTMENT_COLUMNS) if (!cols.includes(c.name)) db.run(`ALTER TABLE appointments ADD COLUMN ${c.name} ${c.ddl}`)
    for (const stmt of CLINICAL_SCHEMA_STATEMENTS) db.run(stmt)
    db.run('INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)', [MIGRATION_NAME])
    db.run('COMMIT')
  } catch (err) {
    try { db.run('ROLLBACK') } catch { /* nothing to roll back */ }
    throw new Error(`Clinical schema migration failed and was rolled back: ${err.message}`)
  }
  return inspectClinicalSchema(db)
}
