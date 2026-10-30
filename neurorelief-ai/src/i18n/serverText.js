import i18n from './index'
import { getLanguage } from './languages'

const currentLang = () => i18n.resolvedLanguage || i18n.language

// Some text arrives from the backend or services/api.js as fixed English sentences (mood trend, mood tips,
// prediction recommendations, affirmations). Those exact sentences are mirrored in en.json under `group`, so a
// match by English value can be shown in the selected language. Anything that does NOT match is returned
// unchanged and flagged `englishOnly`, so it is never presented as translated.
//
//   localizeFixed('recommendation', 'Low pain expected. Continue current routine.')
//     -> { text: <translated>, englishOnly: false }
export function localizeFixed(group, text) {
  if (!text) return { text: '', englishOnly: false }
  const en = i18n.getResourceBundle('en', 'translation')?.[group] || {}
  const key = Object.keys(en).find(k => en[k] === text)
  if (!key) return { text, englishOnly: currentLang() !== 'en' }
  return { text: i18n.t(`${group}.${key}`), englishOnly: false }
}

// ---- backend / API error messages ----
// The backend answers with English sentences. Known sentences (fixed ones in `srv`, sentences with embedded
// values in `srvP`) are shown in the selected language; any other message is shown exactly as received and flagged.
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function weekdayLabel(name) {
  let i = WEEKDAYS_EN.findIndex(d => d === name || d.slice(0, 3) === name)
  if (i < 0) return name
  return new Date(2023, 0, 1 + i).toLocaleDateString(getLanguage(currentLang()).locale, { weekday: 'long' })
}
const statusWord = s => i18n.t(`apptStatus.${s}`, { defaultValue: s }).toLowerCase()

const PATTERNS = [
  [/^Appointments can be requested up to (\d+) days ahead\.$/, 'srvP.daysAhead', m => ({ n: m[1] })],
  [/^(.+) does not take appointments on (\w+)\.$/, 'srvP.noWeekday', m => ({ doctor: m[1], day: weekdayLabel(m[2]) })],
  [/^A (\w+) appointment cannot be cancelled\.$/, 'srvP.cannotCancel', m => ({ status: statusWord(m[1]) })],
  [/^A (\w+) request cannot be changed to '(\w+)'\.$/, 'srvP.cannotChange', m => ({ status: statusWord(m[1]), next: statusWord(m[2]) })],
  [/^Request failed \((\d+)\)$/, 'srvP.httpFail', m => ({ code: m[1] })],
]
// What browsers throw when fetch() cannot reach the server
const BROWSER_NETWORK = /^(Failed to fetch|NetworkError.*|Load failed)$/i

export function localizeServerMessage(message) {
  const msg = String(message ?? '')
  if (!msg || currentLang() === 'en') return { text: msg, englishOnly: false }   // English is the source text
  const exact = localizeFixed('srv', msg)
  if (!exact.englishOnly) return exact
  if (BROWSER_NETWORK.test(msg)) return { text: i18n.t('srv.network'), englishOnly: false }
  for (const [re, key, params] of PATTERNS) {
    const m = re.exec(msg)
    if (m) return { text: i18n.t(key, params(m)), englishOnly: false }
  }
  return { text: msg, englishOnly: true }
}
