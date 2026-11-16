import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../icons'
import { getPatientTimeline } from '../../services/api'
import { CATEGORY_LABELS, toDate } from '../care/shared'

// One patient's timeline for the signed-in doctor (English-only, like the rest of the Doctor Portal).
// Shared health records appear only for categories and dates the patient has shared; opening this view is logged.
const navy = 'text-[#1f2a44]'
const EVENT_TEXT = {
  requested: 'Appointment requested', accepted: 'Appointment accepted', declined: 'Request declined', cancelled_by_patient: 'Cancelled by the patient',
  cancelled_by_doctor: 'Cancelled by you', rescheduled_by_patient: 'Rescheduled by the patient', reschedule_proposed: 'New time proposed',
  proposal_accepted: 'Proposed time accepted', proposal_declined: 'Proposed time declined', completed: 'Appointment completed',
  note_shared: 'Note shared with the patient', follow_up_added: 'Follow-up added',
}
const TYPE_STYLE = {
  appointment: ['calendar', 'bg-sky-50 text-sky-700'], note: ['doc', 'bg-slate-100 text-slate-700'], messages: ['message', 'bg-indigo-50 text-indigo-700'],
  report: ['shield', 'bg-emerald-50 text-emerald-700'], therapy_plan: ['drop', 'bg-orange-50 text-orange-700'], record: ['list', 'bg-brand-50 text-brand-700'],
}
const FILTERS = [['all', 'All'], ['appointment', 'Appointments'], ['record', 'Shared records'], ['note', 'Notes'], ['messages', 'Messages'], ['report', 'Reports'], ['therapy_plan', 'Plans']]

function when(i) {
  const d = i.atKind === 'date' ? new Date(i.at + 'T12:00:00') : i.atKind === 'ts' ? toDate(i.at) : new Date(i.at)
  if (!d || Number.isNaN(d.getTime())) return String(i.at)
  return i.atKind === 'date' ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function recordText(cat, r) {
  switch (cat) {
    case 'pain': return `Pain ${r.pain}/10 · ${String(r.source).replace(/_/g, ' ')}${r.context ? ` (${r.context})` : ''}`
    case 'symptoms': return `${r.type}${r.severity != null ? ` · ${r.severity}/10` : ''}${r.body_area ? ` · ${r.body_area}` : ''}`
    case 'predictions': return `AI prediction: ${r.predicted_severity}${r.confidence != null ? ` (${Math.round(r.confidence * 100)}%)` : ''} — not a diagnosis`
    case 'cycles': return `Period started · ${r.cycle_length || 28}-day cycle${r.flow ? ` · ${r.flow} flow` : ''}`
    case 'wellness': return `Check-in: ${r.mood || '—'} · energy ${r.energy ?? '—'} · stress ${r.stress ?? '—'} · sleep quality ${r.sleep_quality ?? '—'}`
    case 'heat_sessions': return `Heat session ${r.heat_temp_c ?? '—'} °C · ${Math.round((r.duration_seconds || 0) / 60)} min${r.pain_before != null ? ` · pain ${r.pain_before}→${r.pain_after ?? '?'}` : ''}`
    case 'tens_sessions': return `TENS (self-recorded) ${r.tens_frequency ?? '—'} Hz · ${Math.round((r.duration_seconds || 0) / 60)} min${r.pain_before != null ? ` · pain ${r.pain_before}→${r.pain_after ?? '?'}` : ''}`
    default: return cat
  }
}

function itemText(i) {
  switch (i.type) {
    case 'appointment': return `${EVENT_TEXT[i.event] || i.event}${i.date ? ` · for ${new Date(i.date + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}${i.time ? ` ${i.time}` : ''}` : ''}`
    case 'note': return `${i.kind === 'follow_up' ? 'Follow-up' : 'Consultation note'} added (${i.visibility === 'patient' ? 'shared with patient' : 'private'})`
    case 'messages': return `Messages: ${i.fromPatient} from patient, ${i.fromDoctor} from you`
    case 'report': return `Report “${i.title}” shared with you · ${String(i.status).replace(/_/g, ' ')}`
    case 'therapy_plan': return `Therapy plan (${i.status}) · heat ${i.heat} · TENS ${i.tens}`
    case 'record': return recordText(i.category, i.data)
    default: return i.type
  }
}

export default function PatientTimeline({ patientId, name, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const load = useCallback(() => { setError(''); getPatientTimeline(patientId).then(setData).catch(err => setError(err.message)) }, [patientId])
  useEffect(() => { setData(null); load() }, [load])
  const items = (data?.items || []).filter(i => filter === 'all' || i.type === filter)

  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mt-4" aria-label={`Timeline for ${name}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h3 className={`text-lg font-bold ${navy}`}>Timeline · {name}</h3>
          <p className="text-xs text-slate-500">
            {data ? (data.sharedCategories.length ? `Shared records included: ${data.sharedCategories.map(c => CATEGORY_LABELS[c]).join(', ')}.` : 'No health records are shared with you; appointments and messages only.') : ' '}
            {' '}Viewing shared records is logged.
          </p>
        </div>
        <button onClick={onClose} aria-label="Close timeline" className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50"><Icon name="close" size={18} /></button>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-4" role="tablist" aria-label="Filter timeline">
        {FILTERS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${filter === k ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-700 border-slate-200'}`}>{label}</button>
        ))}
      </div>
      {error ? <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2">{error}</p>
        : !data ? <p className="text-sm text-slate-500">Loading…</p>
        : items.length === 0 ? <p className="text-sm text-slate-500">Nothing to show.</p> : (
          <ol className="relative border-l border-slate-200 ml-3 space-y-3">
            {items.map((i, n) => {
              const [icon, tone] = TYPE_STYLE[i.type] || ['list', 'bg-slate-100 text-slate-700']
              return (
                <li key={n} className="ml-5">
                  <span className={`absolute -left-3.5 w-7 h-7 rounded-full flex items-center justify-center ring-4 ring-white ${tone}`}><Icon name={icon} size={14} /></span>
                  <p className="text-xs text-slate-500">{when(i)}{i.type === 'record' && <span className="ml-2 text-[11px] font-medium text-brand-700">{CATEGORY_LABELS[i.category]}</span>}</p>
                  <p className="text-sm text-slate-800">{itemText(i)}</p>
                </li>
              )
            })}
          </ol>
        )}
    </section>
  )
}
