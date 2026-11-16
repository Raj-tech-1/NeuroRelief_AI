import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { LeafLogo, Icon } from '../components/icons'
import { useAuth } from '../context/AuthContext'
import { getMyDoctorApplication } from '../services/api'

// Where a doctor applicant lands after applying or signing in: shows the verification status.
// Approval changes the account's role on the server, so an approved applicant signs in again to open the portal.
const REASONS = {
  licence_unverifiable: 'We could not verify the registration number with the issuing council.',
  details_incomplete: 'Some required details were missing or unclear.',
  duplicate_application: 'This looks like a duplicate of another application.',
  not_eligible: 'The application does not meet the eligibility requirements.',
  other: 'The application was not approved.',
}

export default function DoctorApplicationStatus() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [app, setApp] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    getMyDoctorApplication()
      .then(setApp)
      .catch(err => setError(err.status === 401 || err.status === 403 ? 'Your session has ended. Please sign in again.' : err.message))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  function signInAgain() {
    logout()
    navigate('/auth?portal=doctor', { replace: true })
  }

  const status = app?.status
  const tone = status === 'approved' ? 'bg-emerald-50 text-emerald-700' : status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
  const icon = status === 'approved' ? 'check' : status === 'rejected' ? 'ban' : 'clock'
  const title = status === 'approved' ? 'Your account is verified' : status === 'rejected' ? 'Application not approved' : 'Application under review'

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-[#FCE8F1] to-brand-100 p-3 sm:p-6 flex">
      <div className="w-full max-w-xl mx-auto my-auto bg-white rounded-[28px] shadow-xl shadow-brand-200/40 px-6 py-8 sm:px-10 sm:py-10">
        <div className="flex items-center gap-3">
          <LeafLogo size={48} />
          <div>
            <p className="text-2xl font-extrabold text-brand-700 leading-none tracking-tight">NeuroRelief AI</p>
            <p className="text-sm text-gray-500 mt-1">Doctor Portal</p>
          </div>
        </div>

        {loading ? (
          <p role="status" className="mt-8 flex items-center gap-3 text-brand-700"><span className="w-5 h-5 rounded-full border-2 border-brand-200 border-t-brand-600 animate-spin" aria-hidden="true" />Loading your application…</p>
        ) : error ? (
          <div className="mt-8">
            <p role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</p>
            <div className="mt-4 flex gap-3">
              <button onClick={load} className="h-11 px-5 rounded-xl border border-brand-200 text-brand-700 font-semibold hover:bg-brand-50">Try again</button>
              <button onClick={signInAgain} className="h-11 px-5 rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-700">Sign in</button>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-8 flex items-start gap-4">
              <span className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${tone}`}><Icon name={icon} size={24} /></span>
              <div>
                <h1 className="text-xl font-bold text-[#1E1B4B]">{title}</h1>
                <p className="text-sm text-gray-600 mt-1">
                  {status === 'approved' && 'Sign in again to open the Doctor Portal. Patients can now find and book you.'}
                  {status === 'pending' && 'An administrator is checking your medical registration. You cannot receive bookings, reports or patient information until it is approved.'}
                  {status === 'rejected' && (REASONS[app.reason] || REASONS.other)}
                </p>
              </div>
            </div>

            <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm bg-brand-50/50 border border-brand-100 rounded-2xl p-4">
              <dt className="text-gray-500">Name</dt><dd className="font-medium text-gray-900">{app.name}</dd>
              <dt className="text-gray-500">Email</dt><dd className="font-medium text-gray-900 break-all">{user?.email}</dd>
              <dt className="text-gray-500">Specialty</dt><dd className="font-medium text-gray-900">{app.specialty}</dd>
              <dt className="text-gray-500">Registration</dt><dd className="font-medium text-gray-900">{app.licenceNumber} · {app.licenceAuthority}</dd>
              <dt className="text-gray-500">Days</dt><dd className="font-medium text-gray-900">{app.days.join(', ')}</dd>
            </dl>

            <div className="mt-6 flex flex-wrap gap-3">
              {status === 'approved' ? (
                <button onClick={signInAgain} className="h-11 px-6 rounded-xl bg-gradient-to-r from-brand-400 to-brand-600 text-white font-semibold shadow-md shadow-brand-300/50 inline-flex items-center gap-2">Sign in to the Doctor Portal <Icon name="arrow" size={16} /></button>
              ) : (
                <>
                  {status === 'pending' && <button onClick={load} className="h-11 px-5 rounded-xl border border-brand-200 text-brand-700 font-semibold hover:bg-brand-50 inline-flex items-center gap-2"><Icon name="retry" size={16} /> Check again</button>}
                  <button onClick={signInAgain} className="h-11 px-5 rounded-xl text-gray-600 font-semibold hover:bg-gray-50 inline-flex items-center gap-2"><Icon name="logout" size={16} /> Sign out</button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
