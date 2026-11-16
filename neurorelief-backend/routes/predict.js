import { Router } from 'express'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { run, all, get } from '../db/database.js'
import { authenticateToken, requireRole } from '../middleware/auth.js'
import { isoDay } from '../lib/appointmentRules.js'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const execFileAsync = promisify(execFile)

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
// The calibration table is created once at startup (db/database.js initDB).
// ---------------------------------------------------------------
const MIN_SESSIONS = 5;
const MAX_OFFSET   = 3;
const WINDOW       = 20;   // most recent N observations

function getCalibration(userId) {
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

// A real number in [0, 10]; rejects strings, booleans, NaN and Infinity.
const isScore = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10

// PYTHON_CMD may be "py -3.13", "python3" or a quoted path with spaces: split it into the program and its arguments.
function pythonCommand() {
  const raw = process.env.PYTHON_CMD || 'py -3.13'
  const parts = [...raw.matchAll(/"([^"]+)"|(\S+)/g)].map(m => m[1] ?? m[2])
  return { file: parts[0], args: parts.slice(1) }
}

const router = Router()
router.use(authenticateToken)
router.use(requireRole('user'))   // patient-only: a patient's own records

router.post('/', async (req, res) => {
  const {
    phase = 'Follicular', day_from_last_menses = 14, sleep_hours = 7,
    stress = 3, fatigue = 2, cramps = 2, headaches = 1, bloating = 1,
    moodswing = 1, sleepissue = 1, activity_level = 'Moderate',
    mood = 'Calm'
  } = req.body
  // Age and BMI come from the patient's saved profile, never from the request; the model's defaults when missing
  const me = get('SELECT age, bmi FROM users WHERE user_id = ?', [req.userId]) || {}
  const age = me.age ?? 25, bmi = me.bmi ?? 22
  const inputsUsed = { age, bmi, ageSource: me.age != null ? 'profile' : 'default', bmiSource: me.bmi != null ? 'profile' : 'default' }

  const scriptPath = path.join(__dirname, '..', 'predict.py')
  const modelPath = path.resolve(__dirname, '..', '..', 'neurorelief-ml', 'neurorelief_model.pkl')
  // One temp file per request (outside the project), so concurrent predictions cannot overwrite each other's input
  const tempFile = path.join(os.tmpdir(), `neurorelief-predict-${crypto.randomUUID()}.json`)

  try {
    if (!fs.existsSync(modelPath)) {
      console.error('Model not found at:', modelPath)
      return res.status(500).json({ error: 'Prediction failed' })
    }

    const inputData = {
      features: { phase, day_from_last_menses, sleep_hours, stress, fatigue, cramps, headaches, bloating, moodswing, sleepissue, activity_level, mood, bmi, age },
      model_path: modelPath
    }
    fs.writeFileSync(tempFile, JSON.stringify(inputData))

    // Runs asynchronously (no shell), so a slow prediction does not block other requests
    const { file, args } = pythonCommand()
    let stdout
    try {
      ({ stdout } = await execFileAsync(file, [...args, scriptPath, tempFile], { encoding: 'utf-8', timeout: 30000, windowsHide: true }))
    } finally {
      fs.promises.unlink(tempFile).catch(() => {})
    }

    const prediction = JSON.parse(stdout.trim())

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

    prediction.inputs_used = inputsUsed

    prediction.calibration = {
      applied:  cal.active,
      offset:   cal.offset,
      sessions: cal.n,
      needed:   MIN_SESSIONS
    }

    // Save to database, including the RAW model score so feedback can be checked against it later
    const saved = run(
      'INSERT INTO predictions (user_id, date, predicted_severity, confidence, recommended_tens_intensity, recommended_heat_temp, input_features, base_severity_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [req.userId, isoDay(new Date()), prediction.predicted_severity, prediction.confidence, prediction.recommended_tens_intensity, prediction.recommended_heat_temp, JSON.stringify(inputData.features), prediction.base_severity_score]
    )
    prediction.pred_id = saved.lastInsertRowid

    res.json(prediction)
  } catch (err) {
    console.error('Prediction error:', err.message)
    if (err.stderr) console.error('Python stderr:', err.stderr)
    res.status(500).json({ error: 'Prediction failed' })
  }
})


// POST /api/predict/feedback  { pred_id?, base_score, actual_pain }
// Called after a therapy session, recording the pain she actually reported.
// The offset is always learned against the RAW model score: when pred_id is given, the raw score stored with that
// prediction is used (the client's base_score is ignored), so a calibrated score can never be fed back in.
router.post('/feedback', (req, res) => {
  const { pred_id, actual_pain } = req.body
  let { base_score } = req.body

  if (!isScore(actual_pain)) {
    return res.status(400).json({ error: 'actual_pain must be a number from 0 to 10' })
  }
  if (pred_id != null) {
    const row = Number.isInteger(pred_id) && pred_id > 0
      ? get('SELECT base_severity_score FROM predictions WHERE pred_id = ? AND user_id = ?', [pred_id, req.userId])
      : null
    if (!row) return res.status(404).json({ error: 'Prediction not found' })
    if (row.base_severity_score != null) base_score = row.base_severity_score
  }
  if (!isScore(base_score)) {
    return res.status(400).json({ error: 'base_score must be a number from 0 to 10' })
  }

  run('INSERT INTO calibration (user_id, base_score, actual_pain) VALUES (?, ?, ?)',
      [req.userId, base_score, actual_pain])
  const cal = getCalibration(req.userId)
  res.status(201).json({ message: 'Feedback recorded', calibration: { ...cal, sessions: cal.n, needed: MIN_SESSIONS } })
})

// GET /api/predict/calibration
router.get('/calibration', (req, res) => {
  const cal = getCalibration(req.userId)
  res.json({ ...cal, sessions: cal.n, needed: MIN_SESSIONS, maxOffset: MAX_OFFSET })
})

router.get('/history', (req, res) => {
  const predictions = all('SELECT * FROM predictions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [req.userId])
  res.json(predictions)
})

export default router
