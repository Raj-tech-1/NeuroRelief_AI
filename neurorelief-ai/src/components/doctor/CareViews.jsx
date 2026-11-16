import { useMemo, useState } from 'react'
import { Icon } from '../icons'
import {
  getDoctorPatients, getDoctorNotes, getConversations, getDoctorFollowUps, getPatientRecords,
} from '../../services/api'
import {
  usePolled, UpdatedStamp, ErrorNote, Loading, EmptyState, ApptStatus, MessageThread, eventText, eventIcon, ago,
  fmtDay, localToday, minutesOf, CATEGORY_LABELS, PURPOSE_LABELS,
} from '../care/shared'
import { NoteCard } from './AppointmentDrawer'
import { initials } from './helpers'

// Doctor Portal views for the synchronised features. Every list comes straight from the backend; nothing is invented.

const navy = 'text-[#1f2a44]'
export function Card({ title, right, children, className = '', id }) {
  return (
    <section aria-labelledby={id} className={`bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-4 sm:p-5 ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between gap-3 mb-3">
          {title && <h2 id={id} className={`font-bold ${navy}`}>{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  )
}
const linkBtn = 'inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700'

export function CareUnavailable() {
  return (
    <Card>
      <EmptyState icon="shield" title="Not available yet"
        hint="This part of the Doctor Portal needs the synchronisation update on the server. Appointment requests, the calendar and Report Verification keep working." />
    </Card>
  )
}

const byWhen = (a, b) => a.date.localeCompare(b.date) || minutesOf(a.time) - minutesOf(b.time)

// ---------------------------------------------------------------- Dashboard
function Kpi({ icon, tone, label, value, hint, onClick }) {
  return (
    <button onClick={onClick} className="text-left bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-4 sm:p-5 flex items-start gap-4 hover:border-brand-200 hover:shadow-md transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200 min-w-0">
      <span className={`shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center ${tone}`}><Icon name={icon} size={26} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-slate-600">{label}</span><Icon name="chevron" size={16} className="text-brand-500" /></span>
        <span className={`block text-3xl font-bold ${navy} leading-tight mt-0.5`}>{value}</span>
        <span className="block text-xs text-slate-500 mt-1">{hint}</span>
      </span>
    </button>
  )
}

function MiniCalendar({ requests, onPick }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const today = localToday()
  const busy = useMemo(() => new Set(requests.filter(r => ['pending', 'accepted', 'completed'].includes(r.status)).map(r => r.date)), [requests])
  const y = cursor.getFullYear(), m = cursor.getMonth()
  const first = new Date(y, m, 1).getDay()
  const days = new Date(y, m + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < first; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push(d)
  const iso = d => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return (
    <Card id="cal-h" title={cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} right={
      <span className="flex gap-1">
        <button aria-label="Previous month" onClick={() => setCursor(new Date(y, m - 1, 1))} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center"><Icon name="chevronLeft" size={16} /></button>
        <button aria-label="Next month" onClick={() => setCursor(new Date(y, m + 1, 1))} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center"><Icon name="chevron" size={16} /></button>
      </span>}>
      <div className="grid grid-cols-7 text-center text-xs font-medium text-slate-500 bg-slate-50 rounded-lg py-1.5 mb-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center text-sm">
        {cells.map((d, i) => d === null ? <span key={i} /> : (
          <button key={i} onClick={() => onPick(iso(d))} aria-label={`${iso(d)}${busy.has(iso(d)) ? ', has appointments' : ''}`}
            className={`relative mx-auto w-9 h-9 rounded-full flex items-center justify-center ${iso(d) === today ? 'bg-brand-600 text-white font-bold' : `${navy} hover:bg-brand-50`}`}>
            {d}
            {busy.has(iso(d)) && <span className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${iso(d) === today ? 'bg-white' : 'bg-brand-500'}`} />}
          </button>
        ))}
      </div>
    </Card>
  )
}

