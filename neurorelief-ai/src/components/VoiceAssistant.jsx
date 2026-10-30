import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from './icons'
import { getAssistantStatus, sendAssistantMessage } from '../services/api'

// Browser speech APIs: recognition is Chrome/Edge only; synthesis depends on the OS voices installed.
const SPEECH_TAGS = { en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN', ta: 'ta-IN', te: 'te-IN' }
const Recognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null
const MAX_LEN = 1000

const ERROR_KEYS = {
  not_configured: 'notConfigured', rate_limited: 'errRate', timeout: 'errTimeout', upstream_busy: 'errUpstream',
  upstream_error: 'errUpstream', blocked: 'errBlocked', empty_reply: 'errEmpty', message_too_long: 'errTooLong',
  network: 'errNetwork', session: 'errSession'
}
const SPEECH_ERROR_KEYS = {
  'not-allowed': 'errMicDenied', 'service-not-allowed': 'errMicDenied', 'no-speech': 'errNoSpeech',
  'language-not-supported': 'errLangUnsupported', network: 'errSpeechNetwork'
}

// Replies are read aloud, so strip any markdown the model might still add.
const plain = s => s.replace(/[*_`#>]+/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/[ \t]{2,}/g, ' ').trim()

const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null

function pickVoice(lang) {
  if (!synth) return null
  const voices = synth.getVoices()
  const tag = SPEECH_TAGS[lang].toLowerCase()
  return voices.find(v => v.lang.toLowerCase().replace('_', '-') === tag) || voices.find(v => v.lang.toLowerCase().startsWith(lang)) || null
}

export default function VoiceAssistant({ open, onClose }) {
  const { t, i18n } = useTranslation()
  const lang = (i18n.resolvedLanguage || i18n.language || 'en').slice(0, 2)
  const [messages, setMessages] = useState([])   // { id, role: 'user'|'assistant'|'error', text?, code?, retryText? }
  const [input, setInput] = useState('')
  const [fromVoice, setFromVoice] = useState(false)
  const [phase, setPhase] = useState('idle')      // idle | listening | thinking | speaking
  const [configured, setConfigured] = useState(null)
  const [notice, setNotice] = useState(null)      // assistant.* key
  const [autoSpeak, setAutoSpeak] = useState(true)
  const [voicesTick, setVoicesTick] = useState(0)
  const recRef = useRef(null)
  const idRef = useRef(0)
  const runRef = useRef(0)
  const endRef = useRef(null)
  const inputRef = useRef(null)

  const voicesLoaded = useMemo(() => !!synth && synth.getVoices().length > 0, [voicesTick, open])   // eslint-disable-line react-hooks/exhaustive-deps
  const hasVoice = useMemo(() => !!pickVoice(lang), [lang, voicesTick, open])                        // eslint-disable-line react-hooks/exhaustive-deps

  const stopListening = () => { try { recRef.current?.abort() } catch { /* already stopped */ } recRef.current = null }
  const stopSpeaking = () => { if (synth) synth.cancel() }
  const stopAll = () => { stopListening(); stopSpeaking(); setPhase(p => (p === 'thinking' ? p : 'idle')) }

  // Voices load asynchronously in most browsers.
  useEffect(() => {
    if (!synth) return undefined
    const bump = () => setVoicesTick(n => n + 1)
    synth.addEventListener('voiceschanged', bump)
    return () => synth.removeEventListener('voiceschanged', bump)
  }, [])

  // Setup state, fetched when the dialog opens (never exposes the key itself).
  useEffect(() => {
    if (!open) return undefined
    let alive = true
    setConfigured(null)
    getAssistantStatus().then(s => { if (alive) setConfigured(Boolean(s && s.configured)) }).catch(() => { if (alive) setConfigured(true) })
    setTimeout(() => inputRef.current?.focus(), 50)
    return () => { alive = false }
  }, [open])

  // Leaving the dialog or switching language stops any microphone/speech activity.
  useEffect(() => { stopAll() }, [lang, open])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { stopListening(); stopSpeaking() }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages, phase])
  useEffect(() => {
    if (!open) return undefined
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const speak = text => {
    const voice = pickVoice(lang)
    if (!synth || !voice) return
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.voice = voice; u.lang = voice.lang
    u.onend = () => setPhase(p => (p === 'speaking' ? 'idle' : p))
    u.onerror = u.onend
    setPhase('speaking')
    synth.speak(u)
  }

  const startListening = () => {
    if (!Recognition) { setNotice('errMicUnsupported'); return }
    stopSpeaking()
    const rec = new Recognition()
    rec.lang = SPEECH_TAGS[lang]
    rec.interimResults = true
    rec.continuous = false
    rec.maxAlternatives = 1
    rec.onresult = e => {
      const heard = Array.from(e.results).map(r => r[0].transcript).join(' ').trim()
      setInput(heard.slice(0, MAX_LEN)); setFromVoice(true)
    }
    rec.onerror = e => {
      if (e.error === 'aborted') return
      setNotice(SPEECH_ERROR_KEYS[e.error] || 'errSpeech')
    }
    rec.onend = () => { if (recRef.current === rec) recRef.current = null; setPhase(p => (p === 'listening' ? 'idle' : p)) }
    recRef.current = rec
    setNotice(null)
    try { rec.start(); setPhase('listening') } catch { recRef.current = null; setNotice('errSpeech') }
  }

  const run = async (text, base) => {
    const myRun = ++runRef.current
    setPhase('thinking'); setNotice(null)
    const history = base.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, text: m.text }))
    try {
      const { reply } = await sendAssistantMessage(text, history, lang)
      if (myRun !== runRef.current) return
      const clean = plain(reply)
      setMessages(m => [...m, { id: ++idRef.current, role: 'assistant', text: clean }])
      setPhase('idle')
      if (autoSpeak) speak(clean)
    } catch (err) {
      if (myRun !== runRef.current) return
      if (err.code === 'not_configured') setConfigured(false)
      setMessages(m => [...m, { id: ++idRef.current, role: 'error', code: err.code, retryText: text }])
      setPhase('idle')
    }
  }

  const send = () => {
    const text = input.trim()
    if (!text || phase === 'thinking' || configured === false) return
    stopListening(); stopSpeaking()
    const base = messages
    setMessages([...base, { id: ++idRef.current, role: 'user', text }])
    setInput(''); setFromVoice(false); setNotice(null)
    run(text, base)
  }

  const retry = errId => {
    const idx = messages.findIndex(m => m.id === errId)
    if (idx < 1 || phase === 'thinking') return
    setMessages(messages.slice(0, idx))
    run(messages[idx].retryText, messages.slice(0, idx - 1))
  }

  const clearChat = () => {
    runRef.current++; stopListening(); stopSpeaking()
    setMessages([]); setInput(''); setFromVoice(false); setNotice(null); setPhase('idle')
  }

  const reRecord = () => { setInput(''); setFromVoice(false); startListening() }

  const statusLabel = configured === null ? t('assistant.checking') : t(`assistant.status${{ idle: 'Idle', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking' }[phase]}`)
  const voiceNote = autoSpeak && voicesLoaded && !hasVoice ? 'errVoiceMissing' : null
  const shownNotice = notice || (!Recognition ? 'errMicUnsupported' : voiceNote)
  const busy = phase === 'thinking'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="voice-h"
        className="w-full sm:max-w-xl h-[100dvh] sm:h-[min(90dvh,760px)] bg-white sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-brand-100 flex-wrap">
          <span className="shrink-0 w-9 h-9 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="mic" size={18} /></span>
          <div className="min-w-0 mr-auto">
            <h2 id="voice-h" className="font-display text-base font-bold text-gray-900 leading-tight">{t('assistant.title')}</h2>
            <p role="status" aria-live="polite" className={`text-xs ${phase === 'idle' ? 'text-gray-500' : 'text-brand-700 font-semibold'}`}>{statusLabel}</p>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={autoSpeak} onChange={e => { setAutoSpeak(e.target.checked); if (!e.target.checked) { stopSpeaking(); setPhase(p => (p === 'speaking' ? 'idle' : p)) } }} className="accent-brand-600" />
            {t('assistant.speakReplies')}
          </label>
          <button onClick={clearChat} disabled={!messages.length && !input} title={t('assistant.clear')} aria-label={t('assistant.clear')}
            className="p-2 rounded-lg text-gray-500 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"><Icon name="trash" size={18} /></button>
          <button onClick={onClose} title={t('assistant.close')} aria-label={t('assistant.close')}
            className="p-2 rounded-lg text-gray-500 hover:bg-brand-50 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"><Icon name="close" size={18} /></button>
        </div>

        <div className="shrink-0 px-4 pt-3 space-y-2">
          <p className="text-[11px] leading-snug text-brand-800 bg-brand-50 rounded-lg px-3 py-2">{t('assistant.disclaimer')}</p>
          <p className="text-[11px] leading-snug text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" role="note">{t('assistant.urgent')}</p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3" aria-live="polite">
          {messages.length === 0 && <p className="text-sm text-gray-500 text-center py-6">{t('assistant.empty')}</p>}
          {messages.map(m => m.role === 'error' ? (
            <div key={m.id} className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
              <p>{t(`assistant.${ERROR_KEYS[m.code] || 'errGeneric'}`)}</p>
              {m.code !== 'not_configured' && (
                <button onClick={() => retry(m.id)} disabled={busy} className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:underline disabled:opacity-50">
                  <Icon name="retry" size={14} /> {t('assistant.retry')}
                </button>
              )}
            </div>
          ) : (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap ${m.role === 'user' ? 'bg-brand-600 text-white rounded-br-sm' : 'bg-gray-50 border border-gray-100 text-gray-900 rounded-bl-sm'}`}>
                <span className="sr-only">{m.role === 'user' ? t('assistant.you') : t('assistant.assistant')}: </span>{m.text}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-gray-500" role="status">
              <span className="inline-flex gap-1" aria-hidden="true">{[0, 1, 2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />)}</span>
              {t('assistant.statusThinking')}
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="shrink-0 border-t border-brand-100 px-4 py-3 space-y-2">
          {configured === false ? (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
              <p className="font-semibold">{t('assistant.notConfigured')}</p>
              <p className="text-xs mt-1">{t('assistant.setup')}</p>
            </div>
          ) : (
            <>
              {shownNotice && <p role="status" className="text-xs text-amber-900 bg-amber-50 rounded-lg px-3 py-1.5">{t(`assistant.${shownNotice}`)}</p>}
              {fromVoice && <label htmlFor="voice-input" className="block text-[11px] font-semibold text-brand-700">{t('assistant.transcript')}</label>}
              <textarea id="voice-input" ref={inputRef} rows={2} maxLength={MAX_LEN} value={input} disabled={busy}
                onChange={e => { setInput(e.target.value); setFromVoice(false) }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder={phase === 'listening' ? t('assistant.statusListening') : t('assistant.placeholder')} aria-label={t('assistant.placeholder')}
                className="w-full resize-none rounded-xl border border-brand-100 bg-white px-3 py-2 text-sm focus:outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-200/60 disabled:bg-gray-50" />
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={phase === 'listening' ? stopListening : startListening} disabled={busy || !Recognition}
                  aria-pressed={phase === 'listening'}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border transition disabled:opacity-40 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200 ${phase === 'listening' ? 'bg-red-500 border-red-500 text-white' : 'border-brand-200 text-brand-700 hover:bg-brand-50'}`}>
                  <Icon name={phase === 'listening' ? 'stop' : 'mic'} size={16} /> {phase === 'listening' ? t('assistant.micStop') : t('assistant.mic')}
                </button>
                {fromVoice && phase === 'idle' && (
                  <button onClick={reRecord} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border border-brand-200 text-brand-700 hover:bg-brand-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200">
                    <Icon name="retry" size={16} /> {t('assistant.retry')}
                  </button>
                )}
                {phase === 'speaking' && (
                  <button onClick={() => { stopSpeaking(); setPhase('idle') }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border border-brand-200 text-brand-700 hover:bg-brand-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200">
                    <Icon name="speaker" size={16} /> {t('assistant.stopSpeaking')}
                  </button>
                )}
                <button onClick={send} disabled={!input.trim() || busy}
                  className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-brand-500 to-brand-700 text-white disabled:opacity-40 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200">
                  <Icon name="send" size={16} /> {t('assistant.send')}
                </button>
              </div>
              {Recognition && <p className="text-[10px] leading-snug text-gray-500">{t('assistant.privacy')}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
