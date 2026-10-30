// Additive schema for the Report Audit workflow: encrypted original reports, explicit-consent shares,
// append-only review versions and an append-only audit log.
//
// This module only contains DDL and a function that applies it to a sql.js Database handed in by the caller.
// It never opens a file itself and is NOT called by the server at startup (Phase 2).
//
// Existing tables are never altered. The old `reports` table (never written; plaintext file_path) is left alone:
// its columns cannot hold an authenticated-encryption envelope, so a new table is the safe choice.
//
// Integrity rules are enforced in the database as well as by the (later) API, using constraints and triggers:
//   report_originals   immutable (no UPDATE / DELETE)
//   report_shares      patient must own the report; recipient must be a doctor with a doctor_profiles row;
//                      identity + consent columns immutable; one active share per (report, doctor); 'revoked' is final
//   report_versions    append-only, sequential per share, authored only by the share's doctor, never on a revoked share
//   report_audit_events append-only; detail_code is restricted to a short code charset so no health text can be logged
// A share preserves, immutably: the exact consent text, its version, language ('en' only until reviewed translations exist),
// SHA-256, the recipient's user id, the doctor's name and report title as shown at consent time, and the consent time.
// Note: sql.js enforces FOREIGN KEY constraints only when `PRAGMA foreign_keys = ON` is set on the connection.

import { applySchema002, missingSchema002Columns, SCHEMA_002_TRIGGERS } from './reportSchema002.js'

export const MIGRATION_NAME = 'report-audit-001'

const REPORT_TYPES = "'health_summary'"
const SHARE_STATUSES = "'submitted','under_review','changes_requested','verified','revoked'"
const VERSION_KINDS = "'doctor_note','reviewed_attachment'"
const AUDIT_EVENTS = [
  'report_created', 'consent_recorded', 'share_submitted', 'share_revoked', 'report_opened', 'original_downloaded',
  'status_changed', 'review_created', 'version_downloaded', 'access_denied',
].map(e => `'${e}'`).join(',')

const abort = msg => `SELECT RAISE(ABORT, '${msg}');`

