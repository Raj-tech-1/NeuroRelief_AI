import { useTranslation } from 'react-i18next'
import { useFormat } from '../../i18n/format'
import { Icon } from '../icons'
import { addDays } from './shared'

// Compact summary of a report snapshot (the preview cards). Only values present in the snapshot are shown; averages are
// plain arithmetic over the listed records, and the one forward-looking value (next period) is labelled as an estimate.
// The full record tables stay in ReportDocument (shown below the cards and used for print / Save as PDF).
const avg = xs => { const v = xs.map(Number).filter(n => Number.isFinite(n)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const latest = (items, field) => [...items].filter(r => r[field] !== null && r[field] !== undefined && r[field] !== '').sort((a, b) => String(b.date || b.start_date).localeCompare(String(a.date || a.start_date)))[0] || null
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)

function Card({ icon, tone, title, children, badge }) {
  return (
    <div className="rounded-xl border border-brand-100 bg-white p-3.5 min-w-0">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${tone}`}><Icon name={icon} size={18} /></span>
        <h4 className="text-sm font-bold text-gray-900">{title}</h4>
        {badge}
      </div>
      {children}
    </div>
  )
}
function Rows({ rows }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
      {rows.map(([k, v, cls]) => [<dt key={`${k}-k`} className="text-gray-500">{k}</dt>, <dd key={`${k}-v`} className={`font-semibold text-gray-900 ${cls || ''}`}>{v}</dd>])}
    </dl>
  )
}

export default function ReportSummary({ snapshot, title, patientName, stateLabel }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const S = snapshot.sections || {}
  const n1 = v => fmt.number(Math.round(v * 10) / 10)
  const days = v => t('reportAudit.doc.days', { count: Math.round(v), n: fmt.number(Math.round(v)) })
  const none = key => <p className="text-xs text-gray-500">{S[key] ? t('reportAudit.sum.noData') : t('reportAudit.sum.notIncluded')}</p>
  const span = dayDiff(snapshot.period.from, snapshot.period.to) + 1

  // ---- cycles ----
  const cyc = S.cycles?.items || []
  const avgCycle = avg(cyc.map(c => c.cycle_length))
  const avgPeriod = avg(cyc.filter(c => c.start_date && c.end_date).map(c => dayDiff(c.start_date, c.end_date) + 1))
  const last = latest(cyc, 'start_date')
  const next = last && avgCycle ? addDays(last.start_date, Math.round(avgCycle)) : null
  // ---- wellness ----
  const wel = S.wellness?.items || []
  const sleepH = avg(wel.map(w => w.sleep_hours)), sleepQ = avg(wel.map(w => w.sleep_quality)), energy = avg(wel.map(w => w.energy)), stress = avg(wel.map(w => w.stress))
  const mood = latest(wel, 'mood')
  // ---- predictions ----
  const pred = latest(S.predictions?.items || [], 'predicted_severity')
  // ---- questionnaire ----
  const qs = S.questionnaire?.items || []
  const areas = [...new Set(qs.flatMap(q => String(q.body_areas || '').split(',').map(s => s.trim()).filter(Boolean)))]
  const lastQ = latest(qs, 'severity')

  return (
    <div className="space-y-3" data-summary>
      <div className="flex flex-wrap items-start gap-3 rounded-xl border border-brand-100 bg-white p-3.5">
        <span className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="heart" size={20} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-brand-700">NeuroRelief <span className="text-brand-500">AI</span></p>
          <p className="text-base font-bold text-gray-900 break-words">{title}</p>
          <p className="text-xs text-gray-500">{t('reportAudit.sum.generatedOn', { date: fmt.dateTime(snapshot.generatedAt) })}</p>
        </div>
        {stateLabel && <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-brand-50 text-brand-700 border border-brand-100">{stateLabel}</span>}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-brand-100 bg-white px-3.5 py-2.5">
          <p className="text-[11px] text-gray-500">{t('reportAudit.doc.patient')}</p>
          <p className="text-sm font-semibold text-gray-900 break-words">{patientName || '—'}</p>
        </div>
        <div className="rounded-xl border border-brand-100 bg-white px-3.5 py-2.5">
          <p className="text-[11px] text-gray-500">{t('reportAudit.doc.period')}</p>
          <p className="text-sm font-semibold text-gray-900">{fmt.isoDate(snapshot.period.from)} – {fmt.isoDate(snapshot.period.to)} <span className="font-normal text-gray-500">({days(span)})</span></p>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Card icon="calendar" tone="bg-brand-50 text-brand-600" title={t('reportAudit.sum.cycleTitle')}>
          {cyc.length === 0 ? none('cycles') : (
            <>
              <Rows rows={[
                [t('reportAudit.sum.avgCycle'), avgCycle !== null ? days(avgCycle) : '—'],
                [t('reportAudit.sum.periodLength'), avgPeriod !== null ? days(avgPeriod) : '—'],
                [t('reportAudit.sum.lastPeriod'), last ? fmt.isoDate(last.start_date) : '—'],
                [t('reportAudit.sum.nextExpected'), next ? fmt.isoDate(next) : '—'],
              ]} />
              <p className="text-[11px] text-gray-500 mt-2">{t('reportAudit.sum.basedOn', { count: cyc.length, n: fmt.number(cyc.length) })}{next ? ` ${t('reportAudit.sum.estimateNote')}` : ''}</p>
            </>
          )}
        </Card>
        <Card icon="heart" tone="bg-rose-50 text-rose-600" title={t('reportAudit.sum.wellnessTitle')}>
          {wel.length === 0 ? none('wellness') : (
            <>
              <Rows rows={[
                [t('reportAudit.sum.sleep'), sleepH !== null ? t('reportAudit.sum.hours', { n: n1(sleepH) }) : '—', 'text-emerald-700'],
                [t('reportAudit.sum.sleepQuality'), sleepQ !== null ? n1(sleepQ) : '—'],
                [t('reportAudit.sum.energy'), energy !== null ? n1(energy) : '—'],
                [t('reportAudit.sum.stress'), stress !== null ? n1(stress) : '—'],
                [t('reportAudit.sum.mood'), mood ? t(`moodValue.${mood.mood}`, { defaultValue: mood.mood }) : '—', 'text-amber-700'],
              ]} />
              <p className="text-[11px] text-gray-500 mt-2">{t('reportAudit.sum.basedOn', { count: wel.length, n: fmt.number(wel.length) })}</p>
            </>
          )}
        </Card>
        <Card icon="chart" tone="bg-purple-50 text-purple-600" title={t('reportAudit.sum.aiTitle')}
          badge={<span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">{t('reportAudit.sum.notDiagnosis')}</span>}>
          {!pred ? none('predictions') : (
            <>
              <Rows rows={[
                [t('reportAudit.sum.predicted'), t(`severity.${pred.predicted_severity}`, { defaultValue: pred.predicted_severity }), 'text-amber-700'],
                [t('reportAudit.sum.confidence'), pred.confidence !== null && pred.confidence !== undefined ? `${fmt.number(Number(pred.confidence) <= 1 ? Math.round(Number(pred.confidence) * 100) : Math.round(Number(pred.confidence)))}%` : '—'],
                [t('reportAudit.sum.predDate'), fmt.isoDate(String(pred.date).slice(0, 10))],
              ]} />
              <p className="text-[11px] text-gray-500 mt-2">{t('reportAudit.doc.aiNote')}</p>
            </>
          )}
        </Card>
        <Card icon="list" tone="bg-sky-50 text-sky-600" title={t('reportAudit.sum.symptomsTitle')}>
          {qs.length === 0 ? none('questionnaire') : (
            <>
              {areas.length > 0 && <ul className="flex flex-wrap gap-1.5 mb-2">{areas.map(a => <li key={a} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-700">{a}</li>)}</ul>}
              <Rows rows={[[t('reportAudit.sum.severity'), lastQ ? `${fmt.number(lastQ.severity)}/10` : '—']]} />
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
