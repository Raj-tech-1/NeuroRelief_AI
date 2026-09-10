import { Router } from 'express'
import { all, get, run } from '../db/database.js'
import { authenticateToken } from '../middleware/auth.js'

const router = Router()
router.use(authenticateToken)

router.get('/', (req, res) => {
  const records = all('SELECT * FROM wellness_records WHERE user_id = ? ORDER BY date DESC LIMIT 30', [req.userId])
  const today = new Date().toISOString().split('T')[0]
  const todayEntry = records.find(r => r.date === today) || null

  let trend = "Start tracking your mood to see patterns."
  let tips = ['Log your mood daily', 'Track your sleep quality', 'Note your energy levels']

  if (records.length >= 3) {
    const avgEnergy = records.reduce((s, r) => s + (r.energy || 5), 0) / records.length
    const avgStress = records.reduce((s, r) => s + (r.stress || 5), 0) / records.length
    if (avgEnergy >= 7 && avgStress <= 4) trend = "Your mood has been generally positive with good energy levels."
    else if (avgEnergy >= 5) trend = "Your energy is moderate. Try to get more rest and stay active."
    else trend = "Your energy has been low recently. Prioritize sleep and self-care."
    tips = []
    if (avgStress > 5) tips.push('Try deep breathing exercises to reduce stress')
    if (avgEnergy < 5) tips.push('A short walk can help boost your energy')
    tips.push('Stay hydrated throughout the day')
    tips.push('Connect with a friend or loved one')
  }

  // ---- rolling 7-day averages: uses accumulated history, not just today ----
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
  const recentRecords = records.filter(r => r.date >= cutoff)
  const avg = (arr, k) => {
    const vals = arr.map(r => r[k]).filter(v => v !== null && v !== undefined)
    if (!vals.length) return null
    return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10
  }

  const recent = {
    daysLogged: recentRecords.length,
    avgEnergy: avg(recentRecords, 'energy'),
    avgStress: avg(recentRecords, 'stress'),
    avgSleep:  avg(recentRecords, 'sleep_quality')
  }

  res.json({
    records,
    todayEntry,
    todayLogged: !!todayEntry,
    recent,
    totalRecords: records.length,
    patterns: { trend, tips }
  })
})

router.post('/', (req, res) => {
  const { mood, energy, stress, sleep_quality, sleep_hours, note } = req.body
  const date = new Date().toISOString().split('T')[0]

  const existing = get('SELECT record_id FROM wellness_records WHERE user_id = ? AND date = ?', [req.userId, date])

  if (existing) {
    run('UPDATE wellness_records SET mood=?, energy=?, stress=?, sleep_quality=?, sleep_hours=?, note=? WHERE record_id=?',
      [mood, energy, stress, sleep_quality, sleep_hours || null, note || null, existing.record_id])
    res.json({ record_id: existing.record_id, message: 'Mood updated' })
  } else {
    const result = run(
      'INSERT INTO wellness_records (user_id, date, mood, energy, stress, sleep_quality, sleep_hours, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [req.userId, date, mood, energy, stress, sleep_quality, sleep_hours || null, note || null])
    res.status(201).json({ record_id: result.lastInsertRowid, message: 'Mood saved' })
  }
})

export default router
