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
import { createCareRouter } from './routes/care.js'
import * as reportSvc from './lib/reportService.js'

// Import routes
import authRoutes from './routes/auth.js'
import cycleRoutes from './routes/cycles.js'
import moodRoutes from './routes/mood.js'
import predictRoutes from './routes/predict.js'
import doctorRoutes from './routes/doctors.js'
import scanRoutes from './routes/scans.js'
import assistantRoutes from './routes/assistant.js'
import adminRoutes from './routes/admin.js'
import { createJournalRouter } from './routes/journal.js'
import { createTherapyPlanRouter } from './routes/therapyPlan.js'

const app = express()
const PORT = process.env.PORT || 8000

// Middleware
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3000'], credentials: true }))
// No global body parser: each router parses its own JSON, so the per-router limits in /api/reports (64 KB, 8 MB for
// uploads) and /api/care (32 KB) really apply, and those two only parse a body AFTER the user is authenticated.
const json = express.json()   // default 100 KB limit

// Routes
app.use('/api/auth', json, authRoutes)
app.use('/api/cycles', json, cycleRoutes)
app.use('/api/mood', json, moodRoutes)
app.use('/api/predict', json, predictRoutes)
app.use('/api/doctors', json, doctorRoutes)
app.use('/api/scans', json, scanRoutes)
app.use('/api/assistant', json, assistantRoutes)
app.use('/api/admin', json, adminRoutes)
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

// Patient <-> doctor synchronisation: inert (generic 503) until the clinical-sync schema has been applied
// (scripts/migrate-clinical.js). Notes and messages are encrypted with the same key as Report Audit.
const reportCtx = { db: { all, get, run, transaction }, key: () => (reportKey ??= loadMasterKey()), now: () => new Date(), files: reportFiles }
app.use('/api/care', createCareRouter({
  authenticate: authenticateToken,
  ctx: { db: { all, get, run, transaction }, key: () => (reportKey ??= loadMasterKey()), now: () => new Date() },
  // Reports awaiting review for the doctor dashboard, only when Report Audit itself is enabled
  reportSummary: doctorId => (reportSvc.featureStatus(reportCtx).enabled ? reportSvc.doctorInboxSummary(reportCtx, doctorId) : null),
}))

// Relief Journal (patients). Medicine names and notes are encrypted with the same key as Report Audit; without the key,
// entries can still be saved without those fields.
app.use('/api/journal', createJournalRouter({
  authenticate: authenticateToken,
  ctx: { db: { all, get, run, transaction }, key: () => (reportKey ??= loadMasterKey()), now: () => new Date() },
}))

// Doctor therapy plans and the effective heat/TENS limits (heat limits are hard caps; see lib/therapyLimits.js)
app.use('/api/therapy-plan', createTherapyPlanRouter({
  authenticate: authenticateToken,
  ctx: { db: { all, get, run, transaction }, key: () => (reportKey ??= loadMasterKey()), now: () => new Date() },
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
  Endpoints: /api/auth /api/cycles /api/mood /api/predict /api/doctors /api/scans /api/reports /api/care
  Report Audit key: ${reportKeyStatus()}
    `)
  })
}).catch(err => {
  console.error('Failed to initialize database:', err)
  process.exit(1)
})
