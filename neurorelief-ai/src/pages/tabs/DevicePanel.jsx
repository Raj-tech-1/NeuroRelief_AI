import { useState, useEffect, useRef } from 'react'

const BASE_URL = 'http://localhost:8000/api'
function getToken() {
  const u = localStorage.getItem('neurorelief_user')
  if (!u) return null
  try { return JSON.parse(u).token } catch { return null }
}

export default function DevicePanel() {
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
    const pred = localStorage.getItem('neurorelief_last_prediction')
    if (pred) setLastPrediction(JSON.parse(pred))

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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left: Device Control */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📱</span>
              <div>
                <h3 className="font-bold text-gray-900">Wearable Device Control</h3>
                <p className="text-sm text-brand-600">NeuroRelief TENS + Heat Band</p>
              </div>
            </div>
            {connected && (
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${battery > 20 ? 'bg-green-400' : 'bg-red-400'} ${sessionActive ? 'animate-pulse' : ''}`} />
                <span className="text-xs text-gray-500">🔋 {battery}%</span>
              </div>
            )}
          </div>

          {!connected ? (
            <div className="text-center py-8">
              <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-4xl">⌚</span>
              </div>
              <p className="text-gray-500 mb-4">No device connected</p>
              <button onClick={handleConnect} disabled={connecting}
                className="px-8 py-3 bg-brand-500 text-white rounded-lg font-medium hover:bg-brand-600 disabled:opacity-60">
                {connecting ? 'Connecting...' : 'Connect Device'}
              </button>
              <p className="text-xs text-gray-400 mt-2">Simulated device for demonstration</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Connection status */}
              <div className="flex items-center justify-between bg-green-50 p-3 rounded-xl">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-sm font-medium text-green-700">NeuroRelief Band v1 — Connected</span>
                </div>
                <button onClick={handleDisconnect} className="text-xs text-red-500 hover:text-red-700">Disconnect</button>
              </div>

              {/* Auto-fill from AI */}
              {lastPrediction && (
                <button onClick={applyRecommended}
                  className="w-full py-2.5 bg-purple-100 text-purple-700 rounded-xl text-sm font-medium hover:bg-purple-200 transition flex items-center justify-center gap-2">
                  🎯 Apply AI Recommended Settings
                  <span className="text-xs text-purple-500">({lastPrediction.predicted_severity} pain predicted)</span>
                </button>
              )}

              {/* TENS Controls */}
              <div className="bg-blue-50 p-4 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-blue-800">⚡ TENS Stimulation</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${tensActive ? 'bg-blue-200 text-blue-800' : 'bg-gray-200 text-gray-600'}`}>
                    {tensActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <label className="text-xs text-gray-600">Intensity: {tensIntensity}%</label>
                <input type="range" min="0" max="100" value={tensIntensity} onChange={e => setTensIntensity(Number(e.target.value))}
                  className="w-full" style={{ accentColor: '#2563EB' }} />
                <div className="flex justify-between text-xs text-gray-400"><span>Off</span><span>Low</span><span>Medium</span><span>High</span><span>Max</span></div>

                <label className="text-xs text-gray-600 mt-2 block">Frequency: {tensFrequency} Hz</label>
                <input type="range" min="2" max="150" value={tensFrequency} onChange={e => setTensFrequency(Number(e.target.value))}
                  className="w-full" style={{ accentColor: '#2563EB' }} />
                <div className="flex justify-between text-xs text-gray-400"><span>2 Hz</span><span>Low (endorphins)</span><span>150 Hz</span></div>
              </div>

              {/* Heat Controls */}
              <div className="bg-orange-50 p-4 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-orange-800">🌡️ Heat Therapy</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${heatActive ? 'bg-orange-200 text-orange-800' : 'bg-gray-200 text-gray-600'}`}>
                    {heatActive ? `${heatTemp}°C` : 'Inactive'}
                  </span>
                </div>
                <label className="text-xs text-gray-600">Temperature: {heatTemp}°C</label>
                <input type="range" min="38" max="42" step="0.5" value={heatTemp} onChange={e => setHeatTemp(Number(e.target.value))}
                  className="w-full" style={{ accentColor: '#EA580C' }} />
                <div className="flex justify-between text-xs text-gray-400"><span>38°C (Warm)</span><span>40°C</span><span>42°C (Max safe)</span></div>
              </div>

              {/* Pain Before */}
              {!sessionActive && painAfter === null && (
                <div className="bg-gray-50 p-3 rounded-xl">
                  <label className="text-xs text-gray-600">Current pain level: {painBefore}/10</label>
                  <input type="range" min="0" max="10" value={painBefore} onChange={e => setPainBefore(Number(e.target.value))} className="w-full" />
                </div>
              )}

              {/* Session Controls */}
              {!sessionActive && painAfter === null && (
                <button onClick={handleStartSession}
                  className="w-full py-3 bg-brand-500 text-white rounded-xl font-semibold hover:bg-brand-600 text-lg">
                  ▶ Start Therapy Session
                </button>
              )}

              {sessionActive && (
                <div className="bg-brand-50 p-4 rounded-xl text-center">
                  <p className="text-xs text-brand-600 font-medium">Session Active</p>
                  <p className="text-4xl font-bold text-brand-800 my-2 font-mono">{formatTime(sessionSeconds)}</p>
                  <div className="flex gap-2 text-xs text-gray-500 justify-center mb-3">
                    <span>⚡ {tensIntensity}%</span>
                    <span>•</span>
                    <span>{tensFrequency}Hz</span>
                    <span>•</span>
                    <span>🌡️ {heatTemp}°C</span>
                  </div>
                  <button onClick={handleStopSession}
                    className="px-8 py-2 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600">
                    ⏹ Stop Session
                  </button>
                </div>
              )}

              {/* Pain After Rating */}
              {painAfter !== null && !sessionActive && (
                <div className="bg-green-50 p-4 rounded-xl">
                  <p className="text-sm font-semibold text-green-800 mb-2">Rate your pain now (after therapy):</p>
                  <div className="flex gap-1 justify-center mb-3">
                    {Array.from({ length: 11 }).map((_, i) => (
                      <button key={i} onClick={() => saveSession(i)}
                        className={`w-8 h-8 rounded-lg text-xs font-bold transition ${
                          i <= 3 ? 'bg-green-100 hover:bg-green-300 text-green-800' :
                          i <= 6 ? 'bg-yellow-100 hover:bg-yellow-300 text-yellow-800' :
                          'bg-red-100 hover:bg-red-300 text-red-800'
                        }`}>
                        {i}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 text-center">Pain before: {painBefore}/10 • Session: {formatTime(sessionSeconds)}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Therapy History */}
        <div className="glass-card p-6">
          <h3 className="font-bold text-gray-900 mb-4">Therapy History</h3>

          {/* ---- personal calibration status ---- */}
          {calibration && (
            calibration.active ? (
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 mb-4">
                <p className="text-sm font-semibold text-purple-800">
                  Personal calibration active
                </p>
                <p className="text-xs text-purple-600 mt-1">
                  Across your last {calibration.sessions} sessions you reported pain
                  {' '}<strong>{calibration.offset > 0 ? `${calibration.offset} higher` : `${Math.abs(calibration.offset)} lower`}</strong>
                  {' '}than the model predicted, so your predictions are now shifted
                  {' '}{calibration.offset > 0 ? 'up' : 'down'} to match you.
                </p>
              </div>
            ) : (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-4">
                <p className="text-xs text-gray-600">
                  Personal calibration: <strong>{calibration.sessions || 0} of {calibration.needed || 5}</strong> sessions recorded.
                  {' '}Rate your pain after each session to tune predictions to you.
                </p>
              </div>
            )
          )}

          {history.length === 0 ? (
            <div className="text-center py-12">
              <span className="text-4xl">📊</span>
              <p className="text-gray-400 mt-2">No therapy sessions yet</p>
              <p className="text-xs text-gray-400 mt-1">Complete a session to see your history</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-purple-50 p-3 rounded-xl text-center">
                  <p className="text-xs text-purple-600">Total Sessions</p>
                  <p className="text-xl font-bold text-purple-800">{history.length}</p>
                </div>
                <div className="bg-green-50 p-3 rounded-xl text-center">
                  <p className="text-xs text-green-600">Avg Improvement</p>
                  <p className="text-xl font-bold text-green-800">
                    {history.length > 0 ? (history.reduce((s, h) => s + (h.improvement || 0), 0) / history.length).toFixed(1) : 0}
                  </p>
                </div>
                <div className="bg-blue-50 p-3 rounded-xl text-center">
                  <p className="text-xs text-blue-600">Total Time</p>
                  <p className="text-xl font-bold text-blue-800">
                    {Math.round(history.reduce((s, h) => s + (h.durationSeconds || 0), 0) / 60)}m
                  </p>
                </div>
              </div>

              {/* Session list */}
              {history.map((session, i) => (
                <div key={i} className="border border-gray-100 rounded-xl p-3">
                  <div className="flex justify-between items-start mb-2">
                    <p className="text-xs text-gray-400">{session.date}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      session.improvement > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {session.improvement > 0 ? `↓ ${session.improvement} pain` : 'No change'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1">
                      <span className="text-red-500 font-bold">{session.painBefore}</span>
                      <span className="text-gray-400">→</span>
                      <span className="text-green-500 font-bold">{session.painAfter}</span>
                    </div>
                    <span className="text-xs text-gray-400">⏱ {session.duration}</span>
                    <span className="text-xs text-gray-400">⚡ {session.tensIntensity}%</span>
                    <span className="text-xs text-gray-400">🌡️ {session.heatTemp}°C</span>
                  </div>
                </div>
              ))}

              <button onClick={() => { setHistory([]); localStorage.removeItem('neurorelief_therapy_history') }}
                className="w-full py-2 text-xs text-red-500 hover:text-red-700">Clear History</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
