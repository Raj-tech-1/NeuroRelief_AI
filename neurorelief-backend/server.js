import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { initDB } from './db/database.js'

// Import routes
import authRoutes from './routes/auth.js'
import cycleRoutes from './routes/cycles.js'
import moodRoutes from './routes/mood.js'
import predictRoutes from './routes/predict.js'
import doctorRoutes from './routes/doctors.js'
import scanRoutes from './routes/scans.js'

const app = express()
const PORT = process.env.PORT || 8000

// Middleware
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3000'], credentials: true }))
app.use(express.json())

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/cycles', cycleRoutes)
app.use('/api/mood', moodRoutes)
app.use('/api/predict', predictRoutes)
app.use('/api/doctors', doctorRoutes)
app.use('/api/scans', scanRoutes)

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Initialize DB then start server
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`
  NeuroRelief AI Backend running on http://localhost:${PORT}
  Endpoints: /api/auth /api/cycles /api/mood /api/predict /api/doctors /api/scans
    `)
  })
}).catch(err => {
  console.error('Failed to initialize database:', err)
  process.exit(1)
})
