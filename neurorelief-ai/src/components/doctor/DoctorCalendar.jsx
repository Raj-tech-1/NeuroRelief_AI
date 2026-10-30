import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../../i18n/format'
import { Icon } from '../icons'
import RequestRow from './RequestRow'
import { todayLocal, isoOf, byWhen } from './helpers'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Month calendar built only from the doctor's existing requests. Pending and confirmed requests are shown;
// declined and cancelled ones are not (see dd.calNote). Nothing here creates or edits appointments.
export default function DoctorCalendar({ list, busyId, onDecide }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const today = todayLocal()
  const [cursor, setCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }))
  const [selected, setSelected] = useState(today)

  const byDate = useMemo(() => {
    const map = {}
    for (const r of list) if (r.status === 'pending' || r.status === 'accepted') (map[r.date] ||= []).push(r)
    for (const k of Object.keys(map)) map[k].sort(byWhen)
    return map
  }, [list])

  // Until the doctor navigates, follow the data: stay on today if it has appointments, otherwise show the
  // month and day of the next pending/confirmed appointment (so a request for next month is not hidden).
  const [touched, setTouched] = useState(false)
  const hasToday = !!byDate[today]
  const nextDate = useMemo(() => Object.keys(byDate).sort().find(d => d >= today) || null, [byDate, today])
  useEffect(() => {
    if (touched) return
    const target = hasToday ? today : (nextDate || today)
    setSelected(target)
    setCursor({ y: Number(target.slice(0, 4)), m: Number(target.slice(5, 7)) - 1 })
  }, [touched, hasToday, nextDate, today])

  const first = new Date(cursor.y, cursor.m, 1)
  const gridStart = new Date(cursor.y, cursor.m, 1 - first.getDay())
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
    return { iso: isoOf(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), inMonth: d.getMonth() === cursor.m }
  })
  // The last row is dropped when it falls entirely outside the month
  const shown = cells[35].inMonth ? cells : cells.slice(0, 35)

  const monthLabel = fmt.date(new Date(cursor.y, cursor.m, 1), { month: 'long', year: 'numeric' })
  const move = delta => { setTouched(true); const d = new Date(cursor.y, cursor.m + delta, 1); setCursor({ y: d.getFullYear(), m: d.getMonth() }) }
  const goToday = () => { setTouched(true); setCursor({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }); setSelected(today) }
  const pick = c => { setTouched(true); setSelected(c.iso); if (!c.inMonth) setCursor({ y: Number(c.iso.slice(0, 4)), m: Number(c.iso.slice(5, 7)) - 1 }) }

  const dayList = byDate[selected] || []

  return (
    <div className="space-y-4">
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5" aria-labelledby="cal-h">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 id="cal-h" className="font-bold text-slate-900">{t('dd.calTitle')}</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => move(-1)} aria-label={t('dd.calPrev')} className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-100"><Icon name="chevron" size={16} className="rotate-180" /></button>
            <p className="min-w-[8.5rem] text-center font-semibold text-slate-800" aria-live="polite">{monthLabel}</p>
            <button onClick={() => move(1)} aria-label={t('dd.calNext')} className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-100"><Icon name="chevron" size={16} /></button>
            <button onClick={goToday} className="px-3 py-1.5 rounded-lg border border-teal-300 text-teal-700 text-sm font-semibold hover:bg-teal-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-100">{t('dd.calToday')}</button>
          </div>
        </div>

        <div role="group" aria-label={t('dd.calGridLabel', { month: monthLabel })}>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map(w => <p key={w} className="text-center text-[11px] sm:text-xs font-semibold text-slate-500 py-1">{fmt.weekday(w)}</p>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {shown.map(c => {
              const items = byDate[c.iso] || []
              const isToday = c.iso === today, isSel = c.iso === selected
              return (
                <button key={c.iso} onClick={() => pick(c)} aria-pressed={isSel}
                  aria-label={`${fmt.date(c.iso + 'T12:00:00', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${items.length ? '. ' + t('dd.calCount', { n: fmt.number(items.length) }) : ''}`}
                  className={`min-w-0 min-h-[3.4rem] sm:min-h-[5.6rem] rounded-lg border p-1 sm:p-1.5 text-left flex flex-col gap-0.5 transition focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-200 ${
                    isSel ? 'border-teal-500 bg-teal-50' : c.inMonth ? 'border-slate-200 bg-white hover:bg-slate-50' : 'border-transparent bg-slate-50/70 text-slate-400 hover:bg-slate-100'}`}>
                  <span className={`self-start text-xs font-semibold leading-none px-1.5 py-1 rounded-full ${isToday ? 'bg-teal-600 text-white' : c.inMonth ? 'text-slate-800' : 'text-slate-400'}`}>{fmt.number(c.day)}</span>
                  <span className="hidden sm:flex flex-col gap-0.5 min-w-0">
                    {items.slice(0, 2).map(r => (
                      <span key={r.appointment_id} className={`truncate text-[11px] leading-tight rounded px-1 py-0.5 ${r.status === 'pending' ? 'border border-dashed border-amber-400 bg-amber-50 text-amber-900' : 'bg-teal-100 text-teal-900'}`}>
                        {fmt.time(r.time)} {r.patient_name}
                      </span>
                    ))}
                    {items.length > 2 && <span className="text-[11px] text-slate-500 px-1">{t('dd.more', { n: fmt.number(items.length - 2) })}</span>}
                  </span>
                  {items.length > 0 && (
                    <span className="sm:hidden flex flex-wrap gap-0.5" aria-hidden="true">
                      {items.slice(0, 4).map(r => <span key={r.appointment_id} className={`w-1.5 h-1.5 rounded-full ${r.status === 'pending' ? 'bg-amber-500' : 'bg-teal-600'}`} />)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-3">{t('dd.calNote')}</p>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5" aria-labelledby="day-h">
        <h2 id="day-h" className="font-bold text-slate-900 mb-3">{t('dd.calDayTitle', { date: fmt.isoDate(selected) })}</h2>
        {dayList.length === 0
          ? <p className="text-sm text-slate-500 py-3">{t('dd.calDayNone')}</p>
          : <ul className="space-y-2">{dayList.map(r => <RequestRow key={r.appointment_id} r={r} busyId={busyId} onDecide={onDecide} />)}</ul>}
      </section>
    </div>
  )
}
