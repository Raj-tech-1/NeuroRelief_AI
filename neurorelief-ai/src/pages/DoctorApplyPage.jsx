import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LeafLogo, Icon } from '../components/icons'
import { useAuth } from '../context/AuthContext'

// Public doctor application. The account created here has NO doctor access: an administrator checks the
// registration/licence number manually and approves or rejects it (see routes/auth.js and routes/admin.js).
// The Doctor Portal is English-only, like the rest of the doctor-facing screens.
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LICENCE_RE = /^[A-Za-z0-9][A-Za-z0-9/.\- ]{2,28}[A-Za-z0-9]$/

const inputCls = 'w-full h-12 px-4 rounded-xl bg-white border border-brand-100 text-[15px] text-gray-900 placeholder-gray-400 transition focus:outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-100'
const errCls = 'border-red-300 focus:border-red-400 focus:ring-red-100'

function Row({ id, label, hint, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-[#1E1B4B] mb-1.5">{label}</label>
      {children}
      {error ? <p id={`${id}-err`} className="text-xs text-red-600 mt-1">{error}</p> : hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  )
}

export default function DoctorApplyPage() {
  const { applyDoctor } = useAuth()
  const navigate = useNavigate()
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '', specialty: '', licence_number: '', licence_authority: '', days: [], confirm_accurate: false })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [loading, setLoading] = useState(false)
  const set = (k, v) => { setF(s => ({ ...s, [k]: v })); setErrors(e => ({ ...e, [k]: undefined })) }
  const toggleDay = d => set('days', f.days.includes(d) ? f.days.filter(x => x !== d) : [...f.days, d])

  function validate() {
    const e = {}
    if (!f.name.trim()) e.name = 'Enter your full name.'
    if (!EMAIL_RE.test(f.email.trim())) e.email = 'Enter a valid email address.'
    if (f.password.length < 8) e.password = 'Use at least 8 characters.'
    if (f.confirm !== f.password) e.confirm = 'Passwords do not match.'
    if (f.specialty.trim().length < 2) e.specialty = 'Enter your specialty.'
    if (!LICENCE_RE.test(f.licence_number.trim())) e.licence_number = 'Enter your registration / licence number (4-30 letters, digits, / . -).'
    if (!f.licence_authority.trim()) e.licence_authority = 'Enter the council that issued your registration.'
    if (!f.days.length) e.days = 'Choose at least one consultation day.'
    if (!f.confirm_accurate) e.confirm_accurate = 'Please confirm that your details are accurate.'
    return e
  }

  async function submit(ev) {
    ev.preventDefault()
    setFormError('')
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length) return
    setLoading(true)
    try {
      const { confirm, ...body } = f
      await applyDoctor({ ...body, name: f.name.trim(), email: f.email.trim(), licence_number: f.licence_number.trim(), days: DAYS.filter(d => f.days.includes(d)) })
      navigate('/doctor/application', { replace: true })
    } catch (err) {
      if (err.field) setErrors(s => ({ ...s, [err.field]: err.message }))
      else setFormError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const field = (id, props = {}) => (
    <input id={id} value={f[id]} onChange={e => set(id, e.target.value)} aria-invalid={!!errors[id]} aria-describedby={errors[id] ? `${id}-err` : undefined}
      className={`${inputCls} ${errors[id] ? errCls : ''}`} {...props} />
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-[#FCE8F1] to-brand-100 p-3 sm:p-6 flex">
      <div className="w-full max-w-2xl mx-auto my-auto bg-white rounded-[28px] shadow-xl shadow-brand-200/40 px-5 py-7 sm:px-10 sm:py-10">
        <div className="flex items-center gap-3">
          <LeafLogo size={52} />
          <div>
            <p className="text-2xl font-extrabold text-brand-700 leading-none tracking-tight">NeuroRelief AI</p>
            <p className="text-sm text-gray-500 mt-1">Doctor Portal</p>
          </div>
        </div>

        <h1 className="mt-7 text-2xl font-bold text-[#1E1B4B]">Apply as a doctor</h1>
        <p className="mt-1.5 text-gray-600 text-sm">Your account stays <span className="font-semibold">pending</span> until an administrator has checked your medical registration. Until then you cannot receive bookings, reports or any patient information.</p>

        <form onSubmit={submit} noValidate className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
          <div className="sm:col-span-2"><Row id="name" label="Full name" hint='As it should appear to patients, e.g. "Dr. Asha Menon".' error={errors.name}>{field('name', { autoComplete: 'name', maxLength: 60 })}</Row></div>
          <Row id="email" label="Email" error={errors.email}>{field('email', { type: 'email', autoComplete: 'email' })}</Row>
          <Row id="specialty" label="Specialty" error={errors.specialty}>{field('specialty', { maxLength: 60, placeholder: 'e.g. Gynecology' })}</Row>
          <Row id="password" label="Password" hint="At least 8 characters." error={errors.password}>{field('password', { type: 'password', autoComplete: 'new-password' })}</Row>
          <Row id="confirm" label="Confirm password" error={errors.confirm}>{field('confirm', { type: 'password', autoComplete: 'new-password' })}</Row>
          <Row id="licence_number" label="Medical registration / licence number" hint="Required. Checked manually against the issuing council." error={errors.licence_number}>{field('licence_number', { maxLength: 30, placeholder: 'e.g. KMC-12345' })}</Row>
          <Row id="licence_authority" label="Issuing council" error={errors.licence_authority}>{field('licence_authority', { maxLength: 80, placeholder: 'e.g. Karnataka Medical Council' })}</Row>

          <fieldset className="sm:col-span-2">
            <legend className="block text-sm font-semibold text-[#1E1B4B] mb-1.5">Consultation days</legend>
            <div className="flex flex-wrap gap-2">
              {DAYS.map(d => {
                const on = f.days.includes(d)
                return (
                  <button key={d} type="button" onClick={() => toggleDay(d)} aria-pressed={on}
                    className={`h-10 px-4 rounded-xl text-sm font-semibold border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${on ? 'bg-gradient-to-r from-brand-400 to-brand-600 text-white border-transparent' : 'bg-white text-brand-700 border-brand-100 hover:bg-brand-50'}`}>{d}</button>
                )
              })}
            </div>
            {errors.days && <p className="text-xs text-red-600 mt-1">{errors.days}</p>}
          </fieldset>

          <div className="sm:col-span-2">
            <label className="flex items-start gap-2.5 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={f.confirm_accurate} onChange={e => set('confirm_accurate', e.target.checked)} className="mt-0.5 w-[18px] h-[18px] rounded accent-brand-500" />
              <span>I confirm these details are accurate and that I hold a valid medical registration. I understand NeuroRelief AI verifies registrations manually and may reject the application.</span>
            </label>
            {errors.confirm_accurate && <p className="text-xs text-red-600 mt-1">{errors.confirm_accurate}</p>}
          </div>

          {formError && <div role="alert" className="sm:col-span-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">{formError}</div>}

          <div className="sm:col-span-2 flex flex-col-reverse sm:flex-row sm:items-center gap-3 sm:justify-between mt-1">
            <Link to="/auth?portal=doctor" className="text-sm font-semibold text-brand-600 hover:text-brand-800 inline-flex items-center gap-1">Back to Doctor Portal sign in</Link>
            <button type="submit" disabled={loading}
              className="h-12 px-7 bg-gradient-to-r from-brand-400 to-brand-600 hover:from-brand-500 hover:to-brand-700 text-white font-semibold rounded-2xl shadow-lg shadow-brand-300/50 transition inline-flex items-center justify-center gap-2 disabled:opacity-60 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300">
              {loading ? <><span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden="true" />Submitting…</> : <>Submit application <Icon name="arrow" size={16} /></>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
