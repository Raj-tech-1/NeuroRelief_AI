import { useTranslation } from 'react-i18next'
import { Icon } from '../icons'

// Shown whenever the backend does not offer Report Audit (not configured, older server, or unreachable).
// It makes NO claim that anything can be generated, saved or shared. `problem` adds a banner for connection/session failures.
const card = 'bg-white/90 rounded-2xl border border-brand-100/70 shadow-sm shadow-brand-100/50'
const FEATURES = ['generate', 'share', 'verify']
const PLAN = ['p1', 'p2', 'p3', 'p4']

export default function ReportAuditPlaceholder({ onTabChange, problem, onRetry }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-5 max-w-[900px]">
      {problem && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="flex-1 basis-56">{t(problem === 'session' ? 'reportAudit.err.session' : 'reportAudit.err.network')}</span>
          <button type="button" onClick={onRetry} className="px-3 py-1.5 rounded-lg border border-rose-300 bg-white text-rose-800 text-xs font-semibold hover:bg-rose-100">{t('common.retry')}</button>
        </div>
      )}
      <section className={`${card} p-5 sm:p-6`} aria-labelledby="audit-h">
        <div className="flex flex-wrap items-start gap-4">
          <span className="shrink-0 w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="doc" size={28} /></span>
          <div className="min-w-0 flex-1 basis-64">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h2 id="audit-h" className="font-display text-xl font-bold text-gray-900 leading-tight">{t('audit.title')}</h2>
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">{t('audit.comingSoon')}</span>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">{t('audit.intro')}</p>
          </div>
        </div>
      </section>

      <section className={`${card} p-5 sm:p-6`} aria-labelledby="audit-status-h">
        <h2 id="audit-status-h" className="font-display text-lg font-bold text-gray-900 mb-3">{t('audit.statusTitle')}</h2>
        <ul className="divide-y divide-brand-100/70">
          {FEATURES.map(f => (
            <li key={f} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="text-sm font-medium text-gray-800">{t(`audit.feature.${f}`)}</span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">{t('audit.notConfigured')}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-500 mt-3">{t('audit.nothingYet')}</p>
      </section>

      <section className={`${card} p-5 sm:p-6`} aria-labelledby="audit-plan-h">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <h2 id="audit-plan-h" className="font-display text-lg font-bold text-gray-900">{t('audit.planTitle')}</h2>
          <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-100">{t('audit.plannedLabel')}</span>
        </div>
        <ol className="space-y-2.5">
          {PLAN.map((p, i) => (
            <li key={p} className="flex items-start gap-3">
              <span aria-hidden="true" className="shrink-0 w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
              <span className="text-sm text-gray-700 leading-relaxed">{t(`audit.plan.${p}`)}</span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-gray-600 bg-brand-50/70 rounded-xl px-3 py-2 mt-4">{t('audit.safety')}</p>
      </section>

      <section className={`${card} p-5 sm:p-6 flex flex-wrap items-center justify-between gap-3`} aria-labelledby="audit-meanwhile-h">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id="audit-meanwhile-h" className="font-display text-lg font-bold text-gray-900">{t('audit.meanwhileTitle')}</h2>
          <p className="text-sm text-gray-600 mt-0.5">{t('audit.meanwhileText')}</p>
        </div>
        <button onClick={() => onTabChange && onTabChange('doctor')}
          className="shrink-0 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 text-white text-sm font-semibold hover:opacity-95 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200">
          {t('audit.goDoctor')} <Icon name="arrow" size={16} />
        </button>
      </section>
    </div>
  )
}
