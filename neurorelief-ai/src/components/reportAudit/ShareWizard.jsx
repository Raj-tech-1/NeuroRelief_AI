import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../../i18n/format'
import { Icon } from '../icons'
import { getEligibleDoctors, getReportConsent, shareReport } from '../../services/api'
import { fileSizeText, localTitle, reportErrorKey, SECTION_KEYS } from './shared'

const card = 'bg-white/90 rounded-2xl border border-brand-100/70 shadow-sm shadow-brand-100/50'
const btnPrimary = 'inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 text-white text-sm font-semibold hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200'
const btnGhost = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-brand-200 bg-white text-brand-700 text-sm font-semibold hover:bg-brand-50 disabled:opacity-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200'

// Steps 3 and 4: share a SAVED report with one doctor the patient has a confirmed (accepted) appointment with, after
// explicit consent. Used inline on the Report Audit page (embedded) and as a full page from a report's detail view.
// The backend lists only accepted appointments and re-checks ownership, appointment, doctor and consent version on send;
// success is shown only after it answers 201 and every failure is shown as a failure.
export default function ShareWizard({ report, embedded = false, onBack, onShared, onFindDoctor, onUnavailable }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const [load, setLoad] = useState({ loading: !!report, error: null, doctors: [], consent: null })
  const [doctor, setDoctor] = useState(null)
  const [agreed, setAgreed] = useState(false)
  const [showConsent, setShowConsent] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)   // { key, code }
  const [attempt, setAttempt] = useState(0)
  const reportId = report?.reportId

  useEffect(() => {
    setDoctor(null); setAgreed(false); setError(null); setBusy(false)
    if (!reportId) { setLoad({ loading: false, error: null, doctors: [], consent: null }); return }
    let live = true
    setLoad(s => ({ ...s, loading: true, error: null }))
    Promise.all([getEligibleDoctors(), getReportConsent()])
      .then(([doctors, consent]) => live && setLoad({ loading: false, error: null, doctors, consent }))
      .catch(err => {
        if (!live) return
        if (err.code === 'NOT_CONFIGURED') return onUnavailable()
        setLoad({ loading: false, error: reportErrorKey(err), doctors: [], consent: null })
      })
    return () => { live = false }
  }, [reportId, attempt, onUnavailable])

  const title = report ? localTitle(t, fmt, report.title) : ''
  const sharedWith = new Set((report?.shares || []).filter(s => s.status !== 'revoked').map(s => s.doctorId))
  const counts = SECTION_KEYS.filter(k => report?.snapshot?.sections?.[k]).map(k => [k, report.snapshot.sections[k].count])
  const uploaded = report?.kind === 'uploaded_pdf'
  const fileInfo = uploaded ? (report.file || report.snapshot?.file) : null
  const tSpec = sp => t(`specialty.${sp}`, { defaultValue: sp })

  const send = async () => {
    if (!agreed || busy || !doctor || !load.consent) return
    setBusy(true); setError(null)
    try {
      await shareReport(report.reportId, {
        doctorId: doctor.doctorId, appointmentId: doctor.appointment.id,
        consentVersion: load.consent.version, consentAccepted: true,
      })
      setBusy(false)   // the embedded panel stays mounted for the next report
      onShared(doctor.name)
    } catch (err) {
      if (err.code === 'NOT_CONFIGURED') return onUnavailable()
      setError({ key: reportErrorKey(err), code: err.code })
      setBusy(false)
    }
  }

  const head = !embedded && (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-display text-lg font-bold text-gray-900">{t('reportAudit.share.title')}</h2>
      <button type="button" id="ra-share-back" onClick={onBack} className={btnGhost}><Icon name="chevronLeft" size={16} />{t('reportAudit.share.cancel')}</button>
    </div>
  )
  const retry = <button type="button" onClick={() => setAttempt(a => a + 1)} className={btnGhost}>{t('common.retry')}</button>

  return (
    <div className={embedded ? 'space-y-5' : 'space-y-5 max-w-[900px]'} data-share-panel>
      {head}
      <section className={`${card} p-5 sm:p-6`} aria-labelledby="ra-s3">
        <div className="flex items-start gap-3 mb-3">
          <span className="shrink-0 w-11 h-11 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="users" size={22} /></span>
          <div className="min-w-0">
            <h2 id="ra-s3" className="font-display text-lg font-bold text-gray-900 leading-tight">{t('reportAudit.step3Title')}</h2>
            <p className="text-xs text-gray-600 mt-0.5">{t('reportAudit.step3Sub')}</p>
          </div>
        </div>

        {!report && <p className="text-sm text-gray-500 rounded-xl bg-brand-50/60 px-4 py-3" id="ra-pick-first">{t('reportAudit.share.pickFirst')}</p>}
        {report && (
          <p className="text-sm text-gray-700 mb-3">{t('reportAudit.share.reportLabel')}: <span className="font-semibold text-gray-900" id="ra-share-title">{title}</span></p>
        )}
        {load.loading && report && <p className="text-sm text-gray-500" role="status">{t('common.loading')}</p>}
        {load.error && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm px-4 py-3 flex flex-wrap items-center gap-3">
            <span className="flex-1 basis-56">{t(load.error)}</span>{retry}
          </div>
        )}
        {report && !load.loading && !load.error && load.doctors.length === 0 && (
          <div className="text-center py-6" id="ra-no-doctors">
            <p className="text-sm font-semibold text-gray-800">{t('reportAudit.share.noAccepted')}</p>
            <button type="button" id="ra-find-doctor" onClick={onFindDoctor} className={`${btnPrimary} mt-4`}>{t('audit.goDoctor')}<Icon name="arrow" size={16} /></button>
          </div>
        )}
        {report && !load.loading && !load.error && load.doctors.length > 0 && (
          <ul className="grid md:grid-cols-2 xl:grid-cols-3 gap-3" role="radiogroup" aria-label={t('reportAudit.share.chooseTitle')}>
            {load.doctors.map(d => {
              const already = sharedWith.has(d.doctorId)
              const on = doctor?.doctorId === d.doctorId
              return (
                <li key={d.doctorId}>
                  <label className={`h-full flex items-start gap-3 rounded-xl border px-4 py-3 ${already ? 'opacity-60 border-gray-200 bg-gray-50' : on ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-200 cursor-pointer' : 'border-brand-100 bg-white hover:bg-brand-50/60 cursor-pointer'}`}>
                    <span className="shrink-0 w-11 h-11 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center"><Icon name="stethoscope" size={20} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-gray-900">{d.name}</span>
                      <span className="block text-xs text-brand-700">{tSpec(d.specialty)}</span>
                      <span className="block text-xs text-gray-500 mt-0.5">
                        {t('reportAudit.share.appointment', { date: fmt.isoDate(d.appointment.date), time: fmt.time(d.appointment.time) })}
                        {' · '}{t(`apptStatus.${d.appointment.status}`, { defaultValue: d.appointment.status })}
                      </span>
                      {already && <span className="inline-block mt-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{t('reportAudit.share.alreadyShared')}</span>}
                    </span>
                    <input type="radio" name="ra-doctor" data-doctor={d.doctorId} checked={on} disabled={already}
                      onChange={() => { setDoctor(d); setAgreed(false); setError(null) }} className="mt-1 h-4 w-4 accent-brand-600" aria-label={d.name} />
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className={`${card} p-5 sm:p-6 space-y-4`} aria-labelledby="ra-s4">
        <div className="flex items-start gap-3">
          <span className="shrink-0 w-11 h-11 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="shield" size={22} /></span>
          <h2 id="ra-s4" className="font-display text-lg font-bold text-gray-900 leading-tight pt-2">{t('reportAudit.step4Title')}</h2>
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm px-4 py-3 flex flex-wrap items-center gap-3">
            <span className="flex-1 basis-56">{t(error.key)}</span>
            {error.code === 'CONSENT_VERSION_MISMATCH' && <button type="button" onClick={() => setAttempt(a => a + 1)} className={btnGhost}>{t('reportAudit.share.reload')}</button>}
            {error.code === 'network' && <button type="button" onClick={send} className={btnGhost}>{t('common.retry')}</button>}
          </div>
        )}

        {!(report && doctor && load.consent) && <p className="text-sm text-gray-500" id="ra-select-hint">{t('reportAudit.share.selectFirst')}</p>}
        {report && doctor && load.consent && (
          <>
            <dl className="grid sm:grid-cols-3 gap-3 text-sm">
              <div className="rounded-xl bg-brand-50/60 px-3.5 py-3">
                <dt className="text-xs text-gray-500">{t('reportAudit.share.sendingTo')}</dt>
                <dd className="font-semibold text-gray-900" id="ra-review-doctor">{doctor.name}</dd>
                <dd className="text-xs text-brand-700">{tSpec(doctor.specialty)}</dd>
              </div>
              <div className="rounded-xl bg-brand-50/60 px-3.5 py-3">
                <dt className="text-xs text-gray-500">{t('reportAudit.share.appointmentLabel')}</dt>
                <dd className="font-semibold text-gray-900">{fmt.isoDate(doctor.appointment.date)} · {fmt.time(doctor.appointment.time)}</dd>
                <dd className="text-xs text-gray-600">{t(`apptStatus.${doctor.appointment.status}`, { defaultValue: doctor.appointment.status })}</dd>
              </div>
              <div className="rounded-xl bg-brand-50/60 px-3.5 py-3 min-w-0">
                <dt className="text-xs text-gray-500">{t('reportAudit.share.reportLabel')}</dt>
                <dd className="font-semibold text-gray-900 break-words">{title}</dd>
              </div>
            </dl>
            <div>
              <p className="text-xs text-gray-500">{t('reportAudit.share.willShare')}</p>
              <ul className="mt-1 text-sm text-gray-800 list-disc pl-5">
                {uploaded && fileInfo && <li>{t('reportAudit.share.fileShared', { name: fileInfo.name, size: fileSizeText(t, fmt, fileInfo.size) })}</li>}
                {!uploaded && counts.map(([k, n]) => <li key={k}>{t(`reportAudit.section.${k}`)}: {t('reportAudit.doc.records', { count: n, n: fmt.number(n) })}</li>)}
                {!uploaded && <li>{report.snapshot?.includesFreeText ? t('reportAudit.share.withNotes') : t('reportAudit.share.withoutNotes')}</li>}
              </ul>
            </div>
            <p className="text-xs text-gray-600 bg-brand-50/70 rounded-xl px-3 py-2">{t('reportAudit.share.onlyThisDoctor')}</p>

            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-gray-900 text-sm">{t('reportAudit.share.consentTitle')}</h3>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-100">{load.consent.version}</span>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{t('reportAudit.share.englishOnly')}</span>
              <button type="button" id="ra-consent-toggle" aria-expanded={showConsent} onClick={() => setShowConsent(v => !v)} className="ml-auto text-xs font-semibold text-brand-700 underline">{showConsent ? t('reportAudit.share.hideConsent') : t('reportAudit.share.viewConsent')}</button>
            </div>
            <p className="text-xs text-gray-500">{t('reportAudit.share.consentNotice')}</p>
            {/* The exact server-owned wording, shown verbatim (never translated or reworded by the app) */}
            {showConsent && (
              <div id="ra-consent-text" lang="en" tabIndex={0} aria-label={t('reportAudit.share.consentTitle')}
                className="max-h-72 overflow-y-auto rounded-xl border border-brand-200 bg-white px-4 py-3 text-sm text-gray-800 leading-relaxed whitespace-pre-line focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200">
                {load.consent.text}
              </div>
            )}
            <label className="flex items-start gap-3 rounded-xl border border-brand-100 bg-white px-3.5 py-3 cursor-pointer">
              <input id="ra-agree" type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-1 h-4 w-4 accent-brand-600" />
              <span className="text-sm text-gray-800">{t('reportAudit.share.agree', { doctor: doctor.name })}</span>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" id="ra-send" disabled={!agreed || busy} onClick={send} className={btnPrimary}>
                <Icon name="send" size={16} />{busy ? t('reportAudit.share.sending') : t('reportAudit.share.sendBtn')}
              </button>
              <p className="text-xs text-gray-500 flex-1 basis-56">{agreed ? t('reportAudit.share.sendHint') : t('reportAudit.share.needConsent')}</p>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
