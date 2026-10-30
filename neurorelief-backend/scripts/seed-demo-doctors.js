// Creates/updates the five FICTIONAL demo clinicians used for development and demonstration.
// Idempotent: run it as often as you like, it never creates duplicates. Not run at server startup.
//   node scripts/seed-demo-doctors.js
//
// - Each demo clinician is a real doctor account + doctor_profiles row (is_demo = 1), so booking,
//   ownership checks and accept/decline all use the normal tables and routes.
// - The placeholder dev profile named 'Dr. Demo User' (your existing doctor login) is adopted as
//   Dr. Ananya Rao: its account, password and appointments are untouched; only the profile is renamed.
// - New demo accounts use a reserved, non-routable email domain and a password hash that can never match,
//   so they cannot be logged into unless you opt in with DEMO_DOCTOR_PASSWORD (min 8 chars, applied only to
//   accounts this script creates; the value is never printed).
// - To (re)set one shared password on ALL FIVE demo doctor accounts, run with both DEMO_DOCTOR_PASSWORD and
//   RESET_DEMO_PASSWORDS=1. Only these five accounts are touched; patients and other accounts never are.
// - No ratings, experience, registrations, clinics or phone numbers are stored: nothing here claims credentials.
// - STOP the backend before running this against the real database (sql.js rewrites the whole file on save).
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { initDB, get, run } from '../db/database.js'

const DEMO_DOMAIN = 'demo.neurorelief.invalid'
const DISABLED_HASH = '!disabled-demo-account'

// Fees and weekdays are explicit demo values, not claims about real doctors.
const DEMO_DOCTORS = [
  { name: 'Dr. Ananya Rao', slug: 'ananya.rao', specialty: 'Gynecology', price: 500, days: 'Mon,Wed,Fri', focus: 'gynecology and menstrual health', adopt: true },
  { name: 'Dr. Priya Sharma', slug: 'priya.sharma', specialty: 'Obstetrics & Gynecology', price: 800, days: 'Tue,Thu,Sat', focus: 'obstetrics and gynecology' },
  { name: 'Dr. Kavitha Nair', slug: 'kavitha.nair', specialty: 'Reproductive Endocrinology', price: 1200, days: 'Mon,Tue,Thu,Fri', focus: 'reproductive endocrinology' },
  { name: 'Dr. Meera Iyer', slug: 'meera.iyer', specialty: 'Pain Management', price: 700, days: 'Mon,Wed,Sat', focus: 'pain management' },
  { name: 'Dr. Nisha Desai', slug: 'nisha.desai', specialty: 'Gynecology', price: 600, days: 'Tue,Wed,Fri', focus: 'gynecology' },
]
const description = d => `Demo clinician profile for development and demonstration. Focus area: ${d.focus}. No qualifications or credentials are claimed.`

const password = process.env.DEMO_DOCTOR_PASSWORD
if (password !== undefined && password.length < 8) {
  console.error('DEMO_DOCTOR_PASSWORD must be at least 8 characters (or leave it unset).')
  process.exit(1)
}

await initDB()
for (const d of DEMO_DOCTORS) {
  let profile = get('SELECT doctor_id, user_id FROM doctor_profiles WHERE is_demo = 1 AND display_name = ?', [d.name])
  let action = 'updated'

  if (!profile && d.adopt) {
    const placeholder = get("SELECT doctor_id, user_id FROM doctor_profiles WHERE display_name = 'Dr. Demo User' AND is_demo = 0")
    if (placeholder) { profile = placeholder; action = 'adopted existing profile' }
  }

  if (!profile) {
    const email = `${d.slug}@${DEMO_DOMAIN}`
    let user = get('SELECT user_id, role FROM users WHERE email = ?', [email])
    if (!user) {
      const hash = password ? bcrypt.hashSync(password, 10) : DISABLED_HASH
      const userId = run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', [d.name, email, hash, 'doctor']).lastInsertRowid
      user = { user_id: userId, role: 'doctor' }
    } else if (user.role !== 'doctor') {
      console.error(`Account ${email} exists but is not a doctor account; refusing to change it.`)
      process.exit(1)
    }
    run('INSERT INTO doctor_profiles (user_id, display_name, specialty, rating, experience, description, price, phone, days, is_demo) VALUES (?, ?, ?, NULL, NULL, ?, ?, NULL, ?, 1)',
      [user.user_id, d.name, d.specialty, description(d), d.price, d.days])
    action = 'created'
  } else {
    run('UPDATE doctor_profiles SET display_name = ?, specialty = ?, rating = NULL, experience = NULL, description = ?, price = ?, phone = NULL, days = ?, is_demo = 1 WHERE doctor_id = ?',
      [d.name, d.specialty, description(d), d.price, d.days, profile.doctor_id])
    if (d.adopt) run('UPDATE users SET name = ? WHERE user_id = ? AND name = ?', [d.name, profile.user_id, 'Dr. Demo User'])
  }
  if (password && process.env.RESET_DEMO_PASSWORDS === '1') {
    const owner = get('SELECT user_id FROM doctor_profiles WHERE is_demo = 1 AND display_name = ?', [d.name])
    run("UPDATE users SET password_hash = ? WHERE user_id = ? AND role = 'doctor'", [bcrypt.hashSync(password, 10), owner.user_id])
    action += ', password set'
  }
  console.log(`${d.name}: ${action}`)
}
console.log('Done. Demo clinicians are fictional; no credentials are claimed.')
