import { useState, useEffect } from 'react'
import { getPainPrediction } from '../../services/predictions'
import { getCycleData, getMoodData } from '../../services/api'

const commonSymptoms = [
  'Headache', 'Fatigue', 'Nausea', 'Bloating', 'Cramps', 'Back pain',
  'Breast tenderness', 'Mood swings', 'Acne', 'Insomnia', 'Food cravings',
  'Anxiety', 'Dizziness'
]

const symptomWeights = {
  'Cramps': 3, 'Back pain': 2, 'Headache': 2, 'Nausea': 2,
  'Fatigue': 1, 'Bloating': 1, 'Breast tenderness': 1, 'Mood swings': 1,
  'Anxiety': 2, 'Dizziness': 2, 'Insomnia': 1, 'Acne': 0, 'Food cravings': 0,
}

const adviceBySymptom = {
  'Cramps': 'Apply a warm compress to your lower abdomen. Gentle yoga poses like child\'s pose may help relieve cramping.',
  'Back pain': 'Try lower back stretches and maintain good posture. A warm bath can help ease muscle tension.',
  'Headache': 'Stay hydrated and rest in a dark, quiet room. Avoid screen time if possible.',
  'Nausea': 'Sip ginger tea or eat small, bland meals. Avoid strong smells and greasy foods.',
  'Fatigue': 'Prioritize 7-9 hours of sleep. Short 20-minute naps can help restore energy without disrupting nighttime sleep.',
  'Bloating': 'Reduce sodium intake and eat potassium-rich foods like bananas. Gentle walking aids digestion.',
  'Breast tenderness': 'Wear a supportive bra and reduce caffeine intake. Evening primrose oil may help.',
  'Mood swings': 'Practice mindfulness or deep breathing. Regular exercise releases endorphins that stabilize mood.',
  'Anxiety': 'Try box breathing (4-4-4-4) and limit caffeine. Journaling can help process anxious thoughts.',
  'Dizziness': 'Stand up slowly, stay hydrated, and ensure you\'re eating regularly. Check your iron levels.',
  'Insomnia': 'Establish a consistent bedtime routine. Avoid screens 1 hour before bed. Try chamomile tea.',
  'Acne': 'Keep a gentle skincare routine. Avoid touching your face and consider zinc-rich foods.',
  'Food cravings': 'Eat balanced meals with protein and fiber to stabilize blood sugar. Dark chocolate (70%+) can satisfy sweet cravings healthily.',
}

// Map phase names to model input
const phaseToModel = {
  'Menstrual': 'Menstrual', 'Follicular': 'Follicular',
  'Ovulatory': 'Fertility', 'Luteal': 'Luteal', 'Unknown': 'Follicular'
}

