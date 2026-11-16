/**
 * Pain Prediction Service — Connected to real backend
 * Calls POST /api/predict which runs the trained Random Forest model
 */

const BASE_URL = 'http://localhost:8000/api'

import { getSessionToken } from './session'

// The token of the account THIS tab is signed in as (see services/session.js)
const getToken = getSessionToken

export async function getPainPrediction(userFeatures) {
  const token = getToken()
  let res
  try {
    res = await fetch(`${BASE_URL}/predict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      // ?? (not ||): 0 is a real value on the model's 0-5 symptom scale ("Not at all") and must not become a default
      body: JSON.stringify({
        phase: userFeatures.phase ?? 'Follicular',
        day_from_last_menses: userFeatures.cycle_day ?? 14,
        sleep_hours: userFeatures.sleep_hours ?? 7,
        stress: userFeatures.stress_level ?? 3,
        fatigue: userFeatures.fatigue ?? 2,
        cramps: userFeatures.cramps ?? 2,
        headaches: userFeatures.headaches ?? 1,
        bloating: userFeatures.bloating ?? 1,
        moodswing: userFeatures.moodswing ?? 1,
        sleepissue: userFeatures.sleepissue ?? 1,
        activity_level: userFeatures.activity_level ?? 'Moderate',
        mood: userFeatures.mood ?? 'Calm',
        bmi: userFeatures.bmi ?? 22,
        age: userFeatures.age ?? 25
      })
    })

  } catch (err) {
    console.error('Prediction request failed:', err.message)
    throw new PredictionError('Could not reach the prediction service. Check that the server is running and try again.', undefined, 'network')
  }

  if (!res.ok) {
    console.error('Prediction request failed with HTTP', res.status)
    throw new PredictionError(
      res.status === 401 || res.status === 403
        ? 'Your session has expired. Please sign in again.'
        : 'The prediction service is unavailable right now. No prediction was made — please try again later.',
      res.status,
      res.status === 401 || res.status === 403 ? 'auth' : 'unavailable'
    )
  }

  let data
  try { data = await res.json() } catch { data = null }
  if (!data || !data.predicted_severity || data.probabilities == null) {
    throw new PredictionError('The prediction service returned an unexpected response. No prediction was made.', undefined, 'badResponse')
  }
  return data
}

export class PredictionError extends Error {
  // `code` ('network' | 'auth' | 'unavailable' | 'badResponse') lets the UI show a translated message
  constructor(message, status, code) {
    super(message)
    this.name = 'PredictionError'
    this.status = status
    this.code = code
  }
}

const LAST_PREDICTION_KEY = 'neurorelief_last_prediction'

// Saves the latest prediction for the Device Panel, tagged with the account it belongs to
export function storePrediction(prediction, userId) {
  try { localStorage.setItem(LAST_PREDICTION_KEY, JSON.stringify({ ...prediction, owner_id: userId, made_at: Date.now() })) } catch { /* storage unavailable */ }
}

export function clearStoredPrediction() {
  try { localStorage.removeItem(LAST_PREDICTION_KEY) } catch { /* storage unavailable */ }
}

// Only a prediction produced by the real model (it carries `probabilities`) AND made by this same account may drive
// the Device Panel or be used for calibration feedback (another account on this browser must not reuse it).
export function readStoredPrediction(userId) {
  try {
    const raw = localStorage.getItem(LAST_PREDICTION_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (p && p.probabilities != null && p.predicted_severity) {
      return userId != null && p.owner_id === userId ? p : null   // leave another account's entry in place
    }
  } catch { /* fall through and clear */ }
  clearStoredPrediction()
  return null
}

export async function getWellnessForecast(userId, days = 7) {
  const forecast = []
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.now() + i * 86400000)
    forecast.push({
      date: date.toLocaleDateString(),
      predicted_pain: Math.floor(Math.random() * 5) + 1,
      predicted_energy: Math.floor(Math.random() * 4) + 6,
      predicted_mood: Math.floor(Math.random() * 3) + 6
    })
  }
  return forecast
}
