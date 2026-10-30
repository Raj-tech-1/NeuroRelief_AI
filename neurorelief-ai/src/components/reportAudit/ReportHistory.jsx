import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../../i18n/format'
import { Icon } from '../icons'
import { getMyReportFile } from '../../services/api'
import StatusChip from './StatusChip'
import { localTitle, reportErrorKey, STATUS_ORDER, utcStamp } from './shared'

const card = 'bg-white/90 rounded-2xl border border-brand-100/70 shadow-sm shadow-brand-100/50'
const btnSmall = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-200 bg-white text-brand-700 text-xs font-semibold hover:bg-brand-50 disabled:opacity-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200'

// Report history with status filters. Everything shown is the backend's list; "Download" is a real PDF download for an
// uploaded report, and opens the print / Save-as-PDF view for a generated one.
export default function ReportHistory({ state, onReload, onOpen }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(null)
  const [dlError, setDlError] = useState(null)
  const { loading, error, items } = state
  const shown = filter === 'all' ? items : items.filter(r => r.status === filter)

  const download = async r => {
    if (r.kind !== 'uploaded_pdf') return onOpen(r.reportId, { print: true })
    setBusy(r.reportId); setDlError(null)
    try {
      const blob = await getMyReportFile(r.reportId)
      const href = URL.createObjectURL(blob), a = document.createElement('a')
      a.href = href; a.download = `${localTitle(t, fmt, r.title)}.pdf`.replace(/[\\/:*?"<>|]/g, '-'); document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 2000)
    } catch (err) { setDlError(reportErrorKey(err)) } finally { setBusy(null) }
  }

  return (
    <section className={`${card} p-5 sm:p-6`} aria-labelledby="ra-hist-h">
      <h2 id="ra-hist-h" className="font-display text-lg font-bold text-gray-900 mb-3">{t('reportAudit.historyTitle')}</h2>
      <div role="group" aria-label={t('reportAudit.history.filterLabel')} className="flex flex-wrap gap-2 mb-3">
        {['all', ...STATUS_ORDER].map(f => (
          <button key={f} type="button" data-hfilter={f} aria-pressed={filter === f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200 ${filter === f ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-700 border-brand-100 hover:bg-brand-50'}`}>
            {f === 'all' ? t('reportAudit.history.filterAll') : t(`reportAudit.status.${f}`)}
            <span className={filter === f ? ' text-white/90' : ' text-gray-500'}> ({fmt.number(f === 'all' ? items.length : items.filter(r => r.status === f).length)})</span>
          </button>
        ))}
      </div>
      {loading && <p className="text-sm text-gray-500" role="status">{t('common.loading')}</p>}
      {error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="flex-1 basis-56">{t(error)}</span>
          <button type="button" onClick={onReload} className="px-3 py-1.5 rounded-lg border border-rose-300 bg-white text-rose-800 text-xs font-semibold hover:bg-rose-100">{t('common.retry')}</button>
        </div>
      )}
      {dlError && <p role="alert" className="text-sm text-rose-700 mb-2">{t(dlError)}</p>}
      {!loading && !error && items.length === 0 && (
        <div className="text-center py-6">
          <p className="text-sm font-semibold text-gray-800">{t('reportAudit.historyEmpty')}</p>
          <p className="text-xs text-gray-500 mt-1">{t('reportAudit.historyEmptyHint')}</p>
        </div>
      )}
      {!loading && !error && items.length > 0 && shown.length === 0 && <p className="text-sm text-gray-600 py-3">{t('reportAudit.history.noMatch')}</p>}
      {shown.length > 0 && (
        <ul className="divide-y divide-brand-100/70" data-history>
          {shown.map(r => {
            const active = r.shares.filter(s => s.status !== 'revoked')
            const last = r.shares[0]
            return (
              <li key={r.reportId} data-report={r.reportId} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-sm font-semibold text-gray-900 break-words">{localTitle(t, fmt, r.title)}</p>
                  <p className="text-xs text-gray-500">
                    {t(r.kind === 'uploaded_pdf' ? 'reportAudit.kind.uploaded' : 'reportAudit.kind.generated')}
                    {' · '}{t('reportAudit.detail.createdOn', { date: fmt.dateTime(utcStamp(r.createdAt)) })}
                  </p>
                  <p className="text-xs text-gray-500">
                    {active.length ? t('reportAudit.sharedWith', { doctor: active.map(s => s.doctorName).join(', ') })
                      : last ? t('reportAudit.history.wasSharedWith', { doctor: last.doctorName }) : t('reportAudit.detail.notShared')}
                  </p>
                </div>
                <StatusChip status={r.status} />
                <div className="flex gap-2">
                  <button type="button" data-view={r.reportId} onClick={() => onOpen(r.reportId)} className={btnSmall}><Icon name="eye" size={14} />{t('reportAudit.history.view')}</button>
                  <button type="button" data-download={r.reportId} disabled={busy === r.reportId} onClick={() => download(r)} className={btnSmall}><Icon name="download" size={14} />{t('reportAudit.history.download')}</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
