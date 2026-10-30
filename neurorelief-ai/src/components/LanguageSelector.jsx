import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from './icons'
import { LANGUAGES, getLanguage } from '../i18n/languages'
import { setLanguage } from '../i18n'

// Dropdown listing every language by its native name. Changing it re-renders the app immediately;
// the choice is stored per device (see i18n/index.js), not per account.
export default function LanguageSelector({ onOpen, align = 'right' }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const btnRef = useRef(null)
  const current = getLanguage(i18n.resolvedLanguage || i18n.language)

  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  function choose(code) {
    setLanguage(code)
    setOpen(false)
    btnRef.current?.focus()
  }

  return (
    <div className="relative">
      <button ref={btnRef} onClick={() => { setOpen(o => !o); onOpen?.() }} aria-haspopup="listbox" aria-expanded={open}
        aria-label={`${t('language.change')}: ${current.native}`} title={t('language.change')}
        className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-brand-700 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
        <Icon name="globe" size={20} />
        <span className="hidden sm:block text-sm font-medium text-gray-800 whitespace-nowrap">{current.native}</span>
        <Icon name="chevronDown" size={14} className="hidden sm:block text-gray-500" />
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" aria-label={t('nav.closeMenu')} tabIndex={-1} onClick={() => setOpen(false)} />
          <div className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} mt-2 w-56 bg-white rounded-2xl shadow-xl border border-brand-100 z-50 p-2`}>
            <p className="px-3 pt-1 pb-1.5 text-xs font-semibold text-gray-500">{t('language.label')}</p>
            <ul role="listbox" aria-label={t('language.label')} className="space-y-0.5">
              {LANGUAGES.map(l => {
                const selected = l.code === current.code
                return (
                  <li key={l.code} role="option" aria-selected={selected}>
                    <button onClick={() => choose(l.code)} lang={l.code}
                      className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-left text-sm hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${selected ? 'bg-brand-50 font-semibold text-brand-800' : 'text-gray-800'}`}>
                      <span>{l.native}<span className="ml-2 text-xs font-normal text-gray-400">{l.english}</span></span>
                      {selected && <Icon name="check" size={16} className="text-brand-600 shrink-0" />}
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="px-3 pt-2 pb-1 text-[11px] leading-snug text-gray-400 border-t border-brand-100 mt-1.5">{t('language.note')}</p>
          </div>
        </>
      )}
    </div>
  )
}
