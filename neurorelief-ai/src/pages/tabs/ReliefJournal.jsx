import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '../../components/icons'
import { useFormat } from '../../i18n/format'
import { getJournal, addJournalEntry, setJournalPainAfter, deleteJournalEntry } from '../../services/api'

// Relief Journal: what the patient tried and how the pain changed. Medicines are logged by name and time only —
// there is deliberately no dose field and the app gives no dosing advice. The "what helped" summary only describes
// the patient's own entries. Device-panel sessions appear automatically (read-only).
const card = 'bg-white/90 rounded-2xl border border-brand-100/70 shadow-sm shadow-brand-100/50'
const field = 'w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100'
const METHOD_ICON = { heat: 'drop', tens: 'bolt', rest: 'moon', stretching: 'heart', hydration: 'drop', medicine: 'plus', other: 'list' }
const nowLocal = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }

function PainPicker({ id, label, value, onChange, optional, t }) {
  return (
    <fieldset>
      <legend className="block text-sm font-medium text-gray-700 mb-1.5">{label}</legend>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {optional && (
          <button type="button" role="radio" aria-checked={value == null} onClick={() => onChange(null)}
            className={`h-9 px-3 rounded-lg text-xs font-semibold border transition ${value == null ? 'bg-brand-600 text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:bg-brand-50'}`}>{t('journal.later')}</button>
        )}
        {Array.from({ length: 11 }, (_, n) => (
          <button key={n} id={n === 0 ? id : undefined} type="button" role="radio" aria-checked={value === n} onClick={() => onChange(n)}
            className={`w-9 h-9 rounded-lg text-sm font-semibold border transition ${value === n ? 'bg-brand-600 text-white border-transparent' : 'bg-white text-gray-700 border-gray-200 hover:bg-brand-50'}`}>{n}</button>
        ))}
      </div>
    </fieldset>
  )
}

