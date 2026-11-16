// Relief Journal: a patient's own log of what they tried for period pain and how the pain changed.
// - Medicines are logged by NAME and TIME only. There is no dose field anywhere, and the app gives no dosing advice.
// - Medicine name and note are encrypted together (AES-256-GCM, the Report Audit key) and bound to the entry and user.
// - Device-panel therapy sessions (therapy_sessions) are included read-only, so they are not entered twice.
// - The summary only DESCRIBES the patient's own entries (average change per method); it recommends nothing.
import { encrypt, decrypt } from './reportCrypto.js'
import { isoDay } from './appointmentRules.js'

export const METHODS = ['heat', 'tens', 'rest', 'stretching', 'hydration', 'medicine', 'other']
const MAX_MEDICINE = 60
const MAX_NOTE = 500
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export class JournalError extends Error {
  constructor(status, code, message) { super(message); this.name = 'JournalError'; this.status = status; this.code = code }
}
const E = (s, c, m) => new JournalError(s, c, m)

const aad = (entryId, userId) => Buffer.from(`nr-journal|v1|entry:${entryId}|user:${userId}`, 'utf8')
const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max) : '')
const isPain = v => Number.isInteger(v) && v >= 0 && v <= 10
const localMinute = d => (Number.isNaN(d.getTime()) ? null : `${isoDay(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
const localNow = () => localMinute(new Date())
const tableExists = (db, name) => !!db.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", [name])

function keyOrNull(ctx) { try { return ctx.key() } catch { return null } }

function openPrivate(ctx, row) {
  if (!row.ciphertext) return { medicine: null, note: null }
  const k = keyOrNull(ctx)
  if (!k || k.keyId !== row.key_id) return { medicine: null, note: null, unavailable: true }
  try {
    const p = JSON.parse(decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, { key: k.key, aad: aad(row.entry_id, row.user_id) }).toString('utf8'))
    return { medicine: p.medicine || null, note: p.note || null }
  } catch {
    return { medicine: null, note: null, unavailable: true }
  }
}

function entryView(ctx, row) {
  const priv = openPrivate(ctx, row)
  return {
    id: row.entry_id, source: 'journal', occurredAt: row.occurred_at,
    painBefore: row.pain_before, painAfter: row.pain_after,
    methods: String(row.methods).split(',').filter(Boolean),
    medicine: priv.medicine, medicineTakenAt: row.medicine_taken_at, note: priv.note,
    privateUnavailable: !!priv.unavailable, createdAt: row.created_at,
  }
}

// Average pain change per method, from entries that have both ratings (journal + device sessions). Descriptive only.
function summarize(entries) {
  const by = {}
  for (const e of entries) {
    if (e.painAfter == null) continue
    for (const m of e.methods) {
      const s = (by[m] ??= { method: m, entries: 0, totalChange: 0 })
      s.entries += 1
      s.totalChange += e.painBefore - e.painAfter
    }
  }
  return Object.values(by)
    .map(s => ({ method: s.method, entries: s.entries, avgReduction: Math.round((s.totalChange / s.entries) * 10) / 10 }))
    .sort((a, b) => b.entries - a.entries || b.avgReduction - a.avgReduction)
}

export function listJournal(ctx, userId) {
  const entries = ctx.db.all('SELECT * FROM relief_entries WHERE user_id = ? ORDER BY occurred_at DESC, entry_id DESC LIMIT 200', [userId])
    .map(r => entryView(ctx, r))
  const sessions = tableExists(ctx.db, 'therapy_sessions')
    ? ctx.db.all('SELECT session_id, kind, started_at, duration_seconds, heat_temp_c, tens_intensity, tens_frequency, pain_before, pain_after FROM therapy_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 100', [userId])
      .filter(s => s.pain_before != null)
      .map(s => ({
        // therapy_sessions.started_at is a UTC ISO time; journal times are local, so convert for a consistent list
        id: `s${s.session_id}`, source: 'device', occurredAt: localMinute(new Date(s.started_at)) || String(s.started_at).slice(0, 16),
        painBefore: s.pain_before, painAfter: s.pain_after, methods: [s.kind],
        durationSeconds: s.duration_seconds, heatTempC: s.heat_temp_c, tensIntensity: s.tens_intensity, tensFrequency: s.tens_frequency,
      }))
    : []
  const all = [...entries, ...sessions].sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)))
  return { entries: all, summary: summarize(all), methods: METHODS, encryption: !!keyOrNull(ctx) }
}

export function addEntry(ctx, userId, body) {
  const b = body || {}
  const occurredAt = typeof b.occurredAt === 'string' ? b.occurredAt.slice(0, 16) : ''
  if (!DATETIME_RE.test(occurredAt) || Number.isNaN(Date.parse(occurredAt))) throw E(400, 'INVALID_INPUT', 'Choose a valid date and time.')
  if (occurredAt > localNow()) throw E(400, 'INVALID_INPUT', 'The date and time cannot be in the future.')
  if (!isPain(b.painBefore)) throw E(400, 'INVALID_INPUT', 'Pain before must be a whole number from 0 to 10.')
  if (b.painAfter != null && !isPain(b.painAfter)) throw E(400, 'INVALID_INPUT', 'Pain after must be a whole number from 0 to 10.')
  const medicine = cleanText(b.medicine, MAX_MEDICINE)
  const note = cleanText(b.note, MAX_NOTE)
  const methods = new Set(Array.isArray(b.methods) ? b.methods.filter(m => METHODS.includes(m)) : [])
  if (medicine) methods.add('medicine')
  if (!methods.size) throw E(400, 'INVALID_INPUT', 'Choose at least one thing you tried.')
  const takenAt = b.medicineTakenAt ? String(b.medicineTakenAt) : null
  if (takenAt && !TIME_RE.test(takenAt)) throw E(400, 'INVALID_INPUT', 'Invalid medicine time.')

  const needsKey = !!(medicine || note)
  const k = needsKey ? keyOrNull(ctx) : null
  if (needsKey && !k) throw E(503, 'ENCRYPTION_UNAVAILABLE', 'Medicine names and notes cannot be saved right now. Save the entry without them, or try again later.')

  const id = ctx.db.transaction(tx => {
    const r = tx.run(
      'INSERT INTO relief_entries (user_id, occurred_at, pain_before, pain_after, methods, medicine_taken_at) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, occurredAt, b.painBefore, b.painAfter ?? null, METHODS.filter(m => methods.has(m)).join(','), medicine ? takenAt : null])
    const entryId = Number(r.lastInsertRowid)
    if (needsKey) {
      const env = encrypt(JSON.stringify({ medicine: medicine || null, note: note || null }), { key: k.key, aad: aad(entryId, userId) })
      tx.run('UPDATE relief_entries SET ciphertext = ?, iv = ?, auth_tag = ?, key_id = ? WHERE entry_id = ? AND user_id = ?',
        [env.ciphertext, env.iv, env.authTag, k.keyId, entryId, userId])
    }
    return entryId
  })
  return entryView(ctx, ctx.db.get('SELECT * FROM relief_entries WHERE entry_id = ? AND user_id = ?', [id, userId]))
}

// Adds (or corrects) the pain-after rating of the patient's own entry
export function setPainAfter(ctx, userId, entryId, painAfter) {
  if (!isPain(painAfter)) throw E(400, 'INVALID_INPUT', 'Pain after must be a whole number from 0 to 10.')
  const row = ctx.db.get('SELECT entry_id FROM relief_entries WHERE entry_id = ? AND user_id = ?', [entryId, userId])
  if (!row) throw E(404, 'NOT_FOUND', 'Entry not found.')
  ctx.db.run('UPDATE relief_entries SET pain_after = ? WHERE entry_id = ? AND user_id = ?', [painAfter, entryId, userId])
  return entryView(ctx, ctx.db.get('SELECT * FROM relief_entries WHERE entry_id = ? AND user_id = ?', [entryId, userId]))
}

export function deleteEntry(ctx, userId, entryId) {
  const row = ctx.db.get('SELECT entry_id FROM relief_entries WHERE entry_id = ? AND user_id = ?', [entryId, userId])
  if (!row) throw E(404, 'NOT_FOUND', 'Entry not found.')
  ctx.db.run('DELETE FROM relief_entries WHERE entry_id = ? AND user_id = ?', [entryId, userId])
  return { id: entryId, deleted: true }
}
