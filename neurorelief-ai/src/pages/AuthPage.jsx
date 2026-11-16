import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import LanguageSelector from '../components/LanguageSelector'
import ServerMessage from '../components/ServerMessage'
import { LeafLogo } from '../components/icons'
import { useAuth } from '../context/AuthContext'
import { homeForRole } from '../utils/roles'
import heroArt from '../assets/illustrations/auth-botanical.svg'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const QUOTES = ['quote1', 'quote2', 'quote3']
const QUOTE_MS = 7000

const iconProps = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
const Icons = {
  calendar: <svg {...iconProps} width="24" height="24"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01" /></svg>,
  heart: <svg {...iconProps} width="24" height="24"><path d="M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z" /></svg>,
  bars: <svg {...iconProps} width="24" height="24"><rect x="4" y="13" width="3.5" height="7" rx="1.2" /><rect x="10.25" y="8" width="3.5" height="12" rx="1.2" /><rect x="16.5" y="4" width="3.5" height="16" rx="1.2" /></svg>,
  shield: <svg {...iconProps} width="24" height="24"><path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3z" /><path d="m9 12 2 2 4-4" /></svg>,
  user: <svg {...iconProps}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></svg>,
  stethoscope: <svg {...iconProps}><path d="M6 3v6a4 4 0 0 0 8 0V3M10 13v2a5 5 0 0 0 10 0v-1M20 11a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" /></svg>,
  mail: <svg {...iconProps}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></svg>,
  lock: <svg {...iconProps}><rect x="5" y="11" width="14" height="9" rx="3" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>,
  eye: <svg {...iconProps}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>,
  eyeOff: <svg {...iconProps}><path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 6.7C3.8 8.5 2 12 2 12s3.5 6 10 6c1.5 0 2.8-.3 4-.8M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>,
  arrow: <svg {...iconProps}><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  info: <svg {...iconProps} width="18" height="18"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>,
}
const GoogleMark = () => (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
)

const FEATURES = [
  { icon: Icons.calendar, k: 'f1' },
  { icon: Icons.heart, k: 'f2' },
  { icon: Icons.bars, k: 'f3' },
  { icon: Icons.shield, k: 'f4' },
]

const inputCls = 'w-full h-[52px] pl-12 pr-4 rounded-xl bg-white border border-brand-100 text-[15px] text-gray-900 placeholder-gray-400 transition focus:outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-100'

function Field({ id, label, icon, children }) {
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">{label}</label>
      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">{icon}</span>
      {children}
    </div>
  )
}

function PasswordField({ id, label, value, onChange, show, onToggle, autoComplete }) {
  const { t } = useTranslation()
  return (
    <Field id={id} label={label} icon={Icons.lock}>
      <input id={id} type={show ? 'text' : 'password'} value={value} onChange={onChange} placeholder={label}
        autoComplete={autoComplete} className={`${inputCls} pr-12`} />
      <button type="button" onClick={onToggle} aria-label={show ? t('auth.hide') : t('auth.show')}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-500 hover:text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
        {show ? Icons.eyeOff : Icons.eye}
      </button>
    </Field>
  )
}

function Notice({ children }) {
  return (
    <p role="status" className="flex gap-2 items-start text-sm text-brand-800 bg-brand-50 border border-brand-100 rounded-xl px-3.5 py-2.5">
      <span className="mt-0.5 shrink-0 text-brand-500">{Icons.info}</span><span>{children}</span>
    </p>
  )
}

/** Rotating quote with dots (pauses when the visitor prefers reduced motion). */
function QuoteCard() {
  const { t } = useTranslation()
  const [i, setI] = useState(0)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => setI(n => (n + 1) % QUOTES.length), QUOTE_MS)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="relative flex flex-col items-center gap-5">
      <figure className="flex items-center gap-4 bg-white/75 backdrop-blur-sm rounded-[24px] shadow-lg shadow-brand-200/40 px-6 py-4 max-w-[440px]">
        <span className="shrink-0"><LeafLogo size={48} /></span>
        <blockquote aria-live="polite" className="text-brand-800 text-lg leading-snug italic" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
          “{t(`login.${QUOTES[i]}`)}”
        </blockquote>
      </figure>
      <div className="flex items-center gap-2.5">
        {QUOTES.map((q, n) => (
          <button key={q} type="button" onClick={() => setI(n)} aria-label={t('login.quoteNav', { n: n + 1 })} aria-current={n === i}
            className={`h-2.5 rounded-full transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${n === i ? 'w-2.5 bg-brand-500' : 'w-2.5 bg-brand-200 hover:bg-brand-300'}`} />
        ))}
        <span className="ml-1 h-1 w-14 rounded-full bg-brand-100" aria-hidden="true" />
      </div>
    </div>
  )
}

