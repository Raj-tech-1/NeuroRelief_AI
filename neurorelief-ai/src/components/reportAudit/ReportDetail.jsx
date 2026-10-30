import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../../i18n/format'
import { Icon } from '../icons'
import { getMyReport, getMyReportFile, getReportActivity, getReportShare, revokeReportShare } from '../../services/api'
import UploadedReport from './UploadedReport'
import ReportDocument from './ReportDocument'
import ReportSummary from './ReportSummary'
import StatusChip from './StatusChip'
import { PrintArea, printReport } from './PrintArea'
import { localTitle, reportErrorKey, utcStamp } from './shared'

const card = 'bg-white/90 rounded-2xl border border-brand-100/70 shadow-sm shadow-brand-100/50'
const btnGhost = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-brand-200 bg-white text-brand-700 text-sm font-semibold hover:bg-brand-50 disabled:opacity-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200'
const btnDanger = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 bg-white text-rose-700 text-xs font-semibold hover:bg-rose-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-rose-200'
const btnDangerSolid = 'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-60 focus:outline-none focus-visible:ring-4 focus-visible:ring-rose-200'
const btnPrimary = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 text-white text-sm font-semibold hover:opacity-95 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200'
const btnSmall = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-200 bg-white text-brand-700 text-xs font-semibold hover:bg-brand-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200'

