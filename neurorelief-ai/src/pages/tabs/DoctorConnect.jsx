import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../../i18n/format'
import ServerMessage from '../../components/ServerMessage'
import { getDoctors, getMyBookings, cancelBooking, requestAppointment, getArticles } from '../../services/api'
import { Icon } from '../../components/icons'
import { doctorPhoto, doctorSlug } from '../../assets/doctors'
import heroImg from '../../assets/illustrations/doctor-hero.svg'
import imgNutrition from '../../assets/illustrations/tip-nutrition.svg'
import imgMovement from '../../assets/illustrations/tip-movement.svg'
import imgSleep from '../../assets/illustrations/tip-sleep.svg'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TIME_SLOTS = ['9:00 AM', '10:00 AM', '11:00 AM', '2:00 PM', '3:00 PM', '4:00 PM']
const TIP_ARTICLE_IDS = [2, 3, 6]                 // existing Learn articles
const tipImages = [imgNutrition, imgMovement, imgSleep]

// Next calendar date (local, YYYY-MM-DD) that falls on the given weekday name, starting tomorrow.
function nextDateFor(dayName) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  let diff = (WEEKDAYS.indexOf(dayName) - d.getDay() + 7) % 7
  if (diff === 0) diff = 7
  d.setDate(d.getDate() + diff)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function localToday() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const minutes = t => {
  const m = /^(\d+):(\d+) (AM|PM)$/.exec(t || '')
  return m ? ((Number(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0)) * 60 + Number(m[2]) : 0
}

const statusStyle = {
  pending: 'bg-yellow-100 text-yellow-800',
  accepted: 'bg-green-100 text-green-800',
  declined: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-600',
}

const card = 'bg-white/90 rounded-2xl border border-brand-100/70 shadow-sm shadow-brand-100/50'
const selectCls = 'w-full h-[22px] bg-transparent text-[13px] font-medium text-gray-900 focus:outline-none cursor-pointer'

// Illustrated avatars (profiles have no photos). The variant is chosen from the doctor's id.
const AVATARS = [
  { bg: ['#FBE3EA', '#F5C3D4'], skin: '#F1C7A8', hair: '#4A2432', top: '#F277A9' },
  { bg: ['#E3F0F9', '#C6E0F1'], skin: '#E8B796', hair: '#2B2B3A', top: '#4FA3B8' },
  { bg: ['#EDE4F7', '#D3C4EC'], skin: '#D9A581', hair: '#5A3A2E', top: '#9C86C4' },
  { bg: ['#E4F3E8', '#BFE0C9'], skin: '#F3D2B8', hair: '#7A4A32', top: '#5FB48A' },
]
function avatarIndex(id) {
  const s = String(id)
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % AVATARS.length
}
function DoctorAvatar({ id, name, size = 56 }) {
  const photo = doctorPhoto(name)
  if (photo) {
    // Local photo, cropped to a square from the top so faces stay in frame
    return <img src={photo} alt="" width={size} height={size} loading="lazy" className="rounded-xl shrink-0 object-cover object-top bg-brand-50" style={{ width: size, height: size }} />
  }
  const i = avatarIndex(id), a = AVATARS[i]
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="rounded-xl shrink-0" aria-hidden="true">
      <defs><linearGradient id={`dav${i}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a.bg[0]} /><stop offset="1" stopColor={a.bg[1]} /></linearGradient></defs>
      <rect width="64" height="64" fill={`url(#dav${i})`} />
      <path d="M21 30c-1 9 1 15 3 18M43 30c1 9-1 15-3 18" stroke={a.hair} strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M8 64V55c0-8 8-13 24-13s24 5 24 13v9z" fill="#FFFFFF" />
      <path d="M26 43l6 10 6-10z" fill={a.top} />
      <rect x="29" y="35" width="6" height="8" fill={a.skin} />
      <circle cx="32" cy="27" r="10" fill={a.skin} />
      <path d="M21 27c0-9 5-14 11-14s11 5 11 14c-3-5-7-7-11-7s-8 2-11 7z" fill={a.hair} />
      <path d="M22 45c-2 8 3 13 10 13" stroke="#6B7A89" strokeWidth="1.800" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function CardHeader({ id, icon, title, subtitle, right }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-2.5 fit-hdr">
      <div className="flex items-center gap-3 min-w-0">
        <span className="shrink-0 fit-ico rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name={icon} size={20} /></span>
        <div className="min-w-0">
          <h2 id={id} className="font-display text-lg font-bold text-gray-900 leading-tight break-words">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 short-hide">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  )
}

export default function DoctorConnect({ onTabChange }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const fmtDate = iso => fmt.isoDate(iso)                       // display only; stored/sent dates stay YYYY-MM-DD
  const tSpec = sp => t(`specialty.${sp}`, { defaultValue: sp })   // display only; the filter value stays the stored specialty
  const tStatus = st => t(`apptStatus.${st}`, { defaultValue: st })
  const fmtExp = e => { const m = /^(\d+)(\+?) years?$/.exec(e || ''); return m ? t('doctor.experience', { n: fmt.number(m[1]), plus: m[2] }) : e }
  // data
  const [doctors, setDoctors] = useState([])
  const [loadingDoctors, setLoadingDoctors] = useState(true)
  const [doctorsError, setDoctorsError] = useState(false)
  const [bookings, setBookings] = useState([])
  const [tips, setTips] = useState([])

  // search / filters
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [spec, setSpec] = useState('all')
  const [day, setDay] = useState('any')
  const [sort, setSort] = useState('recommended')

  // profile + booking dialog
  const [selected, setSelected] = useState(null)
  const [selDay, setSelDay] = useState('')
  const [selTime, setSelTime] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [bookingError, setBookingError] = useState('')
  const [toast, setToast] = useState(null)

  // appointments panel
  const [apptTab, setApptTab] = useState('upcoming')
  const [confirmCancelId, setConfirmCancelId] = useState(null)
  const [cancellingId, setCancellingId] = useState(null)
  const [cancelError, setCancelError] = useState('')

  const searchRef = useRef(null)

  const loadDoctors = useCallback(() => {
    setLoadingDoctors(true)
    setDoctorsError(false)
    getDoctors()
      .then(d => setDoctors(Array.isArray(d) ? d : []))
      .catch(() => setDoctorsError(true))
      .finally(() => setLoadingDoctors(false))
  }, [])

  const loadBookings = useCallback(() => {
    return getMyBookings().then(d => setBookings(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  useEffect(() => {
    loadDoctors()
    loadBookings()
    getArticles().then(all => setTips(TIP_ARTICLE_IDS.map(id => all.find(a => a.id === id)).filter(Boolean))).catch(() => {})
    // Pick up the doctor's accept/decline without a manual refresh: every 30s and when the tab regains focus
    const timer = setInterval(loadBookings, 30000)
    const onFocus = () => { if (document.visibilityState === 'visible') loadBookings() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [loadDoctors, loadBookings])

  // Escape closes the dialog; the toast hides itself
  useEffect(() => {
    if (!selected) return
    const onKey = e => { if (e.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 9000)
    return () => clearTimeout(t)
  }, [toast])

  // ---- filtering / sorting (all from real profile fields) ----
  const specialties = useMemo(() => [...new Set(doctors.map(d => d.specialty).filter(Boolean))].sort(), [doctors])
  const filtered = useMemo(() => {
    const q = appliedQuery.trim().toLowerCase()
    const list = doctors.filter(d =>
      (!q || `${d.name} ${d.specialty} ${tSpec(d.specialty)} ${d.description || ''}`.toLowerCase().includes(q)) &&
      (spec === 'all' || d.specialty === spec) &&
      (day === 'any' || (d.days || []).includes(day)))
    if (sort === 'price') return [...list].sort((a, b) => a.price - b.price)
    if (sort === 'rating') return [...list].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))
    return [...list].sort((a, b) => Number(b.bookable !== false) - Number(a.bookable !== false))   // bookable doctors first
  }, [doctors, appliedQuery, spec, day, sort, t])
  const filtersActive = appliedQuery.trim() !== '' || spec !== 'all' || day !== 'any'
  function clearFilters() { setQuery(''); setAppliedQuery(''); setSpec('all'); setDay('any') }

  // ---- appointments ----
  const today = localToday()
  const upcoming = bookings
    .filter(b => (b.status === 'pending' || b.status === 'accepted') && b.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || minutes(a.time) - minutes(b.time))
  const past = bookings
    .filter(b => !upcoming.includes(b))
    .sort((a, b) => b.date.localeCompare(a.date) || minutes(b.time) - minutes(a.time))
  const shown = apptTab === 'upcoming' ? upcoming : past

  async function handleCancel(id) {
    if (cancellingId != null) return
    setCancellingId(id)
    setCancelError('')
    try {
      await cancelBooking(id)
      setConfirmCancelId(null)
      await loadBookings()
    } catch (err) {
      setCancelError(err.message)
    } finally {
      setCancellingId(null)
    }
  }

  // ---- booking ----
  function openProfile(doc) {
    setSelected(doc)
    setSelDay('')
    setSelTime('')
    setBookingError('')
  }

  async function handleConfirm() {
    if (!selected || !selDay || !selTime || submitting) return
    setSubmitting(true)
    setBookingError('')
    try {
      const date = nextDateFor(selDay)
      const data = await requestAppointment({ doctor_id: selected.id, date, time: selTime })
      // Success is shown only after the server confirms the request was saved.
      setToast({ doctor: data.doctor_name, date: data.date, time: data.time, price: data.price, status: data.status })
      setSelected(null)
      setApptTab('upcoming')
      await loadBookings()
    } catch (err) {
      setBookingError(err.message || '__fallback__')
    } finally {
      setSubmitting(false)
    }
  }

  const sel = selected
  const selBookable = sel && sel.bookable !== false

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-3 fit-gap xl:h-full xl:min-h-0">
      {/* ---------------- Left column ---------------- */}
      <div className="flex flex-col gap-3 fit-gap min-w-0 xl:min-h-0">
        {/* Hero */}
        <section className="fit-hero relative overflow-hidden rounded-2xl bg-gradient-to-r from-brand-100/90 via-brand-50 to-brand-100/60 border border-brand-100/70 shrink-0 flex items-center">
          <div className="relative z-10 max-w-[330px] lg:max-w-[360px]">
            <p className="text-[10px] font-semibold tracking-[0.2em] uppercase text-brand-600 mb-1 short-hide">{t('doctor.heroTag')}</p>
            <h2 className="font-display font-bold text-brand-900 leading-tight" style={{ fontSize: 'clamp(1.25rem, 3.3vh, 1.9rem)' }}>{t('doctor.heroTitle')}</h2>
            <p className="text-gray-600 mt-1.5 text-xs sm:text-sm fit-sub">{t('doctor.heroText')}</p>
          </div>
          <img src={heroImg} alt="" aria-hidden="true" className="hidden md:block absolute bottom-0 h-[112%] w-auto object-contain pointer-events-none right-[200px] lg:right-[215px]" />
          <ul className="short-hide hidden md:flex flex-col gap-2 absolute right-4 top-1/2 -translate-y-1/2 w-[190px]" aria-label={t('doctor.howItWorks')}>
            {[['calendar', 'easyBooking'], ['stethoscope', 'docConfirm'], ['heart', 'private']].map(([ic, k]) => (
              <li key={k} className="flex items-center gap-2.5">
                <span className="shrink-0 w-8 h-8 rounded-full bg-white/80 text-brand-600 flex items-center justify-center"><Icon name={ic} size={16} /></span>
                <span><span className="block text-xs font-semibold text-gray-900 leading-tight">{t(`doctor.${k}`)}</span><span className="block text-[10px] text-gray-500 leading-tight">{t(`doctor.${k}Sub`)}</span></span>
              </li>
            ))}
          </ul>
        </section>

        {/* Search + filters */}
        <section className={`${card} fit-filters p-3 shrink-0`} aria-label={t('doctor.searchSection')}>
          <form onSubmit={e => { e.preventDefault(); setAppliedQuery(query) }} className="grid grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto] gap-2 items-stretch">
            <label className="col-span-2 lg:col-span-1 flex items-center gap-2 px-3 rounded-xl border border-brand-100 bg-white focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-200/60 min-h-[48px]">
              <Icon name="search" size={18} className="text-brand-600 shrink-0" />
              <span className="sr-only">{t('doctor.searchSr')}</span>
              <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder={t('doctor.searchPh')}
                className="w-full text-sm bg-transparent focus:outline-none" />
            </label>
            {[
              [t('doctor.specialization'), spec, setSpec, [['all', t('doctor.allSpecialties')], ...specialties.map(sp => [sp, tSpec(sp)])]],
              [t('doctor.availability'), day, setDay, [['any', t('doctor.anyDay')], ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => [d, fmt.weekday(d)])]],
              [t('doctor.sortBy'), sort, setSort, [['recommended', t('doctor.sortSuggested')], ['price', t('doctor.sortPrice')], ['rating', t('doctor.sortRating')]]],
            ].map(([label, value, set, opts]) => (
              <label key={label} className="px-3 py-1.5 rounded-xl border border-brand-100 bg-white focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-200/60 min-w-0">
                <span className="block text-[10px] text-gray-500 leading-tight">{label}</span>
                <select value={value} onChange={e => set(e.target.value)} className={selectCls}>
                  {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            ))}
            <button type="submit" className="px-5 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 text-white text-sm font-semibold hover:from-brand-600 hover:to-brand-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 min-h-[48px]">{t('doctor.search')}</button>
          </form>
        </section>

        {/* Available doctors */}
        <section className={`${card} fit-card flex flex-col xl:flex-1 xl:min-h-0`} aria-labelledby="docs-h">
          <CardHeader id="docs-h" icon="stethoscope" title={t('doctor.available')} subtitle={t('doctor.availableSub')}
            right={<div className="flex items-center gap-3 pt-1 text-xs text-gray-500 whitespace-nowrap">
              {!loadingDoctors && !doctorsError && <span>{t('doctor.count', { count: filtered.length })}</span>}
              {filtersActive && <button onClick={clearFilters} className="font-semibold text-brand-700 hover:underline">{t('doctor.clearFilters')}</button>}
            </div>} />

          {loadingDoctors ? (
            <div className="flex-1 flex items-center justify-center gap-3 py-8 text-brand-700" role="status">
              <span className="w-5 h-5 rounded-full border-2 border-brand-200 border-t-brand-600 animate-spin" aria-hidden="true" />
              <span className="text-sm">{t('doctor.loading')}</span>
            </div>
          ) : doctorsError ? (
            <div role="alert" className="flex-1 flex flex-col items-center justify-center text-center py-6">
              <p className="text-sm font-semibold text-gray-800 max-w-sm">{t('doctor.loadError')}</p>
              <button onClick={loadDoctors} className="mt-3 px-5 py-2 bg-brand-700 text-white rounded-lg text-sm font-medium hover:bg-brand-800">{t('common.tryAgain')}</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-6">
              <p className="text-sm font-semibold text-gray-800">{t('doctor.noMatch')}</p>
              <p className="text-xs text-gray-500 mt-1">{t('doctor.noMatchHint')}</p>
              {filtersActive && <button onClick={clearFilters} className="mt-3 px-5 py-2 border border-brand-300 text-brand-700 rounded-lg text-sm font-medium hover:bg-brand-50">{t('doctor.clearFilters')}</button>}
            </div>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5 content-start xl:flex-1 xl:min-h-0 xl:overflow-y-auto pr-0.5">
              {filtered.map(doc => (
                <li key={doc.id} className="fit-dcard rounded-xl border border-brand-100/70 bg-white p-2 flex flex-col gap-1.5">
                  <div className="flex gap-2.5">
                    <DoctorAvatar id={doc.id} name={doc.name} size={52} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-gray-900 leading-tight truncate">{doc.name}</p>
                      <p className="text-xs text-gray-500 leading-snug line-clamp-2">{tSpec(doc.specialty)}</p>
                      <p className="text-xs text-gray-600 leading-snug">{doc.rating != null && <><span className="text-yellow-500">★</span> {fmt.number(doc.rating)} • </>}{t('doctor.perVisit', { price: fmt.number(doc.price) })}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {doc.bookable === false
                      ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">{t('doctor.demoProfile')}</span>
                      : <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium">{t('doctor.bookable')}</span>}
                    {(doc.days || []).map(d => <span key={d} className="text-[10px] px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 font-medium">{fmt.weekday(d)}</span>)}
                  </div>
                  <button onClick={() => openProfile(doc)}
                    className="w-full py-1.5 rounded-lg border border-brand-400 text-brand-700 text-xs font-semibold hover:bg-brand-50 inline-flex items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200">
                    {t('doctor.viewProfile')} <Icon name="arrow" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ---------------- Right column ---------------- */}
      <div className="flex flex-col gap-3 fit-gap min-w-0 xl:min-h-0">
        {/* My appointments */}
        <section aria-labelledby="appt-h"
          className={`${card} fit-card flex flex-col min-h-[200px] xl:min-h-[120px] xl:flex-1`}>
          <CardHeader id="appt-h" icon="calendar" title={t('doctor.myAppts')} />
          <div className="flex bg-brand-50 rounded-lg p-0.5 mb-2" role="tablist" aria-label={t('doctor.apptTabs')}>
            {[['upcoming', t('doctor.upcoming'), upcoming.length], ['past', t('doctor.past'), past.length]].map(([id, label, n]) => (
              <button key={id} role="tab" aria-selected={apptTab === id} onClick={() => setApptTab(id)}
                className={`flex-1 py-1 rounded-md text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${apptTab === id ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-brand-700'}`}>
                {label}{n > 0 ? ` (${fmt.number(n)})` : ''}
              </button>
            ))}
          </div>
          {cancelError && <p role="alert" className="text-xs text-red-600 mb-1"><ServerMessage message={cancelError} /></p>}
          {shown.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-3">
              <p className="text-sm font-semibold text-gray-800">{apptTab === 'upcoming' ? t('doctor.noUpcoming') : t('doctor.noPast')}</p>
              <p className="text-xs text-gray-500 mt-0.5">{apptTab === 'upcoming' ? t('doctor.noUpcomingHint') : t('doctor.noPastHint')}</p>
            </div>
          ) : (
            <ul className="space-y-2 xl:flex-1 xl:min-h-0 overflow-y-auto pr-0.5">
              {shown.map(b => (
                <li key={b.appointment_id} className="rounded-xl border border-brand-100/70 bg-white px-2.5 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 leading-tight truncate">{b.doctor_name}</p>
                      <p className="text-xs text-gray-700 mt-0.5 flex items-center gap-1.5"><Icon name="calendar" size={13} className="text-brand-600 shrink-0" /> {fmtDate(b.date)} • {fmt.time(b.time)}</p>
                    </div>
                    <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusStyle[b.status] || statusStyle.pending}`}>{tStatus(b.status)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 min-h-[20px]">
                    <span className="text-[10px] text-gray-500">{b.status === 'pending' ? t('doctor.awaiting') : tSpec(b.specialty)}</span>
                    {(b.status === 'pending' || b.status === 'accepted') && (
                      <span className="flex items-center gap-2 shrink-0">
                        {confirmCancelId === b.appointment_id ? (
                          <>
                            <button onClick={() => handleCancel(b.appointment_id)} disabled={cancellingId != null}
                              className="text-xs px-2.5 py-0.5 rounded bg-red-600 text-white disabled:opacity-50">{cancellingId === b.appointment_id ? t('doctor.cancelling') : t('doctor.yesCancel')}</button>
                            <button onClick={() => setConfirmCancelId(null)} className="text-xs text-gray-500 underline">{t('doctor.keep')}</button>
                          </>
                        ) : (
                          <button onClick={() => { setCancelError(''); setConfirmCancelId(b.appointment_id) }} className="text-xs text-red-600 underline">{t('doctor.cancelRequest')}</button>
                        )}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Quick actions (includes the emergency support from the previous page) */}
        <section className={`${card} fit-card shrink-0`} aria-labelledby="qa-h">
          <CardHeader id="qa-h" icon="bolt" title={t('doctor.quickActions')} />
          <ul className="space-y-1.5">
            <li>
              <button onClick={() => { searchRef.current?.focus(); searchRef.current?.scrollIntoView?.({ block: 'nearest' }) }}
                className="w-full flex items-center gap-3 p-1.5 rounded-xl hover:bg-brand-50/60 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
                <span className="shrink-0 w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="calendar" size={18} /></span>
                <span className="flex-1 min-w-0"><span className="block text-sm font-semibold text-gray-900 leading-tight">{t('doctor.bookNew')}</span><span className="fit-sub block text-[11px] text-gray-500 leading-tight">{t('doctor.bookNewSub')}</span></span>
                <Icon name="chevron" size={14} className="text-gray-400" />
              </button>
            </li>
            <li className="rounded-xl bg-red-50/70 border border-red-100 p-2 flex flex-wrap items-center gap-2">
              <span className="flex-1 basis-32 min-w-0"><span className="block text-sm font-semibold text-red-800 leading-tight">{t('doctor.emergency')}</span><span className="fit-sub block text-[11px] text-red-700/80 leading-tight">{t('doctor.emergencySub')}</span></span>
              <a href="tel:112" className="shrink-0 px-2.5 py-1.5 bg-red-700 text-white text-xs rounded-lg font-semibold hover:bg-red-800">{t('doctor.call112')}</a>
              <a href="https://www.google.com/maps/search/hospitals+near+me" target="_blank" rel="noopener noreferrer" className="shrink-0 px-2.5 py-1.5 border border-red-300 text-red-800 text-xs rounded-lg font-semibold hover:bg-red-100">{t('doctor.hospitals')}</a>
            </li>
          </ul>
        </section>

        {/* Health tips (real articles from the Learn tab) */}
        {tips.length > 0 && (
          <section className={`${card} fit-card fit-tipcard xl:min-h-0 xl:overflow-hidden flex flex-col`} aria-labelledby="ht-h">
            <CardHeader id="ht-h" icon="leaf" title={t('doctor.healthTips')} right={<button onClick={() => onTabChange && onTabChange('learn')} className="text-xs font-semibold text-brand-700 hover:underline pt-1">{t('doctor.viewAll')}</button>} />
            <ul className="fit-tips space-y-1 xl:min-h-0 xl:overflow-y-auto">
              {tips.map((a, i) => (
                <li key={a.id}>
                  <button onClick={() => onTabChange && onTabChange('learn')} className="w-full flex items-center gap-2.5 text-left rounded-xl hover:bg-brand-50/60 p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
                    <img src={tipImages[i]} alt="" className="fit-tip-img rounded-lg object-cover shrink-0" />
                    <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-gray-900 leading-tight">{t(`articles.${a.id}.title`, { defaultValue: a.title })}</span><span className="block text-[11px] text-gray-500">{t('doctor.readMin', { n: fmt.number(a.readTime), level: t(`level.${a.level}`, { defaultValue: a.level }) })}</span></span>
                    <Icon name="chevron" size={14} className="text-gray-400 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* ---------------- Toast ---------------- */}
      {toast && (
        <div role="status" className="fixed top-24 right-6 z-[60] max-w-sm bg-green-50 border border-green-300 rounded-xl shadow-lg p-4">
          <p className="font-semibold text-green-800 text-sm">{t('doctor.toastTitle')}</p>
          <p className="text-xs text-green-700 mt-1">{t('doctor.toastText', { doctor: toast.doctor, date: fmtDate(toast.date), time: fmt.time(toast.time), price: fmt.number(toast.price), status: t(`status.${toast.status}`, { defaultValue: toast.status }) })}</p>
          <button onClick={() => setToast(null)} className="text-xs text-green-700 underline mt-2">{t('common.dismiss')}</button>
        </div>
      )}

      {/* ---------------- Profile + booking dialog ---------------- */}
      {sel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="prof-h">
          <button className="absolute inset-0 bg-black/40 cursor-default" aria-label={t('doctor.closeProfile')} onClick={() => setSelected(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5">
            <button onClick={() => setSelected(null)} aria-label={t('common.close')} className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-gray-700 rounded-lg"><Icon name="close" size={18} /></button>
            <div className="flex gap-3 items-center pr-8">
              <DoctorAvatar id={sel.id} name={sel.name} size={72} />
              <div>
                <h2 id="prof-h" className="font-display text-xl font-bold text-gray-900 leading-tight">{sel.name}</h2>
                <p className="text-sm text-brand-700">{tSpec(sel.specialty)}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {sel.experience ? `${fmtExp(sel.experience)} • ` : ''}{t('doctor.perConsultation', { price: fmt.number(sel.price) })}{sel.rating != null ? ` • ★ ${fmt.number(sel.rating)}` : ''}
                </p>
              </div>
            </div>
            {sel.description && <p className="text-sm text-gray-600 mt-3">{sel.demo ? t(`doctorDesc.${doctorSlug(sel.name)}`, { defaultValue: sel.description }) : sel.description}</p>}
            <p className="text-xs text-gray-500 mt-3">{t('doctor.availableDays')} <span className="font-medium text-gray-800">{(sel.days || []).map(fmt.weekday).join(', ') || '—'}</span></p>

            {!selBookable ? (
              <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 p-3">
                <p className="text-sm font-semibold text-gray-800">{t('doctor.demoUnavailable')}</p>
                <p className="text-xs text-gray-500 mt-0.5">{t('doctor.demoUnavailableText')}</p>
              </div>
            ) : (
              <div className="mt-4">
                <p className="text-sm font-medium text-gray-700 mb-1.5">{t('doctor.selectDay')}</p>
                <div className="flex gap-2 flex-wrap mb-3">
                  {(sel.days || []).map(d => (
                    <button key={d} onClick={() => setSelDay(d)} aria-pressed={selDay === d}
                      className={`px-4 py-1.5 rounded-lg text-sm border transition ${selDay === d ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 hover:bg-gray-50'}`}>
                      {fmt.weekday(d)}{selDay === d ? ` • ${fmtDate(nextDateFor(d))}` : ''}
                    </button>
                  ))}
                </div>
                <p className="text-sm font-medium text-gray-700 mb-1.5">{t('doctor.selectTime')}</p>
                <div className="flex gap-2 flex-wrap mb-4">
                  {TIME_SLOTS.map(slot => (
                    <button key={slot} onClick={() => setSelTime(slot)} aria-pressed={selTime === slot}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition ${selTime === slot ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 hover:bg-gray-50'}`}>{fmt.time(slot)}</button>
                  ))}
                </div>
                {bookingError && <p role="alert" className="text-sm text-red-600 mb-3">{bookingError === '__fallback__' ? t('doctor.bookFailed') : <ServerMessage message={bookingError} />}</p>}
                <button onClick={handleConfirm} disabled={!selDay || !selTime || submitting}
                  className="w-full py-2.5 bg-brand-700 text-white rounded-xl font-semibold hover:bg-brand-800 disabled:opacity-40 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300">
                  {submitting ? t('doctor.sending') : t('doctor.sendRequest')}
                </button>
                <p className="text-[11px] text-gray-500 mt-2">{t('doctor.privacyNote')}</p>
              </div>
            )}

            {sel.phone && (
              <a href={`tel:${sel.phone}`} className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 border border-green-500 text-green-700 text-sm rounded-lg font-medium hover:bg-green-50">{t('doctor.call', { phone: sel.phone })}</a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
