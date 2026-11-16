import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../icons'
import {
  getCareAppointment, getDoctorNotes, addConsultationNote, updateNote, proposeTime, completeAppointment,
  doctorCancelAppointment, updateRequestStatus,
} from '../../services/api'
import {
  ApptStatus, MessageThread, ErrorNote, Loading, fmtDay, fmtDateTime, localToday, TIME_SLOTS, UpdatedStamp,
} from '../care/shared'

const btn = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200'
const primary = `${btn} bg-brand-600 text-white hover:bg-brand-700`
const ghost = `${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`
const danger = `${btn} border border-rose-200 bg-white text-rose-700 hover:bg-rose-50`
const TIMELINE = {
  requested: 'requested', accepted: 'confirmed', declined: 'declined', cancelled_by_patient: 'cancelled', cancelled_by_doctor: 'cancelled',
  rescheduled_by_patient: 'moved the appointment', reschedule_proposed: 'proposed a new time', proposal_accepted: 'accepted the new time',
  proposal_declined: 'declined the proposed time', completed: 'completed the consultation', note_shared: 'shared a note',
  follow_up_added: 'added follow-up instructions', message_sent: 'sent a message',
}
const KIND_LABEL = { clinical_note: 'Consultation note', follow_up: 'Follow-up instruction', summary: 'Consultation summary' }

export function VisibilityBadge({ visibility }) {
  return visibility === 'patient'
    ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200"><Icon name="eye" size={12} /> Visible to patient</span>
    : <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200"><Icon name="shield" size={12} /> Private (only you)</span>
}

