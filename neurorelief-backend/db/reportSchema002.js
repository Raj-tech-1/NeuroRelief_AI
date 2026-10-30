// Migration report-audit-002 (additive): ties a share to a confirmed appointment, links revisions, and enforces the
// review lifecycle in the database as well as in the API. Applied by applyReportSchema() right after 001, in the same
// transaction. 001 is left exactly as it was.
//
//   report_shares.appointment_id    the accepted appointment that made this doctor eligible (immutable once set)
//   report_shares.previous_share_id the share where changes were requested, when this share is a revision (immutable)
//   report_shares.verified_at       set only together with status 'verified'
//
// appointment_id is nullable at the database level (ALTER TABLE cannot add a NOT NULL column without a default, and
// shares written before this migration have none); the API always supplies it, and when it is present a trigger checks
// it belongs to this patient and doctor and is 'accepted'.
export const MIGRATION_NAME_002 = 'report-audit-002'

const abort = msg => `SELECT RAISE(ABORT, '${msg}');`

export const SCHEMA_002_COLUMNS = [
  { table: 'report_shares', name: 'appointment_id', ddl: 'INTEGER REFERENCES appointments(appointment_id)' },
  { table: 'report_shares', name: 'previous_share_id', ddl: 'INTEGER REFERENCES report_shares(share_id)' },
  { table: 'report_shares', name: 'verified_at', ddl: 'DATETIME' },
]

export const SCHEMA_002_TRIGGERS = [
  'trg_report_shares_appt_insert', 'trg_report_shares_prev_insert', 'trg_report_shares_immutable_002',
  'trg_report_shares_transition', 'trg_report_shares_verified_at',
]

export const SCHEMA_002_STATEMENTS = [
  `CREATE TRIGGER IF NOT EXISTS trg_report_shares_appt_insert BEFORE INSERT ON report_shares
   WHEN NEW.appointment_id IS NOT NULL
   BEGIN
     SELECT RAISE(ABORT, 'no confirmed appointment links this patient and doctor')
       WHERE NOT EXISTS (SELECT 1 FROM appointments WHERE appointment_id = NEW.appointment_id AND patient_id = NEW.patient_id
                         AND doctor_user_id = NEW.doctor_user_id AND status = 'accepted');
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_report_shares_prev_insert BEFORE INSERT ON report_shares
   WHEN NEW.previous_share_id IS NOT NULL
   BEGIN
     SELECT RAISE(ABORT, 'invalid previous share')
       WHERE NOT EXISTS (SELECT 1 FROM report_shares WHERE share_id = NEW.previous_share_id AND patient_id = NEW.patient_id
                         AND doctor_user_id = NEW.doctor_user_id AND status = 'changes_requested');
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_report_shares_immutable_002 BEFORE UPDATE OF appointment_id, previous_share_id ON report_shares
   WHEN NEW.appointment_id IS NOT OLD.appointment_id OR NEW.previous_share_id IS NOT OLD.previous_share_id
   BEGIN ${abort('the appointment and revision link of a share are immutable')} END`,
  // Lifecycle: submitted -> under_review -> changes_requested | verified; any non-revoked state -> revoked.
  // 'verified' needs at least one doctor note and a verified_at timestamp.
  `CREATE TRIGGER IF NOT EXISTS trg_report_shares_transition BEFORE UPDATE OF status ON report_shares
   WHEN NEW.status <> OLD.status
   BEGIN
     SELECT RAISE(ABORT, 'illegal status transition') WHERE NOT (
       (OLD.status = 'submitted' AND NEW.status IN ('under_review', 'revoked')) OR
       (OLD.status = 'under_review' AND NEW.status IN ('changes_requested', 'verified', 'revoked')) OR
       (OLD.status IN ('changes_requested', 'verified') AND NEW.status = 'revoked'));
     SELECT RAISE(ABORT, 'verification requires a doctor note')
       WHERE NEW.status = 'verified' AND NOT EXISTS (SELECT 1 FROM report_versions WHERE share_id = OLD.share_id AND kind = 'doctor_note');
     SELECT RAISE(ABORT, 'verified_at is required when verified')
       WHERE NEW.status = 'verified' AND NEW.verified_at IS NULL;
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_report_shares_verified_at BEFORE UPDATE OF verified_at, status ON report_shares
   WHEN NEW.verified_at IS NOT OLD.verified_at OR (NEW.verified_at IS NOT NULL AND NEW.status <> 'verified' AND NEW.status <> 'revoked')
   BEGIN
     SELECT RAISE(ABORT, 'verified_at can only be set once, together with status verified')
       WHERE OLD.verified_at IS NOT NULL OR NEW.status <> 'verified';
   END`,
]

const tableColumns = (db, table) => {
  const r = db.exec(`PRAGMA table_info(${table})`)
  return r[0] ? r[0].values.map(v => v[1]) : []
}

// Must be called inside the caller's transaction. Idempotent.
export function applySchema002(db) {
  for (const c of SCHEMA_002_COLUMNS) {
    if (!tableColumns(db, c.table).includes(c.name)) db.run(`ALTER TABLE ${c.table} ADD COLUMN ${c.name} ${c.ddl}`)
  }
  for (const stmt of SCHEMA_002_STATEMENTS) db.run(stmt)
  db.run('INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)', [MIGRATION_NAME_002])
}

export function missingSchema002Columns(db) {
  return SCHEMA_002_COLUMNS.filter(c => !tableColumns(db, c.table).includes(c.name)).map(c => `${c.table}.${c.name}`)
}
