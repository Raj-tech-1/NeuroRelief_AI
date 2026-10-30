import { useTranslation } from 'react-i18next'
import { getLanguage } from './languages'

// Locale-aware formatting. Values stay in their internal form (ISO dates, numbers);
// only the displayed string changes with the selected language.
export function useFormat() {
  const { i18n } = useTranslation()
  const locale = getLanguage(i18n.resolvedLanguage || i18n.language).locale

  return {
    locale,
    number: n => (n == null || Number.isNaN(Number(n)) ? '' : new Intl.NumberFormat(locale).format(Number(n))),
    // opts default matches the previous English output, e.g. "Oct 30, 2026"
    date: (ts, opts = { month: 'short', day: 'numeric', year: 'numeric' }) => (ts ? new Date(ts).toLocaleDateString(locale, opts) : ''),
    // Time slots are stored as '9:00 AM' (the value sent to the backend never changes); this only formats the display
    time: slot => {
      const m = /^(\d+):(\d+) (AM|PM)$/.exec(slot || '')
      if (!m) return slot
      return new Date(2000, 0, 1, (Number(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0), Number(m[2])).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
    },
    // 'Mon' | 'Tue' ... (internal weekday names) -> localized short weekday
    weekday: name => {
      const i = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name)
      return i < 0 ? name : new Date(2023, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' })
    },
    dateTime: ts => (ts ? new Date(ts).toLocaleString(locale) : ''),
    // 'YYYY-MM-DD' strings from the API -> localized date; any other value (e.g. '-') is returned unchanged
    isoDate: s => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? new Date(s + 'T12:00:00').toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }) : s),
  }
}
