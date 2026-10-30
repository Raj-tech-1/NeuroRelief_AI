import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import LanguageSelector from '../components/LanguageSelector'
import ServerMessage from '../components/ServerMessage'
import { useAuth } from '../context/AuthContext'
import { homeForRole } from '../utils/roles'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const iconProps = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }

const Icons = {
  chart: <svg {...iconProps}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>,
  calendar: <svg {...iconProps}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>,
  heart: <svg {...iconProps}><path d="M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z" /></svg>,
  book: <svg {...iconProps}><path d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2zM12 6v14" /></svg>,
  mail: <svg {...iconProps} width="18" height="18"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></svg>,
  lock: <svg {...iconProps} width="18" height="18"><rect x="5" y="11" width="14" height="9" rx="3" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>,
  eye: <svg {...iconProps} width="18" height="18"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>,
  eyeOff: <svg {...iconProps} width="18" height="18"><path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 6.7C3.8 8.5 2 12 2 12s3.5 6 10 6c1.5 0 2.8-.3 4-.8M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>,
  arrow: <svg {...iconProps} width="18" height="18"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  shield: <svg {...iconProps} width="26" height="26"><path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3z" /><path d="m9 12 2 2 4-4" /></svg>,
  brain: <svg {...iconProps} width="26" height="26"><path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V4a3 3 0 0 0-3 0zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1" /></svg>,
}

const benefits = [
  { icon: Icons.chart, k: 'b1' },
  { icon: Icons.calendar, k: 'b2' },
  { icon: Icons.heart, k: 'b3' },
  { icon: Icons.book, k: 'b4' },
]

const highlights = [
  { icon: Icons.brain, k: 'h1' },
  { icon: Icons.heart, k: 'h2' },
  { icon: Icons.shield, k: 'h3' },
]

const inputCls = 'w-full pl-11 pr-4 py-3 rounded-xl bg-white border border-brand-100 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition focus:outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-200/60'

function Logo() {
  return (
    <svg width="52" height="52" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F472B6" />
          <stop offset="1" stopColor="#9D2F83" />
        </linearGradient>
      </defs>
      <path d="M32 6c7 7 10 14 10 21 0 8-4.500 14-10 14s-10-6-10-14c0-7 3-14 10-21z" fill="url(#lg)" />
      <path d="M8 30c9-1 16 3 19 12-9 1-16-3-19-12z" fill="url(#lg)" opacity=".85" />
      <path d="M56 30c-9-1-16 3-19 12 9 1 16-3 19-12z" fill="url(#lg)" opacity=".85" />
      <path d="M32 44c0 6-1 10-1 14h2c0-4-1-8-1-14z" fill="#9D2F83" opacity=".6" />
    </svg>
  )
}

function Illustration() {
  const { t } = useTranslation()
  return (
    <div className="relative hidden lg:block flex-1 min-h-[220px]" aria-hidden="true">
      <div className="absolute right-0 bottom-0 w-[300px] h-[300px] rounded-full bg-gradient-to-br from-brand-200/70 to-brand-300/40 blur-[2px]" />
      <div className="absolute right-16 bottom-10 w-[200px] h-[200px] rounded-full bg-gradient-to-br from-white/70 to-brand-100/60" />
      <svg viewBox="0 0 200 220" className="absolute right-10 bottom-0 w-[240px] h-[260px]">
        <path d="M100 200c-4-40-2-80 6-120" stroke="#F687B3" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M104 140c-30-4-44-22-46-46 28 2 44 18 46 46z" fill="#F9A8D4" opacity=".8" />
        <path d="M106 110c26-6 40-24 40-48-26 4-40 22-40 48z" fill="#F687B3" opacity=".7" />
        <path d="M103 170c-24 2-40-8-50-26 24-4 42 6 50 26z" fill="#FBB6CE" opacity=".9" />
        <path d="M108 82c18-8 24-24 20-40-16 8-22 24-20 40z" fill="#ED64A6" opacity=".5" />
      </svg>
      <svg viewBox="0 0 24 24" className="absolute left-4 top-16 w-10 h-10 text-brand-300" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 20s-7-4.400-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.600-9 9-9 9z" />
      </svg>
      <p className="absolute left-4 right-4 top-0 text-right break-words text-xl text-brand-600 italic leading-snug" style={{ fontFamily: "'Brush Script MT', 'Segoe Script', cursive" }}>
        {t('brand.quote1')}<br />{t('brand.quote2')}
      </p>
    </div>
  )
}

