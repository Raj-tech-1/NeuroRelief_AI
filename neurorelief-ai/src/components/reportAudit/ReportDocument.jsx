import { useTranslation } from 'react-i18next'
import { useFormat } from '../../i18n/format'
import { SECTION_KEYS } from './shared'

// Renders a report snapshot exactly as the server produced it: only recorded values, nothing computed or invented.
// The same markup is shown on screen and in the print/PDF view (index.css `.rpt` rules adapt it for paper).
//   column = [snapshotField, labelKey, formatter]
const SECTIONS = {
  cycles: { cols: [['start_date', 'startDate', 'date'], ['end_date', 'endDate', 'date'], ['cycle_length', 'cycleLength', 'days'], ['flow', 'flow', 'flow'], ['mood', 'mood', 'mood']], free: [['notes', 'notes']] },
  wellness: { cols: [['date', 'date', 'date'], ['mood', 'mood', 'mood'], ['energy', 'energy', 'num'], ['stress', 'stress', 'num'], ['sleep_quality', 'sleepQuality', 'num'], ['sleep_hours', 'sleepHours', 'num']], free: [['note', 'notes']] },
  predictions: { cols: [['date', 'date', 'date'], ['predicted_severity', 'predictedSeverity', 'severity'], ['confidence', 'confidence', 'pct'], ['recommended_tens_intensity', 'tens', 'num'], ['recommended_heat_temp', 'heat', 'temp']], free: [] },
  questionnaire: { cols: [['date', 'date', 'date'], ['life_stage', 'lifeStage', 'raw'], ['body_areas', 'areas', 'raw'], ['severity', 'severity', 'outOf10']], free: [['symptom_description', 'description'], ['medications', 'medications'], ['notes', 'notes']] },
}
// What the server says is not part of the report -> translation key (anything else is shown verbatim)
const NOT_INCLUDED = {
  'symptom log (not recorded by the app)': 'symptomLog',
  'device therapy and pain-rating history (stored only on your device)': 'deviceHistory',
}

export default function ReportDocument({ snapshot, title, meta }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const dash = '—'
  const cell = (kind, v) => {
    if (v === null || v === undefined || v === '') return dash
    switch (kind) {
      case 'date': return fmt.isoDate(String(v).slice(0, 10))
      case 'flow': return t(`flowValue.${v}`, { defaultValue: v })
      case 'mood': return t(`moodValue.${v}`, { defaultValue: v })
      case 'severity': return t(`severity.${v}`, { defaultValue: v })
      case 'days': return t('reportAudit.doc.days', { count: Number(v), n: fmt.number(v) })
      case 'pct': return `${fmt.number(Number(v) <= 1 ? Math.round(Number(v) * 100) : Math.round(Number(v)))}%`
      case 'temp': return `${fmt.number(v)} °C`
      case 'outOf10': return `${fmt.number(v)}/10`
      case 'num': return fmt.number(v)
      default: return String(v)
    }
  }
  const { from, to } = snapshot.period
  const shown = SECTION_KEYS.filter(k => snapshot.sections?.[k])
  return (
    <article className="rpt" aria-label={title}>
      <header className="rpt-head">
        <p className="rpt-brand">NeuroRelief AI</p>
        <h2 className="rpt-title">{title}</h2>
        <dl className="rpt-meta">
          {meta?.patientName && <div><dt>{t('reportAudit.doc.patient')}</dt><dd>{meta.patientName}</dd></div>}
          <div><dt>{t('reportAudit.doc.period')}</dt><dd>{fmt.isoDate(from)} – {fmt.isoDate(to)}</dd></div>
          <div><dt>{t('reportAudit.doc.generated')}</dt><dd>{fmt.dateTime(snapshot.generatedAt)}</dd></div>
          <div><dt>{t('reportAudit.doc.state')}</dt><dd>{meta?.preview ? t('reportAudit.doc.statePreview') : meta?.shared ? t('reportAudit.doc.stateShared') : t('reportAudit.doc.stateSaved', { id: meta?.reportId })}</dd></div>
        </dl>
      </header>

      <div className="rpt-notice" role="note">
        <p className="rpt-notice-title">{t('reportAudit.doc.noticeTitle')}</p>
        <ul>
          {(snapshot.notices || []).map(n => (
            <li key={n}>{n === 'not_doctor_verified' && meta?.verified
              ? t('reportAudit.doc.notice.verified', { doctor: meta.verified.doctor, date: meta.verified.date })   // reflects the report's CURRENT status
              : t(`reportAudit.doc.notice.${n}`, { defaultValue: n })}</li>
          ))}
        </ul>
      </div>

      {shown.map(key => {
        const def = SECTIONS[key], sec = snapshot.sections[key]
        const cols = [...def.cols, ...(snapshot.includesFreeText ? def.free.map(([f, l]) => [f, l, 'raw']) : [])]
        return (
          <section key={key} className="rpt-section" aria-labelledby={`rpt-h-${key}`}>
            <div className="rpt-section-head">
              <h3 id={`rpt-h-${key}`}>{t(`reportAudit.section.${key}`)}</h3>
              {key === 'predictions' && <span className="rpt-ai">{t('reportAudit.doc.aiBadge')}</span>}
              <span className="rpt-count">{t('reportAudit.doc.records', { count: sec.count, n: fmt.number(sec.count) })}</span>
            </div>
            {key === 'predictions' && <p className="rpt-ai-note">{t('reportAudit.doc.aiNote')}</p>}
            {sec.count === 0 ? (
              <p className="rpt-empty">{t('reportAudit.doc.noRecords')}</p>
            ) : (
              <div className="rpt-table-wrap">
                <table>
                  <thead><tr>{cols.map(([f, l]) => <th key={f} scope="col">{t(`reportAudit.col.${l}`)}</th>)}</tr></thead>
                  <tbody>
                    {sec.items.map((row, i) => (
                      <tr key={i}>{cols.map(([f, , kind]) => <td key={f}>{cell(kind, row[f])}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {sec.truncated && <p className="rpt-empty">{t('reportAudit.doc.truncated')}</p>}
          </section>
        )
      })}

      <footer className="rpt-foot">
        {snapshot.includesFreeText && <p>{t('reportAudit.doc.includesNotes')}</p>}
        {(snapshot.notIncluded || []).length > 0 && (
          <>
            <p className="rpt-foot-title">{t('reportAudit.doc.notIncludedTitle')}</p>
            <ul>{snapshot.notIncluded.map(s => <li key={s}>{NOT_INCLUDED[s] ? t(`reportAudit.doc.notIncluded.${NOT_INCLUDED[s]}`) : s}</li>)}</ul>
          </>
        )}
        <p>{t('reportAudit.doc.footerNote')}</p>
      </footer>
    </article>
  )
}