// One recipient doctor's share of this report: status, dates and (on request) the doctor's returned feedback.
function ShareRow({ share, onChanged, onUnavailable }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const dt = s => fmt.dateTime(utcStamp(s))
  const [open, setOpen] = useState(false)
  const [state, setState] = useState({ loading: false, error: null, notes: null })
  const [revoke, setRevoke] = useState({ confirming: false, busy: false, error: null })
  const doRevoke = async () => {
    setRevoke({ confirming: true, busy: true, error: null })
    try { await revokeReportShare(share.shareId); onChanged() }   // the list is reloaded from the server; nothing is assumed
    catch (err) {
      if (err.code === 'NOT_CONFIGURED') return onUnavailable()
      setRevoke({ confirming: true, busy: false, error: reportErrorKey(err) })
    }
  }
  const toggle = async () => {
    if (open) return setOpen(false)
    setOpen(true)
    if (state.notes) return
    setState({ loading: true, error: null, notes: null })
    try { const s = await getReportShare(share.shareId); setState({ loading: false, error: null, notes: s.notes || [] }) }
    catch (err) { setState({ loading: false, error: reportErrorKey(err), notes: null }) }
  }
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{share.doctorName}</p>
          <p className="text-xs text-gray-500">
            {t('reportAudit.detail.sentOn', { date: dt(share.submittedAt) })}
            {share.verifiedAt && ` · ${t('reportAudit.detail.verifiedOn', { date: dt(share.verifiedAt) })}`}
            {share.revokedAt && ` · ${t('reportAudit.detail.revokedOn', { date: dt(share.revokedAt) })}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusChip status={share.status} />
          <button type="button" onClick={toggle} aria-expanded={open} className={btnSmall}>{open ? t('reportAudit.detail.hideFeedback') : t('reportAudit.detail.viewFeedback')}</button>
        </div>
      </div>
      {share.status === 'revoked' && <p className="text-xs text-gray-500 mt-2">{t('reportAudit.detail.revokedNote')}</p>}
      {share.status !== 'revoked' && !revoke.confirming && (
        <div className="mt-2"><button type="button" data-revoke={share.shareId} onClick={() => setRevoke({ confirming: true, busy: false, error: null })} className={btnDanger}><Icon name="ban" size={14} />{t('reportAudit.detail.revokeBtn')}</button></div>
      )}
      {share.status !== 'revoked' && revoke.confirming && (
        <div role="alertdialog" aria-label={t('reportAudit.detail.revokeConfirmTitle')} className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm">
          <p className="font-semibold text-rose-900">{t('reportAudit.detail.revokeConfirmTitle', { doctor: share.doctorName })}</p>
          <p className="text-rose-800 mt-1">{t('reportAudit.detail.revokeConfirmText')}</p>
          {revoke.error && <p role="alert" className="text-rose-800 font-medium mt-2">{t(revoke.error)}</p>}
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" data-revoke-yes disabled={revoke.busy} onClick={doRevoke} className={btnDangerSolid}>{revoke.busy ? t('reportAudit.detail.revoking') : t('reportAudit.detail.revokeYes')}</button>
            <button type="button" data-revoke-no disabled={revoke.busy} onClick={() => setRevoke({ confirming: false, busy: false, error: null })} className={btnSmall}>{t('common.cancel')}</button>
          </div>
        </div>
      )}
      {open && (
        <div className="mt-3 rounded-xl bg-brand-50/60 px-3.5 py-3 text-sm">
          {state.loading && <p className="text-gray-500">{t('common.loading')}</p>}
          {state.error && <p role="alert" className="text-rose-700">{t(state.error)}</p>}
          {state.notes && state.notes.length === 0 && <p className="text-gray-600">{t('reportAudit.detail.noFeedback')}</p>}
          {state.notes && state.notes.length > 0 && (
            <ul className="space-y-3">
              {state.notes.map(n => (
                <li key={n.versionNo}>
                  <p className="text-xs text-gray-500">{t('reportAudit.detail.feedbackFrom', { doctor: share.doctorName, date: dt(n.createdAt) })}</p>
                  <p className="text-gray-800 whitespace-pre-wrap break-words">{n.text}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

export default function ReportDetail({ id, onBack, onShare, onUnavailable, autoPrint = false, patientName }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const dt = s => fmt.dateTime(utcStamp(s))
  const [state, setState] = useState({ loading: true, error: null, report: null })
  const [activity, setActivity] = useState(null)   // null = hidden, { loading, error, items }
  const load = useCallback(async () => {
    setState({ loading: true, error: null, report: null })
    try { setState({ loading: false, error: null, report: await getMyReport(id) }) }
    catch (err) {
      if (err.code === 'NOT_CONFIGURED') return onUnavailable()
      setState({ loading: false, error: reportErrorKey(err), report: null })
    }
  }, [id, onUnavailable])
  useEffect(() => { load() }, [load])
  // "Download" from the history opens a generated report straight into the print / Save-as-PDF dialog
  useEffect(() => {
    if (!autoPrint || !state.report || state.report.kind === 'uploaded_pdf') return
    const timer = setTimeout(() => printReport(localTitle(t, fmt, state.report.title)), 400)
    return () => clearTimeout(timer)
  }, [autoPrint, state.report]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleActivity = async () => {
    if (activity) return setActivity(null)
    setActivity({ loading: true, error: null, items: [] })
    try { setActivity({ loading: false, error: null, items: await getReportActivity(id) }) }
    catch (err) { setActivity({ loading: false, error: reportErrorKey(err), items: [] }) }
  }

  const back = <button type="button" onClick={onBack} className={btnGhost}><Icon name="chevronLeft" size={16} />{t('reportAudit.backToList')}</button>
  if (state.loading) return <div className="space-y-4 max-w-[900px]">{back}<p className="text-sm text-gray-500" role="status">{t('common.loading')}</p></div>
  if (state.error) return (
    <div className="space-y-4 max-w-[900px]">{back}
      <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="flex-1 basis-56">{t(state.error)}</span><button type="button" onClick={load} className={btnGhost}>{t('common.retry')}</button>
      </div>
    </div>
  )
  const r = state.report, title = localTitle(t, fmt, r.title)
  const v = r.shares.find(s => s.status === 'verified')   // shares are newest first
  const uploaded = r.kind === 'uploaded_pdf'
  const docMeta = { reportId: r.reportId, patientName, verified: v ? { doctor: v.doctorName, date: dt(v.verifiedAt) } : null }
  return (
    <div className="space-y-5 max-w-[900px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {back}
        {!uploaded && <button type="button" id="ra-print" onClick={() => printReport(title)} className={btnGhost}><Icon name="download" size={16} />{t('reportAudit.printBtn')}</button>}
      </div>

      <section className={`${card} p-5 sm:p-6`} aria-labelledby="ra-share-h">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h2 id="ra-share-h" className="font-display text-lg font-bold text-gray-900">{t('reportAudit.detail.sharingTitle')}</h2>
          <StatusChip status={r.status} />
        </div>
        <p className="text-xs text-gray-500 mb-2">{t('reportAudit.detail.createdOn', { date: dt(r.createdAt) })}</p>
        {r.shares.length === 0
          ? <p className="text-sm text-gray-600">{t('reportAudit.detail.notShared')}</p>
          : <ul className="divide-y divide-brand-100/70">{r.shares.map(s => <ShareRow key={s.shareId} share={s} onChanged={load} onUnavailable={onUnavailable} />)}</ul>}
        <div className="mt-3"><button type="button" id="ra-share" onClick={() => onShare(r)} className={btnPrimary}><Icon name="send" size={16} />{t('reportAudit.share.shareBtn')}</button></div>
      </section>

      {uploaded ? (
        <div className={`${card} p-4 sm:p-6 space-y-2`}>
          <h2 className="font-display text-lg font-bold text-gray-900 break-words">{title}</h2>
          <UploadedReport snapshot={r.snapshot} loadFile={() => getMyReportFile(r.reportId)} />
        </div>
      ) : (
        <>
          <div className={`${card} p-4 sm:p-6 space-y-4`}>
            <ReportSummary snapshot={r.snapshot} title={title} patientName={patientName} stateLabel={t(`reportAudit.status.${r.status}`)} />
            <ReportDocument snapshot={r.snapshot} title={title} meta={docMeta} />
          </div>
          <PrintArea><ReportDocument snapshot={r.snapshot} title={title} meta={docMeta} /></PrintArea>
        </>
      )}

      <section className={`${card} p-5 sm:p-6`} aria-labelledby="ra-act-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="ra-act-h" className="font-display text-lg font-bold text-gray-900">{t('reportAudit.detail.activityTitle')}</h2>
          <button type="button" onClick={toggleActivity} aria-expanded={!!activity} className={btnSmall}><Icon name="history" size={14} />{activity ? t('reportAudit.detail.hideActivity') : t('reportAudit.detail.showActivity')}</button>
        </div>
        {activity && (
          <div className="mt-3 text-sm">
            {activity.loading && <p className="text-gray-500">{t('common.loading')}</p>}
            {activity.error && <p role="alert" className="text-rose-700">{t(activity.error)}</p>}
            {!activity.loading && !activity.error && (
              <ul className="divide-y divide-brand-100/70">
                {activity.items.map((a, i) => (
                  <li key={i} className="py-2 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-gray-800"><span className="text-xs text-gray-500 mr-1.5">{t(`reportAudit.activity.by.${a.actorRole}`, { defaultValue: '' })}</span>{t(`reportAudit.activity.${a.eventType}`, { defaultValue: a.eventType })}{a.outcome !== 'ok' && ` (${t(`reportAudit.activity.outcome.${a.outcome}`, { defaultValue: a.outcome })})`}</span>
                    <span className="text-xs text-gray-500">{dt(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
