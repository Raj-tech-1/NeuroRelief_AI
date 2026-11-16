import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from './icons'
import { useFormat } from '../i18n/format'

// "Why this score?" — explains one prediction honestly, from the explanation computed by predict.py:
//   factors:     per-prediction effect of each input (perturbation against a neutral reference value)
//   importances: how much the model relies on each input overall (Random Forest feature importances)
// It explains the RAW model result; personal calibration is shown separately.

// Symptom/stress inputs on the model's 0-5 scale
const LEVEL_FEATURES = ['stress', 'fatigue', 'cramps', 'headaches', 'bloating', 'moodswing', 'sleepissue']
const SYMPTOM_FEATURES = ['fatigue', 'cramps', 'headaches', 'bloating', 'moodswing', 'sleepissue']
const PHASES = ['Menstrual', 'Follicular', 'Ovulatory', 'Luteal']   // model codes 0-3 ("Fertility" = Ovulatory)
const MOODS = ['sad', 'Moody', 'Calm', 'Energetic']
const ACTIVITY = ['Low', 'Moderate']
// Advisor symptoms that are model inputs; every other selected symptom is not used by the model
const USED_SYMPTOMS = ['Cramps', 'Fatigue', 'Headache', 'Bloating', 'Mood swings', 'Insomnia']

export default function WhyThisScore({ prediction, selectedSymptoms = [], hasDescription = false, defaultOpen = false }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const [open, setOpen] = useState(defaultOpen)
  const ex = prediction?.explanation
  if (!ex) return null

  const label = f => t(`why.feature.${f}`)
  const tSev = s => t(`severity.${s}`, { defaultValue: s })
  const pts = v => fmt.number(Math.round(Math.abs(v) * 100))
  const value = (f, v) => {
    if (f === 'phase_encoded') return t(`phase.${PHASES[v]}`, { defaultValue: PHASES[v] })
    if (f === 'mood_encoded') return t(`why.mood.${MOODS[v]}`)
    if (f === 'activity_encoded') return t(`why.activity.${ACTIVITY[v]}`)
    if (LEVEL_FEATURES.includes(f)) return t(`why.level.${Math.max(0, Math.min(5, Math.round(v)))}`)
    if (f === 'day_from_last_menses') return t('why.dayN', { n: fmt.number(v) })
    if (f === 'sleep_hours') return t('why.hours', { n: fmt.number(v) })
    return fmt.number(v)
  }

  const factors = ex.factors.filter(f => Math.abs(f.effect) >= 0.005).slice(0, 5)
  const maxEffect = Math.max(0.01, ...factors.map(f => Math.abs(f.effect)))
  const maxImp = Math.max(0.01, ...ex.importances.map(i => i.importance))
  const share = list => Math.round(ex.importances.filter(i => list.includes(i.feature)).reduce((s, i) => s + i.importance, 0) * 100)
  const symptomShare = share(SYMPTOM_FEATURES)
  const topShare = share(['phase_encoded', 'mood_encoded', 'day_from_last_menses'])
  const notUsed = selectedSymptoms.filter(s => !USED_SYMPTOMS.includes(s))
  const cal = prediction.calibration
  const adjusted = cal?.applied && prediction.base_severity && prediction.base_severity !== prediction.predicted_severity

  return (
    <div className="rounded-xl border border-brand-100 bg-white">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-brand-800 hover:bg-brand-50/60 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
        <span className="inline-flex items-center gap-2"><Icon name="bulb" size={16} /> {t('why.title')}</span>
        <Icon name="chevronDown" size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-4 text-sm">
          {/* Raw model result vs what is shown */}
          <p className="text-gray-700">
            {t('why.raw', { severity: tSev(ex.target), pct: fmt.number(Math.round(ex.probability * 100)) })}{' '}
            {adjusted
              ? t('why.adjusted', { severity: tSev(prediction.predicted_severity), offset: `${cal.offset > 0 ? '+' : ''}${fmt.number(cal.offset)}`, n: fmt.number(cal.sessions) })
              : cal ? t('why.notAdjusted', { n: fmt.number(cal.sessions || 0), needed: fmt.number(cal.needed || 5) }) : ''}
          </p>

          {/* Probabilities */}
          <div>
            <p className="font-semibold text-gray-900 mb-1.5">{t('why.probabilities')}</p>
            <div className="space-y-1">
              {['Low', 'Moderate', 'High'].filter(k => prediction.probabilities?.[k] != null).map(k => (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-xs text-gray-600">{tSev(k)}</span>
                  <span className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><span className="block h-full rounded-full bg-brand-400" style={{ width: `${prediction.probabilities[k] * 100}%` }} /></span>
                  <span className="w-10 text-right text-xs text-gray-600">{fmt.number(Math.round(prediction.probabilities[k] * 100))}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* What moved this prediction */}
          <div>
            <p className="font-semibold text-gray-900">{t('why.factorsTitle', { severity: tSev(ex.target) })}</p>
            <p className="text-xs text-gray-500 mb-2">{t('why.factorsHint')}</p>
            {factors.length === 0 ? <p className="text-xs text-gray-500">{t('why.noFactors')}</p> : (
              <ul className="space-y-1.5">
                {factors.map(f => (
                  <li key={f.feature} className="grid grid-cols-[minmax(0,1fr)_96px] gap-2 items-center">
                    <span className="min-w-0">
                      <span className="text-gray-800">{label(f.feature)}: <span className="font-semibold">{value(f.feature, f.value)}</span></span>
                      <span className={`block text-[11px] ${f.effect > 0 ? 'text-brand-700' : 'text-sky-700'}`}>
                        {t(f.effect > 0 ? 'why.toward' : 'why.away', { pts: pts(f.effect), severity: tSev(ex.target) })}
                      </span>
                    </span>
                    <span className="h-2 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
                      <span className={`block h-full rounded-full ${f.effect > 0 ? 'bg-brand-500' : 'bg-sky-400'}`} style={{ width: `${(Math.abs(f.effect) / maxEffect) * 100}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* What the model relies on overall: shown honestly, including that symptoms barely count */}
          <div>
            <p className="font-semibold text-gray-900">{t('why.overallTitle')}</p>
            <p className="text-xs text-gray-600 mt-0.5 mb-2 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">{t('why.overallNote', { symptoms: fmt.number(symptomShare), top: fmt.number(topShare) })}</p>
            <ul className="space-y-1">
              {ex.importances.map(i => (
                <li key={i.feature} className="flex items-center gap-2">
                  <span className={`w-36 shrink-0 text-xs ${SYMPTOM_FEATURES.includes(i.feature) ? 'text-amber-800' : 'text-gray-600'}`}>{label(i.feature)}</span>
                  <span className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><span className={`block h-full rounded-full ${SYMPTOM_FEATURES.includes(i.feature) ? 'bg-amber-400' : 'bg-brand-300'}`} style={{ width: `${(i.importance / maxImp) * 100}%` }} /></span>
                  <span className="w-9 text-right text-[11px] text-gray-500">{fmt.number(Math.round(i.importance * 100))}%</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Inputs the model does not use */}
          {(notUsed.length > 0 || hasDescription) && (
            <p className="text-xs text-gray-600">
              <span className="font-semibold text-gray-800">{t('why.notUsedTitle')}</span>{' '}
              {[...(hasDescription ? [t('why.description')] : []), ...notUsed.map(s => t(`symptom.${s}`, { defaultValue: s }))].join(', ')}
            </p>
          )}

          <p className="text-[11px] text-gray-400">{t('why.method')}</p>
        </div>
      )}
    </div>
  )
}
