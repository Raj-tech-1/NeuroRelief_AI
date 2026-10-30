import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../../i18n/format'
import EnglishOnly from '../../components/EnglishOnly'
import { getCycleData, addCycle } from '../../services/api'
import { downloadCSV } from '../../components/ExportCSV'
import PainCalendar from '../../components/PainCalendar'
import { Icon } from '../../components/icons'

function getInsightsForPhase(phase) {
  const insights = {
    'Menstrual': { description: "You're in your menstrual phase. Focus on rest, gentle movement, and iron-rich foods.", recommendations: ['Rest and gentle stretching', 'Eat iron-rich foods', 'Stay hydrated', 'Use heat therapy for cramps'] },
    'Follicular': { description: "You're in the follicular phase. Energy is rising — great time for new projects.", recommendations: ['Increase magnesium-rich foods', 'Try higher-intensity workouts', 'Start new projects or goals'] },
    'Ovulatory': { description: "You're in the ovulatory phase. Energy and confidence are at their peak.", recommendations: ['Take on challenging workouts', 'Schedule important meetings', 'Eat anti-inflammatory foods'] },
    'Luteal': { description: "You're in the luteal phase. Good time for self-care and preparing for your period.", recommendations: ['Increase magnesium-rich foods', 'Practice gentle yoga', 'Maintain regular sleep schedule'] },
    'Unknown': { description: 'Add your first cycle to get personalized insights.', recommendations: ['Start tracking your cycle', 'Log your symptoms daily', 'Record your mood and energy'] },
  }
  return insights[phase] || insights['Unknown']
}

// General wellness tips (educational content, not personal data)
const TIPS = [
  { id: 'hydrate', icon: 'drop', tone: 'bg-blue-50 text-blue-500' },
  { id: 'move', icon: 'heart', tone: 'bg-brand-50 text-brand-500' },
  { id: 'sleep', icon: 'leaf', tone: 'bg-green-50 text-green-600' },
]

const card = 'bg-white/90 rounded-2xl border border-brand-100/70 shadow-sm shadow-brand-100/50'
const field = 'w-full px-3 py-2.5 rounded-xl border border-brand-100 bg-white text-sm focus:outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-200/60'

function StatCard({ icon, tone, label, value, link, onLink, compact }) {
  return (
    <div className={`${card} p-5 flex items-center gap-4`}>
      <span className={`shrink-0 w-14 h-14 rounded-full flex items-center justify-center ${tone}`}><Icon name={icon} size={26} /></span>
      <div className="min-w-0">
        <p className="text-sm text-gray-500">{label}</p>
        <p className={`font-display font-bold text-gray-900 leading-tight ${compact ? 'text-xl' : 'text-2xl'}`}>{value}</p>
        <button onClick={onLink} className="text-xs font-medium text-brand-600 hover:text-brand-800 mt-1 text-left focus:outline-none focus-visible:underline">{link} →</button>
      </div>
    </div>
  )
}

