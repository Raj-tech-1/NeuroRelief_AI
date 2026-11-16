import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { get, run, transaction } from '../db/database.js'
import { generateToken, authenticateToken, requireRole } from '../middleware/auth.js'
import { createRateLimiter } from '../middleware/rateLimit.js'
import { audit } from '../lib/auditLog.js'
import { WEEKDAYS } from '../lib/appointmentRules.js'

const router = Router()

const MIN_PASSWORD = 8
// Per client IP (these routes are unauthenticated). Slows password guessing; resets on server restart.
const loginLimit = createRateLimiter({ windowMs: 15 * 60_000, max: 10 })
const registerLimit = createRateLimiter({ windowMs: 60 * 60_000, max: 10 })

// Emails are stored and compared in lower case, so "A@x.com" and "a@x.com" are the same account
const normEmail = e => (typeof e === 'string' ? e.trim().toLowerCase() : '')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// A display name / short text: trimmed, control characters removed, inner whitespace collapsed
const MAX_NAME = 60
const cleanText = v => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim() : '')

// Registration / licence number: letters, digits and / . - or spaces inside, 4-30 characters
const LICENCE_RE = /^[A-Za-z0-9][A-Za-z0-9/.\- ]{2,28}[A-Za-z0-9]$/

const publicUser = u => ({ user_id: u.user_id, name: u.name, email: u.email, role: u.role })

