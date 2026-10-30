// Small helpers shared by the Report Audit components.

const KNOWN_ERRORS = ['NOT_CONFIGURED', 'NO_DATA', 'DATA_CHANGED', 'INVALID_INPUT', 'RATE_LIMITED', 'INTEGRITY_FAILURE', 'AUDIT_FAILED', 'NOT_FOUND',
  'NOT_ELIGIBLE', 'ALREADY_SHARED', 'CONSENT_REQUIRED', 'CONSENT_VERSION_MISMATCH', 'ALREADY_REVOKED',
  'INVALID_FILE', 'FILE_TOO_LARGE', 'NOT_A_PDF', 'UNSAFE_PDF', 'UPLOADS_UNAVAILABLE',
  'NOTE_REQUIRED', 'CONFIRM_REQUIRED', 'ILLEGAL_TRANSITION', 'SHARE_INACTIVE', 'NOT_UNDER_REVIEW']

// i18n key for an error thrown by services/api.js reportRequest().
export function reportErrorKey(err) {
  if (err?.code === 'network') return 'reportAudit.err.network'
  // The backend's own machine code wins: e.g. NOT_ELIGIBLE is an HTTP 403 but is NOT a session problem.
  if (KNOWN_ERRORS.includes(err?.code)) return `reportAudit.err.${err.code}`
  // A 401/403 without a report code comes from the sign-in check itself.
  if (err?.status === 401 || err?.status === 403) return 'reportAudit.err.session'
  return 'reportAudit.err.generic'
}

// The server names reports "Health summary YYYY-MM-DD to YYYY-MM-DD"; show that in the selected language.
const TITLE_RE = /^Health summary (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/
export function localTitle(t, fmt, title) {
  const m = TITLE_RE.exec(title || '')
  return m ? t('reportAudit.docTitle', { from: fmt.isoDate(m[1]), to: fmt.isoDate(m[2]) }) : title
}

// UTC calendar date (YYYY-MM-DD). The backend validates the period against the UTC date, so the form uses it too.
export const utcToday = () => new Date().toISOString().slice(0, 10)
export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const SECTION_KEYS = ['cycles', 'wellness', 'predictions', 'questionnaire']
export const STATUS_ORDER = ['draft', 'submitted', 'under_review', 'changes_requested', 'verified', 'revoked']

// The backend stores timestamps as UTC 'YYYY-MM-DD HH:MM:SS' (no zone); make that explicit so the browser shows local time.
export const utcStamp = s => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s || '') ? `${s.replace(' ', 'T')}Z` : s)

// Upload limits (the backend enforces the same limits and is the authority)
export const MAX_PDF_BYTES = 5 * 1024 * 1024
export const fileSizeText = (t, fmt, bytes) => bytes < 1024 * 1024
  ? t('reportAudit.file.kb', { n: fmt.number(Math.max(1, Math.round(bytes / 1024))) })
  : t('reportAudit.file.mb', { n: fmt.number(Math.round(bytes / 1048576 * 10) / 10) })
// base64 of a File (no data: prefix)
export const fileToBase64 = file => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).split(',')[1] || '')
  r.onerror = () => reject(new Error('read'))
  r.readAsDataURL(file)
})
