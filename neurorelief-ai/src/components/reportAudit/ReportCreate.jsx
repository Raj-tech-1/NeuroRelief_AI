import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../../i18n/format'
import { Icon } from '../icons'
import { previewReport, saveReport, uploadReportPdf } from '../../services/api'
import ReportDocument from './ReportDocument'
import ReportSummary from './ReportSummary'
import { PrintArea, printReport } from './PrintArea'
import { addDays, fileSizeText, fileToBase64, localTitle, MAX_PDF_BYTES, reportErrorKey, SECTION_KEYS, utcToday } from './shared'

const card = 'bg-white/90 rounded-2xl border border-brand-100/70 shadow-sm shadow-brand-100/50'
const btnPrimary = 'inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 text-white text-sm font-semibold hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200'
const btnGhost = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-brand-200 bg-white text-brand-700 text-sm font-semibold hover:bg-brand-50 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200'
const input = 'w-full rounded-xl border border-brand-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200'
const PRESETS = [['30', 30], ['90', 90], ['180', 180]]

// Step 1 + 2 of Report Audit: create a report (generate from records, or upload a PDF) and preview it.
// Nothing is stored until the patient presses Save, and a success message is only shown after the backend confirms it.
//   generate: Preview -> Save is only possible for a preview of exactly the options on screen.
//   upload:   the PDF stays on the device until Save; the backend re-validates type, size and content.
export default function ReportCreate({ uploadsEnabled, patientName, onSaved, onReset, onUnavailable }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const today = utcToday()
  const [mode, setMode] = useState('generate')
  // ---- generate ----
  const [title, setTitle] = useState('')
  const [preset, setPreset] = useState('30')
  const [from, setFrom] = useState(addDays(today, -29))
  const [to, setTo] = useState(today)
  const [sections, setSections] = useState(['cycles', 'wellness', 'predictions', 'questionnaire'])
  const [includeNotes, setIncludeNotes] = useState(false)
  const [preview, setPreview] = useState(null)    // { opts, data } of the last successful preview
  // ---- upload ----
  const [file, setFile] = useState(null)          // the chosen File (validated for UX; the server is the authority)
  const [fileUrl, setFileUrl] = useState(null)
  const [upTitle, setUpTitle] = useState('')
  const [fileError, setFileError] = useState(null)
  // ---- shared ----
  const [busy, setBusy] = useState('')            // '' | 'preview' | 'save'
  const [error, setError] = useState(null)        // { key, code }
  const [saved, setSaved] = useState(null)        // { reportId } once the backend confirmed the save
  const fileInput = useRef(null)
  const autoTitle = useRef('')                // the title filled in from the file name (replaced when another file is chosen)

  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl) }, [fileUrl])

  const choosePreset = (id, days) => { setPreset(id); setFrom(addDays(today, -(days - 1))); setTo(today) }
  const toggle = s => setSections(cur => cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s])
  const opts = useMemo(() => ({ from, to, sections, includeNotes, ...(title.trim() ? { title: title.trim() } : {}) }), [from, to, sections, includeNotes, title])
  const stale = !!preview && JSON.stringify(preview.opts) !== JSON.stringify(opts)
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000
  const formError = !from || !to ? 'reportAudit.create.errDates'
    : from > to ? 'reportAudit.create.errOrder'
    : to > today ? 'reportAudit.create.errFuture'
    : span > 730 ? 'reportAudit.create.errSpan'
    : sections.length === 0 ? 'reportAudit.create.errSections' : null

  const fail = err => {
    if (err?.code === 'NOT_CONFIGURED') return onUnavailable()
    setError({ key: reportErrorKey(err), code: err?.code })
  }
  const resetAll = () => {
    setTitle(''); setPreset('30'); setFrom(addDays(today, -29)); setTo(today); setSections(['cycles', 'wellness', 'predictions', 'questionnaire']); setIncludeNotes(false)
    setPreview(null); clearFile(); setUpTitle(''); setError(null); setSaved(null); onReset?.()
  }
  const switchMode = m => { setMode(m); setError(null) }

  const runPreview = async () => {
    if (formError || busy) return
    setBusy('preview'); setError(null); setSaved(null)
    try { setPreview({ opts, data: await previewReport(opts) }) } catch (err) { fail(err) } finally { setBusy('') }
  }
  const runSave = async () => {
    if (!preview || stale || preview.data.totalItems === 0 || busy || saved) return
    setBusy('save'); setError(null)
    try {
      const r = await saveReport({ ...preview.opts, digest: preview.data.digest })
      setSaved({ reportId: r.reportId }); onSaved({ reportId: r.reportId, title: r.title, kind: 'health_summary', snapshot: preview.data.snapshot, shares: [] })
    } catch (err) { fail(err) } finally { setBusy('') }
  }

  // ---- upload handlers ----
  function clearFile() {
    setFile(null); setFileUrl(null); setFileError(null)
    if (fileInput.current) fileInput.current.value = ''
  }
  const pickFile = e => {
    const f = e.target.files?.[0]
    setError(null); setSaved(null)
    if (!f) return
    let problem = null
    if (!/\.pdf$/i.test(f.name) || (f.type && f.type !== 'application/pdf')) problem = 'reportAudit.upload.errType'
    else if (f.size === 0) problem = 'reportAudit.upload.errEmpty'
    else if (f.size > MAX_PDF_BYTES) problem = 'reportAudit.upload.errSize'
    if (problem) { setFile(null); setFileUrl(null); setFileError(problem); if (fileInput.current) fileInput.current.value = ''; return }
    setFileError(null); setFile(f); setFileUrl(URL.createObjectURL(f))
    const auto = f.name.replace(/\.pdf$/i, '').slice(0, 120)
    if (!upTitle.trim() || upTitle === autoTitle.current) setUpTitle(auto)
    autoTitle.current = auto
  }
  const titleError = file && !upTitle.trim() ? 'reportAudit.upload.errTitle' : null
  const runUpload = async () => {
    if (!file || !upTitle.trim() || busy || saved) return
    setBusy('save'); setError(null)
    try {
      const r = await uploadReportPdf({ title: upTitle.trim(), fileName: file.name, dataBase64: await fileToBase64(file) })
      setSaved({ reportId: r.reportId })
      onSaved({ reportId: r.reportId, title: r.title, kind: 'uploaded_pdf', file: { name: file.name, size: file.size }, shares: [] })
    } catch (err) { if (err?.message === 'read') setError({ key: 'reportAudit.upload.errType' }); else fail(err) } finally { setBusy('') }
  }

  const heading = preview ? localTitle(t, fmt, preview.data.title) : ''
  const empty = preview && preview.data.totalItems === 0
  const pill = on => `px-3.5 py-2 rounded-xl text-sm font-semibold border focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200 ${on ? 'bg-brand-100 border-brand-300 text-brand-800' : 'bg-white border-brand-100 text-gray-700 hover:bg-brand-50'}`
  const tab = on => `flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200 ${on ? 'bg-brand-100 text-brand-800' : 'bg-gray-50 text-gray-700 hover:bg-brand-50'}`

  return (
    <div className="grid lg:grid-cols-2 gap-5 items-start">
      {/* ------------ 1. Create or upload ------------ */}
      <section className={`${card} p-5 sm:p-6 space-y-5`} aria-labelledby="ra-s1">
        <div className="flex items-start gap-3">
          <span className="shrink-0 w-11 h-11 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="doc" size={22} /></span>
          <div className="min-w-0">
            <h2 id="ra-s1" className="font-display text-lg font-bold text-gray-900 leading-tight">{t('reportAudit.step1Title')}</h2>
            <p className="text-xs text-gray-600 mt-0.5">{t('reportAudit.step1Sub')}</p>
          </div>
        </div>
        <div role="tablist" aria-label={t('reportAudit.mode.label')} className="flex gap-2">
          <button type="button" role="tab" id="ra-tab-generate" aria-selected={mode === 'generate'} onClick={() => switchMode('generate')} className={tab(mode === 'generate')}><Icon name="doc" size={16} />{t('reportAudit.mode.generate')}</button>
          <button type="button" role="tab" id="ra-tab-upload" aria-selected={mode === 'upload'} onClick={() => switchMode('upload')} className={tab(mode === 'upload')}><Icon name="upload" size={16} />{t('reportAudit.mode.upload')}</button>
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm px-4 py-3 flex flex-wrap items-center gap-3">
            <span className="flex-1 basis-48">{t(error.key)}</span>
            {error.code === 'DATA_CHANGED' && <button type="button" onClick={runPreview} className={btnGhost}>{t('reportAudit.preview.refresh')}</button>}
            {error.code === 'network' && <button type="button" onClick={mode === 'upload' ? runUpload : preview ? runSave : runPreview} className={btnGhost}>{t('common.retry')}</button>}
          </div>
        )}

        {mode === 'generate' && (
          <form className="space-y-5" onSubmit={e => { e.preventDefault(); runPreview() }}>
            <label className="block text-sm font-semibold text-gray-900">{t('reportAudit.create.titleLabel')}
              <input id="ra-title" type="text" value={title} maxLength={120} onChange={e => setTitle(e.target.value)} placeholder={t('reportAudit.create.titlePlaceholder')} className={`${input} mt-1.5 font-normal`} />
            </label>
            <fieldset>
              <legend className="font-semibold text-gray-900 text-sm mb-2">{t('reportAudit.create.periodTitle')}</legend>
              <div className="flex flex-wrap gap-2 mb-3" role="radiogroup" aria-label={t('reportAudit.create.periodTitle')}>
                {PRESETS.map(([id, days]) => (
                  <button key={id} type="button" role="radio" aria-checked={preset === id} onClick={() => choosePreset(id, days)} className={pill(preset === id)}>{t('reportAudit.create.lastDays', { n: fmt.number(days) })}</button>
                ))}
                <button type="button" role="radio" aria-checked={preset === 'custom'} onClick={() => setPreset('custom')} className={pill(preset === 'custom')}>{t('reportAudit.create.custom')}</button>
              </div>
              <div className="flex flex-wrap gap-3">
                <label className="text-xs font-medium text-gray-600 flex flex-col gap-1">{t('reportAudit.create.from')}
                  <input id="ra-from" type="date" value={from} max={today} disabled={preset !== 'custom'} onChange={e => setFrom(e.target.value)} className="rounded-xl border border-brand-200 px-3 py-2 text-sm text-gray-900 disabled:bg-gray-50 disabled:text-gray-500" />
                </label>
                <label className="text-xs font-medium text-gray-600 flex flex-col gap-1">{t('reportAudit.create.to')}
                  <input id="ra-to" type="date" value={to} max={today} disabled={preset !== 'custom'} onChange={e => setTo(e.target.value)} className="rounded-xl border border-brand-200 px-3 py-2 text-sm text-gray-900 disabled:bg-gray-50 disabled:text-gray-500" />
                </label>
              </div>
            </fieldset>
            <fieldset>
              <legend className="font-semibold text-gray-900 text-sm mb-2">{t('reportAudit.create.sectionsTitle')}</legend>
              <div className="grid sm:grid-cols-2 gap-2">
                {SECTION_KEYS.map(s => (
                  <label key={s} className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 cursor-pointer ${sections.includes(s) ? 'border-brand-300 bg-brand-50/70' : 'border-brand-100 bg-white'}`}>
                    <input type="checkbox" checked={sections.includes(s)} onChange={() => toggle(s)} className="mt-1 h-4 w-4 accent-brand-600" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-gray-900">{t(`reportAudit.section.${s}`)}</span>
                      <span className="block text-xs text-gray-500 leading-snug">{t(`reportAudit.create.sectionHint.${s}`)}</span>
                    </span>
                  </label>
                ))}
                <label className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 cursor-pointer ${includeNotes ? 'border-brand-300 bg-brand-50/70' : 'border-brand-100 bg-white'}`}>
                  <input id="ra-notes" type="checkbox" checked={includeNotes} onChange={e => setIncludeNotes(e.target.checked)} className="mt-1 h-4 w-4 accent-brand-600" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-gray-900">{t('reportAudit.create.notesTitle')}</span>
                    <span className="block text-xs text-gray-500 leading-snug">{t('reportAudit.create.notesHelp')}</span>
                  </span>
                </label>
              </div>
            </fieldset>
            {formError && <p role="alert" className="text-sm text-rose-700">{t(formError)}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" id="ra-reset" onClick={resetAll} className={btnGhost}>{t('reportAudit.create.reset')}</button>
              <button type="submit" id="ra-preview" disabled={!!formError || !!busy} className={`${btnPrimary} flex-1`}>
                <Icon name="doc" size={16} />{busy === 'preview' ? t('reportAudit.create.previewing') : t('reportAudit.create.previewBtn')}
              </button>
            </div>
            <p className="text-xs text-gray-500">{t('reportAudit.create.notSavedYet')}</p>
          </form>
        )}

        {mode === 'upload' && !uploadsEnabled && (
          <p role="status" id="ra-upload-off" className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm px-4 py-3">{t('reportAudit.upload.unavailable')}</p>
        )}
        {mode === 'upload' && uploadsEnabled && (
          <form className="space-y-5" onSubmit={e => { e.preventDefault(); runUpload() }}>
            <div>
              <input ref={fileInput} id="ra-file" type="file" accept="application/pdf,.pdf" onChange={pickFile} className="sr-only" aria-describedby="ra-file-hint" />
              {!file ? (
                <label htmlFor="ra-file" className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/40 hover:bg-brand-50 px-4 py-8 text-center cursor-pointer focus-within:ring-4 focus-within:ring-brand-200">
                  <span className="w-12 h-12 rounded-full bg-white text-brand-600 flex items-center justify-center shadow-sm"><Icon name="upload" size={24} /></span>
                  <span className="text-sm font-semibold text-brand-800">{t('reportAudit.upload.choose')}</span>
                  <span id="ra-file-hint" className="text-xs text-gray-500">{t('reportAudit.upload.hint')}</span>
                </label>
              ) : (
                <div className="rounded-2xl border border-brand-200 bg-white px-4 py-3 flex flex-wrap items-center gap-3" data-selected-file>
                  <span className="shrink-0 w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="doc" size={20} /></span>
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="text-sm font-semibold text-gray-900 break-words" data-file-name>{file.name}</p>
                    <p className="text-xs text-gray-500" id="ra-file-hint">{fileSizeText(t, fmt, file.size)}</p>
                  </div>
                  <label htmlFor="ra-file" className="px-3 py-1.5 rounded-lg border border-brand-200 bg-white text-brand-700 text-xs font-semibold hover:bg-brand-50 cursor-pointer">{t('reportAudit.upload.replace')}</label>
                  <button type="button" id="ra-file-remove" onClick={() => { clearFile(); setSaved(null) }} className="px-3 py-1.5 rounded-lg border border-rose-200 bg-white text-rose-700 text-xs font-semibold hover:bg-rose-50">{t('reportAudit.upload.remove')}</button>
                </div>
              )}
              {fileError && <p role="alert" id="ra-file-error" className="text-sm text-rose-700 mt-2">{t(fileError)}</p>}
            </div>
            <label className="block text-sm font-semibold text-gray-900">{t('reportAudit.upload.titleLabel')}
              <input id="ra-up-title" type="text" value={upTitle} maxLength={120} onChange={e => setUpTitle(e.target.value)} placeholder={t('reportAudit.upload.titlePlaceholder')} className={`${input} mt-1.5 font-normal`} />
            </label>
            {titleError && <p role="alert" className="text-sm text-rose-700">{t(titleError)}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={resetAll} className={btnGhost}>{t('reportAudit.create.reset')}</button>
              <button type="submit" id="ra-up-save" disabled={!file || !upTitle.trim() || !!busy || !!saved} className={`${btnPrimary} flex-1`}>
                <Icon name="check" size={16} />{busy === 'save' ? t('reportAudit.upload.saving') : t('reportAudit.upload.save')}
              </button>
            </div>
            <p className="text-xs text-gray-500">{t('reportAudit.upload.privacy')}</p>
          </form>
        )}
      </section>

      {/* ------------ 2. Preview ------------ */}
      <section className={`${card} p-5 sm:p-6 space-y-4 min-w-0`} aria-labelledby="ra-s2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="shrink-0 w-11 h-11 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="eye" size={22} /></span>
            <h2 id="ra-s2" className="font-display text-lg font-bold text-gray-900">{t('reportAudit.step2Title')}</h2>
          </div>
          {mode === 'generate' && preview && (
            <div className="flex flex-wrap gap-2">
              <button type="button" id="ra-print" disabled={empty || stale} onClick={() => printReport(heading)} className={btnGhost}><Icon name="download" size={16} />{t('reportAudit.printBtn')}</button>
              <button type="button" id="ra-save" disabled={empty || stale || !!busy || !!saved} onClick={runSave} className={btnPrimary}><Icon name="check" size={16} />{busy === 'save' ? t('reportAudit.preview.saving') : t('reportAudit.preview.saveBtn')}</button>
            </div>
          )}
        </div>

        {saved && <p role="status" id="ra-saved" className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm px-4 py-3">{t('reportAudit.saved')} <button type="button" onClick={resetAll} className="underline font-semibold ml-1">{t('reportAudit.preview.createAnother')}</button></p>}

        {mode === 'generate' && !preview && <p className="text-sm text-gray-500 py-10 text-center" id="ra-preview-empty">{t('reportAudit.preview.placeholder')}</p>}
        {mode === 'generate' && preview && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">{saved ? t('reportAudit.preview.savedChip') : t('reportAudit.preview.notSaved')}</span>
              <p className="text-xs text-gray-600 flex-1 basis-48">{saved ? '' : stale ? t('reportAudit.preview.stale') : empty ? t('reportAudit.preview.emptyNote') : t('reportAudit.preview.note')}</p>
            </div>
            <p className="text-xs text-gray-500">{t('reportAudit.preview.printHint')}</p>
            <div className="rounded-xl bg-brand-50/40 border border-brand-100 p-3 sm:p-4 space-y-3" data-preview-doc>
              <ReportSummary snapshot={preview.data.snapshot} title={heading} patientName={patientName} stateLabel={saved ? t('reportAudit.preview.savedChip') : t('reportAudit.preview.notSaved')} />
              <details className="rounded-xl border border-brand-100 bg-white" data-all-records>
                <summary className="cursor-pointer px-3.5 py-2.5 text-sm font-semibold text-brand-700">{t('reportAudit.sum.allRecords')}</summary>
                <div className="max-h-[520px] overflow-auto p-3 sm:p-4">
                  <ReportDocument snapshot={preview.data.snapshot} title={heading} meta={{ preview: !saved, reportId: saved?.reportId, patientName }} />
                </div>
              </details>
            </div>
            <PrintArea><ReportDocument snapshot={preview.data.snapshot} title={heading} meta={{ preview: !saved, reportId: saved?.reportId, patientName }} /></PrintArea>
          </>
        )}

        {mode === 'upload' && !file && <p className="text-sm text-gray-500 py-10 text-center" id="ra-preview-empty">{t('reportAudit.upload.noFile')}</p>}
        {mode === 'upload' && file && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">{saved ? t('reportAudit.preview.savedChip') : t('reportAudit.preview.notSaved')}</span>
              {!saved && <p className="text-xs text-gray-600 flex-1 basis-48">{t('reportAudit.upload.previewNote')}</p>}
            </div>
            <iframe id="ra-pdf-frame" title={t('reportAudit.file.frame')} src={fileUrl} className="w-full h-[520px] rounded-xl border border-brand-100 bg-white" />
            <p className="text-xs text-gray-500">{t('reportAudit.upload.noPreview')}</p>
          </>
        )}
      </section>
    </div>
  )
}
