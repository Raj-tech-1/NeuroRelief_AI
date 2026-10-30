import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../../i18n/format'
import { localizeFixed } from '../../i18n/serverText'
import EnglishOnly from '../../components/EnglishOnly'
import { getMoodData, saveMoodEntry, getArticles } from '../../services/api'
import { LineChart } from '../../components/SimpleChart'
import { downloadCSV } from '../../components/ExportCSV'
import { Icon } from '../../components/icons'

// Stored mood labels (the backend and the AI Symptom Advisor depend on these exact values)
const MOODS = [
  { label: 'Good', tone: 'text-green-600 bg-green-50 border-green-200' },
  { label: 'Okay', tone: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
  { label: 'Sad', tone: 'text-blue-600 bg-blue-50 border-blue-200' },
  { label: 'Angry', tone: 'text-red-600 bg-red-50 border-red-200' },
  { label: 'Tired', tone: 'text-purple-600 bg-purple-50 border-purple-200' },
  { label: 'Sick', tone: 'text-teal-600 bg-teal-50 border-teal-200' },
]

const facePaths = {
  Good: <><path d="M9 10h.01M15 10h.01" strokeWidth="2.4" /><path d="M8 14c1 1.8 2.4 2.5 4 2.5s3-.7 4-2.5" /></>,
  Okay: <><path d="M9 10h.01M15 10h.01" strokeWidth="2.4" /><path d="M9 15h6" /></>,
  Sad: <><path d="M9 10h.01M15 10h.01" strokeWidth="2.4" /><path d="M8 16c1-1.6 2.4-2.3 4-2.3s3 .7 4 2.3" /></>,
  Angry: <><path d="M7.5 8.5l3 1.2M16.5 8.5l-3 1.2" /><path d="M9 11.5h.01M15 11.5h.01" strokeWidth="2.4" /><path d="M8.5 16c1-1.2 2.2-1.7 3.5-1.7s2.5.5 3.5 1.7" /></>,
  Tired: <><path d="M7.5 10.5h3M13.5 10.5h3" /><path d="M10 15.5h4" /></>,
  Sick: <><path d="M9 10h.01M15 10h.01" strokeWidth="2.4" /><path d="M8 15c1-1 1.7-1 2.7 0s1.7 1 2.7 0 1.7-1 2.6 0" /></>,
}

function MoodFace({ mood, size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      {facePaths[mood] || facePaths.Okay}
    </svg>
  )
}

const card = 'bg-white/90 rounded-2xl border border-brand-100/70 shadow-sm shadow-brand-100/50'

// ---- daily habits (stored on this device; hydration + mindfulness share keys with the Overview page) ----
const isoDay = offset => new Date(Date.now() - offset * 86400000).toISOString().split('T')[0]
const habitKey = (kind, iso) => `neurorelief_${kind}_${iso}`
function readHabit(kind, iso) {
  try { return localStorage.getItem(habitKey(kind, iso)) } catch { return null }
}
function writeHabit(kind, iso, value) {
  try { localStorage.setItem(habitKey(kind, iso), String(value)) } catch {}
}
const WATER_GOAL = 8

function Dots({ states }) {
  return (
    <span className="flex gap-1.5" aria-hidden="true">
      {states.map((s, i) => (
        <span key={i} className={`w-3.5 h-3.5 rounded-full border ${s === 'done' ? 'bg-brand-500 border-brand-500' : s === 'partial' ? 'bg-brand-200 border-brand-300' : 'bg-white border-gray-200'}`} />
      ))}
    </span>
  )
}

function Slider({ id, label, value, onChange, accent }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <label htmlFor={id} className="text-gray-700">{label}</label>
        <span className="font-semibold text-gray-900">{value}/10</span>
      </div>
      <input id={id} type="range" min="1" max="10" value={value} onChange={e => onChange(Number(e.target.value))} className="w-full" style={{ accentColor: accent }} />
    </div>
  )
}

const METRICS = [
  { id: 'energy', key: 'energy', color: '#059669' },       // label: mood.energy
  { id: 'stress', key: 'stress', color: '#DC2626' },       // label: mood.stress
  { id: 'sleep', key: 'sleep_quality', color: '#2563EB' }, // label: mood.sleep
]

