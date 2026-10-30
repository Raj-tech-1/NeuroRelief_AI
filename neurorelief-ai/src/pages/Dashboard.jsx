import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { getMyBookings } from '../services/api'
import { Icon, LeafLogo } from '../components/icons'
import LanguageSelector from '../components/LanguageSelector'
import { useFormat } from '../i18n/format'
import botanical from '../assets/illustrations/sidebar-botanical.svg'
import Overview from './tabs/Overview'
import CycleTracking from './tabs/CycleTracking'
import MoodWellness from './tabs/MoodWellness'
import AISymptomAdvisor from './tabs/AISymptomAdvisor'
import DoctorConnect from './tabs/DoctorConnect'
import ReportAudit from './tabs/ReportAudit'
import DevicePanel from './tabs/DevicePanel'
import Learn from './tabs/Learn'
import ProfilePage from './ProfilePage'

const tabComponents = {
  overview: Overview,
  cycle: CycleTracking,
  mood: MoodWellness,
  symptom: AISymptomAdvisor,
  doctor: DoctorConnect,
  audit: ReportAudit,
  device: DevicePanel,
  learn: Learn,
}

// Labels and subtitles live in the locale files (nav.<id>, navSub.<id>)
const NAV = [
  { id: 'overview', icon: 'home' },
  { id: 'cycle', icon: 'calendar' },
  { id: 'mood', icon: 'heart' },
  { id: 'symptom', icon: 'brain' },
  { id: 'doctor', icon: 'stethoscope' },
  { id: 'audit', icon: 'doc' },
  { id: 'device', icon: 'device' },
  { id: 'learn', icon: 'book' },
]

const SEEN_KEY = 'neurorelief_seen_appt_updates'

function readSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {} } catch { return {} }
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('overview')
  const [showProfile, setShowProfile] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [bookings, setBookings] = useState([])
  const [seen, setSeen] = useState(readSeen)
  const { user, logout } = useAuth()
  const { t } = useTranslation()
  const fmt = useFormat()
  const navigate = useNavigate()
  const ActiveComponent = tabComponents[activeTab]
  const current = NAV.find(n => n.id === activeTab)
  const fitScreen = (activeTab === 'symptom' || activeTab === 'doctor' || activeTab === 'device') && !showProfile
  const firstName = (user?.name || user?.email || t('header.there')).split(/[\s@]/)[0]
  const initials = (user?.name || user?.email || 'NR').split(/[\s@._]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()

  // Doctor responses (accepted / declined) show up as notifications; refreshed every 30s and on focus
  const loadBookings = useCallback(() => {
    getMyBookings().then(d => setBookings(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])
  useEffect(() => {
    loadBookings()
    const timer = setInterval(loadBookings, 30000)
    const onVisible = () => { if (document.visibilityState === 'visible') loadBookings() }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadBookings])

  const updates = bookings.filter(b => b.status === 'accepted' || b.status === 'declined').slice(0, 6)
  const unreadCount = updates.filter(b => seen[b.appointment_id] !== b.status).length

  function markUpdatesSeen() {
    const next = { ...seen }
    updates.forEach(b => { next[b.appointment_id] = b.status })
    setSeen(next)
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(next)) } catch {}
  }

  function goTab(id) {
    setActiveTab(id)
    setDrawerOpen(false)
    setBellOpen(false)
    setMenuOpen(false)
  }

  function openProfile() {
    setShowProfile(true)
    setMenuOpen(false)
    setDrawerOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleLogout() {
    logout()
    navigate('/auth')
  }

  const navBtn = 'w-full flex items-center gap-3 px-4 py-3 [@media(max-height:820px)]:py-2 rounded-xl text-[15px] font-medium transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200'

  const sidebar = (
    <div className="h-full flex flex-col bg-white/90 border-r border-brand-100/70 px-4 py-5">
      <div className="flex items-center gap-3 px-2 mb-6 [@media(max-height:820px)]:mb-4">
        <LeafLogo size={40} />
        <div>
          <p className="text-xl font-extrabold text-brand-800 leading-none">NeuroRelief <span className="text-brand-500">AI</span></p>
          <p className="text-[11px] text-gray-500 mt-1">{t('brand.tagline')}</p>
        </div>
      </div>

      <nav className="flex flex-col gap-1" aria-label={t('nav.main')}>
        {NAV.map(n => (
          <button key={n.id} onClick={() => goTab(n.id)} aria-current={activeTab === n.id ? 'page' : undefined}
            className={`${navBtn} ${activeTab === n.id ? 'bg-brand-100 text-brand-800' : 'text-gray-700 hover:bg-brand-50'}`}>
            <Icon name={n.icon} className={activeTab === n.id ? 'text-brand-700' : 'text-brand-600'} />
            {t(`nav.${n.id}`)}
          </button>
        ))}
      </nav>

      {/* Decorative quote */}
      <div className="relative flex-1 min-h-0 mt-2 hidden md:block">
        <img src={botanical} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-contain object-left-bottom opacity-90" />
        <p className="absolute right-3 bottom-2 text-right text-sm italic text-brand-700/80" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
          {t('brand.quote1')}<br />{t('brand.quote2')}
        </p>
      </div>

      <div className="border-t border-brand-100 pt-3 mt-3 flex flex-col gap-1">
        <button onClick={openProfile} className={`${navBtn} text-gray-700 hover:bg-brand-50`}>
          <Icon name="settings" className="text-brand-600" /> {t('nav.settings')}
        </button>
        <button onClick={handleLogout} className={`${navBtn} text-gray-700 hover:bg-brand-50`}>
          <Icon name="logout" className="text-brand-600" /> {t('nav.logout')}
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-brand-100/50">
      {/* Desktop sidebar */}
      <aside className="hidden md:block fixed inset-y-0 left-0 w-72 z-30">{sidebar}</aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <button className="absolute inset-0 bg-black/30" aria-label={t('nav.closeMenu')} onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl overflow-y-auto">{sidebar}</div>
        </div>
      )}

      <div className="md:pl-72">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 px-4 md:px-8 py-4 md:py-0 md:h-[76px] bg-white/80 backdrop-blur border-b border-brand-100/60">
          <div className="flex items-center gap-3 min-w-0">
            <button className="md:hidden p-2 -ml-2 rounded-lg text-brand-700 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              onClick={() => setDrawerOpen(true)} aria-label={t('nav.openMenu')}>
              <Icon name="menu" />
            </button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-brand-900 leading-tight">{t(`nav.${current.id}`)}</h1>
              <p className="text-sm text-gray-500 truncate">{t(`navSub.${current.id}`)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            {/* Notifications: doctor responses to appointment requests */}
            <div className="relative">
              <button onClick={() => { setBellOpen(o => !o); setMenuOpen(false) }} aria-expanded={bellOpen}
                aria-label={t('header.notificationsUnread', { count: unreadCount })}
                className="relative p-2.5 rounded-xl text-brand-700 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
                <Icon name="bell" />
                {unreadCount > 0 && <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-brand-500 ring-2 ring-white" />}
              </button>
              {bellOpen && (
                <>
                  <button className="fixed inset-0 z-40 cursor-default" aria-label={t('header.closeNotifications')} onClick={() => setBellOpen(false)} />
                  <div className="absolute right-0 mt-2 w-80 max-w-[85vw] bg-white rounded-2xl shadow-xl border border-brand-100 z-50 p-3">
                    <div className="flex items-center justify-between px-1 pb-2">
                      <p className="font-semibold text-gray-900 text-sm">{t('header.appointmentUpdates')}</p>
                      {unreadCount > 0 && <button onClick={markUpdatesSeen} className="text-xs text-brand-600 hover:underline">{t('header.markRead')}</button>}
                    </div>
                    {updates.length === 0
                      ? <p className="text-sm text-gray-500 px-1 py-4 text-center">{t('header.noUpdates')}</p>
                      : <ul className="space-y-1 max-h-72 overflow-y-auto">
                          {updates.map(b => (
                            <li key={b.appointment_id}>
                              <button onClick={() => { markUpdatesSeen(); goTab('doctor') }}
                                className="w-full text-left px-3 py-2 rounded-xl hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
                                <p className="text-sm font-medium text-gray-900">
                                  {t(b.status === 'accepted' ? 'header.accepted' : 'header.declined', { doctor: b.doctor_name })}
                                  {seen[b.appointment_id] !== b.status && <span className="ml-2 inline-block w-2 h-2 rounded-full bg-brand-500 align-middle" />}
                                </p>
                                <p className="text-xs text-gray-500">{t('header.dateAtTime', { date: fmt.date(b.date + 'T12:00:00'), time: b.time })}</p>
                              </button>
                            </li>
                          ))}
                        </ul>}
                  </div>
                </>
              )}
            </div>

            <LanguageSelector onOpen={() => { setBellOpen(false); setMenuOpen(false) }} />

            {/* User menu */}
            <div className="relative">
              <button onClick={() => { setMenuOpen(o => !o); setBellOpen(false) }} aria-expanded={menuOpen} aria-label={t('header.userMenu')}
                className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
                <span className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-white text-sm font-bold flex items-center justify-center">{initials}</span>
                <span className="hidden sm:block text-sm font-medium text-gray-800">{t('header.hi', { name: firstName })}</span>
                <Icon name="chevronDown" size={16} className="text-gray-500" />
              </button>
              {menuOpen && (
                <>
                  <button className="fixed inset-0 z-40 cursor-default" aria-label={t('nav.closeMenu')} onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-52 bg-white rounded-2xl shadow-xl border border-brand-100 z-50 p-2">
                    <p className="px-3 py-2 text-xs text-gray-500 truncate">{user?.email}</p>
                    <button onClick={openProfile} className="w-full text-left px-3 py-2 rounded-xl text-sm hover:bg-brand-50">{t('header.profileSettings')}</button>
                    <button onClick={handleLogout} className="w-full text-left px-3 py-2 rounded-xl text-sm hover:bg-brand-50">{t('nav.logout')}</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* AI Symptom Advisor and Doctor Connect are one-screen dashboards on large desktops (height = viewport - header) */}
        <main className={fitScreen ? 'px-4 md:px-6 py-4 xl:py-3 xl:h-[calc(100dvh-76px)]' : 'px-4 md:px-8 py-6 max-w-[1300px]'}>
          {showProfile && (
            <div className="mb-6">
              <ProfilePage onClose={() => setShowProfile(false)} />
            </div>
          )}
          <ActiveComponent onTabChange={goTab} />
        </main>
      </div>
    </div>
  )
}
