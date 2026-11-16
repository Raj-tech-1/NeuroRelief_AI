import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../icons'
import { getDoctorTherapyPlan, createTherapyPlan, revokeTherapyPlan } from '../../services/api'

// Doctor's therapy plan for one patient (English-only, like the rest of the Doctor Portal).
// Heat limits are HARD caps enforced by the app (and later the device): never above 40 °C or 20 minutes.
// TENS values are a recommendation shown to the patient; there is no numeric intensity limit, only guidance.
const navy = 'text-[#1f2a44]'
const input = 'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200'

function NumberField({ id, label, value, onChange, min, max, step = 1, unit, error }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-slate-600 mb-1">{label}</label>
      <div className="relative">
        <input id={id} type="number" value={value} min={min} max={max} step={step} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          aria-invalid={!!error} className={`${input} pr-12 ${error ? 'border-red-300' : ''}`} />
        {unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{unit}</span>}
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}

export default function TherapyPlanCard({ patientId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState(null)
  const [fieldErr, setFieldErr] = useState({})
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState('')

  const load = useCallback(() => {
    setError('')
    getDoctorTherapyPlan(patientId).then(setData).catch(err => setError(err.message))
  }, [patientId])
  useEffect(() => { setData(null); setForm(null); load() }, [load])

  function startEdit() {
    const p = data?.plan || data?.standardPlan || {}
    setForm({ heatMinC: p.heatMinC ?? 38, heatMaxC: p.heatMaxC ?? 39, heatMaxMinutes: p.heatMaxMinutes ?? 20, tensFreqMin: p.tensFreqMin ?? 1, tensFreqMax: p.tensFreqMax ?? 150, sessionsPerDay: p.sessionsPerDay ?? '', validDays: 30, note: '' })
    setFieldErr({})
  }
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setFieldErr(e => ({ ...e, [k]: undefined })) }

  async function save() {
    setSaving(true); setError('')
    try {
      await createTherapyPlan(patientId, { ...form, sessionsPerDay: form.sessionsPerDay === '' ? null : form.sessionsPerDay, note: form.note.trim() || undefined })
      setForm(null); setFlash('Plan saved. The patient sees it on their Device page.'); setTimeout(() => setFlash(''), 3500)
      load()
    } catch (err) {
      if (err.field) setFieldErr({ [err.field]: err.message })
      else setError(err.message)
    } finally { setSaving(false) }
  }
  async function revoke() {
    setSaving(true); setError('')
    try { await revokeTherapyPlan(patientId); setFlash('Plan ended. The standard safety limits apply again.'); setTimeout(() => setFlash(''), 3500); load() }
    catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const abs = data?.absolute
  const plan = data?.plan
  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h3 className={`text-lg font-bold ${navy}`}>Therapy plan</h3>
          <p className="text-sm text-slate-500">Heat limits are enforced by the app (hard caps: {abs?.heatMaxC ?? 40} °C, {abs?.heatMaxMinutes ?? 20} min per session). TENS values are shown to the patient as a recommendation.</p>
        </div>
        {data && !form && (
          <div className="flex gap-2">
            <button onClick={startEdit} className="h-9 px-3 rounded-xl bg-gradient-to-r from-brand-400 to-brand-600 text-white text-sm font-semibold inline-flex items-center gap-1.5"><Icon name="plus" size={15} /> {plan ? 'New plan' : 'Set a plan'}</button>
            {plan && <button onClick={revoke} disabled={saving} className="h-9 px-3 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">End plan</button>}
          </div>
        )}
      </div>

      {flash && <p role="status" className="mb-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3.5 py-2">{flash}</p>}
      {error && <p role="alert" className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2">{error}</p>}

      {!data ? (!error && <p className="text-sm text-slate-500">Loading…</p>) : form ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <NumberField id="tp-hmin" label="Heat from" unit="°C" value={form.heatMinC} onChange={v => set('heatMinC', v)} min={abs.heatMinC} max={abs.heatMaxC} step={0.5} error={fieldErr.heatMinC} />
            <NumberField id="tp-hmax" label={`Heat up to (max ${abs.heatMaxC})`} unit="°C" value={form.heatMaxC} onChange={v => set('heatMaxC', v)} min={abs.heatMinC} max={abs.heatMaxC} step={0.5} error={fieldErr.heatMaxC} />
            <NumberField id="tp-min" label={`Minutes per session (max ${abs.heatMaxMinutes})`} unit="min" value={form.heatMaxMinutes} onChange={v => set('heatMaxMinutes', v)} min={1} max={abs.heatMaxMinutes} error={fieldErr.heatMaxMinutes} />
            <NumberField id="tp-fmin" label="TENS from" unit="Hz" value={form.tensFreqMin} onChange={v => set('tensFreqMin', v)} min={abs.tensFreqMin} max={abs.tensFreqMax} error={fieldErr.tensFreqMin} />
            <NumberField id="tp-fmax" label="TENS up to" unit="Hz" value={form.tensFreqMax} onChange={v => set('tensFreqMax', v)} min={abs.tensFreqMin} max={abs.tensFreqMax} error={fieldErr.tensFreqMax} />
            <NumberField id="tp-spd" label="Sessions per day (optional)" value={form.sessionsPerDay} onChange={v => set('sessionsPerDay', v)} min={1} max={abs.sessionsPerDayMax} error={fieldErr.sessionsPerDay} />
            <NumberField id="tp-days" label="Valid for" unit="days" value={form.validDays} onChange={v => set('validDays', v)} min={1} max={abs.planMaxDays} error={fieldErr.validDays} />
          </div>
          <p className="text-xs text-slate-600 bg-purple-50 border border-purple-100 rounded-xl px-3 py-2"><span className="font-semibold">TENS intensity:</span> no numeric limit — the patient is told: “{data.tensGuidance}”</p>
          <div>
            <label htmlFor="tp-note" className="block text-xs font-semibold text-slate-600 mb-1">Note for the patient (optional, stored encrypted)</label>
            <textarea id="tp-note" rows={2} maxLength={500} value={form.note} onChange={e => set('note', e.target.value)} className={input} />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setForm(null)} className="h-10 px-4 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={save} disabled={saving} className="h-10 px-5 rounded-xl bg-gradient-to-r from-brand-400 to-brand-600 text-white text-sm font-semibold disabled:opacity-50">{saving ? 'Saving…' : 'Save plan'}</button>
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl border border-orange-100 bg-orange-50/60 p-3">
            <p className="font-semibold text-orange-900 flex items-center gap-1.5"><Icon name="drop" size={15} /> Heat (enforced)</p>
            <p className="text-slate-700 mt-1">{data.limits.heatMinC}–{data.limits.heatMaxC} °C · up to {data.limits.heatMaxMinutes} min per session{data.limits.sessionsPerDay ? ` · ${data.limits.sessionsPerDay}× per day` : ''}</p>
          </div>
          <div className="rounded-xl border border-purple-100 bg-purple-50/60 p-3">
            <p className="font-semibold text-purple-900 flex items-center gap-1.5"><Icon name="bolt" size={15} /> TENS (recommendation)</p>
            <p className="text-slate-700 mt-1">{data.limits.tensFreqMin}–{data.limits.tensFreqMax} Hz · {data.tensGuidance}</p>
          </div>
          <p className="sm:col-span-2 text-xs text-slate-500">
            {plan ? `Your plan from ${new Date(plan.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString()}, valid until ${new Date(plan.validUntil).toLocaleDateString()}.` : 'No plan set: the standard safety limits apply.'}
            {plan?.note ? ` Note: “${plan.note}”` : ''}
          </p>
          {data.history?.length > 1 && <p className="sm:col-span-2 text-xs text-slate-400">{data.history.length - (plan ? 1 : 0)} earlier plan(s) kept for the record.</p>}
        </div>
      )}
    </section>
  )
}
