import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../i18n/format'
import { localizeServerMessage } from '../i18n/serverText'
import LanguageSelector from '../components/LanguageSelector'
import ServerMessage from '../components/ServerMessage'
import EnglishOnly from '../components/EnglishOnly'
import { Icon, LeafLogo } from '../components/icons'
import RequestQueue from '../components/doctor/RequestQueue'
import DoctorCalendar from '../components/doctor/DoctorCalendar'
import ReportVerification from '../components/doctor/ReportVerification'
import AppointmentDrawer from '../components/doctor/AppointmentDrawer'
import {
  DashboardHome, AppointmentsView, PatientsView, NotesView, MessagesView, FollowUpsView, InsightsView, SettingsView, CareUnavailable,
} from '../components/doctor/CareViews'
import { useCareStatus, eventText, eventIcon, ago } from '../components/care/shared'
import { initials, isAccessDenied } from '../components/doctor/helpers'
import { useAuth } from '../context/AuthContext'
import {
  getDoctorProfile, getDoctorRequests, updateRequestStatus, markRequestSeen, markAllRequestsSeen,
  getReportFeatureStatus, getDoctorReportSummary, getDoctorDashboard, getCareActivity,
} from '../services/api'

// The 3D explorer (three.js) loads only when it is opened. Doctors get the educational explorer, never Device Control.
const Device3DExplorer = lazy(() => import('./tabs/Device3DExplorer'))

const POLL_MS = 30000

// Sidebar. Items marked care: true need the synchronisation update on the server.
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home' },
  { id: 'patients', label: 'Patients', icon: 'users', care: true },
  { id: 'requests', label: 'Appointment Requests', icon: 'list' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'appointments', label: 'Appointments', icon: 'clock' },
  { id: 'notes', label: 'Consultation Notes', icon: 'doc', care: true },
  { id: 'reports', label: 'Report Verification', icon: 'shield' },
  { id: 'messages', label: 'Patient Messages', icon: 'message', care: true },
  { id: 'followups', label: 'Follow-up Centre', icon: 'bell', care: true },
]
const TOOLS = [
  { id: 'insights', label: 'Patient Insights', icon: 'chart', care: true },
  { id: 'explorer', label: 'Device 3D Explorer', icon: 'cube' },
]
const ALL = [...NAV, ...TOOLS, { id: 'settings', label: 'Settings', icon: 'settings' }]

function WithServerMessage({ k, raw }) {
  const { t } = useTranslation()
  const m = localizeServerMessage(raw)
  return <>{t(k, { message: m.text })}{m.englishOnly && <EnglishOnly />}</>
}

function Spinner({ text }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-brand-700" role="status">
      <span className="w-5 h-5 rounded-full border-2 border-brand-200 border-t-brand-600 animate-spin" aria-hidden="true" />
      <span className="text-sm">{text}</span>
    </div>
  )
}

const seenKey = id => `neurorelief_doctor_activity_seen_${id}`
const readSeen = id => { try { return Number(localStorage.getItem(seenKey(id))) || 0 } catch { return 0 } }

