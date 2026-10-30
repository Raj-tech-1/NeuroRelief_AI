import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Icon } from '../../components/icons'
import { useFormat } from '../../i18n/format'
import { getCycleData, getMoodData, getMyBookings, getPredictionHistory, getPastScans } from '../../services/api'

const todayKey = () => new Date().toISOString().split('T')[0]
const waterKey = () => 'neurorelief_water_' + todayKey()
const meditationKey = () => 'neurorelief_meditation_' + todayKey()
const WATER_GOAL = 8

function localToday() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// SQLite timestamps are "YYYY-MM-DD HH:MM:SS" (UTC); plain dates are treated as local noon.
function parseTs(s) {
  if (!s) return 0
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T12:00:00').getTime()
  const t = new Date(String(s).replace(' ', 'T') + 'Z').getTime()
  return Number.isNaN(t) ? 0 : t
}

const MINUTES = t => {
  const m = /^(\d+):(\d+) (AM|PM)$/.exec(t || '')
  return m ? ((Number(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0)) * 60 + Number(m[2]) : 0
}

const card = 'bg-white/90 rounded-2xl border border-brand-100/70 shadow-sm shadow-brand-100/50'

function IconBadge({ name, tone = 'bg-brand-50 text-brand-600', size = 22 }) {
  return <span className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${tone}`}><Icon name={name} size={size} /></span>
}

function CycleRing({ day, length, phase }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const r = 52, c = 2 * Math.PI * r
  const progress = Math.min(1, Math.max(0, day / Math.max(length, 1)))
  return (
    <div className="relative w-36 h-36 mx-auto" role="img" aria-label={t('overview.ringLabel', { day: fmt.number(day), length: fmt.number(length), phase })}>
      <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" stroke="#FDDDE6" strokeWidth="10" />
        <circle cx="64" cy="64" r={r} fill="none" stroke="#D53F8C" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - progress)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-brand-800">{fmt.number(day)}</span>
        <span className="text-xs text-gray-500">{t('overview.ofDays', { length: fmt.number(length) })}</span>
      </div>
    </div>
  )
}

export default function Overview({ onTabChange }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const fmt = useFormat()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [waterCount, setWaterCount] = useState(() => {
    try { return parseInt(localStorage.getItem(waterKey())) || 0 } catch { return 0 }
  })
  const [meditationDone, setMeditationDone] = useState(() => {
    try { return localStorage.getItem(meditationKey()) === 'true' } catch { return false }
  })

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    const [cy, mood, bk, pred, scans] = await Promise.allSettled([
      getCycleData('usr'), getMoodData('usr'), getMyBookings(), getPredictionHistory(), getPastScans('usr'),
    ])
    if ([cy, mood, bk, pred, scans].every(r => r.status === 'rejected')) { setFailed(true); setLoading(false); return }
    const val = (r, fallback) => (r.status === 'fulfilled' && r.value ? r.value : fallback)
    setData({
      cycle: val(cy, null),
      mood: val(mood, null),
      bookings: Array.isArray(val(bk, [])) ? val(bk, []) : [],
      predictions: Array.isArray(val(pred, [])) ? val(pred, []) : [],
      scans: Array.isArray(val(scans, [])) ? val(scans, []) : [],
    })
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function changeWater(delta) {
    const next = Math.max(0, Math.min(WATER_GOAL, waterCount + delta))
    setWaterCount(next)
    try { localStorage.setItem(waterKey(), String(next)) } catch {}
  }

  function toggleMeditation() {
    const next = !meditationDone
    setMeditationDone(next)
    try { localStorage.setItem(meditationKey(), String(next)) } catch {}
  }

  const greeting = () => {
    const h = new Date().getHours()
    return t(h < 12 ? 'overview.greetingMorning' : h < 17 ? 'overview.greetingAfternoon' : 'overview.greetingEvening')
  }
  const fmtDate = s => { const ts = parseTs(s); return ts ? fmt.date(ts) : '' }
  const tPhase = ph => t(`phase.${ph}`, { defaultValue: ph })
  const tStatus = st => t(`status.${st}`, { defaultValue: st })
  const tSeverity = sv => t(`severity.${sv}`, { defaultValue: sv })
  const tMood = m => t(`moodValue.${m}`, { defaultValue: m })   // mood labels are translated in Phase 2; raw value until then

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-brand-700" role="status">
        <span className="w-5 h-5 rounded-full border-2 border-brand-200 border-t-brand-600 animate-spin" aria-hidden="true" />
        <span className="text-sm">{t('overview.loading')}</span>
      </div>
    )
  }
  if (failed || !data) {
    return (
      <div role="alert" className={`${card} p-8 text-center`}>
        <p className="font-semibold text-gray-800">{t('overview.failedTitle')}</p>
        <p className="text-sm text-gray-500 mt-1">{t('overview.failedText')}</p>
        <button onClick={load} className="mt-4 px-5 py-2 bg-brand-700 text-white rounded-lg text-sm font-medium hover:bg-brand-800">{t('overview.tryAgain')}</button>
      </div>
    )
  }

  // ---- derive everything from real backend data ----
  const cyc = data.cycle
  const hasCycle = !!(cyc && cyc.currentPhase && cyc.currentPhase !== 'Unknown')
  const cycleLength = cyc?.lastCycle?.cycleLength || 28
  const cyclesCount = cyc?.cycles?.length || 0
  const moodRecords = data.mood?.history || []
  const moodCount = moodRecords.length

  const today = localToday()
  const nextAppt = data.bookings
    .filter(b => (b.status === 'pending' || b.status === 'accepted') && b.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || MINUTES(a.time) - MINUTES(b.time))[0]
  const latestPred = data.predictions[0]

  const activity = [
    ...(cyc?.cycles || []).map(c => ({ ts: parseTs(c.created_at) || parseTs(c.start_date), icon: 'calendar', title: t('overview.cycleLogged'), detail: t('overview.started', { date: fmtDate(c.start_date) }) })),
    ...moodRecords.map(m => ({ ts: parseTs(m.created_at) || parseTs(m.date), icon: 'smile', title: t('overview.moodCheckin'), detail: m.mood ? tMood(m.mood) : t('overview.logged') })),
    ...data.scans.map(s => ({ ts: parseTs(s.created_at), icon: 'image', title: t('overview.symptomScan'), detail: s.body_areas || t('overview.assessmentSaved') })),
    ...data.bookings.map(b => ({ ts: parseTs(b.created_at), icon: 'stethoscope', title: t('overview.appointmentStatus', { status: tStatus(b.status) }), detail: `${b.doctor_name || t('overview.doctor')} • ${t('header.dateAtTime', { date: fmtDate(b.date), time: b.time })}` })),
    ...data.predictions.map(p => ({ ts: parseTs(p.created_at) || parseTs(p.date), icon: 'brain', title: t('overview.painPrediction'), detail: t('overview.severityDetail', { severity: tSeverity(p.predicted_severity) }) })),
  ].filter(a => a.ts).sort((a, b) => b.ts - a.ts).slice(0, 6)

  const statCards = [
    { icon: 'calendar', tone: 'bg-brand-50 text-brand-600', label: t('overview.cyclesTracked'), value: fmt.number(cyclesCount), numeric: true, sub: t('overview.totalCycles'), onClick: () => onTabChange('cycle') },
    { icon: 'smile', tone: 'bg-purple-50 text-purple-600', label: t('overview.moodCheckins'), value: fmt.number(moodCount), numeric: true, sub: moodCount ? t('overview.keepItUp') : t('overview.startMood'), onClick: () => onTabChange('mood') },
    {
      icon: 'stethoscope', tone: 'bg-green-50 text-green-600', label: t('overview.upcomingAppt'),
      value: nextAppt ? nextAppt.doctor_name : t('overview.noneScheduled'), small: !!nextAppt,
      sub: nextAppt ? t('overview.apptSub', { date: fmtDate(nextAppt.date), time: nextAppt.time, status: tStatus(nextAppt.status) }) : t('overview.bookConsult'),
      onClick: () => onTabChange('doctor'), chevron: true,
    },
    {
      icon: 'chart', tone: 'bg-brand-50 text-brand-600', label: t('overview.latestPrediction'),
      value: latestPred ? tSeverity(latestPred.predicted_severity) : t('overview.notAvailable'), small: !latestPred,
      sub: latestPred ? `${fmtDate(latestPred.created_at || latestPred.date)}` : t('overview.logToPredict'),
      onClick: () => onTabChange('symptom'),
    },
  ]

  const quickActions = [
    { icon: 'calendar', tone: 'bg-brand-50 text-brand-600', title: t('nav.cycle'), sub: t('overview.cycleTrackingSub'), go: () => onTabChange('cycle') },
    { icon: 'brain', tone: 'bg-purple-50 text-purple-600', title: t('nav.symptom'), sub: t('overview.advisorSub'), go: () => onTabChange('symptom') },
    { icon: 'stethoscope', tone: 'bg-green-50 text-green-600', title: t('nav.doctor'), sub: t('overview.doctorSub'), go: () => onTabChange('doctor') },
    { icon: 'image', tone: 'bg-indigo-50 text-indigo-600', title: t('overview.pastScans'), sub: t('overview.pastScansSub'), go: () => navigate('/past-scans') },
  ]

  return (
    <div className="space-y-5">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-100/80 via-brand-50 to-white border border-brand-100/70 p-6 md:p-8 grid gap-6 lg:grid-cols-[1fr_380px] items-center">
        <svg viewBox="0 0 400 260" className="hidden lg:block absolute right-[340px] top-0 h-full w-[360px] opacity-70 pointer-events-none" aria-hidden="true">
          <path d="M260 250c-6-70 6-130 40-190" stroke="#F9A8D4" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M280 170c-46-8-70-34-74-72 46 4 70 30 74 72z" fill="#FBCFE8" opacity=".8" />
          <path d="M300 110c38-12 58-38 58-76-38 8-58 34-58 76z" fill="#F9A8D4" opacity=".6" />
          <path d="M270 215c-34 4-58-10-72-36 34-6 62 8 72 36z" fill="#FCE7F3" />
          <circle cx="340" cy="190" r="34" fill="#FDDDE6" opacity=".7" />
        </svg>
        <div className="relative">
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-brand-800/80 mb-2">{greeting()}</p>
          <h2 className="hero-title text-3xl md:text-4xl font-bold text-brand-900 leading-tight" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
            {t('overview.heroTitle')}
          </h2>
          <p className="text-gray-600 mt-3 max-w-md">{t('overview.heroText')}</p>
        </div>

        <div className={`${card} relative p-5`}>
          <p className="font-semibold text-gray-900 mb-3">{t('overview.cycleStatus')}</p>
          <div className="flex items-start gap-4">
            <IconBadge name="calendar" size={24} />
            <div className="min-w-0">
              {hasCycle ? (
                <>
                  <p className="font-bold text-brand-900">{t('overview.dayPhase', { day: fmt.number(cyc.dayOfCycle), phase: tPhase(cyc.currentPhase) })}</p>
                  <p className="text-sm text-gray-500">
                    {cyc.nextPeriod > 0 ? t('overview.nextPeriod', { count: cyc.nextPeriod }) : t('overview.nextPeriodAny')}
                    {cyc.fertileWindow?.start && cyc.fertileWindow.start !== '-' ? ` ${t('overview.fertile', { start: cyc.fertileWindow.start, end: cyc.fertileWindow.end })}` : ''}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-bold text-brand-900">{t('overview.noCycle')}</p>
                  <p className="text-sm text-gray-500">{t('overview.noCycleText')}</p>
                </>
              )}
            </div>
          </div>
          <button onClick={() => onTabChange('cycle')}
            className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 bg-brand-700 hover:bg-brand-800 text-white rounded-xl font-semibold text-sm transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300">
            {hasCycle ? t('overview.openCycle') : t('overview.logFirst')} <Icon name="arrow" size={16} />
          </button>
        </div>
      </section>

      {/* Stat cards */}
      <section className="indic-2col grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" aria-label={t('overview.summary')}>
        {statCards.map(s => (
          <button key={s.icon + s.label} onClick={s.onClick}
            className={`${card} p-5 flex items-center gap-4 text-left hover:shadow-md hover:border-brand-200 transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200`}>
            <IconBadge name={s.icon} tone={s.tone} size={26} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-600 flex items-center justify-between">{s.label}{s.chevron && <Icon name="chevron" size={16} className="text-gray-400" />}</p>
              <p className={`font-bold text-brand-900 leading-tight mt-0.5 ${s.numeric ? 'text-3xl' : 'text-xl'}`}>{s.value}</p>
              <p className="text-xs text-gray-500 mt-1">{s.sub}</p>
            </div>
          </button>
        ))}
      </section>

      {/* Middle row */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Cycle overview */}
        <div className={`${card} p-5 flex flex-col`}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3 min-w-0 flex-1 basis-48">
              <IconBadge name="calendar" size={20} />
              <div className="min-w-0">
                <h3 className="font-bold text-gray-900">{t('overview.cycleOverview')}</h3>
                <p className="text-xs text-gray-500">{t('overview.cycleOverviewDesc')}</p>
              </div>
            </div>
            <button onClick={() => onTabChange('cycle')} className="shrink-0 flex items-center gap-1 px-3 py-1.5 border border-brand-200 text-brand-700 rounded-lg text-sm hover:bg-brand-50">
              <Icon name="plus" size={14} /> {t('overview.logCycle')}
            </button>
          </div>
          {hasCycle ? (
            <div className="flex-1 flex flex-col items-center justify-center py-2">
              <CycleRing day={cyc.dayOfCycle} length={cycleLength} phase={tPhase(cyc.currentPhase)} />
              <p className="font-semibold text-gray-900 mt-3">{t('overview.phaseLabel', { phase: tPhase(cyc.currentPhase) })}</p>
              <p className="text-xs text-gray-500 text-center mt-1 max-w-xs">{t(`phaseDesc.${cyc.currentPhase}`, { defaultValue: cyc.insights?.description })}</p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-4">
              <div className="w-32 h-32 rounded-full border-2 border-dashed border-brand-200 flex items-center justify-center mb-3">
                <IconBadge name="calendar" size={28} />
              </div>
              <p className="font-semibold text-gray-900">{t('overview.noCycleData')}</p>
              <p className="text-xs text-gray-500 mt-1 max-w-[260px]">{t('overview.noCycleDataText')}</p>
              <button onClick={() => onTabChange('cycle')} className="mt-4 px-8 py-2.5 bg-brand-700 hover:bg-brand-800 text-white rounded-lg text-sm font-semibold">{t('overview.logFirst')}</button>
            </div>
          )}
        </div>

        {/* Wellness check-in */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-3 mb-4">
            <IconBadge name="heart" size={20} />
            <div>
              <h3 className="font-bold text-gray-900">{t('overview.wellness')}</h3>
              <p className="text-xs text-gray-500">{t('overview.wellnessDesc')}</p>
            </div>
          </div>
          {[
            { icon: 'smile', tone: 'bg-orange-50 text-orange-500', title: t('overview.logMood'), sub: t('overview.logMoodSub'), go: () => onTabChange('mood') },
            { icon: 'doc', tone: 'bg-indigo-50 text-indigo-500', title: t('overview.trackSymptoms'), sub: t('overview.trackSymptomsSub'), go: () => onTabChange('symptom') },
          ].map(a => (
            <button key={a.title} onClick={a.go}
              className="w-full flex items-center gap-3 p-3 mb-3 rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50/60 to-white hover:border-brand-200 text-left transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200">
              <IconBadge name={a.icon} tone={a.tone} size={20} />
              <span className="flex-1"><span className="block text-sm font-semibold text-brand-900">{a.title}</span><span className="block text-xs text-gray-500">{a.sub}</span></span>
              <Icon name="chevron" size={16} className="text-gray-400" />
            </button>
          ))}

          <div className="border-t border-brand-100 pt-4 mt-1">
            <div className="flex items-center gap-3 mb-3">
              <IconBadge name="leaf" size={20} />
              <div>
                <p className="text-sm font-semibold text-gray-900">{t('overview.todaysFocus')}</p>
                <p className="text-xs text-gray-500">{t('overview.focusSub')}</p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="flex items-center gap-2 text-sm text-gray-700"><Icon name="drop" size={16} className="text-blue-500" /> {t('overview.hydration')}</span>
              <span className="flex items-center gap-2">
                <button onClick={() => changeWater(-1)} disabled={waterCount <= 0} aria-label={t('overview.removeGlass')}
                  className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40">−</button>
                <span className="text-sm font-medium text-gray-800 w-14 text-center">{fmt.number(waterCount)} / {fmt.number(WATER_GOAL)}</span>
                <button onClick={() => changeWater(1)} disabled={waterCount >= WATER_GOAL} aria-label={t('overview.addGlass')}
                  className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-40">+</button>
              </span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full mb-3" aria-hidden="true">
              <div className="h-1.5 bg-blue-400 rounded-full transition-all" style={{ width: `${(waterCount / WATER_GOAL) * 100}%` }} />
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-gray-700"><Icon name="leaf" size={16} className="text-green-500" /> {t('overview.mindfulness')}</span>
              <button onClick={toggleMeditation} aria-pressed={meditationDone}
                className={`px-3 py-1 text-xs rounded-full font-medium transition ${meditationDone ? 'bg-green-100 text-green-700' : 'bg-brand-100 text-brand-700 hover:bg-brand-200'}`}>
                {meditationDone ? t('overview.done') : t('overview.markDone')}
              </button>
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-3 mb-4">
            <IconBadge name="bolt" size={20} />
            <div>
              <h3 className="font-bold text-gray-900">{t('overview.quickActions')}</h3>
              <p className="text-xs text-gray-500">{t('overview.quickActionsDesc')}</p>
            </div>
          </div>
          <div className="space-y-3">
            {quickActions.map(a => (
              <button key={a.title} onClick={a.go}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-brand-100 hover:border-brand-200 hover:bg-brand-50/40 text-left transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200">
                <IconBadge name={a.icon} tone={a.tone} size={20} />
                <span className="flex-1 min-w-0"><span className="block text-sm font-semibold text-brand-900">{a.title}</span><span className="block text-xs text-gray-500 truncate">{a.sub}</span></span>
                <Icon name="chevron" size={16} className="text-gray-400" />
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Recent activity */}
      <section className={`${card} p-5`}>
        <div className="flex items-center gap-3 mb-4">
          <IconBadge name="doc" size={20} />
          <div>
            <h3 className="font-bold text-gray-900">{t('overview.recentActivity')}</h3>
            <p className="text-xs text-gray-500">{t('overview.recentActivityDesc')}</p>
          </div>
        </div>
        {activity.length === 0 ? (
          <div className="text-center py-6">
            <div className="flex justify-center"><IconBadge name="doc" size={26} /></div>
            <p className="font-semibold text-gray-900 mt-3">{t('overview.activityEmpty')}</p>
            <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">{t('overview.activityEmptyText')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-brand-100/70">
            {activity.map((a, i) => (
              <li key={i} className="flex items-center gap-3 py-3">
                <span className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center shrink-0"><Icon name={a.icon} size={18} /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{a.title}</p>
                  <p className="text-xs text-gray-500 truncate">{a.detail}</p>
                </div>
                <span className="text-xs text-gray-400 shrink-0">{fmt.date(a.ts, { month: 'short', day: 'numeric' })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
