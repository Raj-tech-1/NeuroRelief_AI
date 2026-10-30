import { useTranslation } from 'react-i18next'
import { Icon } from '../icons'

// Text + icon (never colour alone). Statuses come from the backend; 'draft' means saved but not shared with anyone.
const STYLE = {
  draft: ['bg-gray-100 text-gray-700 border-gray-200', 'list'],
  submitted: ['bg-brand-50 text-brand-700 border-brand-100', 'send'],
  under_review: ['bg-amber-50 text-amber-800 border-amber-200', 'clock'],
  changes_requested: ['bg-orange-50 text-orange-800 border-orange-200', 'retry'],
  verified: ['bg-emerald-50 text-emerald-800 border-emerald-200', 'check'],
  revoked: ['bg-gray-100 text-gray-600 border-gray-200', 'ban'],
}

export default function StatusChip({ status }) {
  const { t } = useTranslation()
  const [cls, icon] = STYLE[status] || STYLE.draft
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border whitespace-nowrap ${cls}`}>
      <Icon name={icon} size={12} />{t(`reportAudit.status.${STYLE[status] ? status : 'draft'}`)}
    </span>
  )
}
