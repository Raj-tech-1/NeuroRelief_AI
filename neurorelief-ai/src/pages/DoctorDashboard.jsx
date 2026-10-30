import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../i18n/format'
import { localizeServerMessage } from '../i18n/serverText'
import LanguageSelector from '../components/LanguageSelector'
import ServerMessage from '../components/ServerMessage'
import EnglishOnly from '../components/EnglishOnly'
import { Icon } from '../components/icons'
import RequestRow from '../components/doctor/RequestRow'
import RequestQueue from '../components/doctor/RequestQueue'
import DoctorCalendar from '../components/doctor/DoctorCalendar'
import ReportVerification from '../components/doctor/ReportVerification'
import { todayLocal, byWhen, isStillAhead, initials, isAccessDenied } from '../components/doctor/helpers'
import { useAuth } from '../context/AuthContext'
import {
  getDoctorProfile, getDoctorRequests, updateRequestStatus, markRequestSeen, markAllRequestsSeen,
  getReportFeatureStatus, getDoctorReportSummary
} from '../services/api'

const POLL_MS = 30000

// ids drive the views; labels come from dd.<key>
const navItems = [
  { id: 'dashboard', key: 'navDashboard', icon: 'home' },
  { id: 'requests', key: 'navRequests', icon: 'list' },
  { id: 'calendar', key: 'navCalendar', icon: 'calendar' },
  { id: 'appointments', key: 'navAppointments', icon: 'clock' },
  { id: 'reports', key: 'navReportVerify', icon: 'doc' },
]
// Planned features: shown disabled and marked "Soon" so nothing looks available that is not.
const plannedItems = [
  { key: 'navPatients', icon: 'users' },
]

function WithServerMessage({ k, raw }) {
  const { t } = useTranslation()
  const m = localizeServerMessage(raw)
  return <>{t(k, { message: m.text })}{m.englishOnly && <EnglishOnly />}</>
}

function Spinner({ text }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-teal-700" role="status">
      <span className="w-5 h-5 rounded-full border-2 border-teal-200 border-t-teal-600 animate-spin" aria-hidden="true" />
      <span className="text-sm">{text}</span>
    </div>
  )
}

function Empty({ title, hint }) {
  return (
    <div className="text-center py-8 px-2">
      <p className="font-semibold text-slate-700">{title}</p>
      <p className="text-sm text-slate-500 mt-1">{hint}</p>
    </div>
  )
}

