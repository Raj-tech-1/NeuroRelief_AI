import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { get, run } from '../db/database.js'
import { generateToken } from '../middleware/auth.js'

const router = Router()

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { name, email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' })

  const existing = get('SELECT user_id FROM users WHERE email = ?', [email])
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
router.post('/login', (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' })

  const user = get('SELECT * FROM users WHERE email = ?', [email])
  if (!user) return res.status(401).json({ error: 'Invalid email or password' })

  const valid = bcrypt.compareSync(password, user.password_hash)
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' })

  const token = generateToken(user.user_id, user.role)
  res.json({ user_id: user.user_id, name: user.name, email: user.email, role: user.role, token })
})

export default router
