import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../../i18n/format'
import { Icon } from '../icons'
import { getReportFeatureStatus, getDoctorReportInbox } from '../../services/api'
import StatusChip from '../reportAudit/StatusChip'
import { localTitle, reportErrorKey, utcStamp } from '../reportAudit/shared'
import ReportReview from './ReportReview'

const FILTERS = ['all', 'submitted', 'under_review', 'changes_requested', 'verified', 'revoked']
const btnPrimary = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200'

// Doctor "Report Verification": the inbox of reports patients shared with this doctor, and the review screen.
// Every rule (who may see what, status changes, notes) is enforced by the backend; this only renders and calls it.
export default function ReportVerification({ doctorName, onSummary }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const dt = s => fmt.dateTime(utcStamp(s))
  const [phase, setPhase] = useState('loading')   // loading | ready | unavailable | error
  const [error, setError] = useState(null)
  const [items, setItems] = useState([])
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState(null)

  const load = useCallback(async () => {
    setPhase(p => (p === 'ready' ? p : 'loading'))
    try {
      const status = await getReportFeatureStatus()
      if (status?.enabled !== true) { setPhase('unavailable'); return }
      const list = await getDoctorReportInbox()
      setItems(list)
      onSummary?.(list.filter(r => !r.limited && (r.status === 'submitted' || r.status === 'under_review')).length)
      setError(null)
      setPhase('ready')
    } catch (err) {
      // an older server answers 404 (no such route) or 503 NOT_CONFIGURED: the feature is simply not there
      if (err.code === 'NOT_CONFIGURED' || (err.status === 404 && !err.code)) { setPhase('unavailable'); return }
      setError(reportErrorKey(err))
      setPhase('error')
    }
  }, [onSummary])
  useEffect(() => { load() }, [load])

  const counts = useMemo(() => Object.fromEntries(FILTERS.map(f => [f, f === 'all' ? items.length : items.filter(r => r.status === f).length])), [items])
  const needle = q.trim().toLowerCase()
  const shown = items.filter(r => (filter === 'all' || r.status === filter) && (!needle || r.patientName.toLowerCase().includes(needle)))

  if (phase === 'loading') return <p className="flex items-center justify-center gap-3 py-16 text-teal-700 text-sm" role="status"><span className="w-5 h-5 rounded-full border-2 border-teal-200 border-t-teal-600 animate-spin" aria-hidden="true" />{t('common.loading')}</p>
  if (phase === 'unavailable') {
    return (
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 max-w-2xl" aria-labelledby="rv-na">
        <span className="mb-3 w-12 h-12 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="doc" size={24} /></span>
        <h2 id="rv-na" className="text-lg font-bold text-slate-900">{t('reportVerify.unavailableTitle')}</h2>
        <p className="text-sm text-slate-600 mt-2">{t('reportVerify.unavailableText')}</p>
      </section>
    )
  }
  if (phase === 'error') {
    return (
      <div role="alert" className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center">
        <p className="text-rose-800 font-semibold">{t(error)}</p>
        <button type="button" onClick={load} className="mt-3 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-200">{t('common.tryAgain')}</button>
      </div>
    )
  }

  if (openId !== null) {
    return <ReportReview shareId={openId} doctorName={doctorName} onBack={() => { setOpenId(null); load() }} onUnavailable={() => setPhase('unavailable')} />
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 max-w-3xl">{t('reportVerify.intro')}</p>

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label={t('reportVerify.filterLabel')} className="flex flex-wrap gap-2">
          {FILTERS.filter(f => f !== 'revoked' || counts.revoked > 0).map(f => (
            <button key={f} type="button" data-filter={f} aria-pressed={filter === f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200 ${filter === f ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>
              {f === 'all' ? t('reportVerify.filterAll') : t(`reportAudit.status.${f}`)} <span className={filter === f ? 'text-white/90' : 'text-slate-500'}>({fmt.number(counts[f])})</span>
            </button>
          ))}
        </div>
        <label className="ml-auto flex-1 basis-56 max-w-xs">
          <span className="sr-only">{t('reportVerify.searchLabel')}</span>
          <input type="search" value={q} onChange={e => setQ(e.target.value)} maxLength={80} placeholder={t('reportVerify.searchPlaceholder')}
            className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200" />
        </label>
      </div>

      {items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm text-center py-12 px-4">
          <p className="font-semibold text-slate-800">{t('reportVerify.emptyTitle')}</p>
          <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{t('reportVerify.emptyText')}</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm text-center py-10 px-4">
          <p className="font-semibold text-slate-800">{t('reportVerify.noMatchTitle')}</p>
          <p className="text-sm text-slate-500 mt-1">{t('reportVerify.noMatchText')}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {shown.map(r => (
            <li key={r.shareId} data-share={r.shareId} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col gap-3 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('reportVerify.patient')}</p>
                  <p className="font-bold text-slate-900 break-words">{r.patientName}</p>
                </div>
                <StatusChip status={r.status} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 break-words">{localTitle(t, fmt, r.title)}</p>
                <p className="text-xs text-slate-500 mt-1">{t('reportVerify.submitted', { date: dt(r.submittedAt) })}</p>
                <p className="text-xs text-slate-500">{r.appointment ? t('reportVerify.appointment', { date: fmt.isoDate(r.appointment.date), time: fmt.time(r.appointment.time) }) : t('reportVerify.noAppointment')}</p>
                {r.previousShareId && <p className="text-xs text-brand-700 mt-1">{t('reportVerify.revisionTag')}</p>}
                {r.limited && <p className="text-xs text-amber-800 mt-1">{t(r.limitedReason === 'revoked' ? 'reportVerify.limitedRevoked' : 'reportVerify.limitedAppt')}</p>}
              </div>
              <div className="mt-auto"><button type="button" data-open={r.shareId} onClick={() => setOpenId(r.shareId)} className={btnPrimary}><Icon name="doc" size={16} />{t('reportVerify.openBtn')}</button></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