export default function AuthPage() {
  const { t } = useTranslation()
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState(null)   // { key } for our own messages, { raw } for backend text (localized at render)
  const [notice, setNotice] = useState(null) // 'forgot' | 'google'
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const { login, register, user } = useAuth()
  const navigate = useNavigate()
  // /auth?portal=doctor shows the Doctor Portal sign-in (sign in only; doctor accounts are provisioned, never self-registered)
  const [searchParams, setSearchParams] = useSearchParams()
  const doctorMode = searchParams.get('portal') === 'doctor'

  // Redirect if already logged in
  // (a saved session without a recognised role stays on this page so the user can sign in again)
  // Exception: the Doctor Portal sign-in stays available in a tab signed in to another account, so a doctor can sign in
  // in a new tab without logging the patient out (each tab keeps its own session; see services/session.js).
  const switchingToDoctor = doctorMode && user && user.role !== 'doctor'
  const homeRoute = user && !switchingToDoctor ? homeForRole(user.role) : null
  if (homeRoute) { navigate(homeRoute, { replace: true }); return null }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    if (!email || !password) { setError({ key: 'auth.err.fill' }); return }
    if (!EMAIL_RE.test(email.trim())) { setError({ key: 'auth.err.invalidEmail' }); return }
    if (isSignUp && password !== confirmPassword) { setError({ key: 'auth.err.mismatch' }); return }

    setLoading(true)
    try {
      const userData = isSignUp
        ? await register(email, password, { remember })
        : await login(email, password, doctorMode ? 'doctor' : undefined, { remember })
      const destination = homeForRole(userData?.role)
      if (!destination) { setError({ key: 'auth.err.roleUnknown' }); return }
      navigate(destination)
    } catch (err) {
      setError(err.message ? { raw: err.message } : { key: 'auth.err.generic' })
    } finally {
      setLoading(false)
    }
  }

  function switchMode(signUp) {
    setIsSignUp(signUp)
    setError(null)
    setNotice(null)
  }

  function setPortal(doctor) {
    setIsSignUp(false)
    setError(null)
    setNotice(null)
    setPassword('')
    setConfirmPassword('')
    setSearchParams(doctor ? { portal: 'doctor' } : {}, { replace: true })
  }

  const title = doctorMode ? t('login.doctorTitle') : isSignUp ? t('login.createTitle') : t('login.title')
  const sub = doctorMode ? t('login.doctorSub') : isSignUp ? t('login.createSub') : t('login.sub')

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-[#FCE8F1] to-brand-100 p-3 sm:p-5 flex">
      <div className="flex flex-col lg:flex-row w-full max-w-[1440px] mx-auto rounded-[32px] overflow-hidden bg-white/40 shadow-2xl shadow-brand-200/40 ring-1 ring-white/70">

        {/* ---------------- Left: brand story ---------------- */}
        <section className="relative lg:flex-[1.5] bg-gradient-to-br from-white via-[#FFF5F9] to-[#FCE4EF] px-6 py-8 sm:px-10 lg:px-14 lg:py-12 flex flex-col overflow-hidden">
          <div className="absolute -top-28 -left-28 w-80 h-80 rounded-full bg-white/80 blur-3xl" aria-hidden="true" />
          <img src={heroArt} alt="" aria-hidden="true" draggable="false"
            className="hidden lg:block absolute right-0 bottom-0 h-[90%] max-h-[820px] w-auto max-w-[56%] xl:max-w-[60%] object-contain object-right-bottom select-none pointer-events-none" />

          <header className="relative flex items-center gap-3">
            <LeafLogo size={62} />
            <div>
              <p className="text-[28px] font-extrabold text-brand-700 leading-none tracking-tight">NeuroRelief AI</p>
              <p className="text-sm text-gray-500 mt-1.5">{t('login.tagline')}</p>
            </div>
          </header>

          <div className="relative mt-10 lg:mt-16 max-w-[470px]">
            <h1 className="auth-hero text-[40px] sm:text-5xl xl:text-[60px] font-extrabold leading-[1.08] tracking-tight">
              <span className="text-[#1E1B4B]">{t('login.heroA')}</span><br />
              <span className="text-brand-700">{t('login.heroB')}</span>
            </h1>
            <p className="mt-5 text-xl sm:text-2xl text-gray-500 leading-snug max-w-[360px]">{t('login.heroSub')}</p>

            <ul className="mt-9 space-y-5">
              {FEATURES.map(f => (
                <li key={f.k} className="flex items-center gap-4">
                  <span className="shrink-0 w-14 h-14 rounded-full bg-white shadow-md shadow-brand-200/50 text-brand-600 flex items-center justify-center">{f.icon}</span>
                  <div className="max-w-[220px]">
                    <p className="font-semibold text-[#1E1B4B]">{t(`login.${f.k}.title`)}</p>
                    <p className="text-sm text-gray-500 leading-snug">{t(`login.${f.k}.desc`)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative mt-10 lg:mt-auto lg:pt-10 flex justify-center lg:justify-start lg:pl-[22%]">
            <QuoteCard />
          </div>
        </section>

        {/* ---------------- Right: sign-in card ---------------- */}
        <section className="relative order-first lg:order-none lg:w-[540px] xl:w-[580px] bg-gradient-to-br from-[#FDEBF3] to-[#FBDDEA] px-4 py-6 sm:px-10 lg:px-12 flex flex-col">
          <div className="flex justify-end mb-6">
            <div className="bg-white/80 rounded-2xl shadow-sm"><LanguageSelector /></div>
          </div>

          <div className="bg-white rounded-[28px] shadow-xl shadow-brand-200/40 px-6 py-8 sm:px-10 sm:py-10 my-auto">
            <div className="flex flex-col items-center text-center">
              <LeafLogo size={76} />
              <p className="mt-2 text-[28px] font-extrabold text-brand-700 leading-none tracking-tight">NeuroRelief AI</p>
              <p className="mt-2 text-sm text-gray-500">{t('login.tagline')}</p>
              <h2 className="mt-7 text-2xl font-bold text-[#1E1B4B]">{title}</h2>
              <p className="mt-1.5 text-gray-500">{sub}</p>
            </div>

            {/* Patient / Doctor */}
            <div role="tablist" aria-label={t('login.roleLabel')} className="mt-7 grid grid-cols-2 rounded-2xl border border-brand-100 bg-white p-1">
              {[[false, 'patient', Icons.user], [true, 'doctor', Icons.stethoscope]].map(([doc, k, icon]) => (
                <button key={k} type="button" role="tab" aria-selected={doctorMode === doc} onClick={() => doctorMode !== doc && setPortal(doc)}
                  className={`h-12 rounded-xl flex items-center justify-center gap-2 font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                    doctorMode === doc ? 'bg-gradient-to-r from-brand-400 to-brand-600 text-white shadow-md shadow-brand-300/50' : 'text-brand-700 hover:bg-brand-50'}`}>
                  {icon} {t(`login.${k}`)}
                </button>
              ))}
            </div>

            {switchingToDoctor && <div className="mt-4"><Notice>{t('login.switching', { name: user.name || user.email })}</Notice></div>}

            <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
              <Field id="auth-email" label={t('auth.email')} icon={Icons.mail}>
                <input id="auth-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder={t('auth.email')} autoComplete="email" className={inputCls} />
              </Field>

              <PasswordField id="auth-password" label={t('auth.password')} value={password}
                onChange={e => setPassword(e.target.value)} show={showPassword} onToggle={() => setShowPassword(s => !s)}
                autoComplete={isSignUp ? 'new-password' : 'current-password'} />

              {isSignUp && (
                <PasswordField id="auth-confirm" label={t('auth.confirm')} value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)} show={showConfirmPassword} onToggle={() => setShowConfirmPassword(s => !s)}
                  autoComplete="new-password" />
              )}

              <div className="flex items-center justify-between gap-3 text-sm">
                <label className="inline-flex items-center gap-2 text-gray-700 cursor-pointer select-none" title={t('login.rememberHint')}>
                  <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}
                    className="w-[18px] h-[18px] rounded accent-brand-500 cursor-pointer" />
                  {t('login.remember')}
                </label>
                {!isSignUp && (
                  <button type="button" onClick={() => setNotice(n => (n === 'forgot' ? null : 'forgot'))}
                    className="font-semibold text-brand-600 hover:text-brand-800 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                    {t('login.forgot')}
                  </button>
                )}
              </div>

              {notice === 'forgot' && <Notice>{t('login.forgotInfo')}</Notice>}

              {error && (
                <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
                  {error.key ? t(error.key) : <ServerMessage message={error.raw} />}
                </div>
              )}

              <button type="submit" disabled={loading}
                className="mt-1 w-full h-14 bg-gradient-to-r from-brand-400 to-brand-600 hover:from-brand-500 hover:to-brand-700 text-white font-semibold text-lg rounded-2xl shadow-lg shadow-brand-300/50 transition flex items-center justify-center gap-2.5 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300">
                {loading ? (
                  <><span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden="true" />{t('auth.wait')}</>
                ) : (
                  <>{isSignUp ? t('login.create') : t('login.login')} {Icons.arrow}</>
                )}
              </button>
            </form>

            <div className="my-5 flex items-center gap-4 text-xs font-semibold text-gray-500" aria-hidden="true">
              <span className="h-px flex-1 bg-brand-100" />{t('login.or')}<span className="h-px flex-1 bg-brand-100" />
            </div>

            <button type="button" onClick={() => setNotice(n => (n === 'google' ? null : 'google'))}
              className="w-full h-[52px] rounded-2xl border border-brand-100 bg-white text-[#1E1B4B] font-semibold flex items-center justify-center gap-3 hover:bg-brand-50/60 transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-100">
              <GoogleMark /> {t('login.google')}
            </button>
            {notice === 'google' && <div className="mt-3"><Notice>{t('login.googleInfo')}</Notice></div>}

            <p className="mt-6 text-center text-sm text-gray-600">
              {doctorMode ? t('login.doctorNoSignup') : (
                <>
                  {isSignUp ? t('login.haveAccount') : t('login.noAccount')}{' '}
                  <button type="button" onClick={() => switchMode(!isSignUp)}
                    className="font-semibold text-brand-600 hover:text-brand-800 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                    {isSignUp ? t('login.logIn') : t('login.signUp')}
                  </button>
                </>
              )}
            </p>
          </div>

          <p className="text-xs text-gray-500 text-center mt-6">{t('auth.disclaimer')}</p>
        </section>
      </div>
    </div>
  )
}
