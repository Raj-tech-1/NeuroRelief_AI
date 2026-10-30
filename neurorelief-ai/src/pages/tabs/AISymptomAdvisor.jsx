import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../../i18n/format'
import { localizeFixed } from '../../i18n/serverText'
import EnglishOnly from '../../components/EnglishOnly'
import VoiceAssistant from '../../components/VoiceAssistant'
import { getPainPrediction } from '../../services/predictions'
import { getCycleData, getMoodData, getPredictionHistory, getArticles } from '../../services/api'
import { Icon } from '../../components/icons'
import imgWater from '../../assets/illustrations/tip-water.svg'
import imgNutrition from '../../assets/illustrations/tip-nutrition.svg'
import imgMovement from '../../assets/illustrations/tip-movement.svg'
import imgSleep from '../../assets/illustrations/tip-sleep.svg'
import imgPain from '../../assets/illustrations/res-pain.svg'
import imgDoctor from '../../assets/illustrations/res-doctor.svg'
import imgSunrise from '../../assets/illustrations/res-sunrise.svg'

const commonSymptoms = [
  'Headache', 'Fatigue', 'Nausea', 'Bloating', 'Cramps', 'Back pain',
  'Breast tenderness', 'Mood swings', 'Acne', 'Insomnia', 'Food cravings',
  'Anxiety', 'Dizziness'
]

// Display order, icon and label for the symptom tiles (the stored symptom names are unchanged)
const tiles = [
  { name: 'Cramps', icon: 'uterus' }, { name: 'Bloating', icon: 'stomach' }, { name: 'Headache', icon: 'head' },
  { name: 'Mood swings', icon: 'smile' }, { name: 'Acne', icon: 'face' }, { name: 'Fatigue', icon: 'battery' },
  { name: 'Back pain', icon: 'spine' }, { name: 'Nausea', icon: 'stomach' }, { name: 'Breast tenderness', icon: 'heart' },
  { name: 'Insomnia', icon: 'moon' }, { name: 'Food cravings', icon: 'bowl' }, { name: 'Anxiety', icon: 'brain' }, { name: 'Dizziness', icon: 'dizzy' },
]

// "Quick options" shortcuts: [label translation key, stored symptom name]
const quickOptions = [
  ['symptom.Cramps', 'Cramps'], ['symptom.Bloating', 'Bloating'], ['symptom.Headache', 'Headache'], ['symptom.Back pain', 'Back pain'],
  ['quick.moodChanges', 'Mood swings'], ['symptom.Fatigue', 'Fatigue'], ['symptom.Acne', 'Acne'], ['quick.sleepIssues', 'Insomnia'],
]

const symptomWeights = {
  'Cramps': 3, 'Back pain': 2, 'Headache': 2, 'Nausea': 2,
  'Fatigue': 1, 'Bloating': 1, 'Breast tenderness': 1, 'Mood swings': 1,
  'Anxiety': 2, 'Dizziness': 2, 'Insomnia': 1, 'Acne': 0, 'Food cravings': 0,
}

// Map phase names to model input
const phaseToModel = {
  'Menstrual': 'Menstrual', 'Follicular': 'Follicular',
  'Ovulatory': 'Fertility', 'Luteal': 'Luteal', 'Unknown': 'Follicular'
}

// Wellness tips (general educational content): title/text come from advisor.tip.<id>
const wellnessTips = [
  { id: 'water', img: imgWater },
  { id: 'nutrition', img: imgNutrition },
  { id: 'movement', img: imgMovement },
  { id: 'sleep', img: imgSleep },
]
const RESOURCE_IDS = [8, 3, 2, 14]            // existing Learn articles
const resourceImages = [imgPain, imgSunrise, imgNutrition, imgDoctor]

const card = 'bg-white/90 rounded-2xl border border-brand-100/70 shadow-sm shadow-brand-100/50'

function CardHeader({ id, icon, title, subtitle, right }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-2.5 fit-hdr">
      <div className="flex items-center gap-3 min-w-0">
        <span className="shrink-0 fit-ico rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name={icon} size={20} /></span>
        <div className="min-w-0">
          <h2 id={id} className="font-display text-lg font-bold text-gray-900 leading-tight break-words">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 short-hide">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  )
}

