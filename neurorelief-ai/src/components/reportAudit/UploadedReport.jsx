import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../../i18n/format'
import { Icon } from '../icons'
import { fileSizeText, reportErrorKey, utcStamp } from './shared'

const btnGhost = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-brand-200 bg-white text-brand-700 text-sm font-semibold hover:bg-brand-50 disabled:opacity-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200'
const btnPrimary = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 text-white text-sm font-semibold hover:opacity-95 disabled:opacity-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200'

// An uploaded PDF report: what the backend knows about the file (name, size, date) plus Preview / Download.
// loadFile() fetches the decrypted PDF from the backend with the user's token; the file is only ever held as a blob.
export default function UploadedReport({ snapshot, loadFile }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const [url, setUrl] = useState(null)      // object URL of the fetched PDF while previewing
  const [busy, setBusy] = useState('')      // '' | 'preview' | 'download'
  const [error, setError] = useState(null)
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const fetchBlob = async mode => {
    setBusy(mode); setError(null)
    try { return await loadFile() } catch (err) { setError(reportErrorKey(err)); return null } finally { setBusy('') }
  }
  const preview = async () => {
    if (url) { setUrl(null); return }
    const blob = await fetchBlob('preview'); if (blob) setUrl(URL.createObjectURL(blob))
  }
  const download = async () => {
    const blob = await fetchBlob('download'); if (!blob) return
    const href = URL.createObjectURL(blob), a = document.createElement('a')
    a.href = href; a.download = snapshot.file.name; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 2000)
  }
  return (
    <div className="space-y-4" data-uploaded-report>
      <div className="flex flex-wrap items-center gap-4">
        <span className="shrink-0 w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="doc" size={28} /></span>
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('reportAudit.file.title')}</p>
          <p className="text-sm font-semibold text-gray-900 break-words" data-file-name>{snapshot.file.name}</p>
          <p className="text-xs text-gray-500">{fileSizeText(t, fmt, snapshot.file.size)} · {t('reportAudit.file.uploaded', { date: fmt.dateTime(utcStamp(snapshot.generatedAt)) })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-file-preview disabled={!!busy} onClick={preview} className={btnGhost}><Icon name="eye" size={16} />{url ? t('reportAudit.file.hidePreview') : busy === 'preview' ? t('reportAudit.file.loading') : t('reportAudit.file.preview')}</button>
          <button type="button" data-file-download disabled={!!busy} onClick={download} className={btnPrimary}><Icon name="download" size={16} />{busy === 'download' ? t('reportAudit.file.loading') : t('reportAudit.file.download')}</button>
        </div>
      </div>
      <ul className="text-xs text-gray-600 bg-brand-50/70 rounded-xl px-3 py-2 space-y-1">
        {(snapshot.notices || []).map(n => <li key={n}>{t(`reportAudit.doc.notice.${n}`, { defaultValue: n })}</li>)}
      </ul>
      {error && <p role="alert" className="text-sm text-rose-700">{t(error)}</p>}
      {url && <iframe title={t('reportAudit.file.frame')} src={url} className="w-full h-[70vh] rounded-xl border border-brand-100 bg-white" />}
    </div>
  )
}
