/**
 * Pain Prediction Service — Connected to real backend
 * Calls POST /api/predict which runs the trained Random Forest model
 */

const BASE_URL = 'http://localhost:8000/api'

function getToken() {
  const user = localStorage.getItem('neurorelief_user')
  if (!user) return null
  try { return JSON.parse(user).token } catch { return null }
}

export async function getPainPrediction(userFeatures) {
  const token = getToken()
  try {
    const res = await fetch(`${BASE_URL}/predict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        phase: userFeatures.phase || 'Follicular',
        day_from_last_menses: userFeatures.cycle_day || 14,
        sleep_hours: userFeatures.sleep_hours || 7,
        stress: userFeatures.stress_level || 3,
        fatigue: userFeatures.fatigue || 2,
        cramps: userFeatures.cramps || 2,
        headaches: userFeatures.headaches || 1,
        bloating: userFeatures.bloating || 1,
        moodswing: userFeatures.moodswing || 1,
        sleepissue: userFeatures.sleepissue || 1,
        activity_level: userFeatures.activity_level || 'Moderate',
        mood: userFeatures.mood || 'Calm',
        bmi: userFeatures.bmi || 22,
        age: userFeatures.age || 25
      })
    })

    if (!res.ok) throw new Error('Prediction request failed')
    return await res.json()

  } catch (err) {
    console.error('ML prediction failed, using fallback:', err.message)
    // Fallback if backend/ML is down
    const { stress_level = 5, sleep_hours = 7, cycle_day = 14 } = userFeatures || {}
    let severity = 2
    if (cycle_day <= 5) severity += 3
    if (sleep_hours < 6) severity += 2
    if (stress_level > 7) severity += 2
    severity = Math.min(10, Math.max(0, severity))

    return {
      predicted_severity: severity <= 3 ? 'Low' : severity <= 6 ? 'Moderate' : 'High',
      severity_score: severity,
      confidence: 0.5,
      risk_level: severity <= 3 ? 'low' : severity <= 6 ? 'moderate' : 'high',
      recommended_tens_intensity: Math.min(100, severity * 12),
      recommended_tens_frequency: severity > 5 ? 100 : 50,
      recommended_heat_temp: 38 + Math.min(4, severity * 0.4),
      recommendation: 'Backend unavailable — using fallback prediction.'
    }
  }
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
