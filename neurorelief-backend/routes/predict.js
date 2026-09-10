import { Router } from 'express'
import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { run, all } from '../db/database.js'
import { authenticateToken } from '../middleware/auth.js'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------
// PERSONAL CALIBRATION (Level 1)
// Learns a per-user offset between what the model predicts and what
// the user actually reports, WITHOUT retraining the model.
//
//   offset = mean(actual_pain - base_predicted_score)
//
// Guards:
//   - needs MIN_SESSIONS observations before it is applied
//   - offset clamped to +/- MAX_OFFSET so one bad entry cannot run away
//   - feedback is always recorded against the RAW model score, never a
//     previously calibrated one, otherwise the offset compounds
// ---------------------------------------------------------------
const MIN_SESSIONS = 5;
const MAX_OFFSET   = 3;
const WINDOW       = 20;   // most recent N observations

function ensureCalTable() {
  run(`CREATE TABLE IF NOT EXISTS calibration (
    cal_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    base_score REAL NOT NULL,
    actual_pain REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, [])
}

function getCalibration(userId) {
  ensureCalTable()
  const rows = all(
    'SELECT base_score, actual_pain FROM calibration WHERE user_id = ? ORDER BY cal_id DESC LIMIT ?',
    [userId, WINDOW]
  )
  const n = rows.length
  if (n === 0) return { offset: 0, n: 0, active: false }

  let sum = 0
  for (const r of rows) sum += (r.actual_pain - r.base_score)
  let offset = sum / n
  offset = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, offset))
  offset = Math.round(offset * 10) / 10

  return { offset, n, active: n >= MIN_SESSIONS && Math.abs(offset) >= 0.5 }
}

function scoreToLabel(v) {
  if (v <= 3) return 'Low'
  if (v <= 6) return 'Moderate'
  return 'High'
}

const router = Router()
router.use(authenticateToken)

router.post('/', (req, res) => {
  const {
    phase = 'Follicular', day_from_last_menses = 14, sleep_hours = 7,
    stress = 3, fatigue = 2, cramps = 2, headaches = 1, bloating = 1,
    moodswing = 1, sleepissue = 1, activity_level = 'Moderate',
    mood = 'Calm', bmi = 22, age = 25
  } = req.body

  try {
    const scriptPath = path.join(__dirname, '..', 'predict.py')
    const modelPath = path.resolve(__dirname, '..', '..', 'neurorelief-ml', 'neurorelief_model.pkl')

    if (!fs.existsSync(modelPath)) {
      console.error('Model not found at:', modelPath)
      return res.status(500).json({ error: 'Model file not found', path: modelPath })
    }

    // Write input to temp file
    const tempFile = path.join(__dirname, '..', '_temp_predict.json')
    const inputData = {
      features: { phase, day_from_last_menses, sleep_hours, stress, fatigue, cramps, headaches, bloating, moodswing, sleepissue, activity_level, mood, bmi, age },
      model_path: modelPath
    }
    fs.writeFileSync(tempFile, JSON.stringify(inputData))

    // Call Python with file path as argument — no quotes or stdin issues
    const cmd = `py -3.14 "${scriptPath}" "${tempFile}"`
    console.log('Running:', cmd)
    
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 30000 })
    console.log('Python output:', result.trim())

    // Cleanup
    try { fs.unlinkSync(tempFile) } catch {}

    const prediction = JSON.parse(result.trim())

    // ---- always keep the raw model output for honest feedback ----
    prediction.base_severity       = prediction.predicted_severity
    prediction.base_severity_score = prediction.severity_score

    // ---- apply personal calibration if enough history exists ----
    const cal = getCalibration(req.userId)
    if (cal.active) {
      const adj = Math.max(0, Math.min(10, prediction.severity_score + cal.offset))
      const adjLabel = scoreToLabel(adj)

      prediction.severity_score     = Math.round(adj * 10) / 10
      prediction.predicted_severity = adjLabel
      prediction.risk_level         = adjLabel.toLowerCase()

      // therapy parameters recomputed from the calibrated score,
      // still algebraically bounded to the safe ranges
      prediction.recommended_tens_intensity = Math.min(100, Math.round(adj * 12))
      prediction.recommended_tens_frequency = adj > 5 ? 100 : 50
      prediction.recommended_heat_temp      = Math.round((38 + Math.min(4, adj * 0.4)) * 10) / 10
      prediction.recommendation = {
        Low:      'Low pain expected. Continue current routine.',
        Moderate: 'Moderate pain likely. Consider preemptive therapy.',
        High:     'High pain predicted. Prepare TENS and heat therapy.'
      }[adjLabel]
    }

    prediction.calibration = {
      applied:  cal.active,
      offset:   cal.offset,
      sessions: cal.n,
      needed:   MIN_SESSIONS
    }

    // Save to database
    run(
      'INSERT INTO predictions (user_id, date, predicted_severity, confidence, recommended_tens_intensity, recommended_heat_temp, input_features) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.userId, new Date().toISOString().split('T')[0], prediction.predicted_severity, prediction.confidence, prediction.recommended_tens_intensity, prediction.recommended_heat_temp, JSON.stringify(inputData.features)]
    )

    res.json(prediction)
  } catch (err) {
    console.error('Prediction error:', err.message)
    if (err.stderr) console.error('Python stderr:', err.stderr)
    res.status(500).json({ error: 'Prediction failed', details: err.message })
  }
})


// POST /api/predict/feedback  { base_score, actual_pain }
// Called after a therapy session, recording what she actually felt.
router.post('/feedback', (req, res) => {
  const { base_score, actual_pain } = req.body
  if (base_score == null || actual_pain == null) {
    return res.status(400).json({ error: 'base_score and actual_pain are required' })
  }
  if (actual_pain < 0 || actual_pain > 10) {
    return res.status(400).json({ error: 'actual_pain must be 0-10' })
  }
  ensureCalTable()
  run('INSERT INTO calibration (user_id, base_score, actual_pain) VALUES (?, ?, ?)',
      [req.userId, base_score, actual_pain])
  const cal = getCalibration(req.userId)
  res.status(201).json({ message: 'Feedback recorded', calibration: cal })
})

// GET /api/predict/calibration
router.get('/calibration', (req, res) => {
  const cal = getCalibration(req.userId)
  res.json({ ...cal, needed: MIN_SESSIONS, maxOffset: MAX_OFFSET })
})

router.get('/history', (req, res) => {
  const predictions = all('SELECT * FROM predictions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [req.userId])
  res.json(predictions)
})

export default router
