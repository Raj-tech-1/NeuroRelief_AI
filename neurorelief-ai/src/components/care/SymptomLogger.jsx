import { useState } from 'react'
import { Icon } from '../icons'
import { addSymptom, getMySymptoms } from '../../services/api'
import { useCareStatus, usePolled, ErrorNote, fmtDay, localToday } from './shared'

const TYPES = ['Cramps', 'Back pain', 'Headache', 'Bloating', 'Fatigue', 'Nausea', 'Breast tenderness', 'Other']

/** Patient: record a symptom with pain intensity (0–10). Stored in the existing symptoms table; only shared with a
 *  doctor if the patient explicitly grants the "Recorded symptoms" or "Pain intensity" category. */
export default function SymptomLogger() {
  const care = useCareStatus()
  const list = usePolled(() => getMySymptoms(), [], { enabled: care.enabled })
  const [type, setType] = useState('Cramps')
  const [severity, setSeverity] = useState(5)
  const [date, setDate] = useState(localToday())
  const [area, setArea] = useState('')
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  if (care.loading || !care.enabled) return null

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    setSaving(true); setError(null); setSaved(false)
    try {
      await addSymptom({ date, type, severity: Number(severity), bodyArea: area || undefined, description: desc || undefined })
      setDesc(''); setArea(''); setSaved(true)
      list.reload()
    } catch (err) { setError(err) } finally { setSaving(false) }
  }

  return (
    <section className="bg-white rounded-2xl border border-brand-100 shadow-sm p-5" aria-labelledby="sym-h">
      <h2 id="sym-h" className="font-bold text-gray-900 flex items-center gap-2"><Icon name="drop" size={18} className="text-brand-600" /> Symptoms & pain log</h2>
      <p className="text-xs text-gray-500 mt-0.5">Private to you. A doctor sees these only if you share them from an appointment.</p>
      <div className="grid lg:grid-cols-2 gap-5 mt-4">
        <form onSubmit={submit} className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-sm text-gray-700 flex flex-col gap-1">Symptom
              <select value={type} onChange={e => setType(e.target.value)} className="rounded-lg border border-brand-100 px-2 py-2">{TYPES.map(x => <option key={x}>{x}</option>)}</select>
            </label>
            <label className="text-sm text-gray-700 flex flex-col gap-1">Date
              <input type="date" value={date} max={localToday()} onChange={e => setDate(e.target.value)} className="rounded-lg border border-brand-100 px-2 py-2" />
            </label>
          </div>
          <label className="text-sm text-gray-700 block">Pain intensity: <strong>{severity}/10</strong>
            <input type="range" min="0" max="10" value={severity} onChange={e => setSeverity(e.target.value)} className="w-full accent-brand-600" />
          </label>
          <label className="text-sm text-gray-700 flex flex-col gap-1">Body area (optional)
            <input value={area} maxLength={60} onChange={e => setArea(e.target.value)} className="rounded-lg border border-brand-100 px-2 py-2" />
          </label>
          <label className="text-sm text-gray-700 flex flex-col gap-1">Notes (optional)
            <textarea value={desc} maxLength={500} rows={2} onChange={e => setDesc(e.target.value)} className="rounded-lg border border-brand-100 px-2 py-2" />
          </label>
          <ErrorNote error={error} />
          {saved && <p role="status" className="text-sm text-emerald-700">Saved.</p>}
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save symptom'}</button>
        </form>
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Recent entries</h3>
          {!list.data?.length ? <p className="text-sm text-gray-500">No symptoms recorded yet.</p> : (
            <ul className="space-y-1.5 max-h-72 overflow-y-auto">
              {list.data.slice(0, 15).map(s => (
                <li key={s.symptomId} className="flex items-center justify-between gap-3 rounded-xl border border-brand-50 px-3 py-2 text-sm">
                  <span className="min-w-0"><span className="font-medium text-gray-900">{s.type}</span>{s.bodyArea ? <span className="text-gray-500"> · {s.bodyArea}</span> : null}<span className="block text-xs text-gray-500">{fmtDay(s.date)}</span></span>
                  <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${s.severity >= 7 ? 'bg-rose-100 text-rose-700' : s.severity >= 4 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{s.severity}/10</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
