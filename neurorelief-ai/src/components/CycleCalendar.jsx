import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from './icons'
import { useFormat } from '../i18n/format'

// Month calendar of ESTIMATED cycle phases (phase colours only — no pain values; the 7-day pain estimate from the AI
// model is shown separately in PainForecastStrip). Future days repeat the logged cycle length. While a period is late
// the future phases are unknown, so they are not coloured.
const PHASE_STYLE = {
  Menstrual: { cell: 'bg-rose-100 text-rose-800 hover:bg-rose-200', dot: 'bg-rose-500', pill: 'bg-rose-50 text-rose-800' },
  Follicular: { cell: 'bg-sky-100 text-sky-800 hover:bg-sky-200', dot: 'bg-sky-500', pill: 'bg-sky-50 text-sky-800' },
  Ovulatory: { cell: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200', dot: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-800' },
  Luteal: { cell: 'bg-violet-100 text-violet-800 hover:bg-violet-200', dot: 'bg-violet-500', pill: 'bg-violet-50 text-violet-800' },
}
const phaseForDay = d => (d <= 5 ? 'Menstrual' : d <= 13 ? 'Follicular' : d <= 16 ? 'Ovulatory' : 'Luteal')   // same as lib/cycleMath.js

export default function CycleCalendar({ dayOfCycle, cycleLength = 28, daysLate = 0 }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const tPhase = ph => t(`phase.${ph}`, { defaultValue: ph })
  // 2023-01-01 is a Sunday; weekday names come from the selected locale
  const weekDays = Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + i).toLocaleDateString(fmt.locale, { weekday: 'short' }))
  const [monthOffset, setMonthOffset] = useState(0)
  const [selected, setSelected] = useState(null)   // { y, m, d }

  const now = new Date()
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const view = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const vy = view.getFullYear(), vm = view.getMonth()
  const daysInMonth = new Date(vy, vm + 1, 0).getDate()
  const firstDow = view.getDay()
  const monthName = view.toLocaleDateString(fmt.locale, { month: 'long', year: 'numeric' })
  const hasCycle = dayOfCycle != null
  const late = daysLate > 0

  const offsetOf = (y, m, d) => Math.round((new Date(y, m, d) - todayMid) / 86400000)
  // Estimated cycle day for a day `off` days from today (today and future only; not while the period is late)
  const cycleDayAt = off => {
    if (!hasCycle || off < 0 || late) return null
    return (((dayOfCycle + off - 1) % cycleLength) + cycleLength) % cycleLength + 1
  }
  const selOffset = selected ? offsetOf(selected.y, selected.m, selected.d) : null
  const selDay = selected ? cycleDayAt(selOffset) : null

  function go(delta) {
    setMonthOffset(o => o + delta)
    setSelected(null)
  }

  return (
    <section className="bg-white/90 rounded-2xl border border-brand-100/70 shadow-sm shadow-brand-100/50 p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="calendar" size={22} /></span>
          <div>
            <h3 className="font-display text-xl font-bold text-gray-900">{t('calendar.phaseTitle')}</h3>
            <p className="text-sm text-brand-600">{t('calendar.phaseSubtitle', { month: monthName })}</p>
          </div>
        </div>
        <ul className="flex flex-wrap gap-2 text-xs" aria-label={t('calendar.legend')}>
          {Object.entries(PHASE_STYLE).map(([ph, s]) => (
            <li key={ph} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${s.pill}`}><span className={`w-2 h-2 rounded-full ${s.dot}`} />{tPhase(ph)}</li>
          ))}
        </ul>
      </div>

      {!hasCycle && <p className="mb-4 text-sm text-brand-800 bg-brand-50 border border-brand-100 rounded-xl px-4 py-3">{t('calendar.logFirst')}</p>}
      {hasCycle && late && <p className="mb-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{t('calendar.lateNote', { count: daysLate })}</p>}

      <div className="flex items-center justify-end gap-2 mb-3">
        <button onClick={() => go(-1)} aria-label={t('calendar.prevMonth')}
          className="w-10 h-10 rounded-xl bg-gray-100 text-gray-600 hover:bg-brand-50 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"><Icon name="chevronLeft" size={18} /></button>
        <button onClick={() => { setMonthOffset(0); setSelected(null) }} disabled={monthOffset === 0}
          className="px-5 h-10 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium hover:bg-brand-50 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">{t('calendar.today')}</button>
        <button onClick={() => go(1)} aria-label={t('calendar.nextMonth')}
          className="w-10 h-10 rounded-xl bg-gray-100 text-gray-600 hover:bg-brand-50 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"><Icon name="chevron" size={18} /></button>
      </div>

      <div className="grid grid-cols-7 gap-1.5 sm:gap-2 mb-2">
        {weekDays.map((d, i) => <div key={i} className="text-center text-xs sm:text-sm font-medium text-gray-500 py-1">{d}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} className="h-11 sm:h-12" />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const d = i + 1
          const off = offsetOf(vy, vm, d)
          const isToday = off === 0
          const cd = cycleDayAt(off)
          const phase = cd ? phaseForDay(cd) : null
          const isSel = selected && selected.y === vy && selected.m === vm && selected.d === d
          const tone = phase ? PHASE_STYLE[phase].cell : 'bg-gray-100/80 text-gray-500'
          const dateLabel = new Date(vy, vm, d).toLocaleDateString(fmt.locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
          return (
            <button key={d} onClick={() => setSelected(isSel ? null : { y: vy, m: vm, d })}
              aria-label={phase ? t('calendar.dayPhase', { date: dateLabel, phase: tPhase(phase) }) : dateLabel}
              className={`relative h-11 sm:h-12 rounded-xl text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${tone} ${
                isToday ? 'ring-2 ring-brand-500' : ''} ${isSel ? 'ring-2 ring-purple-500' : ''}`}>
              {fmt.number(d)}
              {isToday && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-brand-500 rounded-full" />}
            </button>
          )
        })}
      </div>

      {selected && (
        <div className="mt-4 bg-purple-50 p-4 rounded-xl flex justify-between items-start gap-3" aria-live="polite">
          <div>
            <p className="font-semibold text-gray-900">
              {new Date(selected.y, selected.m, selected.d).toLocaleDateString(fmt.locale, { weekday: 'long', month: 'short', day: 'numeric' })}
            </p>
            <p className="text-sm text-gray-600 mt-1">
              {selDay ? t('calendar.cycleDayPhaseEst', { day: fmt.number(selDay), phase: tPhase(phaseForDay(selDay)) })
                : selOffset < 0 ? t('calendar.pastDay') : late ? t('calendar.lateDay') : t('calendar.logToSee')}
            </p>
          </div>
          <button onClick={() => setSelected(null)} aria-label={t('calendar.closeDetails')} className="text-gray-400 hover:text-gray-600"><Icon name="close" size={18} /></button>
        </div>
      )}
    </section>
  )
}
