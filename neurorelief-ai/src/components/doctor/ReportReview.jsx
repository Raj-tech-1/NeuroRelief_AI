import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../../i18n/format'
import { Icon } from '../icons'
import { addDoctorReportNote, getDoctorReportFile, getDoctorReportShare, setDoctorReportStatus } from '../../services/api'
import UploadedReport from '../reportAudit/UploadedReport'
import ReportDocument from '../reportAudit/ReportDocument'
import StatusChip from '../reportAudit/StatusChip'
import { localTitle, reportErrorKey, utcStamp } from '../reportAudit/shared'

const MAX_NOTE = 4000   // same limit the backend enforces
const card = 'bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6'
const btnPrimary = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200'
const btnGhost = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200'
const btnVerify = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-200'

function Fact({ label, children }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className="text-sm text-slate-900 break-words mt-0.5">{children}</dd></div>
}

// One shared report: the patient's snapshot (read-only), the sharing/consent facts and the doctor's review actions.
export default function ReportReview({ shareId, doctorName, onBack, onUnavailable }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const dt = s => fmt.dateTime(utcStamp(s))
  const [state, setState] = useState({ loading: true, error: null, share: null })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)             // { ok: true, key } | { ok: false, key }
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(async () => {
    try { setState({ loading: false, error: null, share: await getDoctorReportShare(shareId) }) }
    catch (err) {
      if (err.code === 'NOT_CONFIGURED') return onUnavailable()
      setState({ loading: false, error: reportErrorKey(err), share: null })
    }
  }, [shareId, onUnavailable])
  useEffect(() => { load() }, [load])

  // Run one backend action, then re-read the share from the server (nothing is assumed to have changed).
  const act = async (fn, okKey) => {
    setBusy(true); setMsg(null)
    try { await fn(); setNote(''); setConfirming(false); setMsg({ ok: true, key: okKey }) }
    catch (err) { setMsg({ ok: false, key: err.code === 'NOT_CONFIGURED' ? 'reportAudit.err.NOT_CONFIGURED' : reportErrorKey(err) }); setConfirming(false) }
    finally { setBusy(false) }
    await load()
  }

  const back = <button type="button" data-back onClick={onBack} className={btnGhost}><Icon name="chevronLeft" size={16} />{t('reportVerify.back')}</button>
  if (state.loading) return <div className="space-y-4">{back}<p className="text-sm text-slate-500" role="status">{t('common.loading')}</p></div>
  if (state.error) {
    return (
      <div className="space-y-4">{back}
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="flex-1 basis-56">{t(state.error)}</span><button type="button" onClick={load} className={btnGhost}>{t('common.retry')}</button>
        </div>
      </div>
    )
  }

  const s = state.share, title = localTitle(t, fmt, s.title)
  const text = note.trim()
  const hasNotes = (s.notes || []).length > 0
  return (
    <div className="space-y-4 max-w-[960px]">
      {back}
      <section className={card} aria-labelledby="rv-head">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h2 id="rv-head" className="text-lg font-bold text-slate-900 break-words">{title}</h2>
          <StatusChip status={s.status} />
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          <Fact label={t('reportVerify.detailPatient')}>{s.patientName}</Fact>
          <Fact label={t('reportVerify.detailAppointment')}>{s.appointment ? t('header.dateAtTime', { date: fmt.isoDate(s.appointment.date), time: fmt.time(s.appointment.time) }) : t('reportVerify.noAppointment')}</Fact>
          <Fact label={t('reportVerify.detailSubmitted')}>{dt(s.submittedAt)}</Fact>
          <Fact label={t('reportVerify.detailUpdated')}>{dt(s.updatedAt)}</Fact>
          {s.verifiedAt && <Fact label={t('reportVerify.detailVerified')}>{dt(s.verifiedAt)}</Fact>}
        </dl>
        {s.previousShareId && <p className="text-sm text-brand-700 mt-3">{t('reportVerify.revisionNote')}</p>}
      </section>

      {s.limited ? (
        <div role="alert" data-limited className="rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 text-sm px-4 py-3">
          {t(s.limitedReason === 'revoked' ? 'reportVerify.limitedRevokedLong' : 'reportVerify.limitedApptLong')}
        </div>
      ) : (
        <>
          <section className={card} aria-labelledby="rv-consent">
            <h2 id="rv-consent" className="font-bold text-slate-900 mb-1">{t('reportVerify.sharingTitle')}</h2>
            <p className="text-sm text-slate-700">{t('reportVerify.consentLine', { version: s.consent?.version, date: s.consent ? dt(s.consent.at) : '' })}</p>
            <p className="text-sm text-slate-600 mt-1">{t('reportVerify.accessNote')}</p>
            <p className="text-sm text-slate-600 mt-1">{t('reportVerify.sharedNote')}</p>
          </section>

          <section className={card} aria-labelledby="rv-review">
            <h2 id="rv-review" className="font-bold text-slate-900 mb-3">{t('reportVerify.reviewTitle')}</h2>
            <div aria-live="polite">
              {msg && <p role={msg.ok ? 'status' : 'alert'} data-msg={msg.ok ? 'ok' : 'err'} className={`mb-3 text-sm rounded-xl px-3.5 py-2.5 border ${msg.ok ? 'bg-teal-50 border-teal-200 text-teal-900' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>{t(msg.key)}</p>}
            </div>

            <h3 className="text-sm font-semibold text-slate-800">{t('reportVerify.notesTitle')}</h3>
            {hasNotes ? (
              <ul className="mt-2 space-y-2" data-notes>
                {s.notes.map(n => (
                  <li key={n.versionNo} className="rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5">
                    <p className="text-xs text-slate-500">{t('reportVerify.noteMeta', { date: dt(n.createdAt) })}</p>
                    <p className="text-sm text-slate-900 whitespace-pre-wrap break-words">{n.text}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500 mt-1">{t('reportVerify.noNotes')}</p>}

            {s.status === 'submitted' && (
              <div className="mt-4">
                <p className="text-sm text-slate-600 mb-2">{t('reportVerify.startHint')}</p>
                <button type="button" id="rv-start" disabled={busy} onClick={() => act(() => setDoctorReportStatus(shareId, { status: 'under_review' }), 'reportVerify.noticeStarted')} className={btnPrimary}>
                  <Icon name="clock" size={16} />{busy ? t('reportVerify.working') : t('reportVerify.startBtn')}
                </button>
              </div>
            )}

            {s.status === 'under_review' && (
              <div className="mt-4">
                <label htmlFor="rv-note" className="text-sm font-semibold text-slate-800">{t('reportVerify.noteLabel')}</label>
                <textarea id="rv-note" value={note} onChange={e => setNote(e.target.value)} maxLength={MAX_NOTE} rows={4} disabled={busy} placeholder={t('reportVerify.notePlaceholder')}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200" />
                <p className="text-xs text-slate-500 mt-1">{t('reportVerify.charCount', { n: fmt.number(note.length), max: fmt.number(MAX_NOTE) })}</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button type="button" id="rv-save" disabled={busy || !text} onClick={() => act(() => addDoctorReportNote(shareId, text), 'reportVerify.noticeNote')} className={btnGhost}>{t('reportVerify.saveNote')}</button>
                  <button type="button" id="rv-changes" disabled={busy || !text} onClick={() => act(() => setDoctorReportStatus(shareId, { status: 'changes_requested', note: text }), 'reportVerify.noticeChanges')} className={btnGhost}>{t('reportVerify.requestChanges')}</button>
                  <button type="button" id="rv-verify" disabled={busy || (!text && !hasNotes)} onClick={() => setConfirming(true)} className={btnVerify}><Icon name="check" size={16} />{t('reportVerify.verifyBtn')}</button>
                </div>
                {!text && <p className="text-xs text-slate-500 mt-2">{hasNotes ? t('reportVerify.requestNeedsNote') : t('reportVerify.verifyNeedsNote')}</p>}
                {confirming && (
                  <div role="alertdialog" aria-label={t('reportVerify.confirmTitle')} className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm">
                    <p className="font-semibold text-emerald-900">{t('reportVerify.confirmTitle')}</p>
                    <p className="text-emerald-900 mt-1">{t('reportVerify.confirmText')}</p>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button type="button" id="rv-confirm" disabled={busy} onClick={() => act(() => setDoctorReportStatus(shareId, { status: 'verified', confirm: true, ...(text ? { note: text } : {}) }), 'reportVerify.noticeVerified')} className={btnVerify}>{busy ? t('reportVerify.working') : t('reportVerify.confirmYes')}</button>
                      <button type="button" id="rv-confirm-no" disabled={busy} onClick={() => setConfirming(false)} className={btnGhost}>{t('common.cancel')}</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {s.status === 'verified' && <p className="mt-4 text-sm text-emerald-800 font-medium" data-final>{t('reportVerify.finalVerified', { date: dt(s.verifiedAt) })}</p>}
            {s.status === 'changes_requested' && <p className="mt-4 text-sm text-slate-700" data-final>{t('reportVerify.finalChanges')}</p>}
            <p className="mt-4 text-xs text-slate-500">{t('reportVerify.attachmentsNote')}</p>
          </section>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 text-sm px-4 py-3" role="note">{t('reportVerify.disclaimer')}</div>
          <div className={card}>
            {s.kind === 'uploaded_pdf'
              ? <UploadedReport snapshot={s.snapshot} loadFile={() => getDoctorReportFile(shareId)} />
              : <ReportDocument snapshot={s.snapshot} title={title} meta={{ shared: true, verified: s.status === 'verified' ? { doctor: doctorName, date: dt(s.verifiedAt) } : null }} />}
          </div>
        </>
      )}
    </div>
  )
}