function PasswordField({ id, label, value, onChange, show, onToggle, autoComplete, placeholder }) {
  const { t } = useTranslation()
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-gray-800 mb-1.5">{label}</label>
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">{Icons.lock}</span>
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={`${inputCls} pr-12`}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? t('auth.hide') : t('auth.show')}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-400 hover:text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          {show ? Icons.eyeOff : Icons.eye}
        </button>
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
  const [error, setError] = useState(null)   // { key } for our own messages, { raw } for backend text (localized at render)
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
  const homeRoute = user ? homeForRole(user.role) : null
  if (homeRoute) { navigate(homeRoute, { replace: true }); return null }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!email || !password) { setError({ key: 'auth.err.fill' }); return }
    if (!EMAIL_RE.test(email.trim())) { setError({ key: 'auth.err.invalidEmail' }); return }
    if (isSignUp && password !== confirmPassword) { setError({ key: 'auth.err.mismatch' }); return }

    setLoading(true)
    try {
      const userData = isSignUp ? await register(email, password) : await login(email, password, doctorMode ? 'doctor' : undefined)
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
  }

  function setPortal(doctor) {
    setIsSignUp(false)
    setError(null)
    setPassword('')
    setConfirmPassword('')
    setSearchParams(doctor ? { portal: 'doctor' } : {}, { replace: true })
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-brand-100/60 to-brand-200/50 p-3 sm:p-5 lg:p-6 flex">
      <div className="flex flex-col lg:flex-row w-full max-w-[1400px] mx-auto gap-3 lg:gap-0 rounded-[28px] overflow-hidden shadow-2xl shadow-brand-300/30">

        {/* Left - Branding */}
        <section className="relative flex-1 lg:flex-[1.15] bg-gradient-to-br from-brand-50 via-brand-100 to-brand-200/70 p-6 sm:p-10 lg:p-12 flex flex-col overflow-hidden rounded-[28px] lg:rounded-none">
          <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-white/50 blur-3xl" aria-hidden="true" />

          <header className="relative flex flex-wrap items-center gap-4 justify-between mb-8 lg:mb-10">
            <div className="flex items-center gap-3">
              <Logo />
              <div>
                <p className="text-3xl font-extrabold text-brand-800 leading-none">NeuroRelief <span className="text-brand-500">AI</span></p>
                <p className="text-xs sm:text-sm text-brand-800/80 mt-1">{t('auth.tagline')}</p>
              </div>
            </div>
            <span className="bg-white/60 text-brand-700 text-xs sm:text-sm font-medium px-4 py-2 rounded-full">
              {t('auth.badge')}
            </span>
          </header>

          <div className="relative flex flex-col lg:flex-row flex-1 gap-4">
            <div className="max-w-[520px]">
              <h1 className="auth-hero break-words text-3xl sm:text-4xl xl:text-5xl font-extrabold text-brand-900 leading-[1.15] mb-5">
                {t('auth.heroLine1')}<br />{t('auth.heroLine2')}<br />
                <span className="text-brand-500">{t('auth.heroLine3')}</span>
              </h1>
              <p className="text-gray-700 leading-relaxed mb-7 max-w-md">
                {t('auth.heroText')}
              </p>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                {benefits.map(b => (
                  <li key={b.k} className="flex items-center gap-4">
                    <span className="shrink-0 w-12 h-12 rounded-xl bg-white/80 text-brand-500 shadow-sm flex items-center justify-center">{b.icon}</span>
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{t(`auth.${b.k}.title`)}</p>
                      <p className="text-gray-600 text-sm">{t(`auth.${b.k}.desc`)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <Illustration />
          </div>

          <div className="relative mt-8 bg-white/60 backdrop-blur rounded-2xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:divide-x divide-brand-200/70">
            {highlights.map(h => (
              <div key={h.k} className="flex items-center gap-3 sm:px-4 first:sm:pl-0">
                <span className="text-brand-400 shrink-0">{h.icon}</span>
                <div>
                  <p className="font-bold text-brand-700 text-sm">{t(`auth.${h.k}.title`)}</p>
                  <p className="text-gray-600 text-xs">{t(`auth.${h.k}.desc`)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Right - Auth */}
        <section className="lg:w-[500px] xl:w-[540px] bg-white p-6 sm:p-10 lg:p-12 flex flex-col rounded-[28px] lg:rounded-none">
          <div className="flex items-center justify-between gap-3 mb-8 lg:mb-14">
          <LanguageSelector align="left" />
          {doctorMode ? (
            <p className="text-sm text-gray-500 text-right">
              {t('auth.notDoctor')}{' '}
              <button type="button" onClick={() => setPortal(false)}
                className="font-semibold text-brand-500 hover:text-brand-700 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                {t('auth.patientSignIn')}
              </button>
            </p>
          ) : (
            <p className="text-sm text-gray-500 text-right">
              {isSignUp ? t('auth.haveAccount') : t('auth.newHere')}{' '}
              <button type="button" onClick={() => switchMode(!isSignUp)}
                className="font-semibold text-brand-500 hover:text-brand-700 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                {isSignUp ? t('auth.signInLink') : t('auth.createLink')}
              </button>
            </p>
          )}
          </div>

          <h2 className="text-3xl sm:text-4xl font-extrabold text-brand-900 mb-2">
            {doctorMode ? t('auth.doctorPortal') : isSignUp ? t('auth.createTitle') : t('auth.welcomeBack')}
          </h2>
          <p className="text-gray-500 mb-8">
            {doctorMode
              ? t('auth.doctorPortalText')
              : isSignUp ? t('auth.joinText') : t('auth.signInText')}
          </p>

          {/* Sign In / Sign Up toggle (patients only) */}
          {!doctorMode && <div className="flex bg-brand-50 rounded-xl p-1 mb-6" role="tablist" aria-label={t('auth.modeLabel')}>
            {[['auth.tabSignIn', false], ['auth.tabSignUp', true]].map(([label, mode]) => (
              <button key={label} type="button" role="tab" aria-selected={isSignUp === mode}
                onClick={() => switchMode(mode)}
                className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                  isSignUp === mode ? 'bg-gradient-to-r from-brand-400 to-brand-500 text-white shadow' : 'text-gray-500 hover:text-brand-700'
                }`}>
                {t(label)}
              </button>
            ))}
          </div>}

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
            <div>
              <label htmlFor="auth-email" className="block text-sm font-semibold text-gray-800 mb-1.5">{t('auth.email')}</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">{Icons.mail}</span>
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className={inputCls}
                />
              </div>
            </div>

            <PasswordField
              id="auth-password" label={t('auth.password')} value={password}
              onChange={e => setPassword(e.target.value)}
              show={showPassword} onToggle={() => setShowPassword(s => !s)}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              placeholder={t('auth.passwordPh')}
            />

            {isSignUp && (
              <PasswordField
                id="auth-confirm" label={t('auth.confirm')} value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                show={showConfirmPassword} onToggle={() => setShowConfirmPassword(s => !s)}
                autoComplete="new-password"
                placeholder={t('auth.confirmPh')}
              />
            )}

            {error && (
              <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
                {error.key ? t(error.key) : <ServerMessage message={error.raw} />}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-gradient-to-r from-brand-400 to-brand-600 hover:from-brand-500 hover:to-brand-700 text-white font-semibold text-lg rounded-xl shadow-lg shadow-brand-300/40 transition flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden="true" />
                  {t('auth.wait')}
                </>
              ) : (
                <>{isSignUp ? t('auth.submitCreate') : t('auth.submitSignIn')} {Icons.arrow}</>
              )}
            </button>
          </form>

          {!doctorMode && (
            <button type="button" onClick={() => setPortal(true)}
              className="mt-6 w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-brand-200 text-brand-700 font-semibold text-sm hover:bg-brand-50 transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200">
              <svg {...iconProps} width="18" height="18"><path d="M6 3v6a4 4 0 0 0 8 0V3M10 13v2a5 5 0 0 0 10 0v-1M20 11a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" /></svg>
              {t('auth.doctorPortal')}
            </button>
          )}

          <p className="text-xs text-gray-400 text-center mt-auto pt-10">
            {t('auth.disclaimer')}
          </p>
        </section>
      </div>
    </div>
  )
}