function Panel({ id, title, right, children, className = '' }) {
  return (
    <section aria-labelledby={id} className={`bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 ${className}`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 id={id} className="font-bold text-slate-900">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

function Kpi({ icon, label, value, hint, tone }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 flex items-start gap-3 min-w-0">
      <span className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center ${tone}`}><Icon name={icon} size={22} /></span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        <div className="text-2xl font-bold text-slate-900 leading-tight mt-0.5 break-words">{value}</div>
        <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
      </div>
    </div>
  )
}

const BAR = { pending: 'bg-amber-400', accepted: 'bg-teal-500', declined: 'bg-rose-400', cancelled: 'bg-slate-400' }

export default function DoctorDashboard() {
  const { user, logout } = useAuth()
  const { t } = useTranslation()
  const fmt = useFormat()
  const navigate = useNavigate()

  const [view, setView] = useState('dashboard')
  const [profile, setProfile] = useState(null)
  const [profileError, setProfileError] = useState('')   // raw backend message, localized at render
  const [requests, setRequests] = useState(null)      // null while the first load is running
  const [loadError, setLoadError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [notice, setNotice] = useState(null)          // { type: 'success', key } | { type: 'error', raw }
  const [bellOpen, setBellOpen] = useState(false)
  const [focusId, setFocusId] = useState(null)
  const [filter, setFilter] = useState('all')
  const [reportsWaiting, setReportsWaiting] = useState(0)   // shared reports awaiting review (nav badge); 0 while the feature is off
  const polling = useRef(false)

  const loadRequests = useCallback(async (force = false) => {
    if (polling.current && !force) return
    polling.current = true
    try {
      setRequests(await getDoctorRequests())
      setLoadError('')
    } catch (err) {
      setLoadError(err.message)
    } finally {
      polling.current = false
    }
  }, [])

  // First load, 30-second refresh, and refresh when the tab regains focus
  useEffect(() => {
    loadRequests(true)
    const timer = setInterval(() => loadRequests(), POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') loadRequests() }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadRequests])

  // Badge for the Report Verification item: only asked for when the server says the feature is enabled
  useEffect(() => {
    getReportFeatureStatus().then(s => (s?.enabled === true ? getDoctorReportSummary() : null))
      .then(c => { if (c) setReportsWaiting((c.submitted || 0) + (c.underReview || 0)) }).catch(() => {})
  }, [])

  useEffect(() => {
    getDoctorProfile().then(setProfile).catch(err => setProfileError(err.message))
  }, [])

  // Briefly highlight the request opened from the notification bell
  useEffect(() => {
    if (focusId == null || !requests) return
    const timer = setTimeout(() => setFocusId(null), 4000)
    return () => clearTimeout(timer)
  }, [focusId, requests])

  async function decide(id, status) {
    if (busyId != null) return
    setBusyId(id)
    setNotice(null)
    try {
      await updateRequestStatus(id, status)
      setNotice({ type: 'success', key: status === 'accepted' ? 'dd.noticeAccepted' : 'dd.noticeDeclined' })
      await loadRequests(true)
    } catch (err) {
      setNotice({ type: 'error', raw: err.message })
      loadRequests(true)
    } finally {
      setBusyId(null)
    }
  }

  function openRequest(r) {
    if (r.unread) {
      setRequests(prev => prev && prev.map(x => x.appointment_id === r.appointment_id ? { ...x, unread: false } : x))
      markRequestSeen(r.appointment_id).catch(() => {})
    }
    setFilter('all')
    setView('requests')
    setFocusId(r.appointment_id)
    setBellOpen(false)
  }

  function markAllRead() {
    setRequests(prev => prev && prev.map(x => ({ ...x, unread: false })))
    markAllRequestsSeen().catch(() => loadRequests(true))
  }

  function handleLogout() {
    logout()
    navigate('/auth')
  }

  const list = requests || []
  const pending = list.filter(r => r.status === 'pending')
  const accepted = list.filter(r => r.status === 'accepted').sort(byWhen)
  const today = todayLocal()
  const upcoming = accepted.filter(r => r.date >= today)
  const past = accepted.filter(r => r.date < today)
  const todays = accepted.filter(r => r.date === today)
  const next = accepted.find(r => isStillAhead(r)) || null
  const unread = list.filter(r => r.unread)
  const denied = isAccessDenied(loadError)
  const rowProps = { busyId, onDecide: decide }

  const counts = ['pending', 'accepted', 'declined', 'cancelled'].map(s => ({ s, n: list.filter(r => r.status === s).length }))

  function renderBody() {
    if (denied) {
      return (
        <div role="alert" className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center max-w-xl mx-auto">
          <span className="mx-auto mb-4 w-14 h-14 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center"><Icon name="shield" size={28} /></span>
          <h2 className="text-lg font-bold text-slate-900">{t('dd.deniedTitle')}</h2>
          <p className="text-sm text-slate-600 mt-2">{t('dd.deniedText')}</p>
          <p className="text-xs text-slate-400 mt-2"><ServerMessage message={loadError} /></p>
          <button onClick={handleLogout} className="mt-5 px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200">{t('dd.deniedAction')}</button>
        </div>
      )
    }
    if (requests === null && !loadError) return <Spinner text={t('dd.loading')} />
    if (requests === null && loadError) {
      return (
        <div role="alert" className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center">
          <p className="text-rose-800 font-semibold">{t('dd.loadFail')}</p>
          <p className="text-sm text-rose-700 mt-1"><ServerMessage message={loadError} /></p>
          <button onClick={() => loadRequests(true)} className="mt-3 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-200">{t('common.tryAgain')}</button>
        </div>
      )
    }

    if (view === 'requests') {
      return <RequestQueue list={list} filter={filter} setFilter={setFilter} focusId={focusId} {...rowProps} />
    }

    if (view === 'reports') {
      return <ReportVerification doctorName={profile?.name || user?.name || ''} onSummary={setReportsWaiting} />
    }

    if (view === 'calendar') {
      return <DoctorCalendar list={list} {...rowProps} />
    }

    if (view === 'appointments') {
      return (
        <div className="space-y-4">
          <Panel id="up-h" title={t('dd.upcomingConfirmed')}>
            {upcoming.length === 0
              ? <Empty title={t('dd.noUpcoming')} hint={t('dd.noUpcomingHint')} />
              : <ul className="space-y-2">{upcoming.map(r => <RequestRow key={r.appointment_id} r={r} {...rowProps} />)}</ul>}
          </Panel>
          {past.length > 0 && (
            <Panel id="past-h" title={t('dd.pastConfirmed')}>
              <ul className="space-y-2">{[...past].reverse().map(r => <RequestRow key={r.appointment_id} r={r} {...rowProps} />)}</ul>
            </Panel>
          )}
        </div>
      )
    }

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <Kpi icon="clock" tone="bg-amber-50 text-amber-700" label={t('dd.pendingReq')} value={fmt.number(pending.length)} hint={t('dd.kpiPendingHint')} />
          <Kpi icon="calendar" tone="bg-teal-50 text-teal-700" label={t('dd.kpiToday')} value={fmt.number(todays.length)} hint={t('dd.kpiTodayHint')} />
          <Kpi icon="check" tone="bg-sky-50 text-sky-700" label={t('dd.upcomingAppts')} value={fmt.number(upcoming.length)} hint={t('dd.kpiUpcomingHint')} />
          <Kpi icon="stethoscope" tone="bg-brand-50 text-brand-700" label={t('dd.kpiNext')}
            value={next ? <span className="text-lg">{next.patient_name}</span> : <span className="text-lg text-slate-500">{t('dd.kpiNextNone')}</span>}
            hint={next ? t('header.dateAtTime', { date: fmt.isoDate(next.date), time: fmt.time(next.time) }) : ' '} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 space-y-4 min-w-0">
            <Panel id="pend-h" title={t('dd.pendingReq')}
              right={pending.length > 5 && <button onClick={() => { setFilter('pending'); setView('requests') }} className="text-sm font-semibold text-teal-700 hover:underline">{t('dd.viewAll', { n: fmt.number(pending.length) })}</button>}>
              {pending.length === 0
                ? <Empty title={t('dd.noPending')} hint={t('dd.caughtUp')} />
                : <ul className="space-y-2">{pending.slice(0, 5).map(r => <RequestRow key={r.appointment_id} r={r} highlighted={focusId === r.appointment_id} {...rowProps} />)}</ul>}
            </Panel>
            <Panel id="soon-h" title={t('dd.upcomingAppts')}>
              {upcoming.length === 0
                ? <Empty title={t('dd.noUpcoming')} hint={t('dd.noUpcomingHint')} />
                : <ul className="space-y-2">{upcoming.slice(0, 5).map(r => <RequestRow key={r.appointment_id} r={r} {...rowProps} />)}</ul>}
            </Panel>
          </div>

          <div className="space-y-4 min-w-0">
            <Panel id="today-h" title={t('dd.todayTitle')}>
              {todays.length === 0
                ? <p className="text-sm text-slate-500 py-2">{t('dd.todayNone')}</p>
                : <ul className="space-y-2">{todays.map(r => (
                    <li key={r.appointment_id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                      <span className="shrink-0 text-sm font-semibold text-teal-700 w-20">{fmt.time(r.time)}</span>
                      <span className="min-w-0 font-medium text-slate-900 break-words">{r.patient_name}</span>
                    </li>
                  ))}</ul>}
            </Panel>
            <Panel id="status-h" title={t('dd.statusOverview')}>
              {list.length === 0
                ? <p className="text-sm text-slate-500 py-2">{t('dd.noneHint')}</p>
                : (
                  <>
                    <div className="flex h-3 rounded-full overflow-hidden bg-slate-100" role="img"
                      aria-label={counts.map(c => `${t(`apptStatus.${c.s}`)}: ${fmt.number(c.n)}`).join(', ')}>
                      {counts.filter(c => c.n > 0).map(c => <span key={c.s} className={BAR[c.s]} style={{ width: `${(c.n / list.length) * 100}%` }} />)}
                    </div>
                    <ul className="mt-3 space-y-1.5">
                      {counts.map(c => (
                        <li key={c.s} className="flex items-center justify-between gap-3 text-sm">
                          <span className="flex items-center gap-2 text-slate-700 min-w-0"><span className={`shrink-0 w-2.5 h-2.5 rounded-full ${BAR[c.s]}`} aria-hidden="true" /><span className="break-words">{t(`apptStatus.${c.s}`)}</span></span>
                          <span className="font-semibold text-slate-900">{fmt.number(c.n)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-slate-500 mt-3">{t('dd.statusOverviewHint', { n: fmt.number(list.length) })}</p>
                  </>
                )}
            </Panel>
          </div>
        </div>
      </div>
    )
  }

  const navBtn = (n, mobile) => (
    <button key={n.id} onClick={() => setView(n.id)} aria-current={view === n.id ? 'page' : undefined}
      className={`whitespace-nowrap text-left rounded-xl text-sm font-medium transition flex items-center gap-3 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200 ${mobile ? 'px-3 py-2' : 'px-3.5 py-2.5 w-full'} ${
        view === n.id ? 'bg-brand-50 text-brand-800 font-semibold ring-1 ring-brand-200' : 'text-slate-700 hover:bg-slate-100'
      }`}>
      <Icon name={n.icon} size={18} className={view === n.id ? 'text-brand-600' : 'text-slate-500'} />
      <span>{t(`dd.${n.key}`)}</span>
      {n.id === 'reports' && reportsWaiting > 0 && (
        <span className={`${mobile ? '' : 'ml-auto'} text-xs font-semibold px-1.5 py-0.5 rounded-full ${view === n.id ? 'bg-brand-600 text-white' : 'bg-amber-100 text-amber-800'}`}>{fmt.number(reportsWaiting)}</span>
      )}
      {n.id === 'requests' && pending.length > 0 && (
        <span className={`${mobile ? '' : 'ml-auto'} text-xs font-semibold px-1.5 py-0.5 rounded-full ${view === n.id ? 'bg-brand-600 text-white' : 'bg-amber-100 text-amber-800'}`}>{fmt.number(pending.length)}</span>
      )}
    </button>
  )

  const doctorName = profile?.name || user?.name || t('dd.doctorFallback')
  const title = t(`dd.${navItems.find(n => n.id === view).key}`)

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="md:w-64 md:shrink-0 bg-white md:sticky md:top-0 md:h-screen p-3 md:p-5 flex flex-col gap-3 border-b md:border-b-0 md:border-r border-slate-200">
        <p className="flex items-center gap-2 text-xl font-extrabold text-brand-800 md:mb-3">
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-white flex items-center justify-center" aria-hidden="true"><Icon name="heart" size={18} /></span>
          <span>NeuroRelief <span className="text-brand-500">AI</span></span>
        </p>
        <nav className="flex md:flex-col gap-1.5 overflow-x-auto md:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label={t('dd.navLabel')}>
          {navItems.map(n => navBtn(n, false))}
        </nav>
        <div className="hidden md:block mt-4" aria-label={t('dd.comingLater')} role="group">
          <p className="px-3.5 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t('dd.comingLater')}</p>
          {plannedItems.map(n => (
            <div key={n.key} aria-disabled="true" title={t('dd.notAvailable')}
              className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm text-slate-400 cursor-not-allowed select-none">
              <Icon name={n.icon} size={18} />
              <span>{t(`dd.${n.key}`)}</span>
              <span className="ml-auto text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">{t('dd.soon')}</span>
            </div>
          ))}
        </div>
        <button onClick={handleLogout} className="hidden md:flex md:mt-auto items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200">
          <Icon name="logout" size={18} className="text-slate-500" /> {t('nav.logout')}
        </button>
      </aside>

      <div className="flex-1 min-w-0">
        {/* Top bar */}
        <header className="flex flex-wrap items-center justify-between gap-3 px-4 md:px-6 py-3 bg-white/90 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <span aria-hidden="true" className="shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white font-bold text-sm flex items-center justify-center">{initials(doctorName)}</span>
            <div className="min-w-0">
              <p className="font-bold text-slate-900 break-words leading-tight">{doctorName}</p>
              <p className="text-sm text-teal-700 break-words">{profile?.specialty ? t(`specialty.${profile.specialty}`, { defaultValue: profile.specialty }) : (profileError ? t('dd.profileUnavailable') : ' ')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <LanguageSelector />
            <p className="hidden lg:block text-sm text-slate-500">
              {fmt.date(Date.now(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
            <div className="relative">
              <button onClick={() => setBellOpen(o => !o)} aria-expanded={bellOpen} aria-label={t('header.notificationsUnread', { count: unread.length })}
                className="relative w-11 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200">
                <Icon name="bell" size={22} />
                {unread.length > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center">{fmt.number(unread.length)}</span>
                )}
              </button>
              {bellOpen && (
                <>
                  <button className="fixed inset-0 z-40 cursor-default" aria-label={t('header.closeNotifications')} onClick={() => setBellOpen(false)} />
                  <div className="absolute right-0 mt-2 w-80 max-w-[85vw] bg-white rounded-2xl shadow-xl border border-slate-200 z-50 p-3">
                    <div className="flex items-center justify-between gap-2 px-1 pb-2">
                      <p className="font-semibold text-slate-900 text-sm">{t('dd.newRequests')}</p>
                      {unread.length > 0 && <button onClick={markAllRead} className="text-xs text-teal-700 font-semibold hover:underline">{t('dd.markAllRead')}</button>}
                    </div>
                    {unread.length === 0
                      ? <p className="text-sm text-slate-500 px-1 py-4 text-center">{t('dd.noNew')}</p>
                      : <ul className="max-h-72 overflow-y-auto space-y-1">
                          {unread.map(r => (
                            <li key={r.appointment_id}>
                              <button onClick={() => openRequest(r)} className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300">
                                <p className="text-sm font-medium text-slate-900">{t('dd.requested', { patient: r.patient_name })}</p>
                                <p className="text-xs text-slate-500">{t('header.dateAtTime', { date: fmt.isoDate(r.date), time: fmt.time(r.time) })}</p>
                              </button>
                            </li>
                          ))}
                        </ul>}
                  </div>
                </>
              )}
            </div>
            <button onClick={handleLogout} className="md:hidden w-11 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200" aria-label={t('nav.logout')} title={t('nav.logout')}>
              <Icon name="logout" size={20} />
            </button>
          </div>
        </header>

        <main className="px-4 md:px-6 py-5 max-w-[1280px]">
          <h1 className="text-2xl font-bold text-slate-900 mb-4">{title}</h1>

          {profileError && !denied && (
            <div role="alert" className="mb-4 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3">
              <WithServerMessage k="dd.profileErr" raw={profileError} />
            </div>
          )}
          <div aria-live="polite">
            {notice && (
              <div className={`mb-4 text-sm rounded-xl px-4 py-3 border flex items-start justify-between gap-3 ${notice.type === 'success' ? 'bg-teal-50 border-teal-200 text-teal-900' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                <span>{notice.key ? t(notice.key) : <WithServerMessage k="dd.noticeError" raw={notice.raw} />}</span>
                <button onClick={() => setNotice(null)} className="text-xs underline shrink-0">{t('common.dismiss')}</button>
              </div>
            )}
          </div>
          {requests !== null && loadError && !denied && (
            <div role="alert" className="mb-4 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3 flex items-center justify-between gap-3">
              <span><WithServerMessage k="dd.refreshFail" raw={loadError} /></span>
              <button onClick={() => loadRequests(true)} className="text-xs underline shrink-0">{t('common.retry')}</button>
            </div>
          )}

          {renderBody()}
          <p className="text-xs text-slate-400 mt-6">
            {t('dd.footnote')}
          </p>
        </main>
      </div>
    </div>
  )
}