function NoteForm({ appointmentId, onSaved }) {
  const [kind, setKind] = useState('clinical_note')
  const [visibility, setVisibility] = useState('private')
  const [text, setText] = useState('')
  const [due, setDue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const isFollow = kind === 'follow_up'
  async function save(e) {
    e.preventDefault()
    if (saving || !text.trim()) return
    setSaving(true); setError(null)
    try {
      await addConsultationNote(appointmentId, { kind, visibility: isFollow ? 'patient' : visibility, text: text.trim(), dueDate: isFollow && due ? due : undefined })
      setText(''); setDue('')
      onSaved?.()
    } catch (err) { setError(err) } finally { setSaving(false) }
  }
  return (
    <form onSubmit={save} className="rounded-xl border border-slate-200 p-3 space-y-3 bg-white">
      <div className="flex flex-wrap gap-2">
        {Object.entries(KIND_LABEL).map(([k, label]) => (
          <button type="button" key={k} onClick={() => setKind(k)} aria-pressed={kind === k}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${kind === k ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>{label}</button>
        ))}
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={4} maxLength={4000} required
        placeholder={isFollow ? 'Instructions the patient will see…' : 'Write the note…'}
        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200" />
      {isFollow ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2 text-slate-700">Due date (optional)
            <input type="date" value={due} min={localToday()} onChange={e => setDue(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-sm" />
          </label>
          <VisibilityBadge visibility="patient" />
          <span className="text-xs text-slate-500">Follow-up instructions are always shared with the patient.</span>
        </div>
      ) : (
        <fieldset className="flex flex-wrap gap-3 text-sm">
          <legend className="sr-only">Who can see this note</legend>
          {[['private', 'Private: only you can read it'], ['patient', 'Visible to the patient']].map(([v, label]) => (
            <label key={v} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 cursor-pointer ${visibility === v ? 'border-brand-300 bg-brand-50' : 'border-slate-200'}`}>
              <input type="radio" name={`vis-${appointmentId}`} value={v} checked={visibility === v} onChange={() => setVisibility(v)} className="accent-brand-600" /> {label}
            </label>
          ))}
        </fieldset>
      )}
      <ErrorNote error={error} />
      <div className="flex justify-end"><button type="submit" disabled={saving || !text.trim()} className={primary}>{saving ? 'Saving…' : 'Save note'}</button></div>
    </form>
  )
}

export function NoteCard({ n, onChanged, showPatient = false }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function change(body) {
    if (busy) return
    if (body.visibility === 'patient' && !window.confirm('Share this note with the patient? They will be able to read it in their portal.')) return
    setBusy(true); setError(null)
    try { await updateNote(n.noteId, body); onChanged?.() } catch (err) { setError(err) } finally { setBusy(false) }
  }
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{KIND_LABEL[n.kind]}{showPatient && n.patientName ? ` · ${n.patientName}` : ''}</p>
        <VisibilityBadge visibility={n.visibility} />
      </div>
      <p className="mt-1.5 text-sm text-slate-700 whitespace-pre-wrap break-words">{n.text}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>{fmtDateTime(n.createdAt)}{n.dueDate ? ` · Due ${fmtDay(n.dueDate)}` : ''}{n.followUpStatus ? ` · ${n.followUpStatus === 'done' ? 'Done' : 'Open'}` : ''}</span>
        <span className="flex gap-3">
          {n.kind !== 'follow_up' && (n.visibility === 'private'
            ? <button disabled={busy} onClick={() => change({ visibility: 'patient' })} className="text-brand-700 font-semibold hover:underline">Share with patient</button>
            : <button disabled={busy} onClick={() => change({ visibility: 'private' })} className="text-slate-600 font-semibold hover:underline">Make private</button>)}
          {n.kind === 'follow_up' && (n.followUpStatus === 'open'
            ? <button disabled={busy} onClick={() => change({ followUpStatus: 'done' })} className="text-emerald-700 font-semibold hover:underline">Mark done</button>
            : <button disabled={busy} onClick={() => change({ followUpStatus: 'open' })} className="text-slate-600 font-semibold hover:underline">Reopen</button>)}
        </span>
      </div>
      <ErrorNote error={error} />
    </li>
  )
}

/** Side drawer with everything about one appointment, for the doctor. */
export default function AppointmentDrawer({ appointmentId, profileDays = [], onClose, onChanged, onOpenInsights }) {
  const [appt, setAppt] = useState(null)
  const [notes, setNotes] = useState([])
  const [error, setError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('notes')
  const [proposing, setProposing] = useState(false)
  const [pDate, setPDate] = useState('')
  const [pTime, setPTime] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)

  const load = useCallback(async () => {
    try {
      const [a, n] = await Promise.all([getCareAppointment(appointmentId), getDoctorNotes({ appointmentId })])
      setAppt(a); setNotes(n); setError(null); setUpdatedAt(Date.now())
    } catch (err) { setError(err) }
  }, [appointmentId])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function act(fn, confirmText) {
    if (busy) return
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true); setActionError(null)
    try { await fn(); await load(); onChanged?.() } catch (err) {
      setActionError(err)
      if (err.code === 'STALE') await load()
    } finally { setBusy(false) }
  }

  const today = localToday()
  const weekdayOk = d => !profileDays.length || profileDays.includes(new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }))

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Appointment details">
      <button className="absolute inset-0 bg-slate-900/30" aria-label="Close" onClick={onClose} />
      <div className="relative h-full w-full max-w-2xl bg-slate-50 shadow-2xl overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Appointment</p>
            <h2 className="text-lg font-bold text-[#1f2a44] break-words">{appt?.patient?.name || '…'}</h2>
            {appt && <p className="text-sm text-slate-600">{fmtDay(appt.date)} · {appt.time}</p>}
          </div>
          <div className="flex items-center gap-2">
            {appt && <ApptStatus status={appt.status} />}
            <button onClick={onClose} className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center" aria-label="Close"><Icon name="close" size={18} /></button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <ErrorNote error={error} onRetry={load} />
          {!appt && !error && <Loading />}
          {appt && (
            <>
              {appt.proposal && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  You proposed <strong>{fmtDay(appt.proposal.date)} at {appt.proposal.time}</strong>. The appointment stays at the current time until the patient accepts.
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {appt.status === 'pending' && (
                  <>
                    <button disabled={busy} className={primary} onClick={() => act(() => updateRequestStatus(appt.appointmentId, 'accepted'))}><Icon name="check" size={16} /> Accept</button>
                    <button disabled={busy} className={danger} onClick={() => act(() => updateRequestStatus(appt.appointmentId, 'declined'), 'Decline this request?')}>Decline</button>
                  </>
                )}
                {['pending', 'accepted'].includes(appt.status) && (
                  <button disabled={busy} className={ghost} onClick={() => setProposing(p => !p)}><Icon name="calendar" size={16} /> Propose new time</button>
                )}
                {appt.status === 'accepted' && appt.date <= today && (
                  <button disabled={busy} className={ghost} onClick={() => act(() => completeAppointment(appt.appointmentId, appt.version), 'Mark this consultation as completed?')}><Icon name="check" size={16} /> Complete consultation</button>
                )}
                {['pending', 'accepted'].includes(appt.status) && (
                  <button disabled={busy} className={danger} onClick={() => act(() => doctorCancelAppointment(appt.appointmentId, appt.version), 'Cancel this appointment? The patient will be notified.')}>Cancel appointment</button>
                )}
                {onOpenInsights && <button className={ghost} onClick={() => onOpenInsights(appt.patient.patientId)}><Icon name="chart" size={16} /> Patient insights</button>}
              </div>
              {proposing && (
                <form className="rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-end gap-3" onSubmit={e => {
                  e.preventDefault()
                  act(async () => { await proposeTime(appt.appointmentId, { date: pDate, time: pTime, version: appt.version }); setProposing(false) })
                }}>
                  <label className="text-sm text-slate-700 flex flex-col gap-1">Date
                    <input type="date" required min={today} value={pDate} onChange={e => setPDate(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5" />
                  </label>
                  <label className="text-sm text-slate-700 flex flex-col gap-1">Time
                    <select required value={pTime} onChange={e => setPTime(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5">
                      <option value="">Choose…</option>{TIME_SLOTS.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </label>
                  <button type="submit" disabled={busy || !pDate || !pTime} className={primary}>Send proposal</button>
                  {pDate && !weekdayOk(pDate) && <p className="w-full text-xs text-amber-700">That day is outside your consultation days ({profileDays.join(', ')}); the server will refuse it.</p>}
                  <p className="w-full text-xs text-slate-500">The patient must accept the new time before it replaces the current one. Both of you are notified.</p>
                </form>
              )}
              <ErrorNote error={actionError} />

              <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1" role="tablist">
                {[['notes', `Notes (${notes.length})`], ['messages', `Messages${appt.unreadMessages ? ` (${appt.unreadMessages} new)` : ''}`], ['timeline', 'Timeline']].map(([id, label]) => (
                  <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                    className={`flex-1 rounded-lg py-2 text-sm font-semibold ${tab === id ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-50'}`}>{label}</button>
                ))}
              </div>

              {tab === 'notes' && (
                <div className="space-y-3">
                  {appt.canAddNotes ? <NoteForm appointmentId={appt.appointmentId} onSaved={load} />
                    : <p className="text-sm text-slate-500">Notes can be added to confirmed consultations and for 30 days after completion.</p>}
                  {notes.length === 0 ? <p className="text-sm text-slate-500">No notes for this appointment yet.</p>
                    : <ul className="space-y-2">{notes.map(n => <NoteCard key={n.noteId} n={n} onChanged={load} />)}</ul>}
                </div>
              )}
              {tab === 'messages' && <MessageThread appointmentId={appt.appointmentId} />}
              {tab === 'timeline' && (
                <ol className="space-y-2">
                  {appt.events.length === 0 && <p className="text-sm text-slate-500">No recorded changes yet (history starts from the synchronisation update).</p>}
                  {appt.events.map(e => (
                    <li key={e.eventId} className="rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm">
                      <p className="text-slate-800"><span className="font-semibold">{e.actorRole === 'doctor' ? 'You' : appt.patient.name}</span> {TIMELINE[e.type] || e.type.replace(/_/g, ' ')}{e.to ? ` · ${fmtDay(e.to.date)} ${e.to.time}` : ''}</p>
                      <p className="text-xs text-slate-500">{fmtDateTime(e.createdAt)}</p>
                    </li>
                  ))}
                </ol>
              )}
              <div className="text-right"><UpdatedStamp at={updatedAt} onRefresh={load} /></div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
