import { useEffect, useState } from 'react'
import { Icon } from '../icons'
import { getConversations } from '../../services/api'
import { initials } from '../doctor/helpers'
import { useCareStatus, usePolled, MessageThread, ErrorNote, Loading, fmtDay, ago } from './shared'

// Other parts of the patient portal can open the chat on a given appointment:
//   window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT, { detail: { appointmentId } }))
export const OPEN_CHAT_EVENT = 'nr:open-doctor-chat'
export const openDoctorChat = appointmentId => window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT, { detail: { appointmentId } }))


function statusLine(c) {
  if (c.status === 'pending') return 'Request pending: your doctor can reply'
  if (c.status === 'accepted') return `Appointment ${fmtDay(c.date)} · ${c.time}`
  if (c.status === 'completed') return c.canMessage ? `Follow-up chat open (consultation ${fmtDay(c.date)})` : `Completed ${fmtDay(c.date)}`
  return 'Chat closed'
}

/**
 * Patient: floating chat window to message the doctor of each of their appointments.
 * Uses the same per-appointment threads the Doctor Portal reads (/api/care), so both sides see the same messages.
 * The server decides who may message whom: only the two parties of an appointment that is pending, accepted, or
 * completed within the follow-up window. Hidden until the clinical-sync feature is enabled.
 */
export default function PatientChatWidget() {
  const care = useCareStatus()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState(null)
  const convs = usePolled(() => getConversations(), [], { enabled: care.enabled, interval: open ? 15000 : 30000 })
  const list = convs.data || []
  const unread = list.reduce((s, c) => s + (c.unread || 0), 0)
  const active = list.find(c => c.appointmentId === current) || null

  useEffect(() => {
    const onOpen = e => { setOpen(true); setCurrent(e.detail?.appointmentId ?? null); convs.reload() }
    window.addEventListener(OPEN_CHAT_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_CHAT_EVENT, onOpen)
  }, [convs.reload])

  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (care.loading || !care.enabled) return null

  return (
    <>
      {!open && (
        <button onClick={() => { setOpen(true); convs.reload() }} aria-label={`Chat with your doctor${unread ? `, ${unread} unread` : ''}`}
          className="fixed bottom-5 right-5 z-40 h-14 pl-4 pr-5 rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30 hover:bg-brand-700 flex items-center gap-2 font-semibold text-sm">
          <Icon name="message" size={20} /> <span className="hidden sm:inline">Chat with doctor</span>
          {unread > 0 && <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1.5 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center ring-2 ring-white">{unread}</span>}
        </button>
      )}
      {open && (
        <section role="dialog" aria-label="Chat with your doctor"
          className="fixed z-50 bottom-0 right-0 sm:bottom-5 sm:right-5 w-full sm:w-[400px] h-[85dvh] sm:h-[600px] max-h-[100dvh] bg-white sm:rounded-2xl shadow-2xl border border-brand-100 flex flex-col overflow-hidden">
          <header className="flex items-center gap-2 px-4 py-3 bg-brand-600 text-white">
            {active ? (
              <button onClick={() => { setCurrent(null); convs.reload() }} aria-label="Back to conversations" className="p-1 -ml-1 rounded-lg hover:bg-white/15">
                <Icon name="chevron" size={18} className="rotate-180" />
              </button>
            ) : <Icon name="message" size={18} />}
            <div className="min-w-0 flex-1">
              <p className="font-semibold truncate">{active ? active.doctor?.name : 'Your doctors'}</p>
              <p className="text-[11px] text-brand-100 truncate">{active ? `${active.doctor?.specialty || ''}${active.doctor?.specialty ? ' · ' : ''}${statusLine(active)}` : 'Messages are private to you and your doctor'}</p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close chat" className="p-1 rounded-lg hover:bg-white/15"><Icon name="close" size={18} /></button>
          </header>

          <div className="flex-1 overflow-y-auto p-3">
            {active ? (
              <MessageThread key={active.appointmentId} appointmentId={active.appointmentId} />
            ) : (
              <>
                <ErrorNote error={convs.error} onRetry={convs.reload} />
                {convs.loading && !convs.data ? <Loading text="Loading conversations…" /> : !list.length ? (
                  <div className="text-center py-10 px-4">
                    <div className="w-12 h-12 mx-auto rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="stethoscope" size={22} /></div>
                    <p className="mt-3 font-semibold text-gray-900">No doctor to chat with yet</p>
                    <p className="mt-1 text-sm text-gray-500">Book an appointment in Doctor Connect. Once you have a request or an accepted appointment, you can message that doctor here.</p>
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {list.map(c => (
                      <li key={c.appointmentId}>
                        <button onClick={() => setCurrent(c.appointmentId)}
                          className="w-full text-left rounded-xl px-3 py-2.5 flex items-center gap-3 hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-200">
                          <span className="w-10 h-10 shrink-0 rounded-full bg-brand-100 text-brand-700 font-bold text-xs flex items-center justify-center">{initials(c.doctor?.name)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-gray-900 truncate">{c.doctor?.name}</span>
                              {c.lastMessageAt && <span className="text-[10px] text-gray-400 shrink-0">{ago(c.lastMessageAt)}</span>}
                            </span>
                            <span className={`block text-xs truncate ${c.canMessage ? 'text-gray-500' : 'text-gray-400'}`}>{statusLine(c)}</span>
                          </span>
                          {c.unread > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">{c.unread}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          {!active && <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-brand-50">For emergencies, contact local emergency services. Doctors may not reply immediately.</p>}
        </section>
      )}
    </>
  )
}
