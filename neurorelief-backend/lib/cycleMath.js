// Cycle-day arithmetic shared by /api/cycles and the 7-day forecast (/api/predict/forecast), so both agree.
import { isoDay } from './appointmentRules.js'

export const DAY_MS = 86400000

// App phase names. The model calls the ovulatory phase "Fertility".
export function phaseForDay(day) {
  if (day <= 5) return 'Menstrual'
  if (day <= 13) return 'Follicular'
  if (day <= 16) return 'Ovulatory'
  return 'Luteal'
}
export const modelPhase = phase => (phase === 'Ovulatory' ? 'Fertility' : phase)

// Position of "today" (LOCAL calendar date) in the cycle that started on startDate (YYYY-MM-DD).
export function cyclePosition(startDate, cycleLength = 28, now = new Date()) {
  const start = new Date(startDate + 'T00:00:00Z')
  const today = new Date(isoDay(now) + 'T00:00:00Z')
  const dayOfCycle = Math.round((today - start) / DAY_MS) + 1
  // Expected start of the next period is day (cycleLength + 1); every day after that is "late"
  const daysLate = Math.max(0, dayOfCycle - cycleLength - 1)
  return { start, today, dayOfCycle, cycleLength, daysLate }
}
