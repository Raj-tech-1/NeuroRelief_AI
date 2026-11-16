import { Router } from 'express'
import { all, get, run } from '../db/database.js'
import { authenticateToken, requireRole } from '../middleware/auth.js'
import { isoDay } from '../lib/appointmentRules.js'

const router = Router()
router.use(authenticateToken)
router.use(requireRole('user'))   // patient-only: a patient's own records

router.get('/', (req, res) => {
  const cycles = all('SELECT * FROM menstrual_cycles WHERE user_id = ? ORDER BY start_date DESC', [req.userId])

  let currentData = null
  if (cycles.length > 0) {
    const latest = cycles[0]
    // Whole-day arithmetic on calendar dates: both as UTC midnight, with "today" taken from the LOCAL calendar
    const startDate = new Date(latest.start_date + 'T00:00:00Z')
    const today = new Date(isoDay(new Date()) + 'T00:00:00Z')
    const dayOfCycle = Math.round((today - startDate) / 86400000) + 1
    const cycleLength = latest.cycle_length || 28

    let phase = 'Unknown'
    if (dayOfCycle <= 5) phase = 'Menstrual'
    else if (dayOfCycle <= 13) phase = 'Follicular'
    else if (dayOfCycle <= 16) phase = 'Ovulatory'
    else phase = 'Luteal'

    const DAY = 86400000
    const nextPeriodDate = new Date(startDate.getTime() + cycleLength * DAY)
    const daysUntilPeriod = Math.max(0, Math.ceil((nextPeriodDate - today) / DAY))
    // Expected start is day (cycleLength + 1); every day after that without a new period logged is "late"
    const daysLate = Math.max(0, dayOfCycle - cycleLength - 1)
    const iso = d => d.toISOString().split('T')[0]   // dates are UTC midnight, so this is the calendar date

    // Fertile window (days 9-15). Once this cycle's window has passed, show the next cycle's projected window;
    // while the period is late the next window cannot be estimated, so none is shown (never a past window).
    let fertileWindow = null
    const thisStart = new Date(startDate.getTime() + 8 * DAY), thisEnd = new Date(startDate.getTime() + 14 * DAY)
    if (today <= thisEnd) fertileWindow = { start: iso(thisStart), end: iso(thisEnd), upcoming: today < thisStart }
    else if (!daysLate) fertileWindow = { start: iso(new Date(thisStart.getTime() + cycleLength * DAY)), end: iso(new Date(thisEnd.getTime() + cycleLength * DAY)), upcoming: true }

    currentData = {
      currentPhase: phase, dayOfCycle, cycleLength, nextPeriod: daysUntilPeriod,
      periodLate: daysLate > 0, daysLate,
      fertileWindow, lastCycle: latest,
    }
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
