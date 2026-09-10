import { Router } from 'express'
import { all, get, run } from '../db/database.js'
import { authenticateToken } from '../middleware/auth.js'

const router = Router()
router.use(authenticateToken)

router.get('/', (req, res) => {
  const cycles = all('SELECT * FROM menstrual_cycles WHERE user_id = ? ORDER BY start_date DESC', [req.userId])

  let currentData = null
  if (cycles.length > 0) {
    const latest = cycles[0]
    const startDate = new Date(latest.start_date)
    const today = new Date()
    const dayOfCycle = Math.floor((today - startDate) / 86400000) + 1
    const cycleLength = latest.cycle_length || 28

    let phase = 'Unknown'
    if (dayOfCycle <= 5) phase = 'Menstrual'
    else if (dayOfCycle <= 13) phase = 'Follicular'
    else if (dayOfCycle <= 16) phase = 'Ovulatory'
    else phase = 'Luteal'

    const nextPeriodDate = new Date(startDate.getTime() + cycleLength * 86400000)
    const daysUntilPeriod = Math.max(0, Math.ceil((nextPeriodDate - today) / 86400000))
    const fertileStart = new Date(startDate.getTime() + 8 * 86400000)
    const fertileEnd = new Date(startDate.getTime() + 14 * 86400000)
    const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

    currentData = { currentPhase: phase, dayOfCycle, nextPeriod: daysUntilPeriod, fertileWindow: { start: fmt(fertileStart), end: fmt(fertileEnd) }, lastCycle: latest }
  }

  res.json({ cycles, currentData })
})

router.post('/', (req, res) => {
  const { start_date, end_date, cycle_length, flow, mood, notes } = req.body
  if (!start_date) return res.status(400).json({ error: 'Start date is required' })

  const result = run(
    'INSERT INTO menstrual_cycles (user_id, start_date, end_date, cycle_length, flow, mood, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.userId, start_date, end_date || null, cycle_length || 28, flow || 'Medium', mood || null, notes || null]
  )
  res.status(201).json({ cycle_id: result.lastInsertRowid, message: 'Cycle saved' })
})

router.delete('/:id', (req, res) => {
  run('DELETE FROM menstrual_cycles WHERE cycle_id = ? AND user_id = ?', [req.params.id, req.userId])
  res.json({ message: 'Cycle deleted' })
})

export default router
