import { useTranslation } from 'react-i18next'
import { useFormat } from '../../i18n/format'
import { Icon } from '../icons'
import { initials } from './helpers'

// Status is conveyed by text + icon + colour (never colour alone). Values are the canonical backend statuses.
const STATUS = {
  pending: { icon: 'clock', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  accepted: { icon: 'check', cls: 'bg-teal-50 text-teal-800 border-teal-200' },
  declined: { icon: 'close', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  cancelled: { icon: 'ban', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
}

export function StatusChip({ status }) {
  const { t } = useTranslation()
  const s = STATUS[status] || STATUS.pending
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${s.cls}`}>
      <Icon name={s.icon} size={13} />
      <span>{t(status === 'cancelled' ? 'apptStatus.cancelledByPatient' : `apptStatus.${status}`, { defaultValue: status })}</span>
    </span>
  )
}

export const TABLE_COLS = 'md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.8fr)_minmax(8rem,1.1fr)_minmax(0,15rem)]'

// variant 'table': one aligned row of a wide queue (collapses to a card below md)
// variant 'card':  stacked card for narrow panels
export default function RequestRow({ r, busyId, highlighted, onDecide, variant = 'card' }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const busy = busyId === r.appointment_id
  const day = fmt.isoDate(r.date)
  const time = fmt.time(r.time)
  const table = variant === 'table'

  const actions = r.status === 'pending' ? (
    <div className="flex flex-wrap items-center gap-2 md:justify-end">
      <button onClick={() => onDecide(r.appointment_id, 'accepted')} disabled={busy}
        className="px-3.5 py-1.5 bg-teal-600 text-white text-sm rounded-lg font-semibold hover:bg-teal-700 disabled:opacity-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-200">
        {busy ? t('dd.saving') : t('dd.accept')}
      </button>
      <button onClick={() => onDecide(r.appointment_id, 'declined')} disabled={busy}
        className="px-3.5 py-1.5 border border-rose-300 text-rose-700 bg-white text-sm rounded-lg font-semibold hover:bg-rose-50 disabled:opacity-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-rose-100">
        {t('dd.decline')}
      </button>
    </div>
  ) : null

  return (
    <li id={`req-${r.appointment_id}`}
      className={`rounded-xl border p-3.5 transition ${table ? `md:grid ${TABLE_COLS} md:items-center md:gap-4` : ''} flex flex-wrap items-center gap-x-3 gap-y-2 ${
        highlighted ? 'border-teal-400 ring-4 ring-teal-200/70 bg-teal-50/60' : 'border-slate-200 bg-white hover:border-slate-300'
      }`}>
      <div className={`flex items-center gap-3 min-w-0 ${table ? '' : 'flex-1 basis-48'}`}>
        <span aria-hidden="true" className="shrink-0 w-10 h-10 rounded-full bg-brand-50 text-brand-700 font-bold text-sm flex items-center justify-center">{initials(r.patient_name)}</span>
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-semibold text-slate-900 break-words">
            {!!r.unread && <span className="shrink-0 w-2 h-2 rounded-full bg-brand-500" title={t('dd.newRequest')} aria-label={t('dd.newRequest')} />}
            <span className="min-w-0 break-words">{r.patient_name}</span>
          </p>
          {!table && <p className="text-sm text-slate-600">{t('header.dateAtTime', { date: day, time })}</p>}
        </div>
      </div>
      {table && (
        <p className="text-sm text-slate-700 min-w-0">
          <span className="font-medium">{day}</span><span className="text-slate-500"> · {time}</span>
        </p>
      )}
      <div><StatusChip status={r.status} /></div>
      {actions ? <div className={table ? '' : 'w-full'}>{actions}</div> : (table ? <div /> : null)}
    </li>
  )
}
