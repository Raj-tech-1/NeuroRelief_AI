import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { get, run } from '../db/database.js'
import { generateToken, authenticateToken } from '../middleware/auth.js'
import { createRateLimiter } from '../middleware/rateLimit.js'

const router = Router()

const MIN_PASSWORD = 8
// Per client IP (these routes are unauthenticated). Slows password guessing; resets on server restart.
const loginLimit = createRateLimiter({ windowMs: 15 * 60_000, max: 10 })
const registerLimit = createRateLimiter({ windowMs: 60 * 60_000, max: 10 })

// Emails are stored and compared in lower case, so "A@x.com" and "a@x.com" are the same account
const normEmail = e => (typeof e === 'string' ? e.trim().toLowerCase() : '')

// POST /api/auth/register
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
  const userName = name || email.split('@')[0]
  // Public registration can only ever create a 'user'; the request body is never consulted for role.
  const role = 'user'
  const result = run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', [userName, email, password_hash, role])
  const token = generateToken(result.lastInsertRowid, role)

  res.status(201).json({ user_id: result.lastInsertRowid, name: userName, email, role, token })
})

// POST /api/auth/login
router.post('/login', loginLimit, (req, res) => {
  const { password } = req.body
  const email = normEmail(req.body.email)
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' })

  // Existing passwords shorter than the new minimum still work here; the minimum applies to new passwords.
  const user = get('SELECT * FROM users WHERE lower(email) = ?', [email])
  if (!user) return res.status(401).json({ error: 'Invalid email or password' })

  const valid = typeof password === 'string' && bcrypt.compareSync(password, user.password_hash)
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' })

  const token = generateToken(user.user_id, user.role)
  res.json({ user_id: user.user_id, name: user.name, email: user.email, role: user.role, token })
})

// A display name: trimmed, control characters removed, inner whitespace collapsed, 1-60 characters
const MAX_NAME = 60
const cleanName = v => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim() : '')

// GET /api/auth/me — the signed-in account (name as stored on the server)
router.get('/me', authenticateToken, (req, res) => {
  const u = get('SELECT user_id, name, email, role FROM users WHERE user_id = ?', [req.userId])
  res.json(u)
})

// PATCH /api/auth/me  { name } — sets the display name shown to doctors and in the app (instead of the email username)
router.patch('/me', authenticateToken, (req, res) => {
  const name = cleanName(req.body?.name)
  if (!name) return res.status(400).json({ error: 'Please enter your name', code: 'NAME_REQUIRED' })
  if (name.length > MAX_NAME) return res.status(400).json({ error: `Name must be at most ${MAX_NAME} characters`, code: 'NAME_TOO_LONG' })
  run('UPDATE users SET name = ? WHERE user_id = ?', [name, req.userId])
  res.json(get('SELECT user_id, name, email, role FROM users WHERE user_id = ?', [req.userId]))
})

export default router