export const REPORT_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
     name TEXT PRIMARY KEY,
     applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,

  // ---- A. Original reports (encrypted snapshot; the key is never stored here) ----
  `CREATE TABLE IF NOT EXISTS report_originals (
     report_id INTEGER PRIMARY KEY AUTOINCREMENT,
     patient_id INTEGER NOT NULL,
     report_type TEXT NOT NULL CHECK (report_type IN (${REPORT_TYPES})),
     title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
     ciphertext BLOB NOT NULL CHECK (length(ciphertext) > 0),
     iv BLOB NOT NULL CHECK (length(iv) = 12),
     auth_tag BLOB NOT NULL CHECK (length(auth_tag) = 16),
     enc_alg TEXT NOT NULL DEFAULT 'aes-256-gcm' CHECK (enc_alg = 'aes-256-gcm'),
     enc_version INTEGER NOT NULL DEFAULT 1 CHECK (enc_version >= 1),
     key_id TEXT NOT NULL CHECK (length(key_id) BETWEEN 1 AND 40),
     envelope_sha256 TEXT NOT NULL CHECK (length(envelope_sha256) = 64),
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY (patient_id) REFERENCES users(user_id)
   )`,
  `CREATE TRIGGER IF NOT EXISTS trg_report_originals_no_update BEFORE UPDATE ON report_originals
   BEGIN ${abort('report originals are immutable')} END`,
  `CREATE TRIGGER IF NOT EXISTS trg_report_originals_no_delete BEFORE DELETE ON report_originals
   BEGIN ${abort('report originals cannot be deleted')} END`,
  `CREATE INDEX IF NOT EXISTS idx_report_originals_patient ON report_originals(patient_id, created_at)`,

  // ---- B. Shares and explicit, versioned consent ----
  `CREATE TABLE IF NOT EXISTS report_shares (
     share_id INTEGER PRIMARY KEY AUTOINCREMENT,
     report_id INTEGER NOT NULL,
     patient_id INTEGER NOT NULL,
     doctor_user_id INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (${SHARE_STATUSES})),
     consent_text_version TEXT NOT NULL CHECK (length(consent_text_version) BETWEEN 1 AND 40),
     consent_text TEXT NOT NULL CHECK (length(consent_text) BETWEEN 1 AND 2000),
     consent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     consent_language TEXT NOT NULL DEFAULT 'en' CHECK (consent_language IN ('en')),
     consent_text_sha256 TEXT NOT NULL CHECK (length(consent_text_sha256) = 64),
     consent_doctor_name TEXT NOT NULL CHECK (length(consent_doctor_name) BETWEEN 1 AND 200),
     consent_report_title TEXT NOT NULL CHECK (length(consent_report_title) BETWEEN 1 AND 200),
     submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     revoked_at DATETIME,
     revoked_by_user_id INTEGER,
     CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
     CHECK (revoked_by_user_id IS NULL OR revoked_at IS NOT NULL),
     FOREIGN KEY (report_id) REFERENCES report_originals(report_id),
     FOREIGN KEY (patient_id) REFERENCES users(user_id),
     FOREIGN KEY (doctor_user_id) REFERENCES users(user_id),
     FOREIGN KEY (revoked_by_user_id) REFERENCES users(user_id)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_report_shares_active ON report_shares(report_id, doctor_user_id) WHERE status <> 'revoked'`,
  `CREATE INDEX IF NOT EXISTS idx_report_shares_doctor ON report_shares(doctor_user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_report_shares_patient ON report_shares(patient_id)`,
  `CREATE INDEX IF NOT EXISTS idx_report_shares_report ON report_shares(report_id)`,
  `CREATE TRIGGER IF NOT EXISTS trg_report_shares_validate_insert BEFORE INSERT ON report_shares
   BEGIN
     SELECT RAISE(ABORT, 'report does not belong to this patient')
       WHERE NOT EXISTS (SELECT 1 FROM report_originals WHERE report_id = NEW.report_id AND patient_id = NEW.patient_id);
     SELECT RAISE(ABORT, 'recipient is not a doctor with a profile')
       WHERE NOT EXISTS (SELECT 1 FROM doctor_profiles p JOIN users u ON u.user_id = p.user_id
                         WHERE p.user_id = NEW.doctor_user_id AND u.role = 'doctor');
     SELECT RAISE(ABORT, 'a report cannot be shared with its own patient')
       WHERE NEW.doctor_user_id = NEW.patient_id;
     SELECT RAISE(ABORT, 'a new share must start as submitted')
       WHERE NEW.status <> 'submitted';
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_report_shares_immutable BEFORE UPDATE OF
     report_id, patient_id, doctor_user_id, consent_text_version, consent_text, consent_at,
     consent_language, consent_text_sha256, consent_doctor_name, consent_report_title, submitted_at ON report_shares
   BEGIN ${abort('share identity and consent are immutable')} END`,
  `CREATE TRIGGER IF NOT EXISTS trg_report_shares_revoked_final BEFORE UPDATE ON report_shares
   WHEN OLD.status = 'revoked' AND (NEW.status <> 'revoked' OR NEW.revoked_at IS NOT OLD.revoked_at)
   BEGIN ${abort('a revoked share is final')} END`,
  `CREATE TRIGGER IF NOT EXISTS trg_report_shares_no_delete BEFORE DELETE ON report_shares
   BEGIN ${abort('shares cannot be deleted; revoke instead')} END`,

  // ---- C. Review versions (append-only; the original is never a version) ----
  `CREATE TABLE IF NOT EXISTS report_versions (
     version_id INTEGER PRIMARY KEY AUTOINCREMENT,
     share_id INTEGER NOT NULL,
     version_no INTEGER NOT NULL CHECK (version_no >= 1),
     kind TEXT NOT NULL CHECK (kind IN (${VERSION_KINDS})),
     author_user_id INTEGER NOT NULL,
     note_ciphertext BLOB,
     note_iv BLOB,
     note_auth_tag BLOB,
     key_id TEXT,
     enc_version INTEGER NOT NULL DEFAULT 1,
     attachment_name TEXT CHECK (attachment_name IS NULL OR length(attachment_name) BETWEEN 1 AND 120),
     storage_name TEXT UNIQUE,
     mime_type TEXT,
     size_bytes INTEGER,
     content_sha256 TEXT,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     UNIQUE (share_id, version_no),
     CHECK ((note_ciphertext IS NULL) = (note_iv IS NULL) AND (note_iv IS NULL) = (note_auth_tag IS NULL)),
     CHECK (note_ciphertext IS NULL OR (length(note_iv) = 12 AND length(note_auth_tag) = 16 AND length(note_ciphertext) > 0 AND key_id IS NOT NULL)),
     CHECK (kind <> 'doctor_note' OR (note_ciphertext IS NOT NULL AND storage_name IS NULL)),
     CHECK (kind <> 'reviewed_attachment' OR (storage_name IS NOT NULL AND attachment_name IS NOT NULL
            AND mime_type IN ('application/pdf','image/jpeg','image/png')
            AND size_bytes BETWEEN 1 AND 5242880 AND length(content_sha256) = 64)),
     FOREIGN KEY (share_id) REFERENCES report_shares(share_id),
     FOREIGN KEY (author_user_id) REFERENCES users(user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_report_versions_share ON report_versions(share_id, version_no)`,
  `CREATE TRIGGER IF NOT EXISTS trg_report_versions_validate_insert BEFORE INSERT ON report_versions
   BEGIN
     SELECT RAISE(ABORT, 'only the recipient doctor can add a review version')
       WHERE NEW.author_user_id IS NOT (SELECT doctor_user_id FROM report_shares WHERE share_id = NEW.share_id);
     SELECT RAISE(ABORT, 'cannot add a version to a revoked share')
       WHERE (SELECT status FROM report_shares WHERE share_id = NEW.share_id) = 'revoked';
     SELECT RAISE(ABORT, 'version numbers must be sequential')
       WHERE NEW.version_no <> COALESCE((SELECT MAX(version_no) FROM report_versions WHERE share_id = NEW.share_id), 0) + 1;
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_report_versions_no_update BEFORE UPDATE ON report_versions
   BEGIN ${abort('review versions are append-only')} END`,
  `CREATE TRIGGER IF NOT EXISTS trg_report_versions_no_delete BEFORE DELETE ON report_versions
   BEGIN ${abort('review versions cannot be deleted')} END`,

  // ---- D. Audit events (append-only; no free text, so no health data can be logged) ----
  `CREATE TABLE IF NOT EXISTS report_audit_events (
     event_id INTEGER PRIMARY KEY AUTOINCREMENT,
     event_type TEXT NOT NULL CHECK (event_type IN (${AUDIT_EVENTS})),
     outcome TEXT NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok','denied','error')),
     actor_user_id INTEGER,
     actor_role TEXT CHECK (actor_role IS NULL OR actor_role IN ('user','doctor','admin','system')),
     report_id INTEGER,
     share_id INTEGER,
     version_id INTEGER,
     detail_code TEXT CHECK (detail_code IS NULL OR (length(detail_code) <= 40 AND detail_code NOT GLOB '*[^a-z0-9_.-]*')),
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY (actor_user_id) REFERENCES users(user_id),
     FOREIGN KEY (report_id) REFERENCES report_originals(report_id),
     FOREIGN KEY (share_id) REFERENCES report_shares(share_id),
     FOREIGN KEY (version_id) REFERENCES report_versions(version_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_report_audit_report ON report_audit_events(report_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_report_audit_share ON report_audit_events(share_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_report_audit_actor ON report_audit_events(actor_user_id, created_at)`,
  `CREATE TRIGGER IF NOT EXISTS trg_report_audit_no_update BEFORE UPDATE ON report_audit_events
   BEGIN ${abort('audit events are append-only')} END`,
  `CREATE TRIGGER IF NOT EXISTS trg_report_audit_no_delete BEFORE DELETE ON report_audit_events
   BEGIN ${abort('audit events cannot be deleted')} END`,
]