export default function CycleTracking({ onTabChange }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const [showAddCycle, setShowAddCycle] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [flow, setFlow] = useState('Medium')
  const [mood, setMood] = useState('Normal')
  const [cycleLength, setCycleLength] = useState(28)
  const [saveMsg, setSaveMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [tipIndex, setTipIndex] = useState(0)
  const trackerRef = useRef(null)
  const recsRef = useRef(null)

  // Data from backend
  const [currentPhase, setCurrentPhase] = useState('Unknown')
  const [dayOfCycle, setDayOfCycle] = useState(null)
  const [nextPeriod, setNextPeriod] = useState('-')
  const [fertileWindow, setFertileWindow] = useState({ start: '-', end: '-' })
  const [lastCycle, setLastCycle] = useState(null)
  const [cycles, setCycles] = useState([])
  const [insights, setInsights] = useState(getInsightsForPhase('Unknown'))

  async function fetchData() {
    try {
      const data = await getCycleData('usr')
      setCurrentPhase(data.currentPhase || 'Unknown')
      setDayOfCycle(data.dayOfCycle || null)
      setNextPeriod(data.nextPeriod ?? '-')
      setFertileWindow(data.fertileWindow || { start: '-', end: '-' })
      setLastCycle(data.lastCycle || null)
      setCycles(data.cycles || [])
      setInsights(data.insights || getInsightsForPhase(data.currentPhase))
      setLoadError('')
    } catch (err) {
      console.error('Failed to fetch cycle data:', err)
      setLoadError('cycle.loadError')   // translation key, resolved at render so it follows the language
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  function openForm() {
    setShowAddCycle(true)
    setSaveMsg('')
    setTimeout(() => trackerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  async function handleSaveCycle() {
    if (saving) return
    if (!startDate) { setSaveMsg({ key: 'cycle.needStart' }); return }
    if (endDate && endDate < startDate) { setSaveMsg({ key: 'cycle.endBeforeStart' }); return }
    if (!(cycleLength >= 20 && cycleLength <= 40)) { setSaveMsg({ key: 'cycle.lengthRange' }); return }
    setSaving(true)
    try {
      const res = await addCycle('usr', { startDate, endDate, cycleLength, flow, mood })
      if (res?.error) { setSaveMsg({ text: res.error, server: true }); return }
      setSaveMsg({ key: 'cycle.saved', ok: true })
      setStartDate('')
      setEndDate('')
      setFlow('Medium')
      setMood('Normal')
      setCycleLength(28)
      await fetchData()
      setTimeout(() => { setSaveMsg(''); setShowAddCycle(false) }, 1000)
    } catch {
      setSaveMsg({ key: 'cycle.saveFailed' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-brand-700" role="status">
        <span className="w-5 h-5 rounded-full border-2 border-brand-200 border-t-brand-600 animate-spin" aria-hidden="true" />
        <span className="text-sm">{t('cycle.loading')}</span>
      </div>
    )
  }

  if (loadError) {
    return (
      <div role="alert" className={`${card} p-8 text-center`}>
        <p className="font-semibold text-gray-800">{t(loadError)}</p>
        <button onClick={() => { setLoading(true); fetchData() }} className="mt-4 px-5 py-2 bg-brand-700 text-white rounded-lg text-sm font-medium hover:bg-brand-800">{t('common.tryAgain')}</button>
      </div>
    )
  }

  const hasCycle = currentPhase !== 'Unknown'
  const hasFertile = hasCycle && fertileWindow?.start && fertileWindow.start !== '-'
  const tPhase = ph => t(`phase.${ph}`, { defaultValue: ph })
  const nextValue = !hasCycle || nextPeriod === '-' ? t('cycle.daysUnknown') : nextPeriod === 0 ? t('cycle.dueNow') : t('cycle.days', { count: nextPeriod })
  // insights: shown in the selected language by phase; the API's English text is only a fallback for unknown phases
  const insightText = t(`phaseDesc.${currentPhase}`, { defaultValue: insights.description })
  const recsTr = t(`phaseRecs.${currentPhase}`, { returnObjects: true })
  const recs = Array.isArray(recsTr) && recsTr.length === insights.recommendations.length ? recsTr : insights.recommendations
  const tip = TIPS[tipIndex]
  const tipTitle = t(`cycle.tip.${tip.id}.title`)
  const tipText = t(`cycle.tip.${tip.id}.text`)

  return (
    <div className="space-y-5">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-brand-100/90 via-brand-50 to-brand-100/60 border border-brand-100/70 p-6 md:p-8 min-h-[190px] flex items-center">
        <svg viewBox="0 0 520 220" className="hidden md:block absolute right-52 lg:right-56 top-0 h-full w-[420px] pointer-events-none" aria-hidden="true">
          <circle cx="330" cy="120" r="110" fill="#FBCFE8" opacity=".45" />
          <path d="M300 220c-8-60 6-120 52-170" stroke="#F9A8D4" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M330 150c-50-8-76-34-80-74 50 4 76 30 80 74z" fill="#F9A8D4" opacity=".7" />
          <path d="M352 100c42-12 64-40 64-80-42 8-64 36-64 80z" fill="#F687B3" opacity=".55" />
          <path d="M318 196c-38 4-64-10-80-38 38-6 68 8 80 38z" fill="#FBCFE8" />
          <path d="M400 190c-30-14-42-40-36-70 30 14 42 40 36 70z" fill="#FDDDE6" />
        </svg>
        <div className="relative max-w-xl min-w-0">
          <h2 className="hero-title font-display text-3xl md:text-4xl font-bold text-brand-900 leading-tight break-words">{t('cycle.heroTitle')}</h2>
          <p className="text-gray-600 mt-3 max-w-md">{t('cycle.heroText')}</p>
          <button onClick={openForm}
            className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 bg-brand-700 hover:bg-brand-800 text-white rounded-xl text-sm font-semibold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300">
            <Icon name="plus" size={16} /> {t('cycle.logCycle')}
          </button>
        </div>
        <p className="hidden lg:block absolute right-8 top-1/2 -translate-y-1/2 w-44 text-center font-display italic text-brand-800/80 text-lg leading-snug">
          {t('cycle.heroQuote')}
        </p>
      </section>

      {/* Phase / period / fertile window / insights */}
      <section className="indic-2col grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4" aria-label={t('cycle.summary')}>
        <StatCard icon="drop" tone="bg-brand-50 text-brand-600" label={t('cycle.currentPhase')}
          value={<>{tPhase(currentPhase)}{dayOfCycle && <span className="block font-sans text-xs font-normal text-gray-500">{t('cycle.dayOfCycle', { day: fmt.number(dayOfCycle) })}</span>}</>}
          link={t('cycle.learnPhases')} onLink={() => onTabChange && onTabChange('learn')} />
        <StatCard icon="calendar" tone="bg-blue-50 text-blue-500" label={t('cycle.nextPeriod')} value={nextValue}
          link={hasCycle ? t('cycle.logNew') : t('cycle.logToPredict')} onLink={openForm} />
        <StatCard compact icon="leaf" tone="bg-pink-50 text-brand-500" label={t('cycle.fertileWindow')} value={hasFertile ? `${fmt.isoDate(fertileWindow.start)} – ${fmt.isoDate(fertileWindow.end)}` : '- - -'}
          link={t('cycle.understandFertile')} onLink={() => onTabChange && onTabChange('learn')} />
        <button onClick={() => recsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          className="rounded-2xl bg-gradient-to-br from-brand-100/80 to-brand-50 border border-brand-100/70 p-5 flex items-center gap-4 text-left hover:shadow-md transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200">
          <span className="shrink-0 w-14 h-14 rounded-full bg-white/70 text-brand-700 flex items-center justify-center"><Icon name="chart" size={26} /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-lg font-bold text-gray-900">{t('cycle.insights')}</span>
            <span className="block text-xs text-gray-600 mt-1 line-clamp-3 cycle-insight-text break-words">{insightText}</span>
          </span>
          <Icon name="chevron" size={18} className="text-gray-400 shrink-0" />
        </button>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5">
        <div className="space-y-5 min-w-0">
          <PainCalendar dayOfCycle={dayOfCycle} />

          {/* Cycle tracker: log a cycle, last cycle, history */}
          <section ref={trackerRef} className={`${card} p-5 md:p-6 scroll-mt-24`}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="font-display text-xl font-bold text-gray-900">{t('cycle.tracker')}</h3>
              <button onClick={() => { showAddCycle ? setShowAddCycle(false) : openForm(); setSaveMsg('') }} aria-expanded={showAddCycle}
                className="px-4 py-1.5 border border-brand-200 text-brand-700 text-sm rounded-lg hover:bg-brand-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
                {showAddCycle ? t('common.cancel') : t('cycle.addCycle')}
              </button>
            </div>

            {showAddCycle && (
              <div className="mb-5 p-4 bg-brand-50/70 border border-brand-100 rounded-2xl grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="cy-start" className="block text-sm font-medium text-gray-700 mb-1">{t('cycle.startDate')}</label>
                  <input id="cy-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={field} />
                </div>
                <div>
                  <label htmlFor="cy-end" className="block text-sm font-medium text-gray-700 mb-1">{t('cycle.endDate')}</label>
                  <input id="cy-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={field} />
                </div>
                <div>
                  <label htmlFor="cy-len" className="block text-sm font-medium text-gray-700 mb-1">{t('cycle.cycleLength')}</label>
                  <input id="cy-len" type="number" value={cycleLength} onChange={e => setCycleLength(Number(e.target.value))} min="20" max="40" className={field} />
                </div>
                <div>
                  <label htmlFor="cy-flow" className="block text-sm font-medium text-gray-700 mb-1">{t('cycle.flowIntensity')}</label>
                  <select id="cy-flow" value={flow} onChange={e => setFlow(e.target.value)} className={field}>
                    {['Light', 'Medium', 'Heavy'].map(v => <option key={v} value={v}>{t(`flowValue.${v}`)}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="cy-mood" className="block text-sm font-medium text-gray-700 mb-1">{t('cycle.mood')}</label>
                  <select id="cy-mood" value={mood} onChange={e => setMood(e.target.value)} className={field}>
                    {['Happy', 'Normal', 'Tired', 'Irritable', 'Anxious', 'Sad'].map(v => <option key={v} value={v}>{t(`moodValue.${v}`)}</option>)}
                  </select>
                </div>
                {saveMsg && (
                  <p role="status" className={`sm:col-span-2 text-sm font-medium ${saveMsg.ok ? 'text-green-600' : 'text-red-600'}`}>{saveMsg.key ? t(saveMsg.key) : saveMsg.text}{saveMsg.server && <EnglishOnly />}</p>
                )}
                <button onClick={handleSaveCycle} disabled={saving}
                  className="sm:col-span-2 py-2.5 bg-brand-700 text-white rounded-xl text-sm font-semibold hover:bg-brand-800 disabled:opacity-60 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300">
                  {saving ? t('common.saving') : t('cycle.saveCycle')}
                </button>
              </div>
            )}

            {lastCycle ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-600 mb-2">{t('cycle.lastCycle')}</p>
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  {[[t('cycle.periodStarted'), fmt.isoDate(lastCycle.startDate)], [t('cycle.lengthLabel'), t('cycle.lengthDays', { n: fmt.number(lastCycle.cycleLength) })], [t('cycle.flow'), t(`flowValue.${lastCycle.flow}`, { defaultValue: lastCycle.flow })], [t('cycle.mood'), t(`moodValue.${lastCycle.mood}`, { defaultValue: lastCycle.mood })]].map(([k, v], i) => (
                    <div key={i} className="bg-brand-50/60 rounded-xl px-3 py-2.5"><dt className="text-xs text-gray-500">{k}</dt><dd className="font-semibold text-gray-900">{v}</dd></div>
                  ))}
                </dl>
              </div>
            ) : !showAddCycle && (
              <p className="text-sm text-gray-500">{t('cycle.noCycles')}</p>
            )}

            {cycles.length > 0 && (
              <div className="mt-5 pt-4 border-t border-brand-100">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">{t('cycle.history')}</p>
                  <button onClick={() => downloadCSV(cycles, 'cycle_history.csv')}
                    className="flex items-center gap-1 text-xs text-brand-700 hover:text-brand-900 focus:outline-none focus-visible:underline"><Icon name="download" size={14} /> {t('common.exportCsv')}</button>
                </div>
                <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {cycles.map(c => (
                    <li key={c.cycle_id ?? c.start_date} className="bg-green-50/70 px-3 py-2.5 rounded-xl text-sm flex flex-wrap justify-between gap-1">
                      <span className="font-medium text-gray-800">{fmt.isoDate(c.start_date)}</span>
                      <span className="text-gray-500">{t('cycle.flowMood', { flow: t(`flowValue.${c.flow}`, { defaultValue: c.flow }), mood: c.mood ? t(`moodValue.${c.mood}`, { defaultValue: c.mood }) : '-' })}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>

        <div className="space-y-5">
          {/* Recommendations */}
          <section ref={recsRef} className={`${card} p-5`}>
            <div className="flex items-center gap-3 mb-4">
              <span className="w-10 h-10 rounded-full bg-orange-50 text-orange-500 flex items-center justify-center"><Icon name="bulb" size={20} /></span>
              <h3 className="font-display text-xl font-bold text-gray-900">{t('cycle.recommendations')}</h3>
            </div>
            <ul className="space-y-3">
              {recs.map((rec, i) => {
                const icons = [['calendar', 'bg-brand-50 text-brand-500'], ['doc', 'bg-indigo-50 text-indigo-500'], ['heart', 'bg-orange-50 text-orange-500']]
                const [ic, tone] = icons[i % icons.length]
                return (
                  <li key={rec} className="flex items-center gap-3 p-3 rounded-xl border border-brand-100/70 bg-white">
                    <span className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${tone}`}><Icon name={ic} size={18} /></span>
                    <span className="text-sm font-medium text-gray-900">{rec}</span>
                  </li>
                )
              })}
            </ul>
          </section>

          {/* Tips carousel */}
          <section className={`${card} p-5`} aria-roledescription="carousel" aria-label={t('cycle.tipsLabel')}>
            <div className="flex items-center gap-3 mb-4">
              <span className="w-10 h-10 rounded-full bg-brand-50 text-brand-500 flex items-center justify-center"><Icon name="leaf" size={20} /></span>
              <h3 className="font-display text-xl font-bold text-gray-900">{t('cycle.tips')}</h3>
            </div>
            <div className="flex items-center gap-4 bg-blue-50/70 rounded-2xl p-4 min-h-[96px]" aria-live="polite">
              <span className={`shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center ${tip.tone}`}><Icon name={tip.icon} size={26} /></span>
              <div>
                <p className="font-semibold text-gray-900">{tipTitle}</p>
                <p className="text-xs text-gray-600 mt-0.5">{tipText}</p>
              </div>
            </div>
            <div className="flex items-center justify-between mt-4">
              <button onClick={() => setTipIndex(i => (i + TIPS.length - 1) % TIPS.length)} aria-label={t('cycle.prevTip')}
                className="w-10 h-10 rounded-full bg-gray-100 text-gray-600 hover:bg-brand-50 flex items-center justify-center"><Icon name="chevronLeft" size={18} /></button>
              <div className="flex gap-1.5">
                {TIPS.map((tp, i) => (
                  <button key={tp.id} onClick={() => setTipIndex(i)} aria-label={t('cycle.showTip', { n: i + 1 })} aria-current={i === tipIndex}
                    className={`w-2 h-2 rounded-full ${i === tipIndex ? 'bg-brand-600' : 'bg-gray-300'}`} />
                ))}
              </div>
              <button onClick={() => setTipIndex(i => (i + 1) % TIPS.length)} aria-label={t('cycle.nextTip')}
                className="w-10 h-10 rounded-full bg-gray-100 text-gray-600 hover:bg-brand-50 flex items-center justify-center"><Icon name="chevron" size={18} /></button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
