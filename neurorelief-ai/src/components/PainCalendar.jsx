import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from './icons'
import { useFormat } from '../i18n/format'

// Cell colour per predicted pain level
function painStyle(pain) {
  if (pain <= 2) return 'bg-green-100 text-green-800 hover:bg-green-200'
  if (pain <= 4) return 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
  if (pain <= 6) return 'bg-orange-100 text-orange-800 hover:bg-orange-200'
  return 'bg-red-100 text-red-800 hover:bg-red-200'
}

// returns the internal level key (Low | Mild | Moderate | High); it is translated at display time via pain.<key>
function painLabel(pain) {
  if (pain <= 2) return 'Low'
  if (pain <= 4) return 'Mild'
  if (pain <= 6) return 'Moderate'
  return 'High'
}

// Predict pain for a date from its position in the cycle (rule of thumb based on the usual
// phase pattern; this is NOT the machine-learning model).
function predictFor(dayOffset, dayNum, dayOfCycle, cycleLength) {
  const cycleDay = (((dayOfCycle + dayOffset - 1) % cycleLength) + cycleLength) % cycleLength + 1
  let pain = 1
  if (cycleDay <= 2) pain = 8
  else if (cycleDay <= 5) pain = 6
  else if (cycleDay <= 7) pain = 3
  else if (cycleDay <= 13) pain = 1
  else if (cycleDay <= 16) pain = 1
  else if (cycleDay <= 22) pain = 2
  else if (cycleDay <= 25) pain = 3
  else pain = 5
  pain += Math.sin(dayNum * 0.7) > 0.5 ? 1 : 0
  return {
    pain: Math.min(10, Math.max(0, pain)),
    cycleDay,
    phase: cycleDay <= 5 ? 'Menstrual' : cycleDay <= 13 ? 'Follicular' : cycleDay <= 16 ? 'Ovulatory' : 'Luteal',
  }
}

export default function PainCalendar({ dayOfCycle, cycleLength = 28 }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const tPain = pain => t(`pain.${painLabel(pain)}`)
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

  const offsetOf = (y, m, d) => Math.round((new Date(y, m, d) - todayMid) / 86400000)
  const selOffset = selected ? offsetOf(selected.y, selected.m, selected.d) : null
  const selPred = selected && hasCycle && selOffset >= 0 ? predictFor(selOffset, selected.d, dayOfCycle, cycleLength) : null

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
            <h3 className="font-display text-xl font-bold text-gray-900">{t('calendar.title')}</h3>
            <p className="text-sm text-brand-600">{t('calendar.subtitle', { month: monthName })}</p>
          </div>
        </div>
        <ul className="flex flex-wrap gap-2 text-xs" aria-label={t('calendar.legend')}>
          {[['Low', 'bg-green-500', 'bg-green-50 text-green-800'], ['Mild', 'bg-yellow-400', 'bg-yellow-50 text-yellow-800'], ['Moderate', 'bg-orange-400', 'bg-orange-50 text-orange-800'], ['High', 'bg-red-500', 'bg-red-50 text-red-700']].map(([l, dot, pill]) => (
            <li key={l} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${pill}`}><span className={`w-2 h-2 rounded-full ${dot}`} />{t(`pain.${l}`)}</li>
          ))}
        </ul>
      </div>

      {!hasCycle && (
        <p className="mb-4 text-sm text-brand-800 bg-brand-50 border border-brand-100 rounded-xl px-4 py-3">
          {t('calendar.logFirst')}
        </p>
      )}

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
          const isPast = off < 0
          const pred = !isPast && hasCycle ? predictFor(off, d, dayOfCycle, cycleLength) : null
          const isSel = selected && selected.y === vy && selected.m === vm && selected.d === d
          const tone = pred ? painStyle(pred.pain) : 'bg-gray-100/80 text-gray-500'
          return (
            <button key={d} onClick={() => setSelected(isSel ? null : { y: vy, m: vm, d })}
              aria-label={pred ? t('calendar.dayPredicted', { date: new Date(vy, vm, d).toLocaleDateString(fmt.locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), label: tPain(pred.pain) }) : new Date(vy, vm, d).toLocaleDateString(fmt.locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              className={`relative h-11 sm:h-12 rounded-xl text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${tone} ${
                isToday ? 'ring-2 ring-brand-500 bg-white' : ''} ${isSel ? 'ring-2 ring-purple-500' : ''}`}>
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
            {selPred ? (
              <>
                <p className="text-sm text-gray-600 mt-1">{t('calendar.cycleDayPhase', { day: fmt.number(selPred.cycleDay), phase: tPhase(selPred.phase) })}</p>
                <p className="text-sm mt-2">
                  {t('calendar.estimated')}: <span className={`font-bold ${selPred.pain <= 3 ? 'text-green-600' : selPred.pain <= 6 ? 'text-orange-600' : 'text-red-600'}`}>
                    {t('calendar.painLine', { label: tPain(selPred.pain), pain: fmt.number(selPred.pain) })}
                  </span>
                </p>
                {selPred.pain > 5 && (
                  <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><Icon name="bulb" size={14} /> {t('calendar.prepare')}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-600 mt-1">{selOffset < 0 ? t('calendar.pastDay') : t('calendar.logToSee')}</p>
            )}
          </div>
          <button onClick={() => setSelected(null)} aria-label={t('calendar.closeDetails')} className="text-gray-400 hover:text-gray-600"><Icon name="close" size={18} /></button>
        </div>
      )}
    </section>
  )
}