export default function DoctorDashboard() {
  const { user, logout } = useAuth()
  const { t } = useTranslation()
  const fmt = useFormat()
  const navigate = useNavigate()
  const care = useCareStatus()

  const [view, setView] = useState('dashboard')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [profile, setProfile] = useState(null)
  const [profileError, setProfileError] = useState('')
  const [requests, setRequests] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [notice, setNotice] = useState(null)
  const [bellOpen, setBellOpen] = useState(false)
  const [focusId, setFocusId] = useState(null)
  const [filter, setFilter] = useState('all')
  const [reportsWaiting, setReportsWaiting] = useState(0)
  const [dash, setDash] = useState(null)
  const [activity, setActivity] = useState([])
  const [seenCursor, setSeenCursor] = useState(() => readSeen(user?.user_id))
  const [cursor, setCursor] = useState(0)
  const [openAppt, setOpenAppt] = useState(null)
  const [insightPatient, setInsightPatient] = useState(null)
  const [notesPatient, setNotesPatient] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const polling = useRef(false)

  // One refresh for everything the dashboard shows. Never two at once.
  const refresh = useCallback(async (force = false) => {
    if (polling.current && !force) return
    polling.current = true
    try {
      setRequests(await getDoctorRequests())
      setLoadError('')
      setUpdatedAt(Date.now())
    } catch (err) {
      setLoadError(err.message)
    } finally {
      polling.current = false
    }
    if (care.enabled) {
      getDoctorDashboard().then(setDash).catch(() => {})
      getCareActivity().then(a => { setActivity(a.items || []); setCursor(a.cursor || 0) }).catch(() => {})
    }
    getReportFeatureStatus().then(s => (s?.enabled === true ? getDoctorReportSummary() : null))
      .then(c => { if (c) setReportsWaiting((c.submitted || 0) + (c.underReview || 0)) }).catch(() => {})
  }, [care.enabled])

  useEffect(() => {
    if (care.loading) return
    refresh(true)
    const timer = setInterval(() => refresh(), POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh, care.loading])

  useEffect(() => { getDoctorProfile().then(setProfile).catch(err => setProfileError(err.message)) }, [])

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
      await refresh(true)
    } catch (err) {
      setNotice({ type: 'error', raw: err.message })
      refresh(true)
    } finally {
      setBusyId(null)
    }
  }

  function go(id) { setView(id); setDrawerOpen(false); setBellOpen(false) }

  function openRequest(r) {
    if (r.unread) {
      setRequests(prev => prev && prev.map(x => x.appointment_id === r.appointment_id ? { ...x, unread: false } : x))
      markRequestSeen(r.appointment_id).catch(() => {})
    }
    setFilter('all')
    go('requests')
    setFocusId(r.appointment_id)
  }

  function openActivity(a) {
    setBellOpen(false)
    if (a.source === 'report') return go('reports')
    if (a.type === 'message_sent') return go('messages')
    if (a.appointmentId && care.enabled) setOpenAppt(a.appointmentId)
  }

  function markAllRead() {
    setRequests(prev => prev && prev.map(x => ({ ...x, unread: false })))
    markAllRequestsSeen().catch(() => refresh(true))
    setSeenCursor(cursor)
    try { localStorage.setItem(seenKey(user?.user_id), String(cursor)) } catch { /* private mode */ }
  }

  function handleLogout() { logout(); navigate('/auth') }

  const list = requests || []
  const pending = list.filter(r => r.status === 'pending')
  const unread = list.filter(r => r.unread)
  const newActivity = activity.filter(a => a.source === 'appointment' && a.eventId > seenCursor && a.type !== 'requested')
  const bellCount = unread.length + newActivity.length
  const denied = isAccessDenied(loadError)
  const rowProps = { busyId, onDecide: decide, onOpen: care.enabled ? setOpenAppt : undefined }
  const openInsights = id => { setInsightPatient(id); setOpenAppt(null); go('insights') }

  function renderBody() {
    if (denied) {
      return (
        <div role="alert" className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center max-w-xl mx-auto">
          <span className="mx-auto mb-4 w-14 h-14 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center"><Icon name="shield" size={28} /></span>
          <h2 className="text-lg font-bold text-slate-900">{t('dd.deniedTitle')}</h2>
          <p className="text-sm text-slate-600 mt-2">{t('dd.deniedText')}</p>
          <p className="text-xs text-slate-400 mt-2"><ServerMessage message={loadError} /></p>
          <button onClick={handleLogout} className="mt-5 px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-semibold">{t('dd.deniedAction')}</button>
        </div>
      )
    }
    if (requests === null && !loadError) return <Spinner text={t('dd.loading')} />
    if (requests === null && loadError) {
      return (
        <div role="alert" className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center">
          <p className="text-rose-800 font-semibold">{t('dd.loadFail')}</p>
          <p className="text-sm text-rose-700 mt-1"><ServerMessage message={loadError} /></p>
          <button onClick={() => refresh(true)} className="mt-3 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-semibold">{t('common.tryAgain')}</button>
        </div>
      )
    }
    const item = ALL.find(n => n.id === view)
    if (item?.care && !care.enabled) return <CareUnavailable />
    switch (view) {
      case 'requests': return <RequestQueue list={list} filter={filter} setFilter={setFilter} focusId={focusId} {...rowProps} />
      case 'calendar': return <DoctorCalendar list={list} {...rowProps} />
      case 'appointments': return care.enabled ? <AppointmentsView requests={list} onOpenAppointment={setOpenAppt} /> : <DoctorCalendar list={list} {...rowProps} />
      case 'reports': return <ReportVerification doctorName={profile?.name || user?.name || ''} onSummary={setReportsWaiting} />
      case 'patients': return <PatientsView onOpenInsights={openInsights} onOpenNotes={id => { setNotesPatient(id); go('notes') }} />
      case 'notes': return <NotesView patientId={notesPatient} onClearPatient={() => setNotesPatient(null)} />
      case 'messages': return <MessagesView />
      case 'followups': return <FollowUpsView />
      case 'insights': return <InsightsView patientId={insightPatient} onPickPatient={setInsightPatient} />
      case 'explorer': return <Suspense fallback={<Spinner text="Loading 3D explorer…" />}><Device3DExplorer /></Suspense>
      case 'settings': return <SettingsView profile={profile} careEnabled={care.enabled} />
      default:
        return <DashboardHome requests={list} dash={dash} activity={activity} reportsWaiting={reportsWaiting} careEnabled={care.enabled}
          onNavigate={go} onOpenAppointment={id => (care.enabled ? setOpenAppt(id) : go('requests'))} updatedAt={updatedAt} onRefresh={() => refresh(true)} />
    }
  }

  const badge = id => {
    const n = id === 'requests' ? pending.length : id === 'reports' ? reportsWaiting : id === 'messages' ? (dash?.unreadMessages || 0) : 0
    return n > 0 ? n : null
  }
  const navButton = n => {
    const active = view === n.id
    const b = badge(n.id)
    return (
      <button key={n.id} onClick={() => go(n.id)} aria-current={active ? 'page' : undefined}
        className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[15px] font-medium transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200 ${
          active ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'text-[#1f2a44] hover:bg-slate-50'}`}>
        <Icon name={n.icon} size={19} className={active ? 'text-brand-600' : 'text-slate-500'} />
        <span className="flex-1 text-left">{n.label}</span>
        {b !== null && <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${active ? 'bg-brand-600 text-white' : 'bg-brand-100 text-brand-800'}`}>{fmt.number(b)}</span>}
      </button>
    )
  }

  const doctorName = profile?.name || user?.name || t('dd.doctorFallback')
  const firstName = doctorName.replace(/^Dr\.?\s*/i, '').split(' ')[0]
  const current = ALL.find(n => n.id === view)

  const sidebar = (
    <div className="h-full flex flex-col bg-white border-r border-slate-200 px-4 py-5">
      {/* Same lotus logo as the patient sidebar (components/icons LeafLogo) */}
      <div className="flex items-center gap-3 px-2 mb-6">
        <LeafLogo size={40} />
        <div>
          <p className="text-xl font-extrabold text-[#1f2a44] leading-none">NeuroRelief <span className="text-brand-500">AI</span></p>
          <p className="text-[11px] text-slate-500 mt-1">Doctor Portal</p>
        </div>
      </div>
      <nav className="flex flex-col gap-0.5 overflow-y-auto" aria-label={t('dd.navLabel')}>
        {NAV.map(navButton)}
        <p className="px-3.5 mt-5 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Clinical tools</p>
        {TOOLS.map(navButton)}
      </nav>
      <div className="mt-auto pt-4 border-t border-slate-100 flex flex-col gap-0.5">
        {navButton({ id: 'settings', label: 'Settings', icon: 'settings' })}
        <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[15px] font-medium text-[#1f2a44] hover:bg-slate-50">
          <Icon name="logout" size={19} className="text-slate-500" /> {t('nav.logout')}
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f7f8fb]">
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-64 z-30">{sidebar}</aside>
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <button className="absolute inset-0 bg-black/30" aria-label={t('nav.closeMenu')} onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl">{sidebar}</div>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 px-4 md:px-8 py-3 bg-white/95 backdrop-blur border-b border-slate-200">
          <div className="flex items-center gap-3 min-w-0">
            <button className="lg:hidden p-2 -ml-2 rounded-lg text-[#1f2a44] hover:bg-slate-100" onClick={() => setDrawerOpen(true)} aria-label={t('nav.openMenu')}><Icon name="menu" /></button>
            <span aria-hidden="true" className="shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white font-bold text-sm flex items-center justify-center">{initials(doctorName)}</span>
            <div className="min-w-0">
              <p className="font-bold text-[#1f2a44] truncate leading-tight">{doctorName}</p>
              <p className="text-sm text-brand-600 truncate">{profile?.specialty ? t(`specialty.${profile.specialty}`, { defaultValue: profile.specialty }) : (profileError ? t('dd.profileUnavailable') : ' ')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <LanguageSelector />
            <p className="hidden xl:block text-sm text-slate-500">{fmt.date(Date.now(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
            <div className="relative">
              <button onClick={() => setBellOpen(o => !o)} aria-expanded={bellOpen} aria-label={t('header.notificationsUnread', { count: bellCount })}
                className="relative w-11 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-[#1f2a44]">
                <Icon name="bell" size={22} />
                {bellCount > 0 && <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center">{fmt.number(bellCount)}</span>}
              </button>
              {bellOpen && (
                <>
                  <button className="fixed inset-0 z-40 cursor-default" aria-label={t('header.closeNotifications')} onClick={() => setBellOpen(false)} />
                  <div className="absolute right-0 mt-2 w-96 max-w-[90vw] bg-white rounded-2xl shadow-xl border border-slate-200 z-50 p-3">
                    <div className="flex items-center justify-between gap-2 px-1 pb-2">
                      <p className="font-semibold text-[#1f2a44] text-sm">Notifications</p>
                      {bellCount > 0 && <button onClick={markAllRead} className="text-xs text-brand-700 font-semibold hover:underline">{t('dd.markAllRead')}</button>}
                    </div>
                    {bellCount === 0 ? <p className="text-sm text-slate-500 px-1 py-4 text-center">{t('dd.noNew')}</p> : (
                      <ul className="max-h-80 overflow-y-auto space-y-1">
                        {unread.map(r => (
                          <li key={`r${r.appointment_id}`}>
                            <button onClick={() => openRequest(r)} className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-50">
                              <p className="text-sm font-medium text-[#1f2a44]">{t('dd.requested', { patient: r.patient_name })}</p>
                              <p className="text-xs text-slate-500">{t('header.dateAtTime', { date: fmt.isoDate(r.date), time: fmt.time(r.time) })}</p>
                            </button>
                          </li>
                        ))}
                        {newActivity.map(a => (
                          <li key={a.eventId}>
                            <button onClick={() => openActivity(a)} className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-50 flex gap-2">
                              <Icon name={eventIcon(a.type)} size={16} className="text-brand-600 mt-0.5 shrink-0" />
                              <span><span className="block text-sm text-[#1f2a44]">{eventText(a, 'doctor')}</span><span className="block text-xs text-slate-500">{ago(a.createdAt)}</span></span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="px-4 md:px-8 py-6 max-w-[1400px]">
          <div className="mb-5">
            <h1 className="text-2xl sm:text-3xl font-bold text-[#1f2a44]">{current?.label}</h1>
            {view === 'dashboard' && <p className="text-[15px] font-medium text-slate-600 mt-1">Welcome back, {firstName.startsWith('Dr') ? firstName : `Dr. ${firstName}`}.</p>}
          </div>
          {profileError && !denied && (
            <div role="alert" className="mb-4 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3"><WithServerMessage k="dd.profileErr" raw={profileError} /></div>
          )}
          <div aria-live="polite">
            {notice && (
              <div className={`mb-4 text-sm rounded-xl px-4 py-3 border flex items-start justify-between gap-3 ${notice.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                <span>{notice.key ? t(notice.key) : <WithServerMessage k="dd.noticeError" raw={notice.raw} />}</span>
                <button onClick={() => setNotice(null)} className="text-xs underline shrink-0">{t('common.dismiss')}</button>
              </div>
            )}
          </div>
          {requests !== null && loadError && !denied && (
            <div role="alert" className="mb-4 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3 flex items-center justify-between gap-3">
              <span><WithServerMessage k="dd.refreshFail" raw={loadError} /></span>
              <button onClick={() => refresh(true)} className="text-xs underline shrink-0">{t('common.retry')}</button>
            </div>
          )}
          {renderBody()}
          <p className="text-xs text-slate-400 mt-6">{t('dd.footnote')}</p>
        </main>
      </div>

      {openAppt && (
        <AppointmentDrawer key={openAppt} appointmentId={openAppt} profileDays={profile?.days || []}
          onClose={() => setOpenAppt(null)} onChanged={() => refresh(true)} onOpenInsights={openInsights} />
      )}
    </div>
  )
}
