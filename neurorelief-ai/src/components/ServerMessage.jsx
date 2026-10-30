import { useTranslation } from 'react-i18next'
import { localizeServerMessage } from '../i18n/serverText'
import EnglishOnly from './EnglishOnly'

// Renders a backend/API message in the selected language when it is a known one,
// otherwise verbatim with an "English only" marker. Subscribing via useTranslation re-renders it on language change.
export default function ServerMessage({ message }) {
  useTranslation()
  const { text, englishOnly } = localizeServerMessage(message)
  return <>{text}{englishOnly && <EnglishOnly />}</>
}