export default function MoodWellness({ onTabChange }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [data, setData] = useState(null)
  const [articles, setArticles] = useState([])

  // check-in form
  const [selectedMood, setSelectedMood] = useState(null)
  const [energy, setEnergy] = useState(7)
  const [stress, setStress] = useState(3)
  const [sleep, setSleep] = useState(8)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // trends + habits
  const [metric, setMetric] = useState('energy')
  const [range, setRange] = useState(30)
  const [, setHabitTick] = useState(0)

  async function fetchData(prefill = false) {
    try {
      const d = await getMoodData('usr')
      setData(d)
      setLoadError('')
      if (prefill && d.todayLogged && d.today) {
        setSelectedMood(d.today.mood)
        setEnergy(d.today.energy || 7)
        setStress(d.today.stress || 3)
        setSleep(d.today.sleep || 8)
        setNote(d.today.note || '')
      }
    } catch (err) {
      console.error('Failed to fetch mood data:', err)
      setLoadError('mood.loadError')   // translation key, resolved at render so it follows the language
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData(true)
    getArticles().then(a => setArticles(a.filter(x => x.category === 'mental health').slice(0, 3))).catch(() => {})
  }, [])

  async function handleSave() {
    if (saving) return
    if (!selectedMood) { setSaveMsg({ key: 'mood.pickMood' }); return }
    setSaving(true)
    setSaveMsg('')
    try {
      const res = await saveMoodEntry('usr', { mood: selectedMood, energy, stress, sleep, note: note.trim() })
      if (res?.error) { setSaveMsg({ text: res.error, server: true }); return }
      await fetchData(false)
      setSaveMsg({ key: 'mood.saved', ok: true })
      setTimeout(() => setSaveMsg(''), 2500)
    } catch {
      setSaveMsg({ key: 'mood.saveFailed' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-brand-700" role="status">
        <span className="w-5 h-5 rounded-full border-2 border-brand-200 border-t-brand-600 animate-spin" aria-hidden="true" />
        <span className="text-sm">{t('mood.loading')}</span>
      </div>
    )
  }
  if (loadError || !data) {
    return (
      <div role="alert" className={`${card} p-8 text-center`}>
        <p className="font-semibold text-gray-800">{t(loadError)}</p>
        <button onClick={() => { setLoading(true); fetchData(true) }} className="mt-4 px-5 py-2 bg-brand-700 text-white rounded-lg text-sm font-medium hover:bg-brand-800">{t('common.tryAgain')}</button>
      </div>
    )
  }

  const today = data.today
  const logged = !!data.todayLogged
  const history = data.history || []
  const recent = data.recent || {}
  const patterns = data.patterns || { trend: '', tips: [] }

  // Wellness score: plain average of the user's own 7-day energy, sleep quality and calm (10 - stress)
  const hasScore = recent.daysLogged > 0 && recent.avgEnergy != null && recent.avgStress != null && recent.avgSleep != null
  const score = hasScore ? ((recent.avgEnergy + (10 - recent.avgStress) + recent.avgSleep) / 3).toFixed(1) : null
  const stressWord = s => t(`severity.${s <= 3 ? 'Low' : s <= 6 ? 'Moderate' : 'High'}`)
  const tMood = m => t(`moodValue.${m}`, { defaultValue: m })

  const cards = [
    { icon: 'smile', tone: 'bg-brand-50 text-brand-600', bg: 'from-brand-50/80', label: t('mood.checkins'), value: fmt.number(data.totalRecords || 0), sub: data.totalRecords ? t('mood.last30') : t('mood.startTracking') },
    { icon: 'leaf', tone: 'bg-green-50 text-green-600', bg: 'from-green-50/80', label: t('mood.stressLevel'), value: logged ? `${today.stress}/10` : t('mood.notTracked'), sub: logged ? t('mood.stressToday', { level: stressWord(today.stress) }) : t('mood.logToday') },
    { icon: 'heart', tone: 'bg-blue-50 text-blue-500', bg: 'from-blue-50/80', label: t('mood.sleepQuality'), value: logged ? `${today.sleep}/10` : t('mood.notTracked'), sub: logged ? t('mood.howWell') : t('mood.logSleepSub') },
    { icon: 'chart', tone: 'bg-purple-50 text-purple-600', bg: 'from-purple-50/80', label: t('mood.wellnessScore'), value: score ? `${score}/10` : '-', sub: score ? t('mood.scoreSub') : t('mood.buildData') },
  ]

  // ---- trend chart data ----
  const cutoff = isoDay(range)
  const points = history.filter(h => h.date >= cutoff).slice().reverse()
  const m = METRICS.find(x => x.id === metric)
  const step = Math.max(1, Math.ceil(points.length / 7))
  const chartData = points.map(h => h[m.key] ?? 0)
  const chartLabels = points.map((h, i) => (i % step === 0 || i === points.length - 1 ? h.date.split('-').slice(1).join('/') : ''))

  // ---- habits ----
  const week = Array.from({ length: 7 }, (_, i) => isoDay(6 - i))
  const todayIso = isoDay(0)
  const loggedDates = new Set(history.map(h => h.date))
  const water = parseInt(readHabit('water', todayIso)) || 0
  const toggleHabit = kind => { writeHabit(kind, todayIso, readHabit(kind, todayIso) === 'true' ? 'false' : 'true'); setHabitTick(t => t + 1) }
  const changeWater = d => { writeHabit('water', todayIso, Math.max(0, Math.min(WATER_GOAL, water + d))); setHabitTick(t => t + 1) }

  const habits = [
    {
      key: 'water', name: t('mood.hydration'), icon: 'drop', tone: 'bg-blue-50 text-blue-500', status: t('mood.glasses', { n: fmt.number(water), goal: fmt.number(WATER_GOAL) }),
      dots: week.map(d => { const w = parseInt(readHabit('water', d)) || 0; return w >= WATER_GOAL ? 'done' : w > 0 ? 'partial' : 'none' }),
      control: (
        <span className="flex items-center gap-1.5">
          <button onClick={() => changeWater(-1)} disabled={water <= 0} aria-label={t('mood.removeGlass')} className="w-8 h-8 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40">−</button>
          <button onClick={() => changeWater(1)} disabled={water >= WATER_GOAL} className="px-3 h-8 rounded-lg bg-brand-50 text-brand-700 text-sm font-medium hover:bg-brand-100 disabled:opacity-40">{t('mood.addGlass')}</button>
        </span>
      ),
    },
    ...[['movement', t('mood.movement'), 'bolt', 'bg-brand-50 text-brand-500'], ['meditation', t('mood.mindfulness'), 'leaf', 'bg-green-50 text-green-600']].map(([kind, name, icon, tone]) => {
      const done = readHabit(kind, todayIso) === 'true'
      return {
        key: kind, name, icon, tone, status: done ? t('mood.doneToday') : t('mood.notDone'),
        dots: week.map(d => (readHabit(kind, d) === 'true' ? 'done' : 'none')),
        control: (
          <button onClick={() => toggleHabit(kind)} aria-pressed={done}
            className={`px-4 h-8 rounded-lg text-sm font-medium transition ${done ? 'bg-green-100 text-green-700' : 'bg-brand-50 text-brand-700 hover:bg-brand-100'}`}>{done ? t('mood.done') : t('mood.markDone')}</button>
        ),
      }
    }),
    {
      key: 'sleep', name: t('mood.sleepHabit'), icon: 'heart', tone: 'bg-indigo-50 text-indigo-500', status: logged ? t('mood.loggedQuality', { n: today.sleep }) : t('mood.notTracked'),
      dots: week.map(d => (loggedDates.has(d) ? 'done' : 'none')),
      control: logged ? <span className="px-4 h-8 inline-flex items-center rounded-lg bg-green-100 text-green-700 text-sm font-medium">{t('mood.loggedBadge')}</span>
        : <button onClick={() => document.getElementById('checkin-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="px-4 h-8 rounded-lg bg-brand-50 text-brand-700 text-sm font-medium hover:bg-brand-100">{t('mood.logSleep')}</button>,
    },
  ]

  const trendTxt = localizeFixed('moodTrend', patterns.trend)
  const affirmTxt = localizeFixed('affirmation', today?.affirmation)
  const tipIcons = [['bulb', 'bg-orange-50 text-orange-500'], ['leaf', 'bg-green-50 text-green-600'], ['heart', 'bg-indigo-50 text-indigo-500']]

  return (
    <div className="space-y-5">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-brand-100/90 via-brand-50 to-brand-100/60 border border-brand-100/70 p-6 md:p-8 min-h-[190px] flex items-center">
        <svg viewBox="0 0 520 220" className="hidden md:block absolute right-52 lg:right-56 top-0 h-full w-[420px] pointer-events-none" aria-hidden="true">
          <circle cx="300" cy="115" r="105" fill="#FBCFE8" opacity=".45" />
          <path d="M280 220c-8-60 6-120 52-170" stroke="#F9A8D4" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M310 150c-50-8-76-34-80-74 50 4 76 30 80 74z" fill="#F9A8D4" opacity=".7" />
          <path d="M332 100c42-12 64-40 64-80-42 8-64 36-64 80z" fill="#F687B3" opacity=".55" />
          <path d="M298 196c-38 4-64-10-80-38 38-6 68 8 80 38z" fill="#FBCFE8" />
        </svg>
        <div className="relative max-w-xl min-w-0">
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-brand-600 mb-2">{t('mood.tagline')}</p>
          <h2 className="hero-title font-display text-3xl md:text-4xl font-bold text-brand-900 leading-tight break-words">{t('mood.heroTitle')}</h2>
          <p className="text-gray-600 mt-3 max-w-md">{t('mood.heroText')}</p>
        </div>
        <p className="hidden lg:block absolute right-8 top-1/2 -translate-y-1/2 w-44 text-center font-display italic text-brand-800/80 text-lg leading-snug">
          {t('mood.heroQuote')}
        </p>
      </section>

      {/* Summary cards */}
      <section className="indic-2col grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" aria-label={t('mood.summary')}>
        {cards.map(c => (
          <div key={c.label} className={`rounded-2xl border border-brand-100/70 bg-gradient-to-br ${c.bg} to-white p-5 flex items-center gap-4`}>
            <span className={`shrink-0 w-14 h-14 rounded-full flex items-center justify-center ${c.tone}`}><Icon name={c.icon} size={26} /></span>
            <div className="min-w-0">
              <p className="text-sm text-gray-600">{c.label}</p>
              <p className={`font-bold text-gray-900 leading-tight ${/\d/.test(String(c.value)) ? 'font-sans text-3xl' : 'font-display text-2xl'}`}>{c.value}</p>
              <p className="text-xs text-gray-500 mt-1">{c.sub}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4">
        {/* Mood trends */}
        <div className={`${card} p-5 flex flex-col`}>
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="chart" size={20} /></span>
              <div>
                <h3 className="font-display text-xl font-bold text-gray-900">{t('mood.trends')}</h3>
                <p className="text-xs text-gray-500">{t('mood.trendsSub')}</p>
              </div>
            </div>
            <label className="sr-only" htmlFor="mood-range">{t('mood.timeRange')}</label>
            <select id="mood-range" value={range} onChange={e => setRange(Number(e.target.value))}
              className="text-sm border border-brand-100 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-300">
              <option value={7}>{t('mood.last7')}</option>
              <option value={30}>{t('mood.last30opt')}</option>
            </select>
          </div>
          <div className="flex gap-2 mb-3" role="group" aria-label={t('mood.metric')}>
            {METRICS.map(x => (
              <button key={x.id} onClick={() => setMetric(x.id)} aria-pressed={metric === x.id}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition ${metric === x.id ? 'bg-brand-500 text-white border-brand-500' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{t(`mood.${x.id}`)}</button>
            ))}
          </div>
          {points.length >= 2 ? (
            <LineChart data={chartData} labels={chartLabels} color={m.color} height={290} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center bg-brand-50/50 rounded-xl py-8 px-4">
              <span className="w-12 h-12 rounded-full bg-white text-brand-500 flex items-center justify-center mb-2"><Icon name="chart" size={22} /></span>
              <p className="font-semibold text-gray-900">{points.length === 0 ? t('mood.noData') : t('mood.notEnough')}</p>
              <p className="text-xs text-gray-500 mt-1 max-w-xs">{points.length === 0 ? t('mood.startLogging') : t('mood.logTwo')}</p>
              <button onClick={() => document.getElementById('checkin-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                className="mt-3 px-6 py-2 bg-brand-700 hover:bg-brand-800 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2">{t('mood.logYourMood')} <Icon name="arrow" size={14} /></button>
            </div>
          )}
        </div>

        {/* Today's check-in */}
        <div id="checkin-card" className={`${card} p-5 scroll-mt-24`}>
          <div className="flex items-center gap-3 mb-4">
            <span className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="heart" size={20} /></span>
            <div>
              <h3 className="font-display text-xl font-bold text-gray-900">{t('mood.todaysCheckin')}</h3>
              <p className="text-xs text-gray-500">{logged ? t('mood.loggedToday', { mood: tMood(today.mood) }) : t('mood.howFeeling')}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4" role="group" aria-label={t('mood.howFeelingGroup')}>
            {MOODS.map(mo => (
              <button key={mo.label} onClick={() => setSelectedMood(mo.label)} aria-pressed={selectedMood === mo.label}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                  selectedMood === mo.label ? `${mo.tone} ring-2 ring-brand-400` : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                <span className={selectedMood === mo.label ? '' : mo.tone.split(' ')[0]}><MoodFace mood={mo.label} size={28} /></span>
                {tMood(mo.label)}
              </button>
            ))}
          </div>

          <div className="space-y-3 mb-4">
            <Slider id="mood-energy" label={t('mood.energy')} value={energy} onChange={setEnergy} accent="#059669" />
            <Slider id="mood-stress" label={t('mood.stress')} value={stress} onChange={setStress} accent="#DC2626" />
            <Slider id="mood-sleep" label={t('mood.sleepQ')} value={sleep} onChange={setSleep} accent="#2563EB" />
          </div>

          <label htmlFor="mood-note" className="sr-only">{t('mood.note')}</label>
          <textarea id="mood-note" value={note} maxLength={200} onChange={e => setNote(e.target.value)} rows={3}
            placeholder={t('mood.notePlaceholder')}
            className="w-full border border-brand-100 rounded-xl p-3 text-sm focus:outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-200/60" />
          <p className="text-right text-xs text-gray-400 mb-3">{fmt.number(note.length)}/200</p>

          {saveMsg && <p role="status" className={`text-sm font-medium mb-2 ${saveMsg.ok ? 'text-green-600' : 'text-red-600'}`}>{saveMsg.key ? t(saveMsg.key) : saveMsg.text}{saveMsg.server && <EnglishOnly />}</p>}
          <button onClick={handleSave} disabled={saving}
            className="w-full py-3 bg-gradient-to-r from-brand-500 to-brand-700 text-white rounded-xl font-semibold hover:from-brand-600 hover:to-brand-800 disabled:opacity-60 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300">
            {saving ? t('common.saving') : logged ? t('mood.update') : t('mood.save')}
          </button>
        </div>

        {/* Wellness insights */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-3 mb-4">
            <span className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="bulb" size={20} /></span>
            <div>
              <h3 className="font-display text-xl font-bold text-gray-900">{t('mood.insights')}</h3>
              <p className="text-xs text-gray-500">{t('mood.insightsSub')}</p>
            </div>
          </div>
          <div className="space-y-3">
            {patterns.trend && (
              <div className="rounded-xl bg-orange-50/70 p-3 flex gap-3">
                <span className="shrink-0 w-9 h-9 rounded-full bg-white text-orange-500 flex items-center justify-center"><Icon name="chart" size={18} /></span>
                <div><p className="text-sm font-semibold text-gray-900">{t('mood.weekTrend')}</p><p className="text-xs text-gray-600 mt-0.5">{trendTxt.text}{trendTxt.englishOnly && <EnglishOnly />}</p></div>
              </div>
            )}
            {(patterns.tips || []).slice(0, 3).map((tip, i) => {
              const [ic, tone] = tipIcons[i % tipIcons.length]
              const tipTxt = localizeFixed('moodTip', tip)
              return (
                <div key={tip} className="rounded-xl bg-green-50/60 p-3 flex gap-3">
                  <span className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${tone}`}><Icon name={ic} size={18} /></span>
                  <p className="text-sm text-gray-700 self-center">{tipTxt.text}{tipTxt.englishOnly && <EnglishOnly />}</p>
                </div>
              )
            })}
            {today?.affirmation && (
              <div className="rounded-xl bg-purple-50/70 p-3">
                <p className="text-sm font-semibold text-gray-900">{t('mood.affirmation')}</p>
                <p className="text-xs text-purple-700 italic mt-0.5">“{affirmTxt.text}”{affirmTxt.englishOnly && <EnglishOnly />}</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-4">
        {/* Wellness habits */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-3 mb-4">
            <span className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="bolt" size={20} /></span>
            <div>
              <h3 className="font-display text-xl font-bold text-gray-900">{t('mood.habits')}</h3>
              <p className="text-xs text-gray-500">{t('mood.habitsSub')}</p>
            </div>
          </div>
          <ul className="divide-y divide-brand-100/70">
            {habits.map(h => (
              <li key={h.key} className="flex flex-wrap items-center gap-3 py-3">
                <span className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${h.tone}`}><Icon name={h.icon} size={18} /></span>
                <div className="flex-1 min-w-[120px]">
                  <p className="text-sm font-semibold text-gray-900">{h.name}</p>
                  <p className="text-xs text-gray-500">{h.status}</p>
                </div>
                <Dots states={h.dots} />
                {h.control}
              </li>
            ))}
          </ul>
        </div>

        {/* Resources */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-3 mb-4">
            <span className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="book" size={20} /></span>
            <div>
              <h3 className="font-display text-xl font-bold text-gray-900">{t('mood.resources')}</h3>
              <p className="text-xs text-gray-500">{t('mood.resourcesSub')}</p>
            </div>
          </div>
          {articles.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">{t('mood.articlesSoon')}</p>
          ) : (
            <ul className="space-y-3">
              {articles.map((a, i) => (
                <li key={a.id}>
                  <button onClick={() => onTabChange && onTabChange('learn')}
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-brand-50/60 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
                    <span className={`shrink-0 w-16 h-14 rounded-xl flex items-center justify-center ${['bg-gradient-to-br from-orange-100 to-brand-100 text-brand-600', 'bg-gradient-to-br from-blue-100 to-purple-100 text-purple-600', 'bg-gradient-to-br from-green-100 to-yellow-100 text-green-700'][i % 3]}`}>
                      <Icon name={['leaf', 'heart', 'brain'][i % 3]} size={24} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-gray-900">{t(`articles.${a.id}.title`, { defaultValue: a.title })}</span>
                      <span className="block text-xs text-gray-500 truncate">{t(`articles.${a.id}.description`, { defaultValue: a.description })}</span>
                    </span>
                    <Icon name="chevron" size={16} className="text-gray-400 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Recent check-ins */}
      {history.length > 0 && (
        <section className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-xl font-bold text-gray-900">{t('mood.recent')}</h3>
            <button onClick={() => downloadCSV(history, 'mood_history.csv')}
              className="flex items-center gap-1 text-xs text-brand-700 hover:text-brand-900 focus:outline-none focus-visible:underline"><Icon name="download" size={14} /> {t('common.exportCsv')}</button>
          </div>
          <ul className="divide-y divide-brand-100/70">
            {history.slice(0, 7).map(e => (
              <li key={e.record_id ?? e.date} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className={(MOODS.find(x => x.label === e.mood)?.tone || '').split(' ')[0]}><MoodFace mood={e.mood} size={26} /></span>
                <span className="font-medium text-gray-900 min-w-[4rem]">{tMood(e.mood)}</span>
                <span className="text-gray-500">{t('mood.energyStressSleep', { energy: e.energy, stress: e.stress, sleep: e.sleep_quality })}</span>
                {e.note && <span className="text-gray-500 italic truncate max-w-[260px]">“{e.note}”</span>}
                <span className="ml-auto text-xs text-gray-400">{fmt.isoDate(e.date)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
