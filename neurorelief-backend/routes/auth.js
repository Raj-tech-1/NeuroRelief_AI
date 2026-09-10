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
  const result = run('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [userName, email, password_hash])
  const token = generateToken(result.lastInsertRowid)

  res.status(201).json({ user_id: result.lastInsertRowid, name: userName, email, token })
})

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' })

  const user = get('SELECT * FROM users WHERE email = ?', [email])
  if (!user) return res.status(401).json({ error: 'Invalid email or password' })

  const valid = bcrypt.compareSync(password, user.password_hash)
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' })

  const token = generateToken(user.user_id)
  res.json({ user_id: user.user_id, name: user.name, email: user.email, token })
})

export default router
