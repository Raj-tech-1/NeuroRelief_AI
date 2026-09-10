import Spinner from '../../components/Spinner'
import { useState, useEffect } from 'react'
import { getCycleData, addCycle } from '../../services/api'
import { downloadCSV } from '../../components/ExportCSV'
import PainCalendar from '../../components/PainCalendar'

function getInsightsForPhase(phase) {
  const insights = {
    'Menstrual': { description: "You're in your menstrual phase. Focus on rest, gentle movement, and iron-rich foods.", recommendations: ['Rest and gentle stretching', 'Eat iron-rich foods', 'Stay hydrated', 'Use heat therapy for cramps'] },
    'Follicular': { description: "You're in the follicular phase. Energy is rising — great time for new projects.", recommendations: ['Increase magnesium-rich foods', 'Try higher-intensity workouts', 'Start new projects or goals'] },
    'Ovulatory': { description: "You're in the ovulatory phase. Energy and confidence are at their peak.", recommendations: ['Take on challenging workouts', 'Schedule important meetings', 'Eat anti-inflammatory foods'] },
    'Luteal': { description: "You're in the luteal phase. Good time for self-care and preparing for your period.", recommendations: ['Increase magnesium-rich foods', 'Practice gentle yoga', 'Maintain regular sleep schedule'] },
    'Unknown': { description: 'Add your first cycle to get personalized insights.', recommendations: ['Start tracking your cycle', 'Log your symptoms daily', 'Record your mood and energy'] },
  }
  return insights[phase] || insights['Unknown']
}

export default function CycleTracking() {
  const [showAddCycle, setShowAddCycle] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [flow, setFlow] = useState('Medium')
  const [mood, setMood] = useState('Normal')
  const [cycleLength, setCycleLength] = useState(28)
  const [saveMsg, setSaveMsg] = useState('')
  const [loading, setLoading] = useState(true)

  // Data from backend
  const [currentPhase, setCurrentPhase] = useState('Unknown')
  const [dayOfCycle, setDayOfCycle] = useState(null)
  const [nextPeriod, setNextPeriod] = useState('-')
  const [fertileWindow, setFertileWindow] = useState({ start: '-', end: '-' })
  const [lastCycle, setLastCycle] = useState(null)
  const [cycles, setCycles] = useState([])
  const [insights, setInsights] = useState(getInsightsForPhase('Unknown'))

  async function fetchData() {
    try {
      const data = await getCycleData('usr')
      setCurrentPhase(data.currentPhase || 'Unknown')
      setDayOfCycle(data.dayOfCycle || null)
      setNextPeriod(data.nextPeriod || '-')
      setFertileWindow(data.fertileWindow || { start: '-', end: '-' })
      setLastCycle(data.lastCycle || null)
      setCycles(data.cycles || [])
      setInsights(data.insights || getInsightsForPhase(data.currentPhase))
    } catch (err) {
      console.error('Failed to fetch cycle data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  async function handleSaveCycle() {
    if (!startDate) { setSaveMsg('Please select a start date'); return }
    await addCycle('usr', { startDate, endDate, cycleLength, flow, mood })
    setSaveMsg('Cycle saved!')
    setStartDate('')
    setEndDate('')
    setFlow('Medium')
    setMood('Normal')
    setCycleLength(28)
    // Refresh data from backend
    await fetchData()
    setTimeout(() => { setSaveMsg(''); setShowAddCycle(false) }, 1000)
  }

  if (loading) return <Spinner text="Loading cycle data..." />

  return (
    <>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Left: Cycle Tracker */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-gray-900">Cycle Tracker</h3>
          <button
            onClick={() => { setShowAddCycle(!showAddCycle); setSaveMsg('') }}
            className="px-4 py-1.5 border border-brand-300 text-brand-600 text-sm rounded-lg hover:bg-brand-50 transition"
          >
            {showAddCycle ? 'Cancel' : 'Add Cycle'}
          </button>
        </div>

        {showAddCycle && (
          <div className="mb-4 p-4 bg-brand-50 rounded-xl space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Period start date *</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Period end date (optional)</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cycle length (days)</label>
              <input type="number" value={cycleLength} onChange={e => setCycleLength(Number(e.target.value))} min="20" max="40" className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Flow intensity</label>
              <select value={flow} onChange={e => setFlow(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option>Light</option><option>Medium</option><option>Heavy</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mood</label>
              <select value={mood} onChange={e => setMood(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option>Happy</option><option>Normal</option><option>Tired</option><option>Irritable</option><option>Anxious</option><option>Sad</option>
              </select>
            </div>
            {saveMsg && <p className={`text-sm font-medium ${saveMsg.includes('saved') ? 'text-green-600' : 'text-red-500'}`}>{saveMsg}</p>}
            <button onClick={handleSaveCycle} className="w-full py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600">Save Cycle</button>
          </div>
        )}

        {/* Phase cards */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-pink-50 p-3 rounded-xl">
            <p className="text-xs font-semibold text-brand-600">Current Phase</p>
            <p className="text-lg font-bold text-gray-900">{currentPhase}</p>
            {dayOfCycle && <p className="text-xs text-gray-500">Day {dayOfCycle} of cycle</p>}
          </div>
          <div className="bg-purple-50 p-3 rounded-xl">
            <p className="text-xs font-semibold text-purple-600">Next Period</p>
            <p className="text-lg font-bold text-gray-900">{nextPeriod} days</p>
          </div>
        </div>

        <div className="bg-pink-50 p-3 rounded-xl mb-4">
          <p className="text-xs font-semibold text-brand-600">Fertile Window</p>
          <p className="text-sm font-bold text-gray-900">{fertileWindow.start} - {fertileWindow.end}</p>
        </div>

        {lastCycle && (
          <div>
            <p className="text-xs font-semibold text-brand-600 mb-2">Last Cycle Details</p>
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <p className="text-gray-500">Period started:</p>
              <p className="font-medium">{lastCycle.startDate}</p>
              <p className="text-gray-500">Cycle length:</p>
              <p className="font-medium">{lastCycle.cycleLength} days</p>
              <p className="text-gray-500">Flow:</p>
              <p className="font-medium">{lastCycle.flow}</p>
              <p className="text-gray-500">Mood:</p>
              <p className="font-medium">{lastCycle.mood}</p>
            </div>
          </div>
        )}

        {/* Cycle history */}
        {cycles.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-brand-600">Cycle History</p>
              <button onClick={() => downloadCSV(cycles, 'cycle_history.csv')}
                className="text-xs text-brand-600 hover:text-brand-800 underline">Export CSV</button>
            </div>
            {cycles.map((c, i) => (
              <div key={i} className="bg-green-50 p-3 rounded-xl mb-2 text-sm flex justify-between items-center">
                <span>{c.start_date}</span>
                <span className="text-gray-500">{c.flow} flow • {c.mood || '-'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right: Insights */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Cycle Insights</h3>
        <div className="bg-purple-50 p-4 rounded-xl mb-4">
          <p className="font-semibold text-gray-900 mb-1">Current Phase</p>
          <p className="text-sm text-gray-600">{insights.description}</p>
        </div>
        <div className="bg-purple-50 p-4 rounded-xl">
          <p className="font-semibold text-gray-900 mb-2">Recommendations</p>
          {insights.recommendations.map((rec, i) => (
            <p key={i} className="text-sm text-gray-600 mb-1">• {rec}</p>
          ))}
        </div>
      </div>
    </div>

    {/* Pain Prediction Calendar */}
    <PainCalendar currentPhase={currentPhase} dayOfCycle={dayOfCycle} />
    </>
  )
}
