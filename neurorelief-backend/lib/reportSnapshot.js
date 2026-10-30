// Builds the report snapshot from the PATIENT'S OWN recorded rows. The browser never supplies report content.
// Nothing is invented: a section with no rows is simply empty, and data the server does not hold (the unused symptoms
// table, device/pain history that lives only in the browser) is listed under `notIncluded`.
// Excluded on purpose: scans.ai_summary (a fixed template string, not an assessment) and predictions.input_features.
import crypto from 'node:crypto'

export const SECTIONS = ['cycles', 'wellness', 'predictions', 'questionnaire']
export const MAX_ROWS = 500
export const MAX_SPAN_DAYS = 730
export const SNAPSHOT_VERSION = 1

export class SnapshotError extends Error {
  constructor(code, message) { super(message); this.name = 'SnapshotError'; this.code = code }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export function validDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null
}

// Returns { from, to, sections, includeNotes } or throws SnapshotError('INVALID_INPUT').
export function parseOptions(body, today) {
  const bad = msg => new SnapshotError('INVALID_INPUT', msg)
  const from = validDate(body?.from), to = validDate(body?.to)
  if (!from || !to) throw bad('A valid period (from and to, YYYY-MM-DD) is required.')
  if (from > to) throw bad('The start of the period must not be after its end.')
  if (to > today) throw bad('The period cannot end in the future.')
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000
  if (span > MAX_SPAN_DAYS) throw bad(`The period can cover at most ${MAX_SPAN_DAYS} days.`)
  const sections = body?.sections
  if (!Array.isArray(sections) || sections.length === 0 || sections.length > SECTIONS.length ||
      sections.some(s => !SECTIONS.includes(s)) || new Set(sections).size !== sections.length) {
    throw bad('Choose at least one valid section.')
  }
  if (body?.includeNotes !== undefined && typeof body.includeNotes !== 'boolean') throw bad('includeNotes must be true or false.')
  let title
  if (body?.title !== undefined && body?.title !== null && body?.title !== '') {
    if (typeof body.title !== 'string' || body.title.trim().length < 1 || body.title.trim().length > MAX_TITLE) throw bad(`The title must be 1 to ${MAX_TITLE} characters.`)
    title = body.title.trim()
  }
  return { from, to, sections: SECTIONS.filter(s => sections.includes(s)), includeNotes: body?.includeNotes === true, title }
}

const pick = (row, keys) => Object.fromEntries(keys.map(k => [k, row[k] ?? null]))

function section(db, sql, params, mapRow) {
  const rows = db.all(`${sql} LIMIT ${MAX_ROWS + 1}`, params)
  const truncated = rows.length > MAX_ROWS
  const items = rows.slice(0, MAX_ROWS).map(mapRow)
  return { count: items.length, truncated, items }
}

// `db` is { all }. `userId` is always the authenticated patient.
export function buildSnapshot(db, userId, opts, nowIso) {
  const { from, to, sections, includeNotes } = opts
  const out = {}
  if (sections.includes('cycles')) {
    out.cycles = section(db,
      'SELECT start_date, end_date, cycle_length, flow, mood, notes FROM menstrual_cycles WHERE user_id = ? AND start_date BETWEEN ? AND ? ORDER BY start_date',
      [userId, from, to],
      r => ({ ...pick(r, ['start_date', 'end_date', 'cycle_length', 'flow', 'mood']), ...(includeNotes ? { notes: r.notes ?? null } : {}) }))
  }
  if (sections.includes('wellness')) {
    out.wellness = section(db,
      'SELECT date, mood, energy, stress, sleep_quality, sleep_hours, note FROM wellness_records WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date',
      [userId, from, to],
      r => ({ ...pick(r, ['date', 'mood', 'energy', 'stress', 'sleep_quality', 'sleep_hours']), ...(includeNotes ? { note: r.note ?? null } : {}) }))
  }
  if (sections.includes('predictions')) {
    out.predictions = {
      source: 'ai_prediction',   // labelled so a reader can never mistake these for a diagnosis
      ...section(db,
        'SELECT date, predicted_severity, confidence, recommended_tens_intensity, recommended_heat_temp FROM predictions WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date',
        [userId, from, to],
        r => pick(r, ['date', 'predicted_severity', 'confidence', 'recommended_tens_intensity', 'recommended_heat_temp'])),
    }
  }
  if (sections.includes('questionnaire')) {
    out.questionnaire = section(db,
      'SELECT date(created_at) AS date, life_stage, body_areas, severity, symptom_description, medications, notes FROM scans WHERE user_id = ? AND date(created_at) BETWEEN ? AND ? ORDER BY created_at',
      [userId, from, to],
      r => ({ ...pick(r, ['date', 'life_stage', 'body_areas', 'severity']), ...(includeNotes ? pick(r, ['symptom_description', 'medications', 'notes']) : {}) }))
  }
  const totalItems = Object.values(out).reduce((n, s) => n + s.count, 0)
  const snapshot = {
    version: SNAPSHOT_VERSION,
    kind: 'health_summary',
    generatedAt: nowIso,
    period: { from, to },
    sections: out,
    includesFreeText: includeNotes,
    notIncluded: ['symptom log (not recorded by the app)', 'device therapy and pain-rating history (stored only on your device)'],
    notices: ['system_generated', 'ai_not_diagnosis', 'not_doctor_verified'],
  }
  return { snapshot, totalItems, digest: snapshotDigest(snapshot) }
}

// Stable digest of the content (excludes generatedAt) so "preview then save" can detect that the data changed between the two.
export function snapshotDigest(snapshot) {
  const { generatedAt, ...rest } = snapshot
  return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex')
}

export const MAX_TITLE = 120
export const reportTitle = ({ from, to, title }) => title || `Health summary ${from} to ${to}`