export const REPORT_SCHEMA_OBJECTS = {
  tables: ['schema_migrations', 'report_originals', 'report_shares', 'report_versions', 'report_audit_events'],
  triggers: [
    'trg_report_originals_no_update', 'trg_report_originals_no_delete',
    'trg_report_shares_validate_insert', 'trg_report_shares_immutable', 'trg_report_shares_revoked_final', 'trg_report_shares_no_delete',
    'trg_report_versions_validate_insert', 'trg_report_versions_no_update', 'trg_report_versions_no_delete',
    'trg_report_audit_no_update', 'trg_report_audit_no_delete',
    ...SCHEMA_002_TRIGGERS,
  ],
  indexes: [
    'idx_report_originals_patient', 'uq_report_shares_active', 'idx_report_shares_doctor', 'idx_report_shares_patient',
    'idx_report_shares_report', 'idx_report_versions_share', 'idx_report_audit_report', 'idx_report_audit_share', 'idx_report_audit_actor',
  ],
}

const REQUIRED_EXISTING = ['users', 'doctor_profiles']

function rows(db, sql) {
  const r = db.exec(sql)
  return r[0] ? r[0].values.map(v => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]]))) : []
}

// Which of the new schema objects exist / are missing (names only).
export function inspectReportSchema(db) {
  const have = new Set(rows(db, 'SELECT name FROM sqlite_master').map(r => r.name))
  const all = [...REPORT_SCHEMA_OBJECTS.tables, ...REPORT_SCHEMA_OBJECTS.triggers, ...REPORT_SCHEMA_OBJECTS.indexes]
  const missingCols = have.has('report_shares') ? missingSchema002Columns(db).map(c => `column:${c}`) : []
  return { present: all.filter(n => have.has(n)), missing: [...all.filter(n => !have.has(n)), ...missingCols] }
}

// Applies the migration atomically. Safe to run repeatedly (every statement is IF NOT EXISTS).
// Requires the existing users and doctor_profiles tables (the foreign-key targets).
export function applyReportSchema(db) {
  const have = new Set(rows(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map(r => r.name))
  for (const t of REQUIRED_EXISTING) {
    if (!have.has(t)) throw new Error(`Required existing table "${t}" is missing; this does not look like a NeuroRelief database.`)
  }
  db.run('BEGIN')
  try {
    for (const stmt of REPORT_SCHEMA_STATEMENTS) db.run(stmt)
    db.run('INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)', [MIGRATION_NAME])
    applySchema002(db)   // report-audit-002: appointment link, revision link, lifecycle triggers
    db.run('COMMIT')
  } catch (err) {
    try { db.run('ROLLBACK') } catch { /* nothing to roll back */ }
    throw new Error(`Report schema migration failed and was rolled back: ${err.message}`)
  }
  return inspectReportSchema(db)
}
