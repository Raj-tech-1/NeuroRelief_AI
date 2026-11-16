import { useCallback, useEffect, useRef, useState } from 'react'
import { getCareStatus, getMessages, sendMessage } from '../../services/api'
import { Icon } from '../icons'

// Shared pieces for the patient <-> doctor synchronisation UI (both portals).
// Every rule is enforced by the backend; these components only render what it returns.

export const POLL_MS = 30000

// SQLite CURRENT_TIMESTAMP is UTC without a zone ("2030-01-02 10:00:00")
export function toDate(ts) {
  if (!ts) return null
  const s = String(ts)
  return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z')
}
export function ago(ts, now = Date.now()) {
  const d = toDate(ts)
  if (!d || Number.isNaN(d.getTime())) return ''
  const s = Math.max(0, Math.round((now - d.getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const days = Math.round(h / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
export const fmtDay = iso => {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
export const fmtDateTime = ts => { const d = toDate(ts); return d ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '' }
export function localToday() {
  const d = new Date(); const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
export const minutesOf = t => { const m = /^(\d+):(\d+) (AM|PM)$/.exec(t || ''); return m ? ((Number(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0)) * 60 + Number(m[2]) : 0 }
export const TIME_SLOTS = ['9:00 AM', '10:00 AM', '11:00 AM', '2:00 PM', '3:00 PM', '4:00 PM']

// Whether /api/care is enabled on this server (it is inert until the clinical-sync migration has been applied)
export function useCareStatus() {
  const [status, setStatus] = useState({ loading: true, enabled: false, notes: false })
  useEffect(() => {
    let alive = true
    getCareStatus().then(s => alive && setStatus({ loading: false, enabled: s?.enabled === true, notes: s?.notes === true }))
      .catch(() => alive && setStatus({ loading: false, enabled: false, notes: false }))
    return () => { alive = false }
  }, [])
  return status
}

/**
 * Loads data now, every POLL_MS and when the window regains focus. Never runs two loads at once.
 * Returns { data, error, loading, updatedAt, reload }.
 */
export function usePolled(loader, deps = [], { enabled = true, interval = POLL_MS } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true, updatedAt: null })
  const busy = useRef(false)
  const alive = useRef(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps)
  const reload = useCallback(async () => {
    if (busy.current || !enabled) return
    busy.current = true
    try {
      const data = await load()
      if (alive.current) setState({ data, error: null, loading: false, updatedAt: Date.now() })
    } catch (error) {
      if (alive.current) setState(s => ({ ...s, error, loading: false }))
    } finally {
      busy.current = false
    }
  }, [load, enabled])
  useEffect(() => {
    alive.current = true
    if (!enabled) { setState(s => ({ ...s, loading: false })); return () => { alive.current = false } }
    reload()
    const timer = setInterval(reload, interval)
    const onVisible = () => { if (document.visibilityState === 'visible') reload() }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive.current = false
      clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [reload, enabled, interval])
  return { ...state, reload }
}

export function UpdatedStamp({ at, onRefresh, busy }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 15000); return () => clearInterval(t) }, [])
  if (!at) return null
  return (
    <span className="inline-flex items-center gap-2 text-xs text-slate-500">
      Updated {ago(new Date(at).toISOString())}
      {onRefresh && (
        <button onClick={onRefresh} disabled={busy} className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700 font-medium disabled:opacity-50">
          <Icon name="retry" size={13} /> Refresh
        </button>
      )}
    </span>
  )
}

export const APPT_STATUS = {
  pending: { label: 'Pending', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  accepted: { label: 'Confirmed', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  completed: { label: 'Completed', cls: 'bg-sky-50 text-sky-800 border-sky-200' },
  declined: { label: 'Declined', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  cancelled: { label: 'Cancelled by patient', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  cancelled_by_doctor: { label: 'Cancelled by doctor', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
}
export function ApptStatus({ status, patientView = false }) {
  const s = APPT_STATUS[status] || { label: status, cls: 'bg-slate-100 text-slate-600 border-slate-200' }
  const label = patientView && status === 'cancelled' ? 'Cancelled' : s.label
  return <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full border ${s.cls}`}>{label}</span>
}

// Human text for appointment / report events. `role` is the viewer.
export function eventText(e, role) {
  const who = e.counterpart || (role === 'doctor' ? 'The patient' : 'Your doctor')
  const slot = x => (x ? `${fmtDay(x.date)} at ${x.time}` : '')
  switch (e.type) {
    case 'requested': return `${who} requested an appointment for ${slot(e.to)}`
    case 'accepted': return `${who} confirmed your appointment on ${slot(e.to)}`
    case 'declined': return `${who} declined the request for ${slot(e.to)}`
    case 'cancelled_by_patient': return `${who} cancelled the appointment on ${slot(e.from || e.to)}`
    case 'cancelled_by_doctor': return `${who} cancelled the appointment on ${slot(e.from)}`
    case 'rescheduled_by_patient': return `${who} moved the appointment to ${slot(e.to)} (needs confirmation)`
    case 'reschedule_proposed': return `${who} proposed a new time: ${slot(e.to)}`
    case 'proposal_accepted': return `${who} accepted the new time ${slot(e.to)}`
    case 'proposal_declined': return `${who} declined the proposed time ${slot(e.to)}`
    case 'completed': return `${who} marked the consultation as completed`
    case 'note_shared': return `${who} shared a consultation note`
    case 'follow_up_added': return `${who} added follow-up instructions`
    case 'message_sent': return `New message from ${who}`
    case 'share_submitted': return `${who} shared a report: ${e.title || ''}`
    case 'share_revoked': return `${who} revoked access to a report`
    case 'report_under_review': return `${who} started reviewing your report`
    case 'report_changes_requested': return `${who} requested changes to your report`
    case 'report_verified': return `${who} completed verification of your report`
    default: return `${who}: ${String(e.type).replace(/_/g, ' ')}`
  }
}
export function eventIcon(type) {
  if (type === 'message_sent') return 'message'
  if (type?.startsWith('report') || type?.startsWith('share')) return 'doc'
  if (type === 'note_shared' || type === 'follow_up_added') return 'list'
  return 'calendar'
}

export const CATEGORY_LABELS = {
  cycles: 'Cycle history', symptoms: 'Recorded symptoms', pain: 'Pain intensity', wellness: 'Wellness records',
  predictions: 'AI-generated predictions', heat_sessions: 'Heating therapy sessions', tens_sessions: 'TENS sessions (manually recorded)',
}
export const PURPOSE_LABELS = { consultation_review: 'Review for my consultation', follow_up_care: 'Follow-up care' }

export function ErrorNote({ error, onRetry }) {
  if (!error) return null
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      <span>{error.message || 'Something went wrong.'}</span>
      {onRetry && <button onClick={onRetry} className="text-xs underline shrink-0">Try again</button>}
    </div>
  )
}
export function Loading({ text = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-brand-700" role="status">
      <span className="w-5 h-5 rounded-full border-2 border-brand-200 border-t-brand-600 animate-spin" aria-hidden="true" />
      <span className="text-sm">{text}</span>
    </div>
  )
}
export function EmptyState({ title, hint, icon = 'list' }) {
  return (
    <div className="text-center py-8 px-3">
      <span className="mx-auto mb-2 w-10 h-10 rounded-full bg-brand-50 text-brand-500 flex items-center justify-center"><Icon name={icon} size={20} /></span>
      <p className="font-semibold text-slate-800">{title}</p>
      {hint && <p className="text-sm text-slate-500 mt-1">{hint}</p>}
    </div>
  )
}

/** Message thread for one appointment (either portal). Polls while open. */
export function MessageThread({ appointmentId, compact = false }) {
  const { data, error, loading, reload, updatedAt } = usePolled(() => getMessages(appointmentId), [appointmentId], { interval: 15000 })
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(null)
  const endRef = useRef(null)
  const count = data?.messages?.length || 0
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }) }, [count])

  async function send(e) {
    e.preventDefault()
    const body = text.trim()
    if (!body || sending) return
    setSending(true); setSendError(null)
    try { await sendMessage(appointmentId, body); setText(''); await reload() } catch (err) { setSendError(err) } finally { setSending(false) }
  }

  if (loading && !data) return <Loading text="Loading messages…" />
  return (
    <div className="flex flex-col gap-2">
      <ErrorNote error={error} onRetry={reload} />
      <div className={`overflow-y-auto rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2 ${compact ? 'max-h-60' : 'max-h-[420px] min-h-[180px]'}`}>
        {count === 0 && <p className="text-sm text-slate-500 text-center py-6">No messages yet.</p>}
        {data?.messages?.map(m => (
          <div key={m.messageId} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${m.mine ? 'bg-brand-600 text-white rounded-br-md' : 'bg-white text-slate-800 border border-slate-200 rounded-bl-md'}`}>
              <p className="whitespace-pre-wrap break-words">{m.text}</p>
              <p className={`text-[10px] mt-1 ${m.mine ? 'text-brand-100' : 'text-slate-400'}`}>{fmtDateTime(m.createdAt)}{m.mine && m.readAt ? ' · Read' : ''}</p>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {data?.canMessage ? (
        <form onSubmit={send} className="flex items-end gap-2">
          <label className="sr-only" htmlFor={`msg-${appointmentId}`}>Message</label>
          <textarea id={`msg-${appointmentId}`} value={text} onChange={e => setText(e.target.value)} maxLength={2000} rows={2}
            placeholder="Write a message about this appointment…"
            className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200" />
          <button type="submit" disabled={sending || !text.trim()}
            className="h-10 px-4 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 inline-flex items-center gap-1.5">
            <Icon name="send" size={15} /> {sending ? 'Sending…' : 'Send'}
          </button>
        </form>
      ) : <p className="text-xs text-slate-500">Messages are closed for this appointment.</p>}
      <ErrorNote error={sendError} />
      <div className="text-right"><UpdatedStamp at={updatedAt} /></div>
    </div>
  )
}
