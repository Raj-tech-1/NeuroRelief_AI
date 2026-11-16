import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LeafLogo, Icon } from '../components/icons'
import { useAuth } from '../context/AuthContext'
import { getDoctorApplications, approveDoctorApplication, rejectDoctorApplication, getAuditLog } from '../services/api'
import { initials } from '../components/doctor/helpers'
import { toDate } from '../components/care/shared'

// Admin area: verify doctor applications and read the audit log. English-only, like the Doctor Portal.
const navy = 'text-[#1f2a44]'
const card = 'bg-white rounded-2xl border border-slate-200 shadow-sm'
const REASON_LABELS = {
  licence_unverifiable: 'Registration could not be verified',
  details_incomplete: 'Details incomplete',
  duplicate_application: 'Duplicate application',
  not_eligible: 'Not eligible',
  other: 'Other',
}
const fmtTs = ts => { const d = toDate(ts); return d ? d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—' }

function Applications() {
  const [status, setStatus] = useState('pending')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)           // userId being reviewed
  const [rejecting, setRejecting] = useState(null) // { userId, reason }
  const [flash, setFlash] = useState('')

  const load = useCallback(() => {
    setError('')
    getDoctorApplications(status).then(setData).catch(err => setError(err.message))
  }, [status])
  useEffect(() => { setData(null); load() }, [load])

  async function act(userId, fn, done) {
    setBusy(userId); setError('')
    try { await fn(); setFlash(done); setRejecting(null); load(); setTimeout(() => setFlash(''), 3000) }
    catch (err) { setError(err.message) }
    finally { setBusy(null) }
  }

  const list = data?.applications || []
  return (
    <section className={`${card} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className={`text-lg font-bold ${navy}`}>Doctor applications</h2>
          <p className="text-sm text-slate-500">Check each registration number with the issuing council before approving.</p>
        </div>
        <div role="tablist" aria-label="Application status" className="inline-flex rounded-xl border border-slate-200 p-1 bg-slate-50">
          {['pending', 'approved', 'rejected'].map(s => (
            <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
              className={`px-3.5 h-9 rounded-lg text-sm font-semibold capitalize transition ${status === s ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>{s}</button>
          ))}
        </div>
      </div>

      {flash && <p role="status" className="mb-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3.5 py-2">{flash}</p>}
      {error && <p role="alert" className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2">{error}</p>}

      {!data ? <p className="text-sm text-slate-500 py-6 text-center">Loading…</p> : list.length === 0 ? (
        <div className="py-10 text-center text-slate-500">
          <span className="inline-flex w-12 h-12 rounded-full bg-slate-100 items-center justify-center mb-2"><Icon name="users" size={22} /></span>
          <p className="font-semibold text-slate-700">No {status} applications</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.map(a => (
            <li key={a.userId} className="py-4 flex flex-col lg:flex-row lg:items-start gap-4">
              <span className="shrink-0 w-10 h-10 rounded-full bg-brand-50 text-brand-700 font-bold text-sm flex items-center justify-center">{initials(a.name)}</span>
              <div className="flex-1 min-w-0 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <p className={`sm:col-span-2 font-semibold ${navy}`}>{a.name}{a.demo && <span className="ml-2 text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Demo clinician</span>}</p>
                <p className="text-slate-600 break-all"><span className="text-slate-400">Email:</span> {a.email}</p>
                <p className="text-slate-600"><span className="text-slate-400">Specialty:</span> {a.specialty}</p>
                <p className="text-slate-600"><span className="text-slate-400">Registration:</span> <span className="font-semibold text-slate-800">{a.licenceNumber || '—'}</span>{a.licenceAuthority ? ` · ${a.licenceAuthority}` : ''}</p>
                <p className="text-slate-600"><span className="text-slate-400">Days:</span> {a.days.join(', ') || '—'}</p>
                <p className="text-slate-500 text-xs sm:col-span-2">Applied {fmtTs(a.appliedAt)}{a.reviewedAt ? ` · reviewed ${fmtTs(a.reviewedAt)}` : ''}{a.reason ? ` · ${REASON_LABELS[a.reason] || a.reason}` : ''}</p>
              </div>
              {a.status === 'pending' && (
                <div className="shrink-0 flex flex-col gap-2 lg:w-64">
                  {rejecting?.userId === a.userId ? (
                    <>
                      <label htmlFor={`reason-${a.userId}`} className="text-xs font-semibold text-slate-600">Reason for rejection</label>
                      <select id={`reason-${a.userId}`} value={rejecting.reason} onChange={e => setRejecting({ userId: a.userId, reason: e.target.value })}
                        className="h-10 rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200">
                        <option value="">Choose a reason…</option>
                        {(data.rejectReasons || []).map(r => <option key={r} value={r}>{REASON_LABELS[r] || r}</option>)}
                      </select>
                      <div className="flex gap-2">
                        <button disabled={!rejecting.reason || busy === a.userId} onClick={() => act(a.userId, () => rejectDoctorApplication(a.userId, rejecting.reason), `${a.name} was rejected.`)}
                          className="flex-1 h-10 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50">Confirm reject</button>
                        <button onClick={() => setRejecting(null)} className="h-10 px-3 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
                      </div>
                    </>
                  ) : (
                    <div className="flex gap-2">
                      <button disabled={busy === a.userId} onClick={() => act(a.userId, () => approveDoctorApplication(a.userId), `${a.name} is now a verified doctor.`)}
                        className="flex-1 h-10 rounded-xl bg-gradient-to-r from-brand-400 to-brand-600 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"><Icon name="check" size={16} /> Approve</button>
                      <button disabled={busy === a.userId} onClick={() => setRejecting({ userId: a.userId, reason: '' })}
                        className="flex-1 h-10 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">Reject</button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function AuditLog() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => { setError(''); getAuditLog(200).then(setRows).catch(err => setError(err.message)) }, [])
  useEffect(() => { load() }, [load])
  return (
    <section className={`${card} p-5`}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className={`text-lg font-bold ${navy}`}>Audit log</h2>
          <p className="text-sm text-slate-500">Append-only. Codes and account ids only — no emails, passwords or health data.</p>
        </div>
        <button onClick={load} className="h-9 px-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1.5"><Icon name="retry" size={15} /> Refresh</button>
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2">{error}</p>}
      {!rows ? <p className="text-sm text-slate-500 py-6 text-center">Loading…</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500 bg-slate-50">
              <th className="py-2 px-3 font-medium">When</th><th className="px-3 font-medium">Action</th><th className="px-3 font-medium">Outcome</th>
              <th className="px-3 font-medium">Actor</th><th className="px-3 font-medium">Target</th><th className="px-3 font-medium">Detail</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r.log_id}>
                  <td className="py-2 px-3 text-slate-600 whitespace-nowrap">{fmtTs(r.created_at)}</td>
                  <td className="px-3 font-mono text-xs text-slate-800">{r.action}</td>
                  <td className="px-3"><span className={`text-xs font-semibold ${r.outcome === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>{r.outcome}</span></td>
                  <td className="px-3 text-slate-600">{r.actor_user_id ? `#${r.actor_user_id} ${r.actor_role || ''}` : '—'}</td>
                  <td className="px-3 text-slate-600">{r.target_id ? `${r.target_type} #${r.target_id}` : '—'}</td>
                  <td className="px-3 text-slate-500 text-xs">{r.detail_code || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default function AdminDashboard() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState('applications')
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
          <LeafLogo size={36} />
          <div className="mr-auto">
            <p className={`text-lg font-extrabold leading-none ${navy}`}>NeuroRelief <span className="text-brand-500">AI</span></p>
            <p className="text-[11px] text-slate-500 mt-0.5">Administration</p>
          </div>
          <span className="hidden sm:inline text-sm text-slate-500">{user?.email}</span>
          <button onClick={() => { logout(); navigate('/auth', { replace: true }) }}
            className="h-9 px-3 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 inline-flex items-center gap-1.5"><Icon name="logout" size={16} /> Sign out</button>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div role="tablist" aria-label="Admin sections" className="inline-flex rounded-xl border border-slate-200 p-1 bg-white">
          {[['applications', 'Doctor applications', 'stethoscope'], ['audit', 'Audit log', 'list']].map(([k, label, ic]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`px-4 h-10 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition ${tab === k ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:text-slate-900'}`}><Icon name={ic} size={16} /> {label}</button>
          ))}
        </div>
        {tab === 'applications' ? <Applications /> : <AuditLog />}
      </main>
    </div>
  )
}