export default function AISymptomAdvisor({ onTabChange }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const [selectedSymptoms, setSelectedSymptoms] = useState([])
  const [description, setDescription] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)   // { key } | { text } so it follows the selected language
  const [history, setHistory] = useState([])
  const [articles, setArticles] = useState([])
  const textareaRef = useRef(null)

  // Auto-filled from user's saved data
  const [userContext, setUserContext] = useState(null)
  const [loadingContext, setLoadingContext] = useState(true)
  const [voiceOpen, setVoiceOpen] = useState(false)

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
    getPredictionHistory().then(setHistory).catch(() => {})
    getArticles().then(all => setArticles(RESOURCE_IDS.map(id => all.find(a => a.id === id)).filter(Boolean))).catch(() => {})
  }, [])

  function toggleSymptom(s) {
    setSelectedSymptoms(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  async function handleGetAdvice() {
    if (selectedSymptoms.length === 0 && !description.trim()) {
      setError({ key: 'advisor.err.pickOne' })
      return
    }
    if (!userContext?.canPredict) {
      setError({ key: 'advisor.err.notEnough' })
      return
    }
    setError(null)
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

    let prediction
    try {
      prediction = await getPainPrediction(predictionInput)
    } catch (err) {
      // No fabricated result: drop any stale prediction so the Device Panel cannot apply it
      localStorage.removeItem('neurorelief_last_prediction')
      setResult(null)
      setError({ key: `advisor.err.${err.code || 'generic'}` })
      setLoading(false)
      return
    }
    const advice = selectedSymptoms.map(s => ({ symptom: s }))   // guidance text is looked up per language at render

    setResult({ symptoms: selectedSymptoms, description, prediction, advice, context: userContext })
    // Save prediction for Device Panel auto-fill
    localStorage.setItem('neurorelief_last_prediction', JSON.stringify(prediction))
    setLoading(false)
    getPredictionHistory().then(setHistory).catch(() => {})
  }

  function handleReset() {
    setResult(null)
    setSelectedSymptoms([])
    setDescription('')
    setError(null)
  }

  const focusInput = () => textareaRef.current?.focus()
  const todayLabel = fmt.date(Date.now())
  const cannotPredict = !loadingContext && !userContext?.canPredict
  const tPhase = ph => t(`phase.${ph}`, { defaultValue: ph })
  const tSev = sv => t(`severity.${sv}`, { defaultValue: sv })
  const pct = c => fmt.number(Math.round((c || 0) * 100))
  // recommendation text comes from the model service as one of three fixed English sentences;
  // known sentences are shown in the selected language, anything else is shown as-is and marked English-only
  const recText = result ? localizeFixed('recommendation', result.prediction.recommendation) : null

  // "Today's Insight" and "AI Pain Prediction" only ever show real data
  const insight = result
    ? { title: t('advisor.pred', { severity: tSev(result.prediction.predicted_severity) }), text: recText.text, englishOnly: recText.englishOnly }
    : cannotPredict
      ? { title: t('advisor.notEnoughTitle'), text: t('advisor.notEnoughText') }
      : userContext?.hasCycleData
        ? { title: t('advisor.phaseDayTitle', { phase: tPhase(userContext.phase), day: fmt.number(userContext.dayOfCycle) }), text: userContext.usingAverage ? t('advisor.usingAvgText', { days: fmt.number(userContext.daysLogged) }) : t('advisor.describePersonal') }
        : { title: t('advisor.noSymptoms'), text: t('advisor.shareFeeling') }

  const latest = result?.prediction
    ? { severity: result.prediction.predicted_severity, confidence: result.prediction.confidence, when: t('advisor.justNow') }
    : history[0] ? { severity: history[0].predicted_severity, confidence: history[0].confidence, when: fmt.isoDate(history[0].date) } : null

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_312px] gap-3 fit-gap xl:h-full xl:min-h-0">
      {/* ---------------- Left column ---------------- */}
      <div className="flex flex-col gap-3 fit-gap min-w-0 xl:min-h-0">
        {/* Describe your symptoms */}
        <section className={`${card} fit-card shrink-0`} aria-labelledby="describe-h">
          <div className="flex items-center gap-3 mb-2.5 fit-hdr">
            <span className="shrink-0 fit-ico rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="message" size={20} /></span>
            <div className="min-w-0 mr-auto">
              <h2 id="describe-h" className="font-display text-xl font-bold text-gray-900 leading-tight">{t('advisor.describe')}</h2>
              <p className="text-xs text-gray-500 short-hide">{t('advisor.describeSub')}</p>
            </div>
            <button onClick={() => setVoiceOpen(true)} aria-haspopup="dialog"
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-brand-200 text-brand-700 hover:bg-brand-50 text-xs font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-200">
              <Icon name="mic" size={16} /> {t('assistant.open')}
            </button>
          </div>

          <div className="relative rounded-xl border border-brand-100 bg-white focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-200/60 transition">
            <label htmlFor="symptom-text" className="sr-only">{t('advisor.describe')}</label>
            <textarea id="symptom-text" ref={textareaRef} value={description} maxLength={500} onChange={e => setDescription(e.target.value)}
              placeholder={t('advisor.placeholder')}
              className="sym-textarea w-full resize-none bg-transparent p-3 pb-9 text-sm focus:outline-none rounded-xl" />
            <span className="absolute bottom-3 right-44 text-xs text-gray-400" aria-live="off">{fmt.number(description.length)}/500</span>
            <button onClick={handleGetAdvice} disabled={loading || !userContext?.canPredict}
              className="absolute bottom-2 right-2 px-5 py-2 bg-brand-700 hover:bg-brand-800 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300">
              {loading ? t('advisor.analyzing') : cannotPredict ? t('advisor.logToEnable') : <>{t('advisor.getInsights')} <Icon name="arrow" size={16} /></>}
            </button>
          </div>
          {error && <p role="alert" className="text-xs text-red-600 mt-2">{error.key ? t(error.key) : error.text}</p>}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-gray-700">{t('advisor.quick')}</span>
            {quickOptions.map(([labelKey, name]) => (
              <button key={labelKey} onClick={() => toggleSymptom(name)} aria-pressed={selectedSymptoms.includes(name)}
                className={`px-2 py-0.5 rounded-full text-[11px] border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                  selectedSymptoms.includes(name) ? 'bg-brand-700 text-white border-brand-700' : 'bg-brand-50 text-brand-800 border-brand-100 hover:bg-brand-100'}`}>
                {t(labelKey)}
              </button>
            ))}
          </div>
        </section>

        {/* Middle: result, or common symptoms + recent check-ins */}
        {result ? (
          <section className={`${card} fit-card xl:flex-1 xl:min-h-0 flex flex-col`} aria-labelledby="result-h">
            <CardHeader id="result-h" icon="brain" title={t('advisor.resultTitle')} subtitle={t('advisor.resultSub')}
              right={<button onClick={handleReset} className="shrink-0 px-4 py-1.5 bg-brand-700 hover:bg-brand-800 text-white rounded-lg text-sm font-medium">{t('advisor.newAnalysis')}</button>} />
            <div className="xl:flex-1 xl:min-h-0 overflow-y-auto pr-1 space-y-3">
              {result.context?.hasCycleData || result.context?.hasMoodData ? (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center gap-2">
                  <Icon name="bolt" size={18} className="text-blue-600 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-blue-800">{t('advisor.personalized')}</p>
                    <p className="text-xs text-blue-600">
                      {result.context.usingAverage ? `${t('advisor.usingAverage', { days: fmt.number(result.context.daysLogged) })} ` : ''}
                      {result.context.hasCycleData ? t('advisor.phaseDay', { phase: tPhase(result.context.phase), day: fmt.number(result.context.dayOfCycle) }) : ''}
                      {result.context.hasCycleData && result.context.hasMoodData ? ' • ' : ''}
                      {result.context.hasMoodData ? t('advisor.sleepStress', { sleep: result.context.sleepHours, stress: result.context.stressLevel }) : ''}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
                  <p className="text-xs text-yellow-700">{t('advisor.logTip')}</p>
                </div>
              )}

              <div className="bg-purple-50 p-3 rounded-xl">
                <p className="font-semibold text-gray-900 text-sm">{t('advisor.painPrediction')}</p>
                <p className="text-sm text-gray-600 mt-1">
                  {t('advisor.severity')}: <span className="font-bold text-brand-700">{tSev(result.prediction.predicted_severity)}</span>
                  {' • '}{t('advisor.risk')}: <span className={`font-bold ${result.prediction.risk_level === 'high' ? 'text-red-600' : result.prediction.risk_level === 'moderate' ? 'text-orange-600' : 'text-green-600'}`}>{t(`riskLevel.${result.prediction.risk_level}`, { defaultValue: result.prediction.risk_level })}</span>
                  {' • '}{t('advisor.confidence')}: {pct(result.prediction.confidence)}%
                </p>
              </div>

              {result.prediction.risk_level === 'high' && (
                <div className="bg-red-50 border border-red-300 rounded-xl p-3">
                  <p className="font-semibold text-red-800 text-sm flex items-center gap-1.5"><Icon name="bolt" size={16} /> {t('advisor.highAlert')}</p>
                  <p className="text-xs text-red-600 mt-1">{t('advisor.highAlertText')}</p>
                </div>
              )}

              <div className="bg-green-50 p-3 rounded-xl">
                <p className="font-semibold text-gray-900 text-sm">{t('advisor.overall')}</p>
                <p className="text-sm text-gray-600 mt-1">{recText.text}{recText.englishOnly && <EnglishOnly />}</p>
              </div>

              {result.advice.length > 0 && (
                <div>
                  <p className="font-semibold text-gray-900 text-sm mb-2">{t('advisor.guidance')}</p>
                  <div className="grid md:grid-cols-2 gap-2">
                    {result.advice.map(item => (
                      <div key={item.symptom} className="bg-blue-50 p-3 rounded-xl">
                        <p className="text-sm font-semibold text-blue-800">{t(`symptom.${item.symptom}`, { defaultValue: item.symptom })}</p>
                        <p className="text-xs text-gray-600 mt-1">{t(`advice.${item.symptom}`, { defaultValue: t('advice.default') })}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.prediction.recommended_tens_intensity > 0 && (
                <div className="bg-orange-50 p-3 rounded-xl">
                  <p className="font-semibold text-gray-900 text-sm">{t('advisor.therapy')}</p>
                  <p className="text-sm text-gray-600 mt-1">
                    {t('advisor.therapyLine', { intensity: result.prediction.recommended_tens_intensity, freq: result.prediction.recommended_tens_frequency, heat: result.prediction.recommended_heat_temp })}
                  </p>
                </div>
              )}

              {result.description && (
                <div className="bg-gray-50 p-3 rounded-xl">
                  <p className="text-xs text-gray-500">{t('advisor.yourDescription')}</p>
                  <p className="text-sm text-gray-700">{result.description}</p>
                </div>
              )}
            </div>
          </section>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[1.25fr_1fr] gap-3 fit-gap xl:flex-1 xl:min-h-0">
            {/* Common symptoms */}
            <section className={`${card} fit-card flex flex-col min-h-0`} aria-labelledby="common-h">
              <CardHeader id="common-h" icon="heart" title={t('advisor.common')} subtitle={t('advisor.commonSub')}
                right={selectedSymptoms.length > 0 ? <span className="text-xs bg-brand-100 text-brand-800 px-2.5 py-1 rounded-full font-medium">{t('advisor.selected', { n: fmt.number(selectedSymptoms.length) })}</span> : null} />
              <div className="sym-grid xl:flex-1 xl:min-h-0 xl:overflow-y-auto pr-0.5 content-start">
                {tiles.map(tile => {
                  const on = selectedSymptoms.includes(tile.name)
                  return (
                    <button key={tile.name} onClick={() => toggleSymptom(tile.name)} aria-pressed={on}
                      className={`flex items-center gap-2 px-2.5 sym-tile rounded-xl border text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                        on ? 'bg-brand-100 border-brand-400 text-brand-900' : 'bg-white border-brand-100/80 text-gray-800 hover:bg-brand-50'}`}>
                      <Icon name={tile.icon} size={20} className="sym-t-ico shrink-0 text-brand-600" />
                      <span className="flex-1 text-xs font-medium leading-tight">{t(`symptomTile.${tile.name}`, { defaultValue: t(`symptom.${tile.name}`) })}</span>
                      <Icon name={on ? 'check' : 'chevron'} size={14} className={`sym-t-chev ${on ? 'text-brand-700' : 'text-gray-400'}`} />
                    </button>
                  )
                })}
              </div>
            </section>

            {/* Recent check-ins */}
            <section className={`${card} fit-card flex flex-col min-h-0`} aria-labelledby="recent-h">
              <CardHeader id="recent-h" icon="history" title={t('advisor.recentCheckins')} subtitle={t('advisor.recentSub')} />
              {history.length === 0 ? (
                <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center py-2">
                  <span className="w-12 h-12 rounded-xl bg-brand-50 text-brand-500 flex items-center justify-center mb-2"><Icon name="doc" size={24} /></span>
                  <p className="text-sm font-semibold text-gray-900">{t('advisor.noCheckins')}</p>
                  <p className="text-xs text-gray-500 mt-1 max-w-[230px]">{t('advisor.noCheckinsText')}</p>
                  <button onClick={focusInput} className="mt-3 px-5 py-2 bg-brand-700 hover:bg-brand-800 text-white rounded-lg text-sm font-semibold">{t('advisor.logFirst')}</button>
                </div>
              ) : (
                <ul className="xl:flex-1 xl:min-h-0 overflow-y-auto space-y-2 pr-0.5">
                  {history.slice(0, 8).map(h => (
                    <li key={h.pred_id} className="flex items-center gap-3 p-2.5 rounded-xl bg-brand-50/50 border border-brand-100/60">
                      <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${h.predicted_severity === 'High' ? 'bg-red-100 text-red-600' : h.predicted_severity === 'Moderate' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'}`}><Icon name="chart" size={16} /></span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-gray-900">{t('advisor.pred', { severity: tSev(h.predicted_severity) })}</span>
                        <span className="block text-xs text-gray-500">{t('advisor.confidencePct', { pct: pct(h.confidence) })}</span>
                      </span>
                      <span className="text-xs text-gray-400 shrink-0">{fmt.isoDate(h.date)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {/* Educational resources */}
        <section className={`${card} fit-card shrink-0`} aria-labelledby="edu-h">
          <CardHeader id="edu-h" icon="book" title={t('advisor.edu')} subtitle={t('advisor.eduSub')}
            right={<button onClick={() => onTabChange && onTabChange('learn')} className="shrink-0 text-xs font-semibold text-brand-700 hover:underline">{t('advisor.viewAll')}</button>} />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {articles.map((a, i) => (
              <button key={a.id} onClick={() => onTabChange && onTabChange('learn')}
                className="flex items-center gap-2 p-1.5 pr-2 rounded-xl border border-brand-100/70 bg-white hover:bg-brand-50/50 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                <img src={resourceImages[i]} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0" />
                <span className="flex-1 min-w-0 text-[11px] font-semibold text-gray-900 leading-[1.2] break-words">{t(`articles.${a.id}.title`, { defaultValue: a.title })}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* ---------------- Right column ---------------- */}
      <div className="flex flex-col gap-3 fit-gap min-w-0 xl:min-h-0">
        <section className={`${card} fit-card shrink-0`} aria-labelledby="insight-h">
          <CardHeader id="insight-h" icon="bulb" title={t('advisor.todaysInsight')} right={<span className="text-[11px] text-gray-500 pt-1 whitespace-nowrap">{todayLabel}</span>} />
          <div className={`rounded-xl p-3 flex items-start gap-3 ${cannotPredict ? 'bg-yellow-50' : 'bg-brand-50/80'}`}>
            <span className="fit-deco shrink-0 w-10 h-10 rounded-full bg-white text-brand-500 flex items-center justify-center"><Icon name="heart" size={20} /></span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">{insight.title}</p>
              <p className="text-xs text-gray-600 mt-0.5">{insight.text}{insight.englishOnly && <EnglishOnly />}</p>
            </div>
          </div>
        </section>

        <section className={`${card} fit-card shrink-0`} aria-labelledby="pred-h">
          <div className="flex items-center gap-3">
            <span className="fit-deco shrink-0 w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center"><Icon name="chart" size={24} /></span>
            <div className="flex-1 min-w-0">
              <h2 id="pred-h" className="text-sm font-semibold text-gray-900">{t('advisor.predTitle')}</h2>
              <p className="font-display text-xl font-bold text-gray-900 leading-tight">{latest ? tSev(latest.severity) : t('advisor.notAvailable')}</p>
              <p className="text-xs text-gray-500">{latest ? t('advisor.confWhen', { pct: pct(latest.confidence), when: latest.when }) : t('advisor.predHint')}</p>
            </div>
            <button onClick={focusInput} aria-label={t('advisor.describe')} className="shrink-0 p-1.5 text-gray-400 hover:text-brand-700"><Icon name="chevron" size={18} /></button>
          </div>
        </section>

        <section className={`${card} fit-card flex flex-col xl:flex-1 xl:min-h-0`} aria-labelledby="tips-h">
          <CardHeader id="tips-h" icon="leaf" title={t('advisor.tips')} right={<button onClick={() => onTabChange && onTabChange('learn')} className="shrink-0 text-xs font-semibold text-brand-700 hover:underline pt-1">{t('advisor.viewAll')}</button>} />
          <ul className="sym-tips grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2 xl:flex-1 xl:min-h-0 xl:overflow-y-auto pr-0.5">
            {wellnessTips.map(tip => (
              <li key={tip.id} className="flex items-center gap-3 p-1.5 rounded-xl border border-brand-100/70 bg-white">
                <img src={tip.img} alt="" className="sym-tip-img rounded-lg object-cover shrink-0" />
                <div className="min-w-0">
                  <p className="sym-tip-title font-semibold text-gray-900">{t(`advisor.tip.${tip.id}.title`)}</p>
                  <p className="sym-tip-desc text-gray-500">{t(`advisor.tip.${tip.id}.text`)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <VoiceAssistant open={voiceOpen} onClose={() => setVoiceOpen(false)} />
    </div>
  )
}
