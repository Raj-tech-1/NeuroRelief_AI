// Shared FICTIONAL scratch fixture for tests and migration rehearsals.
// Built from the CREATE TABLE statements found in db/database.js's SOURCE TEXT (the file is only read as text;
// database.js is never imported, so no real database is ever opened). All people are fictional (@fixture.invalid).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export function buildFixtureDb(SQL, { demoDoctors = 2 } = {}) {
  const src = fs.readFileSync(path.join(backendDir, 'db', 'database.js'), 'utf8')
  const creates = [...src.matchAll(/db\.run\(`\s*(CREATE TABLE IF NOT EXISTS[\s\S]*?)`\)/g)].map(m => m[1])
  assert.ok(creates.length >= 8, 'expected to extract the existing CREATE TABLE statements')
  const db = new SQL.Database()
  for (const c of creates) db.run(c)
  db.run("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
  db.run('ALTER TABLE appointments ADD COLUMN doctor_seen INTEGER NOT NULL DEFAULT 0')
  db.run('ALTER TABLE doctor_profiles ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0')
  const fakeHash = 'fixture-not-a-real-password-hash'
  const U = (id, name, email, role) => db.run('INSERT INTO users (user_id, name, email, password_hash, role) VALUES (?,?,?,?,?)', [id, name, email, fakeHash, role])
  U(1, 'Fixture Patient One', 'patient1@fixture.invalid', 'user')
  U(2, 'Fixture Patient Two', 'patient2@fixture.invalid', 'user')
  U(3, 'Dr. Fixture Alpha', 'alpha@fixture.invalid', 'doctor')
  U(4, 'Dr. Fixture Beta', 'beta@fixture.invalid', 'doctor')
  U(5, 'Fixture Not A Doctor', 'plain@fixture.invalid', 'user')
  U(6, 'Dr. Fixture NoProfile', 'noprofile@fixture.invalid', 'doctor')   // doctor role but no doctor_profiles row
  db.run("INSERT INTO doctor_profiles (user_id, display_name, specialty, price, days, is_demo) VALUES (3,'Dr. Fixture Alpha','Gynecology',100,'Mon',1)")
  db.run("INSERT INTO doctor_profiles (user_id, display_name, specialty, price, days, is_demo) VALUES (4,'Dr. Fixture Beta','Gynecology',100,'Tue',1)")
  db.run("INSERT INTO appointments (patient_id, doctor_user_id, requested_date, requested_time, status) VALUES (1,3,'2030-01-07','9:00 AM','pending')")
  db.run("INSERT INTO appointments (patient_id, doctor_user_id, requested_date, requested_time, status) VALUES (2,4,'2030-01-08','10:00 AM','accepted')")
  db.run("INSERT INTO scans (user_id, life_stage, body_areas, severity, ai_summary) VALUES (1,'fictional','fictional area',4,'fictional summary')")
  db.run("INSERT INTO menstrual_cycles (user_id, start_date, cycle_length) VALUES (1,'2030-01-01',28)")
  db.run("INSERT INTO predictions (user_id, date, predicted_severity, confidence) VALUES (1,'2030-01-02','Low',0.5)")
  db.run("INSERT INTO wellness_records (user_id, date, mood) VALUES (1,'2030-01-02','Fictional')")
  return db
}
