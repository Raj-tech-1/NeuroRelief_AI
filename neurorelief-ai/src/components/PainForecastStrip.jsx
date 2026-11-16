import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from './icons'
import { useFormat } from '../i18n/format'
import { getPainForecast } from '../services/api'

// 7-day pain ESTIMATE from the AI model (GET /api/predict/forecast). Always labelled as an estimate: it projects the
// logged cycle and recent check-ins forward and cannot know future symptoms. Not shown while a period is late.
const TONE = {
  Low: 'bg-green-50 border-green-200 text-green-800',
  Moderate: 'bg-orange-50 border-orange-200 text-orange-800',
  High: 'bg-red-50 border-red-200 text-red-800',
}
const DOT = { Low: 'bg-green-500', Moderate: 'bg-orange-400', High: 'bg-red-500' }

export default function PainForecastStrip({ reloadKey = 0, compact = false }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  const [sel, setSel] = useState(0)

  useEffect(() => {
    let alive = true
    setError(false)
    getPainForecast().then(d => { if (alive) { setData(d); setSel(0) } }).catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [reloadKey])

  const tSev = s => t(`severity.${s}`, { defaultValue: s })
  const tPhase = p => t(`phase.${p}`, { defaultValue: p })
  const day = data?.available ? data.days[sel] : null

  return (
    <section className="bg-white/90 rounded-2xl border border-brand-100/70 shadow-sm shadow-brand-100/50 p-5" aria-label={t('forecast.title')}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="chart" size={20} /></span>
          <div>
            <h3 className="font-bold text-gray-900 leading-tight">{t('forecast.title')}</h3>
            <p className="text-xs text-gray-500">{t('forecast.subtitle')}</p>
          </div>
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">{t('forecast.estimate')}</span>
      </div>

      {error ? <p className="text-sm text-gray-500">{t('forecast.error')}</p>
        : !data ? <p className="text-sm text-gray-500" role="status">{t('common.loading')}</p>
        : !data.available ? (
          <p className="text-sm text-brand-800 bg-brand-50 border border-brand-100 rounded-xl px-4 py-3">
            {data.reason === 'period_late' ? t('forecast.late', { count: data.daysLate }) : t('forecast.noCycle')}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
              {data.days.map((d, i) => {
                const date = new Date(d.date + 'T12:00:00')
                return (
                  <button key={d.date} type="button" onClick={() => setSel(i)} aria-pressed={sel === i}
                    aria-label={t('forecast.dayLabel', { date: date.toLocaleDateString(fmt.locale, { weekday: 'long', day: 'numeric', month: 'long' }), severity: tSev(d.severity) })}
                    className={`rounded-xl border px-1 py-2 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${TONE[d.severity] || 'bg-gray-50 border-gray-200 text-gray-700'} ${sel === i ? 'ring-2 ring-brand-500' : ''}`}>
                    <span className="block text-[11px] font-medium opacity-80">{i === 0 ? t('forecast.today') : date.toLocaleDateString(fmt.locale, { weekday: 'short' })}</span>
                    <span className="block text-sm font-bold">{fmt.number(date.getDate())}</span>
                    <span className={`mx-auto mt-1 block w-2 h-2 rounded-full ${DOT[d.severity] || 'bg-gray-400'}`} aria-hidden="true" />
                    {!compact && <span className="block mt-1 text-[10px] font-semibold leading-tight truncate">{tSev(d.severity)}</span>}
                  </button>
                )
              })}
            </div>
            {day && (
              <p className="mt-3 text-sm text-gray-700" aria-live="polite">
                {t('forecast.detail', {
                  date: new Date(day.date + 'T12:00:00').toLocaleDateString(fmt.locale, { weekday: 'long', day: 'numeric', month: 'short' }),
                  severity: tSev(day.severity), pct: fmt.number(Math.round(day.confidence * 100)),
                  day: fmt.number(day.cycleDay), phase: tPhase(day.phase),
                })}
                {day.projected && <span className="block text-xs text-gray-500">{t('forecast.projected')}</span>}
              </p>
            )}
            <p className="mt-2 text-[11px] text-gray-500">
              {t('forecast.basis', { n: fmt.number(data.basis?.checkinDays || 0) })}
              {data.calibration?.applied ? ` ${t('forecast.calibrated')}` : ''}
            </p>
          </>
        )}
    </section>
  )
}
