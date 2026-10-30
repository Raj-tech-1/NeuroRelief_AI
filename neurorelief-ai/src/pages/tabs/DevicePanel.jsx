import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../../i18n/format'
import { readStoredPrediction } from '../../services/predictions'
import { Icon } from '../../components/icons'

const BASE_URL = 'http://localhost:8000/api'
function getToken() {
  const u = localStorage.getItem('neurorelief_user')
  if (!u) return null
  try { return JSON.parse(u).token } catch { return null }
}

export default function DevicePanel() {
  const { t } = useTranslation()
  const fmt = useFormat()
  const [calibration, setCalibration] = useState(null)
  // Device state
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [battery, setBattery] = useState(85)

  // Therapy controls
  const [tensIntensity, setTensIntensity] = useState(0)
  const [tensFrequency, setTensFrequency] = useState(50)
  const [heatTemp, setHeatTemp] = useState(38)
  const [heatActive, setHeatActive] = useState(false)
  const [tensActive, setTensActive] = useState(false)

  // Session timer
  const [sessionActive, setSessionActive] = useState(false)
  const [sessionSeconds, setSessionSeconds] = useState(0)
  const [painBefore, setPainBefore] = useState(5)
  const [painAfter, setPainAfter] = useState(null)
  const timerRef = useRef(null)

  // Therapy history
  const [history, setHistory] = useState(() => {
    const saved = localStorage.getItem('neurorelief_therapy_history')
    return saved ? JSON.parse(saved) : []
  })

  // Last AI prediction (for auto-fill)
  const [lastPrediction, setLastPrediction] = useState(null)

  useEffect(() => {
    // Load last prediction from localStorage
    const pred = readStoredPrediction()
    if (pred) setLastPrediction(pred)

    // Load personal calibration status
    fetch(`${BASE_URL}/predict/calibration`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    })
      .then(r => r.json())
      .then(setCalibration)
      .catch(() => {})
  }, [])

  // Timer logic
  useEffect(() => {
    if (sessionActive) {
      timerRef.current = setInterval(() => {
        setSessionSeconds(prev => prev + 1)
      }, 1000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [sessionActive])

  // Simulate battery drain
  useEffect(() => {
    if (sessionActive) {
      const drain = setInterval(() => setBattery(prev => Math.max(0, prev - 1)), 30000)
      return () => clearInterval(drain)
    }
  }, [sessionActive])

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  async function handleConnect() {
    setConnecting(true)
    await new Promise(r => setTimeout(r, 1500))
    setConnected(true)
    setConnecting(false)
    setBattery(85)
  }

  function handleDisconnect() {
    if (sessionActive) handleStopSession()
    setConnected(false)
    setTensActive(false)
    setHeatActive(false)
  }

  function applyRecommended() {
    if (lastPrediction) {
      setTensIntensity(lastPrediction.recommended_tens_intensity || 50)
      setTensFrequency(lastPrediction.recommended_tens_frequency || 50)
      setHeatTemp(lastPrediction.recommended_heat_temp || 40)
    }
  }

  function handleStartSession() {
    setSessionActive(true)
    setSessionSeconds(0)
    setTensActive(true)
    setHeatActive(true)
    setPainAfter(null)
  }

  function handleStopSession() {
    setSessionActive(false)
    setTensActive(false)
    setHeatActive(false)

    // Show pain-after prompt
    if (sessionSeconds > 5) {
      setPainAfter(0) // trigger the rating UI
    }
  }

  function saveSession(afterPain) {
    const session = {
      date: new Date().toLocaleString(),
      ts: Date.now(),
      duration: formatTime(sessionSeconds),
      durationSeconds: sessionSeconds,
      tensIntensity,
      tensFrequency,
      heatTemp,
      painBefore,
      painAfter: afterPain,
      improvement: painBefore - afterPain
    }
    const updated = [session, ...history].slice(0, 20)
    setHistory(updated)
    localStorage.setItem('neurorelief_therapy_history', JSON.stringify(updated))

    // ---- personal calibration feedback ----
    // Always report against the RAW model score. Using an already-calibrated
    // score here would make the offset compound on itself.
    const rawScore = lastPrediction?.base_severity_score ?? lastPrediction?.severity_score
    if (rawScore != null) {
      fetch(`${BASE_URL}/predict/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ base_score: rawScore, actual_pain: painBefore })
      })
        .then(r => r.json())
        .then(d => { if (d.calibration) setCalibration({ ...d.calibration, needed: 5 }) })
        .catch(() => {})
    }

    setPainAfter(null)
    setSessionSeconds(0)
  }

  const card = 'bg-white rounded-2xl border border-brand-100 shadow-[0_2px_10px_rgba(157,47,131,0.06)]'
  const rating = painAfter !== null && !sessionActive
  const painLocked = sessionActive || rating
  const settingsRow = (
    <div className="grid grid-cols-3 gap-1.5">
      {[
        ['bolt', `${tensIntensity}%`, t('device.intensityShort'), 'text-amber-600 bg-amber-50'],
        ['chart', `${tensFrequency} Hz`, t('device.frequencyShort'), 'text-sky-600 bg-sky-50'],
        ['drop', `${heatTemp}°C`, t('device.temperatureShort'), 'text-rose-600 bg-rose-50'],
      ].map(([ic, v, l, tone]) => (
        <div key={l} className={`rounded-lg px-2 py-1 flex items-center gap-1.5 ${tone}`}>
          <Icon name={ic} size={16} className="shrink-0" />
          <div className="leading-tight min-w-0">
            <p className="text-sm font-bold text-gray-900">{v}</p>
            <p className="text-[11px] text-gray-500">{l}</p>
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] gap-3 dev-gap xl:h-full xl:min-h-0">
      {/* ---------------- Left column ---------------- */}
      <div className="flex flex-col gap-2.5 dev-gap min-w-0 xl:min-h-0">
        {/* Device status */}
        <section className={`${card} dev-pad p-3 shrink-0 bg-gradient-to-r from-brand-50 via-white to-white`} aria-label={t('device.section')}>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="shrink-0 w-11 h-11 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center"><Icon name="device" size={22} /></span>
            <div className="min-w-0 mr-auto flex-1 basis-56">
              <h2 className="font-display text-lg font-bold text-gray-900 leading-tight">NeuroRelief Band v1</h2>
              <p className="text-xs text-gray-500">{t('device.bandSub')}</p>
            </div>
            {connected && (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600" aria-label={t('device.battery', { n: battery })}>
                <span className={`w-2.5 h-2.5 rounded-full ${battery > 20 ? 'bg-green-400' : 'bg-red-400'} ${sessionActive ? 'animate-pulse' : ''}`} />
                <Icon name="battery" size={20} className="text-green-600" /> {battery}%
              </span>
            )}
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
              {connected ? t('device.connected') : t('device.notConnected')}
            </span>
            {connected ? (
              <button onClick={handleDisconnect} className="text-xs text-red-500 hover:text-red-700 font-medium">{t('device.disconnect')}</button>
            ) : (
              <button onClick={handleConnect} disabled={connecting}
                className="px-5 py-2 bg-brand-700 hover:bg-brand-800 text-white rounded-lg text-sm font-semibold disabled:opacity-60 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300">
                {connecting ? t('device.connecting') : t('device.connect')}
              </button>
            )}
          </div>
        </section>

        {!connected ? (
          <section className={`${card} flex-1 min-h-0 flex flex-col items-center justify-center text-center p-6`}>
            <span className="w-16 h-16 rounded-full bg-brand-50 text-brand-500 flex items-center justify-center mb-3"><Icon name="device" size={30} /></span>
            <p className="font-display text-lg font-bold text-gray-900">{t('device.noDevice')}</p>
            <p className="text-sm text-gray-500 mt-1 max-w-sm">{t('device.noDeviceText')}</p>
          </section>
        ) : (
          <>
            {/* AI recommended settings */}
            <section className={`${card} dev-pad px-3 py-2 shrink-0`} aria-label={t('device.aiTitle')}>
              {lastPrediction ? (
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="mr-auto min-w-0">
                    <h3 className="font-bold text-gray-900 text-sm leading-tight">{t('device.aiTitle')}</h3>
                    <span className="inline-block mt-0.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">{t('advisor.pred', { severity: t(`severity.${lastPrediction.predicted_severity}`, { defaultValue: lastPrediction.predicted_severity }) })}</span>
                  </div>
                  <p className="text-sm text-gray-700 font-medium">
                    {lastPrediction.recommended_tens_intensity}% · {lastPrediction.recommended_tens_frequency} Hz · {lastPrediction.recommended_heat_temp}°C
                  </p>
                  <button onClick={applyRecommended}
                    className="px-4 py-2 bg-gradient-to-r from-brand-500 to-brand-700 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2 hover:opacity-95 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300">
                    <Icon name="bolt" size={16} /> {t('device.apply')}
                  </button>
                </div>
              ) : (
                <p className="text-sm text-gray-500 py-1"><span className="font-semibold text-gray-700">{t('device.aiTitle')}</span> — {t('device.aiNone')}</p>
              )}
            </section>

            {/* Therapy controls */}
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 dev-gap xl:flex-[1_0_auto]" aria-label={t('device.controls')}>
              {/* TENS */}
              <div className="rounded-2xl border border-purple-100 bg-purple-50/60 dev-pad p-3 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-sm font-bold text-purple-900 inline-flex items-center gap-1.5"><Icon name="bolt" size={16} className="text-purple-600" /> {t('device.tens')}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${tensActive ? 'bg-purple-200 text-purple-800' : 'bg-gray-200 text-gray-600'}`}>
                    {tensActive ? t('device.active') : t('device.inactive')}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-semibold text-gray-800"><label htmlFor="tens-int">{t('device.intensity', { n: tensIntensity })}</label></div>
                <input id="tens-int" type="range" min="0" max="100" value={tensIntensity} onChange={e => setTensIntensity(Number(e.target.value))}
                  className="w-full h-5" style={{ accentColor: '#7C3AED' }} />
                <div className="flex justify-between text-[11px] text-gray-400"><span>{t('device.off')}</span><span>{t('device.low')}</span><span>{t('device.medium')}</span><span>{t('device.high')}</span><span>{t('device.max')}</span></div>

                <label htmlFor="tens-freq" className="text-sm font-semibold text-gray-800 mt-1.5 block">{t('device.frequency', { n: tensFrequency })}</label>
                <input id="tens-freq" type="range" min="2" max="150" value={tensFrequency} onChange={e => setTensFrequency(Number(e.target.value))}
                  className="w-full h-5" style={{ accentColor: '#7C3AED' }} />
                <div className="flex justify-between text-[11px] text-gray-400"><span>2 Hz</span><span>{t('device.lowEndorphins')}</span><span>150 Hz</span></div>
              </div>

              {/* Heat */}
              <div className="rounded-2xl border border-orange-100 bg-orange-50/60 dev-pad p-3 flex flex-col">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-sm font-bold text-orange-900 inline-flex items-center gap-1.5"><Icon name="drop" size={16} className="text-orange-600" /> {t('device.heat')}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${heatActive ? 'bg-orange-200 text-orange-800' : 'bg-gray-200 text-gray-600'}`}>
                    {heatActive ? `${heatTemp}°C` : t('device.inactive')}
                  </span>
                </div>
                <label htmlFor="heat-temp" className="text-sm font-semibold text-gray-800">{t('device.temperature', { n: heatTemp })}</label>
                <input id="heat-temp" type="range" min="38" max="42" step="0.5" value={heatTemp} onChange={e => setHeatTemp(Number(e.target.value))}
                  className="w-full h-5" style={{ accentColor: '#EA580C' }} />
                <div className="flex justify-between text-[11px] text-gray-400"><span>{t('device.warm')}</span><span>40°C</span><span>{t('device.maxSafe')}</span></div>
                <p className="mt-auto pt-1.5 text-[11px] text-orange-800/80 bg-orange-100/60 rounded-lg px-2 py-1.5 dev-note">{t('device.heatNote')}</p>
              </div>
            </section>

            {/* Current pain level */}
            <section className={`${card} dev-pad px-3 py-2 shrink-0 ${painLocked ? 'opacity-70' : ''}`} aria-label={t('device.painLevel')}>
              <div className="flex items-center justify-between">
                <label htmlFor="pain-before" className="text-sm font-bold text-gray-900 inline-flex items-center gap-1.5"><Icon name="chart" size={16} className="text-brand-600" /> {t('device.painLevel')}</label>
                <span className="text-sm font-bold text-gray-900">{painBefore} / 10</span>
              </div>
              <input id="pain-before" type="range" min="0" max="10" value={painBefore} disabled={painLocked} onChange={e => setPainBefore(Number(e.target.value))}
                className="w-full h-5" style={{ accentColor: '#C03B8F' }} />
              <div className="flex justify-between text-[11px] text-gray-400"><span>{t('device.noPain')}</span><span>{t('device.severePain')}</span></div>
            </section>

            {/* Session control */}
            {sessionActive ? (
              <button onClick={handleStopSession}
                className="shrink-0 w-full py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold text-base inline-flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-red-300">
                <span className="w-3 h-3 bg-white rounded-sm" /> {t('device.stop')}
              </button>
            ) : rating ? (
              <p className="shrink-0 w-full py-3 text-center rounded-xl bg-brand-50 text-brand-700 text-sm font-medium">{t('device.rateHint')}</p>
            ) : (
              <button onClick={handleStartSession}
                className="shrink-0 w-full py-3 bg-gradient-to-r from-brand-500 to-brand-700 hover:opacity-95 text-white rounded-xl font-semibold text-base inline-flex items-center justify-center gap-2 shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300">
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2l11 6-11 6z" fill="currentColor" /></svg> {t('device.start')}
              </button>
            )}
            <p className="shrink-0 text-[11px] text-gray-500 text-center -mt-1 flex items-center justify-center gap-1.5">
              <Icon name="check" size={12} className="text-brand-600" /> {t('device.safety')}
            </p>
          </>
        )}
      </div>

      {/* ---------------- Right column ---------------- */}
      <div className="flex flex-col gap-2.5 dev-gap min-w-0 xl:min-h-0">
        {/* Session status */}
        <section className={`${card} dev-pad p-3 shrink-0`} aria-label={t('device.sessionStatus')}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${sessionActive ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
              <div className="leading-tight">
                <h3 className="font-bold text-gray-900">{t('device.sessionStatus')}</h3>
                <p className="text-xs text-gray-500">
                  {sessionActive ? t('device.sessionActive') : rating ? t('device.sessionFinished') : connected ? t('device.noSession') : t('device.connectToStart')}
                </p>
              </div>
            </div>
            <span className="text-2xl font-bold font-mono text-brand-800" aria-live="off">{formatTime(sessionSeconds)}</span>
          </div>
          {rating ? (
            <div>
              <div className="flex gap-1 justify-center flex-wrap mb-1.5">
                {Array.from({ length: 11 }).map((_, i) => (
                  <button key={i} onClick={() => saveSession(i)} aria-label={t('device.ratePain', { n: i })}
                    className={`w-8 h-8 rounded-lg text-xs font-bold transition ${
                      i <= 3 ? 'bg-green-100 hover:bg-green-300 text-green-800' :
                      i <= 6 ? 'bg-yellow-100 hover:bg-yellow-300 text-yellow-800' :
                      'bg-red-100 hover:bg-red-300 text-red-800'
                    }`}>
                    {i}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 text-center">{t('device.painBefore', { before: painBefore, time: formatTime(sessionSeconds) })}</p>
            </div>
          ) : settingsRow}
        </section>

        {/* Therapy history */}
        <section className={`${card} dev-pad p-3 flex flex-col xl:flex-1 xl:min-h-0`} aria-label={t('device.history')}>
          <div className="flex items-center justify-between mb-1.5 shrink-0">
            <h3 className="font-bold text-gray-900 inline-flex items-center gap-2"><Icon name="history" size={18} className="text-brand-600" /> {t('device.history')}</h3>
            {history.length > 0 && (
              <button onClick={() => { setHistory([]); localStorage.removeItem('neurorelief_therapy_history') }}
                className="text-xs text-red-500 hover:text-red-700 font-medium">{t('device.clearHistory')}</button>
            )}
          </div>

          {history.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-6">
              <span className="text-brand-300"><Icon name="chart" size={30} /></span>
              <p className="text-gray-500 mt-1 text-sm">{t('device.noSessions')}</p>
              <p className="text-xs text-gray-400">{t('device.noSessionsHint')}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1.5 mb-1.5 shrink-0 text-center">
                <div className="bg-purple-50 rounded-lg py-1"><p className="text-[11px] text-purple-600 leading-tight">{t('device.totalSessions')}</p><p className="font-bold text-purple-800 leading-tight">{history.length}</p></div>
                <div className="bg-green-50 rounded-lg py-1"><p className="text-[11px] text-green-600 leading-tight">{t('device.avgImprovement')}</p><p className="font-bold text-green-800 leading-tight">{(history.reduce((s, h) => s + (h.improvement || 0), 0) / history.length).toFixed(1)}</p></div>
                <div className="bg-blue-50 rounded-lg py-1"><p className="text-[11px] text-blue-600 leading-tight">{t('device.totalTime')}</p><p className="font-bold text-blue-800 leading-tight">{t('device.minutes', { n: Math.round(history.reduce((s, h) => s + (h.durationSeconds || 0), 0) / 60) })}</p></div>
              </div>
              <div className="flex-1 min-h-0 overflow-auto max-h-64 xl:max-h-none">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white text-gray-500 text-left">
                    <tr><th className="font-medium py-1 pr-2">{t('device.colDate')}</th><th className="font-medium py-1 pr-2">{t('device.colDuration')}</th><th className="font-medium py-1 pr-2">{t('device.colPain')}</th><th className="font-medium py-1">{t('device.colSettings')}</th></tr>
                  </thead>
                  <tbody>
                    {history.map((session, i) => (
                      <tr key={i} className="border-t border-gray-100 text-gray-700">
                        <td className="py-1.5 pr-2">{session.ts ? fmt.dateTime(session.ts) : session.date}</td>
                        <td className="py-1.5 pr-2 whitespace-nowrap">{session.duration}</td>
                        <td className="py-1.5 pr-2 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full font-medium ${session.improvement > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                            {session.painBefore} → {session.painAfter}
                          </span>
                        </td>
                        <td className="py-1.5 whitespace-nowrap">{session.tensIntensity}% | {session.tensFrequency ?? '-'}Hz | {session.heatTemp}°C</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {/* Personal calibration */}
        {calibration && (
          <section className={`${card} dev-pad px-3 py-2 shrink-0 short-hide`} aria-label={t('device.calSection')}>
            {calibration.active ? (
              <p className="text-xs text-purple-700">
                {t(calibration.offset > 0 ? 'device.calActiveHigher' : 'device.calActiveLower', { sessions: calibration.sessions, offset: Math.abs(calibration.offset) })}
              </p>
            ) : (
              <p className="text-xs text-gray-600">
                {t('device.calInactive', { n: calibration.sessions || 0, needed: calibration.needed || 5 })}
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
