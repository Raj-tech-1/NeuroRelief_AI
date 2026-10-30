import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../../i18n/format'
import { useAuth } from '../../context/AuthContext'
import { getMyReports, getReportFeatureStatus } from '../../services/api'
import ReportAuditPlaceholder from '../../components/reportAudit/ReportAuditPlaceholder'
import ReportCreate from '../../components/reportAudit/ReportCreate'
import ReportDetail from '../../components/reportAudit/ReportDetail'
import ReportHistory from '../../components/reportAudit/ReportHistory'
import ReportStats from '../../components/reportAudit/ReportStats'
import ShareWizard from '../../components/reportAudit/ShareWizard'
import { localTitle, reportErrorKey } from '../../components/reportAudit/shared'

// Report Audit (patient). The page asks the backend whether the feature is configured:
//   enabled              -> counters, Create/Upload + Preview, Share with a doctor + consent, History
//   not configured/older -> the honest "not available yet" placeholder (nothing can be generated, saved or shared)
//   unreachable / signed out -> the same placeholder with a retry banner
// Every number, status and success message shown here comes from the backend's answer; nothing is assumed.
export default function ReportAudit({ onTabChange }) {
  const { user } = useAuth()
  const { t } = useTranslation()
  const fmt = useFormat()
  const [phase, setPhase] = useState('loading')       // loading | ready | unavailable | unreachable | session
  const [uploads, setUploads] = useState(false)       // the server has private file storage for PDF uploads
  const [view, setView] = useState({ name: 'main' })  // main | detail | share
  const [list, setList] = useState({ loading: true, error: null, items: [] })
  const [saved, setSaved] = useState(null)            // the report just saved on the main page, ready to share
  const [sent, setSent] = useState(null)              // { doctor, title, at } after a confirmed share

  const check = useCallback(() => {
    setPhase('loading')
    getReportFeatureStatus()
      .then(s => { setUploads(s?.uploads === true); setPhase(s?.enabled === true ? 'ready' : 'unavailable') })
      .catch(err => setPhase(err.code === 'network' ? 'unreachable' : err.status === 401 || err.status === 403 ? 'session' : 'unavailable'))
  }, [])
  useEffect(() => { check() }, [check])
  const unavailable = useCallback(() => { setView({ name: 'main' }); setPhase('unavailable') }, [])

  const reload = useCallback(async () => {
    setList(s => ({ ...s, loading: true, error: null }))
    try { setList({ loading: false, error: null, items: await getMyReports() }) }
    catch (err) {
      if (err.code === 'NOT_CONFIGURED') return unavailable()
      setList({ loading: false, error: reportErrorKey(err), items: [] })
    }
  }, [unavailable])
  useEffect(() => { if (phase === 'ready') reload() }, [phase, reload])

  if (phase === 'loading') return <p className="text-sm text-gray-500" role="status">{t('common.loading')}</p>
  if (phase !== 'ready') {
    return <ReportAuditPlaceholder onTabChange={onTabChange} problem={phase === 'unreachable' || phase === 'session' ? phase : null} onRetry={check} />
  }
  const findDoctor = () => onTabChange && onTabChange('doctor')
  const patientName = user?.name || ''

  if (view.name === 'share') {
    return <ShareWizard report={view.report} onUnavailable={unavailable} onFindDoctor={findDoctor}
      onBack={() => setView({ name: 'detail', id: view.report.reportId })}
      onShared={doctor => { reload(); setView({ name: 'detail', id: view.report.reportId, sentTo: doctor }) }} />
  }
  if (view.name === 'detail') {
    return (
      <div className="space-y-4">
        {view.sentTo && <div role="status" id="ra-sent" className="max-w-[900px] rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm px-4 py-3">{t('reportAudit.share.sent', { doctor: view.sentTo })}</div>}
        <ReportDetail key={`${view.id}-${list.items.length}-${view.sentTo || ''}`} id={view.id} autoPrint={!!view.print} patientName={patientName}
          onBack={() => setView({ name: 'main' })} onShare={report => setView({ name: 'share', report })} onUnavailable={unavailable} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {sent && (
        <div role="status" id="ra-sent" className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm px-4 py-3 flex flex-wrap items-center gap-2">
          <span className="flex-1 basis-64">{t('reportAudit.share.sentOn', { doctor: sent.doctor, title: sent.title, date: fmt.dateTime(sent.at) })}</span>
          <button type="button" onClick={() => setSent(null)} className="text-xs underline">{t('common.dismiss')}</button>
        </div>
      )}
      <p className="text-xs text-gray-600 bg-brand-50/70 rounded-xl px-3 py-2">{t('reportAudit.notice')}</p>
      <ReportStats items={list.items} />
      <ReportCreate uploadsEnabled={uploads} patientName={patientName} onUnavailable={unavailable}
        onSaved={r => { setSaved(r); setSent(null); reload() }} onReset={() => setSaved(null)} />
      <ShareWizard embedded report={saved} onUnavailable={unavailable} onFindDoctor={findDoctor}
        onShared={doctor => { setSent({ doctor, title: localTitle(t, fmt, saved.title), at: new Date() }); setSaved(null); reload() }} />
      <ReportHistory state={list} onReload={reload} onOpen={(id, opts) => setView({ name: 'detail', id, print: !!opts?.print })} />
    </div>
  )
}