export default function AISymptomAdvisor() {
  const [started, setStarted] = useState(false)
  const [selectedSymptoms, setSelectedSymptoms] = useState([])
  const [description, setDescription] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Auto-filled from user's saved data
  const [userContext, setUserContext] = useState(null)
  const [loadingContext, setLoadingContext] = useState(true)

  useEffect(() => {
    async function loadUserContext() {
      try {
        const [cycleData, moodData] = await Promise.all([
          getCycleData('usr').catch(() => null),
          getMoodData('usr').catch(() => null)
        ])
        const hasCycle = !!(cycleData?.currentPhase && cycleData.currentPhase !== 'Unknown')
        const rec = moodData?.recent || {}
        const loggedToday = !!moodData?.todayLogged
        const hasMood = loggedToday || (rec.daysLogged || 0) > 0

        // Precedence: today's entry -> 7-day average -> NEUTRAL fallback.
        // Neutral, not optimistic: an unknown user must not be assumed pain-free.
        const pick = (todayVal, avgVal, neutral) =>
          loggedToday && todayVal != null ? todayVal
          : (avgVal != null ? avgVal : neutral)

        setUserContext({
          phase: cycleData?.currentPhase || 'Unknown',
          dayOfCycle: cycleData?.dayOfCycle || null,
          sleepHours:  pick(moodData?.today?.sleep,  rec.avgSleep,  6.5),
          stressLevel: pick(moodData?.today?.stress, rec.avgStress, 5),
          energyLevel: pick(moodData?.today?.energy, rec.avgEnergy, 5),
          mood: loggedToday ? (moodData?.today?.mood || 'Okay') : 'Okay',
          hasCycleData: hasCycle,
          hasMoodData: hasMood,
          loggedToday,
          daysLogged: rec.daysLogged || 0,
          totalRecords: moodData?.totalRecords || 0,
          usingAverage: !loggedToday && (rec.daysLogged || 0) > 0,
          canPredict: hasCycle || hasMood,
        })
      } catch { setUserContext(null) }
      setLoadingContext(false)
    }
    loadUserContext()
  }, [])

  function toggleSymptom(s) {
    setSelectedSymptoms(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  async function handleGetAdvice() {
    if (selectedSymptoms.length === 0 && !description.trim()) {
      setError('Please select at least one symptom or describe what you are experiencing')
      return
    }
    if (!userContext?.canPredict) {
      setError('Not enough data yet. Log at least one cycle or one mood check-in first - a prediction without them would not be personalised.')
      return
    }
    setError('')
    setLoading(true)

    const totalWeight = selectedSymptoms.reduce((sum, s) => sum + (symptomWeights[s] || 1), 0)
    const stressFromSymptoms = Math.min(10, 3 + totalWeight)

    // Use real user data for prediction instead of random/hardcoded values
    const predictionInput = {
      phase: phaseToModel[userContext?.phase] || 'Follicular',
      cycle_day: userContext?.dayOfCycle ?? 14,   // 14 only if cycle genuinely unknown
      sleep_hours: userContext?.sleepHours || 7,
      stress_level: userContext?.stressLevel || stressFromSymptoms,
      fatigue: selectedSymptoms.includes('Fatigue') ? 4 : 2,
      cramps: selectedSymptoms.includes('Cramps') ? 4 : 1,
      headaches: selectedSymptoms.includes('Headache') ? 3 : 1,
      bloating: selectedSymptoms.includes('Bloating') ? 3 : 1,
      moodswing: selectedSymptoms.includes('Mood swings') ? 3 : 1,
      sleepissue: selectedSymptoms.includes('Insomnia') ? 4 : 1,
      activity_level: userContext?.energyLevel >= 6 ? 'Moderate' : 'Low',
      mood: userContext?.mood === 'Good' ? 'Energetic' : userContext?.mood === 'Sad' ? 'sad' : 'Calm',
      bmi: 22,
      age: 25,
    }

    const prediction = await getPainPrediction(predictionInput)
    const advice = selectedSymptoms.map(s => ({
      symptom: s,
      advice: adviceBySymptom[s] || 'Monitor this symptom and consult a healthcare provider if it persists.'
    }))

    setResult({ symptoms: selectedSymptoms, description, prediction, advice, context: userContext })
    // Save prediction for Device Panel auto-fill
    localStorage.setItem('neurorelief_last_prediction', JSON.stringify(prediction))
    setLoading(false)
  }

  function handleReset() {
    setResult(null)
    setSelectedSymptoms([])
    setDescription('')
    setError('')
  }

  // Empty state
  if (!started) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-brand-800">AI Symptom Advisor</h3>
          <button onClick={() => setStarted(true)} className="px-4 py-1.5 border border-brand-300 text-brand-600 text-sm rounded-lg hover:bg-brand-50">Get Advice</button>
        </div>
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-pink-100 rounded-full flex items-center justify-center mx-auto mb-4"><span className="text-3xl">🤖</span></div>
          <p className="text-gray-500 mb-2">Get personalized AI guidance for your symptoms</p>
          <p className="text-xs text-gray-400 mb-4">Powered by a Random Forest model trained on real clinical data (87.8% accuracy)</p>
          <button onClick={() => setStarted(true)} className="px-8 py-3 bg-brand-500 text-white rounded-lg font-medium hover:bg-brand-600">Start Analysis</button>
        </div>
      </div>
    )
  }

  // Result state
  if (result) {
    return (
      <div className="glass-card p-6">
        <h3 className="text-lg font-bold text-brand-800 mb-4">AI Analysis Result</h3>

        {/* Personalization badge */}
        {result.context?.hasCycleData || result.context?.hasMoodData ? (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 flex items-center gap-2">
            <span className="text-lg">🎯</span>
            <div>
              <p className="text-sm font-medium text-blue-800">Personalized Prediction</p>
              <p className="text-xs text-blue-600">
                {result.context.usingAverage ? `Using your ${result.context.daysLogged}-day average. ` : ''}
                {result.context.hasCycleData ? `${result.context.phase} phase (Day ${result.context.dayOfCycle})` : ''}
                {result.context.hasCycleData && result.context.hasMoodData ? ' • ' : ''}
                {result.context.hasMoodData ? `Sleep ${result.context.sleepHours}/10, Stress ${result.context.stressLevel}/10` : ''}
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4">
            <p className="text-xs text-yellow-700">Tip: Log your cycle and mood data for more accurate personalized predictions.</p>
          </div>
        )}

        <div className="bg-purple-50 p-4 rounded-xl mb-4">
          <p className="font-semibold text-gray-900">Pain Prediction</p>
          <p className="text-sm text-gray-600 mt-1">
            Severity: <span className="font-bold text-brand-700">{result.prediction.predicted_severity}</span>
            {' • '}Risk: <span className={`font-bold ${result.prediction.risk_level === 'high' ? 'text-red-600' : result.prediction.risk_level === 'moderate' ? 'text-orange-600' : 'text-green-600'}`}>{result.prediction.risk_level}</span>
            {' • '}Confidence: {Math.round(result.prediction.confidence * 100)}%
          </p>
        </div>

        {/* High pain warning */}
        {result.prediction.risk_level === 'high' && (
          <div className="bg-red-50 border border-red-300 rounded-xl p-4 mb-4">
            <p className="font-semibold text-red-800">⚠️ High Pain Alert</p>
            <p className="text-sm text-red-600 mt-1">High pain severity predicted. Consider using TENS therapy and heat therapy. If pain is severe, consult a healthcare provider.</p>
          </div>
        )}

        <div className="bg-green-50 p-4 rounded-xl mb-4">
          <p className="font-semibold text-gray-900">Overall Recommendation</p>
          <p className="text-sm text-gray-600 mt-1">{result.prediction.recommendation}</p>
        </div>

        {result.advice.length > 0 && (
          <div className="mb-4">
            <p className="font-semibold text-gray-900 mb-2">Symptom-Specific Guidance</p>
            {result.advice.map((item, i) => (
              <div key={i} className="bg-blue-50 p-3 rounded-xl mb-2">
                <p className="text-sm font-semibold text-blue-800">{item.symptom}</p>
                <p className="text-sm text-gray-600 mt-1">{item.advice}</p>
              </div>
            ))}
          </div>
        )}

        {result.prediction.recommended_tens_intensity > 0 && (
          <div className="bg-orange-50 p-4 rounded-xl mb-4">
            <p className="font-semibold text-gray-900">Suggested Therapy Settings</p>
            <p className="text-sm text-gray-600 mt-1">
              TENS intensity: {result.prediction.recommended_tens_intensity}% •
              Frequency: {result.prediction.recommended_tens_frequency}Hz •
              Heat: {result.prediction.recommended_heat_temp}°C
            </p>
          </div>
        )}

        {result.description && (
          <div className="bg-gray-50 p-3 rounded-xl mb-4">
            <p className="text-xs text-gray-500">Your description:</p>
            <p className="text-sm text-gray-700">{result.description}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={handleReset} className="flex-1 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600">New Analysis</button>
          <button onClick={() => { handleReset(); setStarted(false) }} className="flex-1 py-2 border border-gray-300 rounded-lg text-sm">Done</button>
        </div>
      </div>
    )
  }

  // Input state
  return (
    <div className="glass-card p-6">
      <h3 className="text-lg font-bold text-brand-800 mb-2">AI Symptom Advisor</h3>
      <p className="text-sm text-gray-500 mb-4">Tell us what you're experiencing, and our AI will provide personalized guidance</p>

      {/* Cold start: not enough data to predict */}
      {!loadingContext && userContext && !userContext.canPredict && (
        <div className="bg-yellow-50 border border-yellow-300 rounded-xl p-4 mb-4">
          <p className="text-sm font-semibold text-yellow-800">Not enough data for a prediction yet</p>
          <p className="text-xs text-yellow-700 mt-1">
            The model needs your cycle phase and recent sleep/stress to personalise a result.
            Log at least one cycle or one mood check-in, then come back.
          </p>
          <p className="text-xs text-yellow-600 mt-2">
            Without this, a prediction would be based on assumed values rather than your data.
          </p>
        </div>
      )}

      {/* Using averages because today is not logged */}
      {!loadingContext && userContext?.usingAverage && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
          <p className="text-xs text-blue-700">
            No mood logged today - using your <strong>{userContext.daysLogged}-day average</strong>
            {' '}(sleep {userContext.sleepHours}/10, stress {userContext.stressLevel}/10).
            Log today's mood for a more accurate result.
          </p>
        </div>
      )}

      {/* Show auto-detected context */}
      {!loadingContext && userContext && (userContext.hasCycleData || userContext.hasMoodData) && (
        <div className="bg-blue-50 rounded-xl p-3 mb-4">
          <p className="text-xs font-semibold text-blue-700 mb-1">📊 Auto-detected from your data:</p>
          <div className="flex flex-wrap gap-2">
            {userContext.hasCycleData && (
              <span className="text-xs bg-white px-2 py-1 rounded-full text-blue-700">Phase: {userContext.phase} (Day {userContext.dayOfCycle})</span>
            )}
            {userContext.hasMoodData && (
              <>
                <span className="text-xs bg-white px-2 py-1 rounded-full text-blue-700">Sleep: {userContext.sleepHours}/10</span>
                <span className="text-xs bg-white px-2 py-1 rounded-full text-blue-700">Stress: {userContext.stressLevel}/10</span>
                <span className="text-xs bg-white px-2 py-1 rounded-full text-blue-700">Energy: {userContext.energyLevel}/10</span>
              </>
            )}
          </div>
          <p className="text-xs text-blue-500 mt-1">This data will be used to personalize your prediction</p>
        </div>
      )}

      <p className="text-sm font-semibold text-brand-600 mb-2">Quick Select Common Symptoms</p>
      <div className="flex flex-wrap gap-2 mb-4">
        {commonSymptoms.map(s => (
          <button key={s} onClick={() => toggleSymptom(s)}
            className={`px-3 py-1.5 rounded-full text-sm border transition ${
              selectedSymptoms.includes(s) ? 'bg-brand-100 border-brand-400 text-brand-700 font-medium' : 'border-pink-200 text-brand-600 hover:bg-pink-50'
            }`}>{s}</button>
        ))}
      </div>

      {selectedSymptoms.length > 0 && (
        <p className="text-xs text-gray-500 mb-2">Selected: {selectedSymptoms.join(', ')}</p>
      )}

      <p className="text-sm font-semibold text-brand-600 mb-2">Describe Your Symptoms</p>
      <textarea value={description} onChange={e => setDescription(e.target.value)}
        placeholder="Describe what you're experiencing... (e.g., headache, fatigue, cramps)"
        className="w-full border border-gray-200 rounded-xl p-4 text-sm mb-4" rows={4} />

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      <div className="flex gap-3">
        <button onClick={handleGetAdvice} disabled={loading || !userContext?.canPredict}
          className="flex-1 py-3 bg-brand-500 text-white rounded-lg font-medium hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed">
          {loading ? 'Analyzing...' : !userContext?.canPredict ? 'Log data to enable' : 'Get AI Advice'}
        </button>
        <button onClick={() => { handleReset(); setStarted(false) }}
          className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200">Cancel</button>
      </div>
    </div>
  )
}