export function DashboardHome({ requests, dash, activity, reportsWaiting, careEnabled, onNavigate, onOpenAppointment, updatedAt, onRefresh }) {
  const today = localToday()
  const schedule = dash?.today?.schedule
    ?? requests.filter(r => r.date === today && ['pending', 'accepted', 'completed'].includes(r.status)).sort(byWhen)
      .map(r => ({ appointmentId: r.appointment_id, patientName: r.patient_name, time: r.time, status: r.status }))
  const upcoming = requests.filter(r => ['pending', 'accepted'].includes(r.status) && r.date > today).sort(byWhen).slice(0, 5)
  const patientsTotal = dash?.patients?.total ?? new Set(requests.filter(r => r.status !== 'declined').map(r => r.patient_id ?? r.patient_name)).size
  const pending = requests.filter(r => r.status === 'pending').length
  const awaiting = dash?.reports?.awaiting ?? reportsWaiting
  const tasks = []
  if (pending) tasks.push({ text: `Review ${pending} appointment request${pending === 1 ? '' : 's'}`, view: 'requests', icon: 'list' })
  if (awaiting) tasks.push({ text: `Review ${awaiting} shared report${awaiting === 1 ? '' : 's'}`, view: 'reports', icon: 'doc' })
  if (dash?.unreadMessages) tasks.push({ text: `Reply to ${dash.unreadMessages} unread message${dash.unreadMessages === 1 ? '' : 's'}`, view: 'messages', icon: 'message' })
  if (dash?.followUps?.overdue) tasks.push({ text: `${dash.followUps.overdue} follow-up${dash.followUps.overdue === 1 ? ' is' : 's are'} overdue`, view: 'followups', icon: 'clock' })
  if (dash?.tasks?.pastConfirmedToComplete) tasks.push({ text: `Complete ${dash.tasks.pastConfirmedToComplete} past consultation${dash.tasks.pastConfirmedToComplete === 1 ? '' : 's'}`, view: 'appointments', icon: 'check' })
  if (dash?.tasks?.consultsWithoutNotes) tasks.push({ text: `Add notes to ${dash.tasks.consultsWithoutNotes} completed consultation${dash.tasks.consultsWithoutNotes === 1 ? '' : 's'}`, view: 'appointments', icon: 'doc' })
  if (dash?.proposalsAwaitingPatient) tasks.push({ text: `${dash.proposalsAwaitingPatient} proposed time${dash.proposalsAwaitingPatient === 1 ? '' : 's'} awaiting the patient`, view: 'appointments', icon: 'calendar', info: true })

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi icon="calendar" tone="bg-brand-50 text-brand-600" label="Today's Appointments" value={schedule.length}
          hint={`${schedule.filter(s => s.status === 'accepted').length} confirmed · ${schedule.filter(s => s.status === 'pending').length} pending`} onClick={() => onNavigate('appointments')} />
        <Kpi icon="users" tone="bg-sky-50 text-sky-600" label="My Patients" value={patientsTotal}
          hint={dash ? `+${dash.patients.newThisMonth} new this month` : 'From your appointments'} onClick={() => onNavigate('patients')} />
        <Kpi icon="doc" tone="bg-amber-50 text-amber-600" label="Reports Awaiting Review" value={awaiting}
          hint={dash?.reports ? `${dash.reports.submitted} new · ${dash.reports.underReview} in review` : 'Shared with you by patients'} onClick={() => onNavigate('reports')} />
        <Kpi icon="clock" tone="bg-rose-50 text-rose-600" label="Follow-ups Due" value={careEnabled && dash ? dash.followUps.dueNext7Days : '—'}
          hint={careEnabled && dash ? `Next 7 days${dash.followUps.overdue ? ` · ${dash.followUps.overdue} overdue` : ''}` : 'Available after the update'} onClick={() => onNavigate('followups')} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-5">
        <div className="space-y-5 min-w-0">
          <Card id="sched-h" title="Today's Schedule" right={<button onClick={() => onNavigate('calendar')} className={linkBtn}>View Calendar <Icon name="arrow" size={14} /></button>}>
            {schedule.length === 0 ? <EmptyState icon="calendar" title="No appointments today" hint="Confirmed and pending appointments for today appear here." /> : (
              <ul className="divide-y divide-slate-100">
                {schedule.map(s => (
                  <li key={s.appointmentId}>
                    <button onClick={() => onOpenAppointment(s.appointmentId)} className="w-full grid grid-cols-[80px_auto_minmax(0,1fr)_auto] items-center gap-3 py-3 text-left hover:bg-slate-50 rounded-xl px-2">
                      <span className="text-sm text-slate-600">{s.time}</span>
                      <span className="w-9 h-9 rounded-full bg-brand-50 text-brand-700 font-bold text-sm flex items-center justify-center">{initials(s.patientName)}</span>
                      <span className={`font-semibold ${navy} truncate`}>{s.patientName}</span>
                      <ApptStatus status={s.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card id="up-h" title="Upcoming Appointments" right={<button onClick={() => onNavigate('appointments')} className={linkBtn}>View All <Icon name="arrow" size={14} /></button>}>
            {upcoming.length === 0 ? <EmptyState icon="clock" title="Nothing upcoming" hint="New requests and confirmed appointments appear here." /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-slate-500 bg-slate-50"><th className="py-2 px-3 font-medium rounded-l-lg">Date</th><th className="px-3 font-medium">Time</th><th className="px-3 font-medium">Patient</th><th className="px-3 font-medium rounded-r-lg">Status</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {upcoming.map(r => (
                      <tr key={r.appointment_id} onClick={() => onOpenAppointment(r.appointment_id)} className="cursor-pointer hover:bg-slate-50">
                        <td className="py-3 px-3 text-slate-700 whitespace-nowrap">{fmtDay(r.date)}</td>
                        <td className="px-3 text-slate-700 whitespace-nowrap">{r.time}</td>
                        <td className={`px-3 font-medium ${navy}`}>{r.patient_name}{r.proposal ? <span className="ml-2 text-[11px] text-amber-700">new time proposed</span> : null}</td>
                        <td className="px-3"><ApptStatus status={r.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-5 min-w-0">
          <MiniCalendar requests={requests} onPick={() => onNavigate('calendar')} />
          <Card id="tasks-h" title="Tasks for Today">
            {tasks.length === 0 ? <p className="text-sm text-slate-500 py-2">You're all caught up.</p> : (
              <ul className="space-y-1">
                {tasks.map((t, i) => (
                  <li key={i}>
                    <button onClick={() => onNavigate(t.view)} className="w-full flex items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-slate-50">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${t.info ? 'bg-slate-100 text-slate-500' : 'bg-brand-50 text-brand-600'}`}><Icon name={t.icon} size={16} /></span>
                      <span className={`text-sm ${navy} flex-1`}>{t.text}</span>
                      <Icon name="chevron" size={14} className="text-slate-400" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-slate-400 mt-2">Generated from your live appointments, reports, messages and follow-ups.</p>
          </Card>
          <Card id="act-h" title="Recent Activity">
            {!careEnabled ? <p className="text-sm text-slate-500">Available after the synchronisation update.</p>
              : !activity?.length ? <p className="text-sm text-slate-500 py-2">No recent patient activity.</p> : (
                <ul className="space-y-1">
                  {activity.slice(0, 6).map(a => (
                    <li key={a.eventId} className="flex items-start gap-3 py-1.5">
                      <span className="w-8 h-8 shrink-0 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name={eventIcon(a.type)} size={15} /></span>
                      <span className="min-w-0 flex-1 text-sm text-slate-700">{eventText(a, 'doctor')}</span>
                      <span className="text-xs text-slate-400 whitespace-nowrap">{ago(a.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
          </Card>
        </div>
      </div>
      <div className="text-right"><UpdatedStamp at={updatedAt} onRefresh={onRefresh} /></div>
    </div>
  )
}

// ---------------------------------------------------------------- Appointments list
export function AppointmentsView({ requests, onOpenAppointment }) {
  const [tab, setTab] = useState('upcoming')
  const today = localToday()
  const groups = {
    upcoming: requests.filter(r => ['pending', 'accepted'].includes(r.status) && r.date >= today).sort(byWhen),
    past: requests.filter(r => (r.status === 'accepted' && r.date < today) || r.status === 'completed').sort((a, b) => byWhen(b, a)),
    closed: requests.filter(r => ['declined', 'cancelled', 'cancelled_by_doctor'].includes(r.status)).sort((a, b) => byWhen(b, a)),
  }
  const list = groups[tab]
  return (
    <Card>
      <div className="flex gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1 mb-4 max-w-md" role="tablist">
        {[['upcoming', 'Upcoming'], ['past', 'Past & completed'], ['closed', 'Declined / cancelled']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`flex-1 rounded-lg py-1.5 text-sm font-semibold ${tab === id ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600'}`}>{label} ({groups[id].length})</button>
        ))}
      </div>
      {list.length === 0 ? <EmptyState icon="clock" title="No appointments here" /> : (
        <ul className="divide-y divide-slate-100">
          {list.map(r => (
            <li key={r.appointment_id}>
              <button onClick={() => onOpenAppointment(r.appointment_id)} className="w-full flex flex-wrap items-center gap-3 py-3 px-2 text-left hover:bg-slate-50 rounded-xl">
                <span className="w-10 h-10 rounded-full bg-brand-50 text-brand-700 font-bold text-sm flex items-center justify-center">{initials(r.patient_name)}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block font-semibold ${navy}`}>{r.patient_name}</span>
                  <span className="block text-sm text-slate-600">{fmtDay(r.date)} · {r.time}{r.proposal ? ` · proposed ${fmtDay(r.proposal.date)} ${r.proposal.time}` : ''}</span>
                </span>
                {tab === 'past' && r.status === 'accepted' && <span className="text-xs font-semibold text-amber-700">Needs completing</span>}
                <ApptStatus status={r.status} />
                <Icon name="chevron" size={16} className="text-slate-400" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- Patients
export function PatientsView({ onOpenInsights, onOpenNotes }) {
  const { data, error, loading, reload, updatedAt } = usePolled(() => getDoctorPatients(), [])
  const [q, setQ] = useState('')
  const list = (data || []).filter(p => p.name.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <Card right={<UpdatedStamp at={updatedAt} onRefresh={reload} />} title={`Patients (${data?.length ?? 0})`}>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search patients by name" aria-label="Search patients"
        className="w-full sm:w-80 mb-3 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200" />
      <ErrorNote error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : list.length === 0 ? <EmptyState icon="users" title="No patients yet" hint="Patients appear here once they request an appointment with you." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500 bg-slate-50"><th className="py-2 px-3 font-medium">Patient</th><th className="px-3 font-medium">Appointments</th><th className="px-3 font-medium">Next appointment</th><th className="px-3 font-medium">Record access</th><th className="px-3" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.map(p => (
                <tr key={p.patientId}>
                  <td className="py-3 px-3"><span className="flex items-center gap-2"><span className="w-8 h-8 rounded-full bg-brand-50 text-brand-700 font-bold text-xs flex items-center justify-center">{initials(p.name)}</span><span className={`font-semibold ${navy}`}>{p.name}</span></span></td>
                  <td className="px-3 text-slate-700">{p.appointments}</td>
                  <td className="px-3 text-slate-700">{p.nextAppointment ? `${fmtDay(p.nextAppointment.date)} · ${p.nextAppointment.time}` : '—'}</td>
                  <td className="px-3">{p.access.active
                    ? <span className="text-xs text-emerald-700 font-semibold">{p.access.categories.length} categor{p.access.categories.length === 1 ? 'y' : 'ies'} shared</span>
                    : <span className="text-xs text-slate-500">Not shared</span>}</td>
                  <td className="px-3 text-right whitespace-nowrap">
                    <button onClick={() => onOpenInsights(p.patientId)} className={`${linkBtn} mr-3`}>Insights</button>
                    <button onClick={() => onOpenNotes(p.patientId)} className={linkBtn}>Notes</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-400 mt-3">Only names are shown here. Health records are visible only where the patient has explicitly shared them with you.</p>
    </Card>
  )
}

// ---------------------------------------------------------------- Consultation notes
export function NotesView({ patientId, onClearPatient }) {
  const [kind, setKind] = useState('all')
  const query = { ...(kind !== 'all' ? { kind } : {}), ...(patientId ? { patientId } : {}) }
  const { data, error, loading, reload, updatedAt } = usePolled(() => getDoctorNotes(query), [kind, patientId])
  return (
    <Card title="Consultation Notes" right={<UpdatedStamp at={updatedAt} onRefresh={reload} />}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {[['all', 'All'], ['clinical_note', 'Consultation notes'], ['summary', 'Summaries'], ['follow_up', 'Follow-ups']].map(([k, label]) => (
          <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${kind === k ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-700 border-slate-200'}`}>{label}</button>
        ))}
        {patientId && <button onClick={onClearPatient} className="text-xs text-slate-600 underline">Show all patients</button>}
      </div>
      <ErrorNote error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : !data?.length ? <EmptyState icon="doc" title="No notes yet" hint="Open an appointment to add a note. Private notes are never shown to patients." /> : (
        <ul className="space-y-2">{data.map(n => <NoteCard key={n.noteId} n={n} showPatient onChanged={reload} />)}</ul>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- Messages
export function MessagesView() {
  const { data, error, loading, reload, updatedAt } = usePolled(() => getConversations(), [], { interval: 20000 })
  const [openId, setOpenId] = useState(null)
  const current = data?.find(c => c.appointmentId === openId) || null
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-5">
      <Card title="Conversations" right={<UpdatedStamp at={updatedAt} onRefresh={reload} />}>
        <ErrorNote error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : !data?.length ? <EmptyState icon="message" title="No conversations" hint="Each appointment has its own message thread." /> : (
          <ul className="space-y-1">
            {data.map(c => (
              <li key={c.appointmentId}>
                <button onClick={() => setOpenId(c.appointmentId)} aria-current={openId === c.appointmentId}
                  className={`w-full text-left rounded-xl px-3 py-2.5 flex items-center gap-3 ${openId === c.appointmentId ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-slate-50'}`}>
                  <span className="w-9 h-9 rounded-full bg-brand-50 text-brand-700 font-bold text-xs flex items-center justify-center">{initials(c.patient?.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block font-semibold ${navy} truncate`}>{c.patient?.name}</span>
                    <span className="block text-xs text-slate-500">{fmtDay(c.date)} · {c.messageCount} message{c.messageCount === 1 ? '' : 's'}</span>
                  </span>
                  {c.unread > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">{c.unread}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={current ? `${current.patient?.name} · ${fmtDay(current.date)} ${current.time}` : 'Messages'}>
        {current ? <MessageThread key={current.appointmentId} appointmentId={current.appointmentId} /> : <EmptyState icon="message" title="Select a conversation" />}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- Follow-up Centre
export function FollowUpsView() {
  const { data, error, loading, reload, updatedAt } = usePolled(() => getDoctorFollowUps(), [])
  const today = localToday()
  const groups = [
    ['Overdue', f => f.followUpStatus === 'open' && f.dueDate && f.dueDate < today],
    ['Due in the next 7 days', f => f.followUpStatus === 'open' && f.dueDate && f.dueDate >= today && f.dueDate <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)],
    ['Open, later or no due date', f => f.followUpStatus === 'open' && (!f.dueDate || f.dueDate > new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10))],
    ['Done', f => f.followUpStatus === 'done'],
  ]
  return (
    <Card title="Follow-up Centre" right={<UpdatedStamp at={updatedAt} onRefresh={reload} />}>
      <ErrorNote error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : !data?.length ? <EmptyState icon="clock" title="No follow-ups" hint="Add follow-up instructions from an appointment. Patients see them in their portal." /> : (
        <div className="space-y-5">
          {groups.map(([title, test]) => {
            const items = data.filter(test)
            if (!items.length) return null
            return (
              <div key={title}>
                <h3 className="text-sm font-semibold text-slate-600 mb-2">{title} ({items.length})</h3>
                <ul className="space-y-2">{items.map(n => <NoteCard key={n.noteId} n={n} showPatient onChanged={reload} />)}</ul>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- Patient Insights (consent-gated records)
const CATS = Object.keys(CATEGORY_LABELS)
function RecordsTable({ rows }) {
  if (!rows.length) return <EmptyState icon="list" title="No entries in the shared date range" />
  const cols = Object.keys(rows[0])
  const label = c => c.replace(/_/g, ' ').replace(/^./, x => x.toUpperCase())
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-500 bg-slate-50">{cols.map(c => <th key={c} className="py-2 px-3 font-medium whitespace-nowrap">{label(c)}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => <tr key={i}>{cols.map(c => <td key={c} className="py-2 px-3 text-slate-700 align-top">{r[c] === null || r[c] === undefined || r[c] === '' ? '—' : String(r[c])}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  )
}

export function InsightsView({ patientId, onPickPatient }) {
  const patients = usePolled(() => getDoctorPatients(), [])
  const [cat, setCat] = useState('symptoms')
  const current = patients.data?.find(p => p.patientId === patientId) || null
  const records = usePolled(() => (patientId ? getPatientRecords(patientId, cat) : Promise.resolve(null)), [patientId, cat], { enabled: !!patientId, interval: 300000 })   // each load is an audited record view: no fast polling
  const noConsent = records.error?.code === 'NO_CONSENT'
  return (
    <div className="space-y-5">
      <Card title="Patient Insights">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-700 flex items-center gap-2">Patient
            <select value={patientId || ''} onChange={e => onPickPatient(e.target.value ? Number(e.target.value) : null)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm min-w-[220px]">
              <option value="">Choose a patient…</option>
              {(patients.data || []).map(p => <option key={p.patientId} value={p.patientId}>{p.name}{p.access.active ? ' (records shared)' : ''}</option>)}
            </select>
          </label>
          {current && (current.access.active
            ? <span className="text-xs text-emerald-700">Shared: {current.access.categories.map(c => CATEGORY_LABELS[c]).join(', ')}{current.access.expiresAt ? ` · until ${new Date(current.access.expiresAt).toLocaleDateString()}` : ''}</span>
            : <span className="text-xs text-slate-500">This patient has not shared any records with you.</span>)}
        </div>
        <p className="text-xs text-slate-400 mt-2">Records are shown only for the categories, date range and period the patient chose. Every view is logged.</p>
      </Card>
      {patientId && (
        <Card>
          <div className="flex flex-wrap gap-1.5 mb-4" role="tablist">
            {CATS.map(c => {
              const shared = current?.access.categories.includes(c)
              return (
                <button key={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1.5 ${cat === c ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-700 border-slate-200'}`}>
                  {!shared && <Icon name="shield" size={12} />}{CATEGORY_LABELS[c]}
                </button>
              )
            })}
          </div>
          {records.loading && !records.data && !records.error ? <Loading /> : noConsent ? (
            <EmptyState icon="shield" title="No consent for this category"
              hint="The patient has not shared this category with you, or the access has expired or been revoked. An appointment alone does not give access." />
          ) : records.error ? <ErrorNote error={records.error} onRetry={records.reload} /> : records.data ? (
            <>
              <p className="text-xs text-slate-500 mb-3">Shared range: {fmtDay(records.data.rangeFrom)} – {fmtDay(records.data.rangeTo)}
                {cat === 'predictions' && ' · AI-generated predictions are not confirmed diagnoses.'}
                {cat === 'tens_sessions' && ' · TENS sessions are manually recorded by the patient (the commercial device is not connected).'}</p>
              <RecordsTable rows={records.data.rows} />
              <div className="text-right mt-3"><UpdatedStamp at={records.updatedAt} onRefresh={records.reload} /></div>
            </>
          ) : null}
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Settings
export function SettingsView({ profile, careEnabled }) {
  return (
    <Card title="Settings">
      {profile ? (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          {[['Name', profile.name], ['Specialty', profile.specialty], ['Consultation days', (profile.days || []).join(', ') || '—'], ['Fee', profile.price], ['Phone', profile.phone || '—'], ['Profile type', profile.demo ? 'Demo clinician' : 'Clinician']].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-slate-50 px-4 py-3"><dt className="text-slate-500">{k}</dt><dd className={`font-semibold ${navy}`}>{String(v)}</dd></div>
          ))}
        </dl>
      ) : <Loading />}
      <p className="text-xs text-slate-500 mt-4">Profile details are managed by the clinic administrator. Synchronisation features: {careEnabled ? 'enabled' : 'not yet enabled on this server'}. Purposes patients can choose when sharing records: {Object.values(PURPOSE_LABELS).join(', ')}.</p>
    </Card>
  )
}