// POST /api/auth/register  (patients only; the request body is never consulted for role)
router.post('/register', registerLimit, (req, res) => {
  const { name, password } = req.body
  const email = normEmail(req.body.email)
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' })
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` })
  }

  // lower(email): also catches accounts created before emails were normalised
  const existing = get('SELECT user_id FROM users WHERE lower(email) = ?', [email])
  if (existing) return res.status(409).json({ error: 'Email already registered' })

  const password_hash = bcrypt.hashSync(password, 10)
  const userName = cleanText(name).slice(0, MAX_NAME) || email.split('@')[0]
  const role = 'user'
  const result = run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', [userName, email, password_hash, role])
  audit({ action: 'auth.register', actorId: result.lastInsertRowid, actorRole: role, targetType: 'user', targetId: result.lastInsertRowid })
  const token = generateToken(result.lastInsertRowid, role)

  res.status(201).json({ user_id: result.lastInsertRowid, name: userName, email, role, token })
})

// POST /api/auth/doctor-apply — public doctor application. Creates an account with role 'doctor_applicant'
// (no doctor access of any kind) and a doctor profile with verification_status 'pending'. An admin checks the
// registration/licence number manually and approves (role becomes 'doctor') or rejects it.
router.post('/doctor-apply', registerLimit, (req, res) => {
  const b = req.body || {}
  const email = normEmail(b.email)
  const name = cleanText(b.name)
  const specialty = cleanText(b.specialty)
  const licence = cleanText(b.licence_number).toUpperCase()
  const authority = cleanText(b.licence_authority)
  const days = Array.isArray(b.days) ? [...new Set(b.days)].filter(d => WEEKDAYS.includes(d)) : []

  const fail = (field, error) => res.status(400).json({ error, field, code: 'INVALID_INPUT' })
  if (!name || name.length > MAX_NAME) return fail('name', `Enter your full name (up to ${MAX_NAME} characters)`)
  if (!EMAIL_RE.test(email)) return fail('email', 'Enter a valid email address')
  if (typeof b.password !== 'string' || b.password.length < MIN_PASSWORD) return fail('password', `Password must be at least ${MIN_PASSWORD} characters`)
  if (specialty.length < 2 || specialty.length > 60) return fail('specialty', 'Enter your specialty (2-60 characters)')
  if (!LICENCE_RE.test(licence)) return fail('licence_number', 'Enter your medical registration / licence number (4-30 letters, digits, / . -)')
  if (!authority || authority.length > 80) return fail('licence_authority', 'Enter the council that issued your registration (up to 80 characters)')
  if (!days.length) return fail('days', 'Choose at least one consultation day')
  if (b.confirm_accurate !== true) return fail('confirm_accurate', 'Please confirm that your details are accurate')

  if (get('SELECT user_id FROM users WHERE lower(email) = ?', [email])) {
    return res.status(409).json({ error: 'Email already registered', field: 'email', code: 'EMAIL_TAKEN' })
  }
  if (get('SELECT doctor_id FROM doctor_profiles WHERE licence_number = ?', [licence])) {
    return res.status(409).json({ error: 'This registration number is already in use. Contact support if this is your number.', field: 'licence_number', code: 'LICENCE_TAKEN' })
  }

  const hash = bcrypt.hashSync(b.password, 10)
  const role = 'doctor_applicant'
  const userId = transaction(tx => {
    const id = tx.run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', [name, email, hash, role]).lastInsertRowid
    tx.run(
      `INSERT INTO doctor_profiles (user_id, display_name, specialty, description, price, days, verification_status, licence_number, licence_authority, applied_at)
       VALUES (?, ?, ?, NULL, 0, ?, 'pending', ?, ?, CURRENT_TIMESTAMP)`,
      [id, name, specialty, days.join(','), licence, authority])
    tx.run("INSERT INTO audit_log (action, actor_user_id, actor_role, target_type, target_id) VALUES ('doctor.applied', ?, ?, 'user', ?)", [id, role, id])
    return id
  })

  res.status(201).json({ user_id: userId, name, email, role, token: generateToken(userId, role), verification_status: 'pending' })
})

// GET /api/auth/doctor-application — the applicant's own application status
router.get('/doctor-application', authenticateToken, requireRole('doctor_applicant', 'doctor'), (req, res) => {
  const p = get(`SELECT display_name, specialty, days, verification_status, licence_number, licence_authority, applied_at, reviewed_at, review_reason
                 FROM doctor_profiles WHERE user_id = ?`, [req.userId])
  if (!p) return res.status(404).json({ error: 'No application found' })
  res.json({
    name: p.display_name, specialty: p.specialty, days: (p.days || '').split(',').filter(Boolean),
    status: p.verification_status, licenceNumber: p.licence_number, licenceAuthority: p.licence_authority,
    appliedAt: p.applied_at, reviewedAt: p.reviewed_at, reason: p.review_reason,
  })
})

// POST /api/auth/login
router.post('/login', loginLimit, (req, res) => {
  const { password } = req.body
  const email = normEmail(req.body.email)
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' })

  // Existing passwords shorter than the new minimum still work here; the minimum applies to new passwords.
  const user = get('SELECT * FROM users WHERE lower(email) = ?', [email])
  const valid = !!user && typeof password === 'string' && bcrypt.compareSync(password, user.password_hash)
  if (!valid) {
    // No email is logged; the user id only when the account exists
    audit({ action: 'auth.login', outcome: 'failed', targetType: user ? 'user' : null, targetId: user?.user_id ?? null })
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  audit({ action: 'auth.login', actorId: user.user_id, actorRole: user.role })
  const token = generateToken(user.user_id, user.role)
  res.json({ ...publicUser(user), token })
})

// ---- Profile: display name + measurements (age, height, weight). BMI is always computed here, never sent.
// Age and BMI feed the pain model (routes/predict.js). Doctors see them only through the 'profile' consent category.
const PROFILE_LIMITS = { age: [10, 80], height: [100, 220], weight: [30, 200] }   // years, cm, kg
const computeBmi = (h, w) => (h && w ? Math.round((w / ((h / 100) ** 2)) * 10) / 10 : null)

function profileView(u) {
  const filled = ['name', 'age', 'height', 'weight'].filter(k => k === 'name' ? !!u.name && u.name !== u.email.split('@')[0] : u[k] != null)
  return {
    ...publicUser(u),
    profile: { age: u.age ?? null, height: u.height ?? null, weight: u.weight ?? null, bmi: u.bmi ?? null },
    // A name that is still the email username does not count as filled in
    completion: { done: filled.length, total: 4, missing: ['name', 'age', 'height', 'weight'].filter(k => !filled.includes(k)) },
  }
}
const loadMe = id => get('SELECT user_id, name, email, role, age, height, weight, bmi FROM users WHERE user_id = ?', [id])

// GET /api/auth/me — the signed-in account and its profile
router.get('/me', authenticateToken, (req, res) => {
  res.json(profileView(loadMe(req.userId)))
})

// PATCH /api/auth/me  { name?, age?, height?, weight? } — any subset; null clears a measurement.
// The display name is shown to doctors and in the app (instead of the email username).
router.patch('/me', authenticateToken, (req, res) => {
  const b = req.body || {}
  const sets = [], vals = []
  if ('name' in b) {
    const name = cleanText(b.name)
    if (!name) return res.status(400).json({ error: 'Please enter your name', code: 'NAME_REQUIRED', field: 'name' })
    if (name.length > MAX_NAME) return res.status(400).json({ error: `Name must be at most ${MAX_NAME} characters`, code: 'NAME_TOO_LONG', field: 'name' })
    sets.push('name = ?'); vals.push(name)
  }
  for (const [k, [lo, hi]] of Object.entries(PROFILE_LIMITS)) {
    if (!(k in b)) continue
    const v = b[k] === null || b[k] === '' ? null : Number(b[k])
    if (v !== null && (!Number.isFinite(v) || v < lo || v > hi)) {
      return res.status(400).json({ error: `${k[0].toUpperCase() + k.slice(1)} must be between ${lo} and ${hi}`, code: 'OUT_OF_RANGE', field: k })
    }
    sets.push(`${k} = ?`); vals.push(v === null ? null : (k === 'age' ? Math.round(v) : Math.round(v * 10) / 10))
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update', code: 'EMPTY' })

  run(`UPDATE users SET ${sets.join(', ')} WHERE user_id = ?`, [...vals, req.userId])
  const cur = loadMe(req.userId)
  run('UPDATE users SET bmi = ? WHERE user_id = ?', [computeBmi(cur.height, cur.weight), req.userId])
  if ('name' in b) audit({ action: 'profile.name_changed', actorId: req.userId, actorRole: req.userRole, targetType: 'user', targetId: req.userId })
  if (['age', 'height', 'weight'].some(k => k in b)) audit({ action: 'profile.measurements_changed', actorId: req.userId, actorRole: req.userRole, targetType: 'user', targetId: req.userId })
  res.json(profileView(loadMe(req.userId)))
})

export default router