export default function ReliefJournal() {
  const { t } = useTranslation()
  const fmt = useFormat()
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const empty = { occurredAt: nowLocal(), painBefore: 5, painAfter: null, methods: [], medicine: '', medicineTakenAt: '', note: '' }
  const [f, setF] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)   // { ok, text }
  const [afterFor, setAfterFor] = useState(null)   // entry id being completed with a pain-after rating

  const load = useCallback(() => {
    setLoadError(false)
    getJournal().then(setData).catch(() => setLoadError(true))
  }, [])
  useEffect(() => { load() }, [load])

  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const toggle = m => set('methods', f.methods.includes(m) ? f.methods.filter(x => x !== m) : [...f.methods, m])
  const tMethod = m => t(`journal.method.${m}`)
  const when = s => { const d = new Date(s); return Number.isNaN(d.getTime()) ? s : d.toLocaleString(fmt.locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) }

  async function save(e) {
    e.preventDefault()
    if (saving) return
    setMsg(null)
    if (!f.methods.length && !f.medicine.trim()) { setMsg({ ok: false, text: t('journal.pickMethod') }); return }
    setSaving(true)
    try {
      await addJournalEntry({ ...f, medicine: f.medicine.trim() || undefined, medicineTakenAt: f.medicine.trim() && f.medicineTakenAt ? f.medicineTakenAt : undefined, note: f.note.trim() || undefined })
      setF({ ...empty, occurredAt: nowLocal() })
      setMsg({ ok: true, text: t('journal.saved') })
      setTimeout(() => setMsg(null), 2500)
      load()
    } catch (err) {
      setMsg({ ok: false, text: err.code === 'ENCRYPTION_UNAVAILABLE' ? t('journal.noEncryption') : err.message || t('journal.saveFailed') })
    } finally {
      setSaving(false)
    }
  }

  async function addAfter(id, n) {
    try { await setJournalPainAfter(id, n); setAfterFor(null); load() } catch { setMsg({ ok: false, text: t('journal.saveFailed') }) }
  }
  async function remove(id) {
    try { await deleteJournalEntry(id); load() } catch { setMsg({ ok: false, text: t('journal.saveFailed') }) }
  }

  const methods = data?.methods || ['heat', 'tens', 'rest', 'stretching', 'hydration', 'medicine', 'other']

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-brand-100/90 via-brand-50 to-brand-100/60 border border-brand-100/70 p-6 md:p-8">
        <p className="text-xs font-semibold tracking-[0.2em] uppercase text-brand-600 mb-2">{t('journal.tagline')}</p>
        <h2 className="hero-title font-display text-3xl md:text-4xl font-bold text-brand-900 leading-tight">{t('journal.title')}</h2>
        <p className="text-gray-600 mt-3 max-w-xl">{t('journal.heroText')}</p>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-5">
        {/* ---------- New entry ---------- */}
        <form onSubmit={save} className={`${card} p-5 space-y-4`} aria-label={t('journal.newEntry')}>
          <h3 className="font-bold text-gray-900 text-lg">{t('journal.newEntry')}</h3>
          <div>
            <label htmlFor="rj-when" className="block text-sm font-medium text-gray-700 mb-1.5">{t('journal.when')}</label>
            <input id="rj-when" type="datetime-local" value={f.occurredAt} max={nowLocal()} onChange={e => set('occurredAt', e.target.value)} className={field} />
          </div>
          <PainPicker id="rj-before" label={t('journal.painBefore')} value={f.painBefore} onChange={v => set('painBefore', v)} t={t} />

          <fieldset>
            <legend className="block text-sm font-medium text-gray-700 mb-1.5">{t('journal.whatTried')}</legend>
            <div className="flex flex-wrap gap-2">
              {methods.map(m => {
                const on = f.methods.includes(m)
                return (
                  <button key={m} type="button" aria-pressed={on} onClick={() => toggle(m)}
                    className={`h-9 px-3 rounded-xl text-sm font-medium border inline-flex items-center gap-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${on ? 'bg-brand-600 text-white border-transparent' : 'bg-white text-gray-700 border-gray-200 hover:bg-brand-50'}`}>
                    <Icon name={METHOD_ICON[m] || 'list'} size={14} /> {tMethod(m)}
                  </button>
                )
              })}
            </div>
          </fieldset>

          {/* Medicine: name and time only. No dose field, no dosing advice. */}
          <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-3 space-y-2.5">
            <p className="text-sm font-semibold text-gray-800">{t('journal.medicineTitle')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_130px] gap-2">
              <div>
                <label htmlFor="rj-med" className="sr-only">{t('journal.medicineName')}</label>
                <input id="rj-med" value={f.medicine} maxLength={60} onChange={e => set('medicine', e.target.value)} placeholder={t('journal.medicineName')} className={field} />
              </div>
              <div>
                <label htmlFor="rj-medtime" className="sr-only">{t('journal.medicineTime')}</label>
                <input id="rj-medtime" type="time" value={f.medicineTakenAt} onChange={e => set('medicineTakenAt', e.target.value)} disabled={!f.medicine.trim()} aria-label={t('journal.medicineTime')} className={`${field} disabled:opacity-50`} />
              </div>
            </div>
            <p className="text-xs text-gray-600 flex gap-1.5"><Icon name="shield" size={14} className="shrink-0 mt-0.5 text-brand-600" />{t('journal.noDosing')}</p>
          </div>

          <PainPicker id="rj-after" label={t('journal.painAfter')} value={f.painAfter} onChange={v => set('painAfter', v)} optional t={t} />

          <div>
            <label htmlFor="rj-note" className="block text-sm font-medium text-gray-700 mb-1.5">{t('journal.note')}</label>
            <textarea id="rj-note" rows={2} maxLength={500} value={f.note} onChange={e => set('note', e.target.value)} placeholder={t('journal.notePh')} className={field} />
            <p className="text-[11px] text-gray-400 mt-1">{t('journal.privateHint')}</p>
          </div>

          {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm font-medium ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}
          <button type="submit" disabled={saving}
            className="w-full py-2.5 bg-brand-700 hover:bg-brand-800 text-white rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300">
            <Icon name="plus" size={16} /> {saving ? t('common.saving') : t('journal.save')}
          </button>
        </form>

        <div className="space-y-5 min-w-0">
          {/* ---------- What helped (descriptive) ---------- */}
          <section className={`${card} p-5`} aria-label={t('journal.helpedTitle')}>
            <h3 className="font-bold text-gray-900 text-lg">{t('journal.helpedTitle')}</h3>
            <p className="text-xs text-gray-500 mb-3">{t('journal.helpedHint')}</p>
            {!data ? <p className="text-sm text-gray-500">{loadError ? t('journal.loadFailed') : t('common.loading')}</p>
              : data.summary.length === 0 ? <p className="text-sm text-gray-500">{t('journal.helpedEmpty')}</p> : (
                <ul className="space-y-2">
                  {data.summary.map(s => (
                    <li key={s.method} className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center shrink-0"><Icon name={METHOD_ICON[s.method] || 'list'} size={15} /></span>
                      <span className="w-28 shrink-0 text-sm text-gray-800">{tMethod(s.method)}</span>
                      <span className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
                        <span className={`block h-full rounded-full ${s.avgReduction > 0 ? 'bg-green-400' : 'bg-gray-300'}`} style={{ width: `${Math.min(100, Math.max(0, s.avgReduction) * 10)}%` }} />
                      </span>
                      <span className="w-40 text-right text-xs text-gray-600">{t('journal.avgChange', { change: fmt.number(s.avgReduction), count: s.entries })}</span>
                    </li>
                  ))}
                </ul>
              )}
          </section>

          {/* ---------- History ---------- */}
          <section className={`${card} p-5`} aria-label={t('journal.historyTitle')}>
            <h3 className="font-bold text-gray-900 text-lg mb-3">{t('journal.historyTitle')}</h3>
            {!data ? null : data.entries.length === 0 ? <p className="text-sm text-gray-500">{t('journal.empty')}</p> : (
              <ul className="divide-y divide-gray-100">
                {data.entries.map(e => (
                  <li key={e.id} className="py-3 flex gap-3">
                    <span className="w-12 shrink-0 text-center">
                      <span className="block text-lg font-bold text-brand-800">{e.painBefore}<span className="text-gray-400">→</span>{e.painAfter ?? '?'}</span>
                      <span className="block text-[10px] text-gray-500">{t('journal.painShort')}</span>
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-500">{when(e.occurredAt)}{e.source === 'device' && <span className="ml-2 px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 font-medium">{t('journal.fromDevice')}</span>}</p>
                      <p className="mt-1 flex flex-wrap gap-1.5">{e.methods.map(m => <span key={m} className="text-xs px-2 py-0.5 rounded-full bg-brand-50 text-brand-700">{tMethod(m)}</span>)}</p>
                      {e.medicine && <p className="text-sm text-gray-700 mt-1">{t('journal.medicineLine', { name: e.medicine })}{e.medicineTakenAt ? ` · ${e.medicineTakenAt}` : ''}</p>}
                      {e.source === 'device' && e.heatTempC != null && <p className="text-xs text-gray-500 mt-1">{t('journal.deviceHeat', { temp: fmt.number(e.heatTempC), min: fmt.number(Math.round((e.durationSeconds || 0) / 60)) })}</p>}
                      {e.note && <p className="text-sm text-gray-600 mt-1 break-words">{e.note}</p>}
                      {e.privateUnavailable && <p className="text-xs text-amber-700 mt-1">{t('journal.privateUnavailable')}</p>}
                      {e.source === 'journal' && e.painAfter == null && (afterFor === e.id ? (
                        <div className="mt-2 flex flex-wrap gap-1" aria-label={t('journal.painAfter')}>
                          {Array.from({ length: 11 }, (_, n) => <button key={n} type="button" onClick={() => addAfter(e.id, n)} className="w-8 h-8 rounded-lg text-xs font-semibold border border-gray-200 hover:bg-brand-50">{n}</button>)}
                        </div>
                      ) : <button type="button" onClick={() => setAfterFor(e.id)} className="mt-1.5 text-xs font-semibold text-brand-700 hover:underline">{t('journal.addAfter')}</button>)}
                    </div>
                    {e.source === 'journal' && (
                      <button type="button" onClick={() => remove(e.id)} aria-label={t('journal.delete')} className="self-start p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"><Icon name="trash" size={16} /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
