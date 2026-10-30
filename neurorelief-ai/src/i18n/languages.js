// Single source of truth for supported UI languages.
// `locale` is the BCP-47 tag used for date/number formatting; `speech` is reserved for the voice features (Phase 4).
export const LANGUAGES = [
  { code: 'en', native: 'English', english: 'English', locale: 'en-US', speech: 'en-IN' },
  { code: 'hi', native: 'हिंदी', english: 'Hindi', locale: 'hi-IN', speech: 'hi-IN' },
  { code: 'kn', native: 'ಕನ್ನಡ', english: 'Kannada', locale: 'kn-IN', speech: 'kn-IN' },
  { code: 'ta', native: 'தமிழ்', english: 'Tamil', locale: 'ta-IN', speech: 'ta-IN' },
  { code: 'te', native: 'తెలుగు', english: 'Telugu', locale: 'te-IN', speech: 'te-IN' },
]

export const DEFAULT_LANGUAGE = 'en'
export const LANGUAGE_STORAGE_KEY = 'neurorelief_lang'

export const isSupported = code => LANGUAGES.some(l => l.code === code)
export const getLanguage = code => LANGUAGES.find(l => l.code === code) || LANGUAGES[0]
