// Controlled creation of doctor/admin accounts (never exposed over HTTP).
// Usage (PowerShell):
//   $env:SEED_EMAIL='doc@example.com'; $env:SEED_PASSWORD='...'; $env:SEED_ROLE='doctor'; $env:SEED_NAME='Dr. X'
//   node scripts/seed-user.js
// If the email already exists, only its role is updated (password is left unchanged).
//
// For role 'doctor', set SEED_SPECIALTY to also create/update the bookable doctor profile:
//   SEED_SPECIALTY, SEED_PRICE (whole number), SEED_DAYS ('Mon,Wed,Fri'),
//   optional SEED_PHONE, SEED_EXPERIENCE, SEED_DESCRIPTION, SEED_RATING
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { initDB, get, run } from '../db/database.js'

const { SEED_EMAIL, SEED_PASSWORD, SEED_ROLE, SEED_NAME } = process.env
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

if (!SEED_EMAIL || !['doctor', 'admin'].includes(SEED_ROLE)) {
  console.error('Set SEED_EMAIL and SEED_ROLE (doctor or admin). SEED_PASSWORD is required for new accounts.')
  process.exit(1)
}

// Validate the optional doctor profile BEFORE touching the database.
const wantsProfile = SEED_ROLE === 'doctor' && !!process.env.SEED_SPECIALTY
let profile = null
if (wantsProfile) {
  const price = Number(process.env.SEED_PRICE)
  const days = (process.env.SEED_DAYS || '').split(',').map(d => d.trim()).filter(Boolean)
  const rating = process.env.SEED_RATING ? Number(process.env.SEED_RATING) : null
  if (!Number.isInteger(price) || price < 0 || !days.length || days.some(d => !WEEKDAYS.includes(d)) ||
      (rating !== null && !(rating >= 0 && rating <= 5))) {
    console.error('Doctor profile needs SEED_PRICE (whole number), SEED_DAYS (e.g. Mon,Wed,Fri) and an optional SEED_RATING (0-5).')
    process.exit(1)
  }
  profile = {
    specialty: process.env.SEED_SPECIALTY, price, days: days.join(','), rating,
    phone: process.env.SEED_PHONE || null, experience: process.env.SEED_EXPERIENCE || null,
    description: process.env.SEED_DESCRIPTION || null
  }
}

await initDB()
const existing = get('SELECT user_id, name FROM users WHERE email = ?', [SEED_EMAIL])
let userId

if (existing) {
  run('UPDATE users SET role = ? WHERE user_id = ?', [SEED_ROLE, existing.user_id])
  userId = existing.user_id
  console.log(`Existing account ${SEED_EMAIL} set to role '${SEED_ROLE}'.`)
} else {
  if (!SEED_PASSWORD || SEED_PASSWORD.length < 8) {
    console.error('SEED_PASSWORD (min 8 characters) is required to create a new account.')
    process.exit(1)
  }
  userId = run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [SEED_NAME || SEED_EMAIL.split('@')[0], SEED_EMAIL, bcrypt.hashSync(SEED_PASSWORD, 10), SEED_ROLE]).lastInsertRowid
  console.log(`Created ${SEED_ROLE} account ${SEED_EMAIL}.`)
}

if (profile) {
  const displayName = SEED_NAME || existing?.name || SEED_EMAIL.split('@')[0]
  const vals = [displayName, profile.specialty, profile.rating, profile.experience, profile.description, profile.price, profile.phone, profile.days]
  if (get('SELECT doctor_id FROM doctor_profiles WHERE user_id = ?', [userId])) {
    run('UPDATE doctor_profiles SET display_name=?, specialty=?, rating=?, experience=?, description=?, price=?, phone=?, days=? WHERE user_id=?', [...vals, userId])
    console.log('Doctor profile updated.')
  } else {
    run('INSERT INTO doctor_profiles (display_name, specialty, rating, experience, description, price, phone, days, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [...vals, userId])
    console.log('Doctor profile created.')
  }
}
