import { useTranslation } from 'react-i18next'
import { useFormat } from '../../i18n/format'
import { Icon } from '../icons'

const card = 'bg-white/90 rounded-2xl border border-brand-100/70 shadow-sm shadow-brand-100/50'

// Four counters computed from the patient's real report list (never hardcoded).
export default function ReportStats({ items }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const n = f => items.filter(f).length
  const cards = [
    ['total', 'doc', 'bg-brand-50 text-brand-600', items.length],
    ['pending', 'clock', 'bg-amber-50 text-amber-600', n(r => r.status === 'submitted' || r.status === 'under_review')],
    ['verified', 'check', 'bg-emerald-50 text-emerald-600', n(r => r.status === 'verified')],
    ['changes', 'message', 'bg-purple-50 text-purple-600', n(r => r.status === 'changes_requested')],
  ]
  return (
    <ul className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label={t('reportAudit.stats.label')} data-stats>
      {cards.map(([k, icon, tone, value]) => (
        <li key={k} className={`${card} p-4 flex items-center gap-3 min-w-0`} data-stat={k}>
          <span className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${tone}`}><Icon name={icon} size={24} /></span>
          <div className="min-w-0">
            <p className="text-2xl font-bold text-gray-900 leading-none" data-stat-value>{fmt.number(value)}</p>
            <p className="text-sm font-semibold text-gray-800 mt-1 break-words">{t(`reportAudit.stats.${k}`)}</p>
            <p className="text-xs text-gray-500 break-words">{t(`reportAudit.stats.${k}Sub`)}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
