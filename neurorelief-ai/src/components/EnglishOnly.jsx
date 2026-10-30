import { useTranslation } from 'react-i18next'

// Small marker for text the app only has in English (e.g. backend-generated text we have no verified translation for).
export default function EnglishOnly() {
  const { t } = useTranslation()
  return (
    <span title={t('common.englishOnlyHint')}
      className="ml-1.5 inline-block align-middle px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px] font-medium not-italic whitespace-nowrap">
      {t('common.englishOnly')}
    </span>
  )
}
