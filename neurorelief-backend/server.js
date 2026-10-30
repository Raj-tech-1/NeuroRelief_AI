import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { initDB, all, get, run, transaction } from './db/database.js'
import { authenticateToken } from './middleware/auth.js'
import { createReportsRouter } from './routes/reports.js'
import { createFileStore } from './lib/reportFiles.js'
import path from 'node:path'
import os from 'node:os'
import { loadMasterKey, reportKeyStatus } from './lib/reportCrypto.js'

// Import routes
import authRoutes from './routes/auth.js'
import cycleRoutes from './routes/cycles.js'
import moodRoutes from './routes/mood.js'
import predictRoutes from './routes/predict.js'
import doctorRoutes from './routes/doctors.js'
import scanRoutes from './routes/scans.js'
import assistantRoutes from './routes/assistant.js'

const app = express()
const PORT = process.env.PORT || 8000

// Middleware
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3000'], credentials: true }))
// A report PDF upload is base64 JSON (up to ~6.7 MB); only that route gets the larger limit, everything else keeps the default.
app.use('/api/reports/uploads', express.json({ limit: '8mb' }))
app.use(express.json())

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/cycles', cycleRoutes)
app.use('/api/mood', moodRoutes)
app.use('/api/predict', predictRoutes)
app.use('/api/doctors', doctorRoutes)
app.use('/api/scans', scanRoutes)
app.use('/api/assistant', assistantRoutes)
// Report Audit: inert (generic 503) until the report key is configured AND the report tables exist.
let reportKey = null
// Encrypted PDF uploads go to a private directory outside the project and OneDrive (override with REPORT_STORAGE_DIR); nothing is created until the first upload.
let reportFiles = null
try {
  reportFiles = createFileStore({ dir: process.env.REPORT_STORAGE_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'NeuroRelief', 'report-files') })
} catch (err) { console.warn('Report file uploads disabled:', err.message) }
app.use('/api/reports', createReportsRouter({
  authenticate: authenticateToken,
  ctx: {
    db: { all, get, run, transaction },
    key: () => (reportKey ??= loadMasterKey()),   // throws (and is not cached) while the key is missing/invalid
    now: () => new Date(),
    files: reportFiles,   // null when no valid private directory is configured: uploads then answer 503
  },
}))

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
  Report Audit key: ${reportKeyStatus()}
    `)
  })
}).catch(err => {
  console.error('Failed to initialize database:', err)
  process.exit(1)
})
