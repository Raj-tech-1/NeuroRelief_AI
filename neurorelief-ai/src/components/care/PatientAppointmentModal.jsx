import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../icons'
import {
  getCareAppointment, respondToProposal, rescheduleAppointment, getPatientNotes, getMyGrants, createGrant, revokeGrant, getRecordConsent,
} from '../../services/api'
import {
  ApptStatus, MessageThread, ErrorNote, Loading, EmptyState, fmtDay, fmtDateTime, localToday, TIME_SLOTS, CATEGORY_LABELS, PURPOSE_LABELS, UpdatedStamp,
} from './shared'

const btn = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200'
const primary = `${btn} bg-brand-600 text-white hover:bg-brand-700`
const ghost = `${btn} border border-brand-200 bg-white text-brand-700 hover:bg-brand-50`
const KIND_LABEL = { clinical_note: 'Note from your doctor', follow_up: 'Follow-up instructions', summary: 'Consultation summary' }
const isoMinus = days => { const d = new Date(Date.now() - days * 864e5); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }

function ShareRecords({ appt }) {
  const [grants, setGrants] = useState(null)
  const [consent, setConsent] = useState(null)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [cats, setCats] = useState([])
  const [purpose, setPurpose] = useState('consultation_review')
  const [from, setFrom] = useState(isoMinus(90))
  const [to, setTo] = useState(localToday())
  const [days, setDays] = useState(30)
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  const load = useCallback(async () => {
    try {
      const [g, c] = await Promise.all([getMyGrants(), getRecordConsent()])
      setGrants(g.filter(x => x.appointmentId === appt.appointmentId)); setConsent(c); setError(null)
    } catch (err) { setError(err) }
  }, [appt.appointmentId])
  useEffect(() => { load() }, [load])

  const eligible = appt.status === 'accepted' || appt.status === 'completed'
  async function submit(e) {
    e.preventDefault()
    if (busy || !agreed || !cats.length) return
    setBusy(true); setError(null); setDone('')
    try {
      await createGrant({ appointmentId: appt.appointmentId, categories: cats, purpose, rangeFrom: from, rangeTo: to, days: Number(days), consentVersion: consent.version, consentAccepted: true })
      setShowForm(false); setCats([]); setAgreed(false); setDone('Access granted. Your doctor can now view the records you selected.')
      await load()
    } catch (err) { setError(err) } finally { setBusy(false) }
  }
  async function revoke(id) {
    if (!window.confirm('Revoke this access? Your doctor will no longer be able to view these records in the app.')) return
    setBusy(true); setError(null); setDone('')
    try { await revokeGrant(id); setDone('Access revoked.'); await load() } catch (err) { setError(err) } finally { setBusy(false) }
  }

  if (!grants && !error) return <Loading />
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Your doctor cannot see your health records unless you share them here. You choose what, for which dates, and for how long, and you can revoke access at any time.</p>
      <ErrorNote error={error} onRetry={load} />
      {done && <p role="status" className="text-sm rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2">{done}</p>}
      {grants?.length ? (
        <ul className="space-y-2">
          {grants.map(g => (
            <li key={g.grantId} className="rounded-xl border border-brand-100 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${g.status === 'active' ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>
                  {g.status === 'active' ? 'Active' : g.status === 'expired' ? 'Expired' : 'Revoked'}
                </span>
                {g.status === 'active' && <button disabled={busy} onClick={() => revoke(g.grantId)} className="text-xs font-semibold text-red-600 underline">Revoke access</button>}
              </div>
              <p className="mt-1.5 text-gray-800">{g.categories.map(c => CATEGORY_LABELS[c]).join(', ')}</p>
              <p className="text-xs text-gray-500 mt-0.5">Records from {fmtDay(g.rangeFrom)} to {fmtDay(g.rangeTo)} · {PURPOSE_LABELS[g.purpose]} · {g.status === 'revoked' ? `revoked ${fmtDateTime(g.revokedAt)}` : `until ${new Date(g.expiresAt).toLocaleDateString()}`}</p>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-gray-500">You have not shared any records with this doctor.</p>}

      {!eligible ? <p className="text-xs text-gray-500">Records can be shared once the doctor has confirmed this appointment.</p> : !showForm ? (
        <button onClick={() => setShowForm(true)} className={ghost}><Icon name="shield" size={16} /> Share records with this doctor</button>
      ) : (
        <form onSubmit={submit} className="rounded-xl border border-brand-100 bg-brand-50/40 p-3 space-y-3">
          <fieldset>
            <legend className="text-sm font-semibold text-gray-900 mb-1.5">What to share</legend>
            <div className="grid sm:grid-cols-2 gap-1.5">
              {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm text-gray-800">
                  <input type="checkbox" className="accent-brand-600" checked={cats.includes(k)} onChange={e => setCats(c => e.target.checked ? [...c, k] : c.filter(x => x !== k))} /> {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex flex-col gap-1">From<input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="rounded-lg border border-brand-100 px-2 py-1" /></label>
            <label className="flex flex-col gap-1">To<input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="rounded-lg border border-brand-100 px-2 py-1" /></label>
            <label className="flex flex-col gap-1">Access lasts
              <select value={days} onChange={e => setDays(e.target.value)} className="rounded-lg border border-brand-100 px-2 py-1">
                {[7, 14, 30, 60, 90].map(d => <option key={d} value={d}>{d} days</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">Purpose
              <select value={purpose} onChange={e => setPurpose(e.target.value)} className="rounded-lg border border-brand-100 px-2 py-1">
                {Object.entries(PURPOSE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
          {consent && (
            <div className="rounded-lg bg-white border border-brand-100 p-3 max-h-40 overflow-y-auto text-xs text-gray-700 whitespace-pre-line">{consent.text}</div>
          )}
          <label className="flex items-start gap-2 text-sm text-gray-800">
            <input type="checkbox" className="accent-brand-600 mt-0.5" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
            I have read the consent above and agree to share the selected records with {appt.doctor.name}.
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !agreed || !cats.length} className={primary}>{busy ? 'Saving…' : 'Give consent and share'}</button>
            <button type="button" onClick={() => setShowForm(false)} className={ghost}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}

/** Everything about one of the patient's appointments, kept in sync with the Doctor Portal. */
export default function PatientAppointmentModal({ appointmentId, doctorDays = [], onClose, onChanged }) {
  const [appt, setAppt] = useState(null)
  const [notes, setNotes] = useState(null)
  const [error, setError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('notes')
  const [moving, setMoving] = useState(false)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)

  const load = useCallback(async () => {
    try {
      const [a, n] = await Promise.all([getCareAppointment(appointmentId), getPatientNotes(appointmentId)])
      setAppt(a); setNotes(n); setError(null); setUpdatedAt(Date.now())
    } catch (err) { setError(err) }
  }, [appointmentId])
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [load])
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function act(fn) {
    if (busy) return
    setBusy(true); setActionError(null)
    try { await fn(); await load(); onChanged?.() } catch (err) { setActionError(err); if (err.code === 'STALE') await load() } finally { setBusy(false) }
  }
  const dayOk = d => !doctorDays.length || doctorDays.includes(new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }))
  const open = appt && ['pending', 'accepted'].includes(appt.status)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Appointment details">
      <button className="absolute inset-0 bg-black/30" aria-label="Close" onClick={onClose} />
      <div className="relative w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl">
        <div className="sticky top-0 z-10 bg-white border-b border-brand-100 px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Your appointment</p>
            <h2 className="text-lg font-bold text-gray-900 break-words">{appt?.doctor?.name || '…'}</h2>
            {appt && <p className="text-sm text-gray-600">{fmtDay(appt.date)} · {appt.time}</p>}
          </div>
          <div className="flex items-center gap-2">
            {appt && <ApptStatus status={appt.status} patientView />}
            <button onClick={onClose} className="w-9 h-9 rounded-lg hover:bg-brand-50 flex items-center justify-center" aria-label="Close"><Icon name="close" size={18} /></button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <ErrorNote error={error} onRetry={load} />
          {!appt && !error && <Loading />}
          {appt && (
            <>
              {appt.proposal?.byDoctor && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm text-amber-900">Your doctor proposed a new time: <strong>{fmtDay(appt.proposal.date)} at {appt.proposal.time}</strong>. Your appointment stays at the current time unless you accept.</p>
                  <div className="mt-3 flex gap-2">
                    <button disabled={busy} className={primary} onClick={() => act(() => respondToProposal(appt.appointmentId, true, appt.version))}>Accept new time</button>
                    <button disabled={busy} className={ghost} onClick={() => act(() => respondToProposal(appt.appointmentId, false, appt.version))}>Keep current time</button>
                  </div>
                </div>
              )}
              {appt.status === 'pending' && !appt.proposal && <p className="text-sm text-gray-600">Waiting for the doctor to confirm.</p>}
              {open && (
                <div>
                  <button onClick={() => setMoving(m => !m)} className={ghost}><Icon name="calendar" size={16} /> Request a different time</button>
                  {moving && (
                    <form className="mt-3 rounded-xl border border-brand-100 p-3 flex flex-wrap items-end gap-3" onSubmit={e => {
                      e.preventDefault()
                      act(async () => { await rescheduleAppointment(appt.appointmentId, { date, time, version: appt.version }); setMoving(false) })
                    }}>
                      <label className="text-sm flex flex-col gap-1">Date<input type="date" required min={localToday()} value={date} onChange={e => setDate(e.target.value)} className="rounded-lg border border-brand-100 px-2 py-1.5" /></label>
                      <label className="text-sm flex flex-col gap-1">Time
                        <select required value={time} onChange={e => setTime(e.target.value)} className="rounded-lg border border-brand-100 px-2 py-1.5">
                          <option value="">Choose…</option>{TIME_SLOTS.map(s => <option key={s}>{s}</option>)}
                        </select>
                      </label>
                      <button type="submit" disabled={busy || !date || !time} className={primary}>Send request</button>
                      {date && !dayOk(date) && <p className="w-full text-xs text-amber-700">This doctor sees patients on {doctorDays.join(', ')}.</p>}
                      <p className="w-full text-xs text-gray-500">The appointment goes back to "pending" until the doctor confirms the new time.</p>
                    </form>
                  )}
                </div>
              )}
              <ErrorNote error={actionError} />

              <div className="flex gap-1 bg-brand-50 rounded-xl p-1" role="tablist">
                {[['notes', `From your doctor${notes?.length ? ` (${notes.length})` : ''}`], ['messages', `Messages${appt.unreadMessages ? ` (${appt.unreadMessages} new)` : ''}`], ['share', 'Share records']].map(([id, label]) => (
                  <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                    className={`flex-1 rounded-lg py-2 text-sm font-semibold ${tab === id ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-600'}`}>{label}</button>
                ))}
              </div>
              {tab === 'notes' && (!notes?.length
                ? <EmptyState icon="doc" title="Nothing shared yet" hint="Notes and follow-up instructions your doctor shares with you appear here." />
                : <ul className="space-y-2">{notes.map(n => (
                    <li key={n.noteId} className={`rounded-xl border p-3 ${n.kind === 'follow_up' ? 'border-brand-200 bg-brand-50/50' : 'border-gray-200 bg-white'}`}>
                      <p className="text-sm font-semibold text-gray-900">{KIND_LABEL[n.kind]}{n.dueDate ? ` · by ${fmtDay(n.dueDate)}` : ''}{n.followUpStatus === 'done' ? ' · completed' : ''}</p>
                      <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap break-words">{n.text}</p>
                      <p className="text-xs text-gray-500 mt-1">{fmtDateTime(n.createdAt)}</p>
                    </li>
                  ))}</ul>)}
              {tab === 'messages' && <MessageThread appointmentId={appt.appointmentId} compact />}
              {tab === 'share' && <ShareRecords appt={appt} />}
              <div className="text-right"><UpdatedStamp at={updatedAt} onRefresh={load} /></div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
