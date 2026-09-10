import { Router } from 'express'
import { all, run } from '../db/database.js'
import { authenticateToken } from '../middleware/auth.js'

const router = Router()

const doctors = [
  { id: 'doc_001', name: 'Dr. Priya Sharma', specialty: 'Gynecology', rating: 4.8, experience: '15+ years', description: "Specialized in women's health with 15+ years of experience in reproductive health, hormonal disorders, and menstrual pain management.", price: 800, phone: '+919876543210', days: ['Mon', 'Wed', 'Fri'] },
  { id: 'doc_002', name: 'Dr. Anjali Desai', specialty: 'Obstetrics & Gynecology', rating: 4.9, experience: '12+ years', description: 'Expert in pregnancy care, fertility treatments, PCOS management, and minimally invasive gynecological procedures.', price: 1000, phone: '+919876543211', days: ['Tue', 'Thu', 'Sat'] },
  { id: 'doc_003', name: 'Dr. Kavitha Nair', specialty: 'Reproductive Endocrinology', rating: 4.7, experience: '10+ years', description: 'Focus on hormonal disorders, PCOS, endometriosis, thyroid-related menstrual issues, and fertility preservation treatments.', price: 1200, phone: '+919876543212', days: ['Mon', 'Tue', 'Thu', 'Fri'] },
  { id: 'doc_004', name: 'Dr. Meena Iyer', specialty: 'Pain Management', rating: 4.6, experience: '8+ years', description: 'Specializes in chronic pain management including dysmenorrhea, TENS therapy guidance, and non-pharmacological pain relief techniques.', price: 700, phone: '+919876543213', days: ['Mon', 'Wed', 'Sat'] },
]

// GET /api/doctors — list doctors
router.get('/', (req, res) => res.json(doctors))

// POST /api/doctors/book — book an appointment (requires auth)
router.post('/book', authenticateToken, (req, res) => {
  const { doctor_id, doctor_name, specialty, day, time, price } = req.body
  if (!doctor_id || !day || !time) return res.status(400).json({ error: 'Missing booking details' })

  run(
    `CREATE TABLE IF NOT EXISTS bookings (
      booking_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, doctor_id TEXT, doctor_name TEXT, specialty TEXT,
      day TEXT, time TEXT, price INTEGER, status TEXT DEFAULT 'confirmed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, []
  )

  const result = run(
    'INSERT INTO bookings (user_id, doctor_id, doctor_name, specialty, day, time, price) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.userId, doctor_id, doctor_name, specialty, day, time, price]
  )

  res.status(201).json({ booking_id: result.lastInsertRowid, message: 'Appointment booked', status: 'confirmed' })
})

// GET /api/doctors/bookings — get user's bookings
router.get('/bookings', authenticateToken, (req, res) => {
  try {
    const bookings = all('SELECT * FROM bookings WHERE user_id = ? ORDER BY created_at DESC', [req.userId])
    res.json(bookings)
  } catch {
    res.json([])
  }
})

export default router
