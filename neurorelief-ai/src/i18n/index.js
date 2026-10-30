import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en.json'
import hi from '../locales/hi.json'
import kn from '../locales/kn.json'
import ta from '../locales/ta.json'
import te from '../locales/te.json'
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, isSupported } from './languages'

// The preference is a per-device setting, deliberately independent of the logged-in user,
// so it survives logout/login. English is the default (no browser-language guessing).
function readSavedLanguage() {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return isSupported(saved) ? saved : DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}

function applyDocumentLanguage(code) {
  document.documentElement.lang = code
}

const initial = readSavedLanguage()

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, hi: { translation: hi }, kn: { translation: kn }, ta: { translation: ta }, te: { translation: te } },
  lng: initial,
  fallbackLng: DEFAULT_LANGUAGE,          // any missing key falls back to English
  supportedLngs: ['en', 'hi', 'kn', 'ta', 'te'],
  returnEmptyString: false,               // an empty translation also falls back to English
  interpolation: { escapeValue: false },  // React already escapes
  react: { useSuspense: false },
})

applyDocumentLanguage(initial)

export function setLanguage(code) {
  if (!isSupported(code)) return
  try { localStorage.setItem(LANGUAGE_STORAGE_KEY, code) } catch { /* private mode: still switch for this session */ }
  applyDocumentLanguage(code)
  return i18n.changeLanguage(code)
}

export default i18n
