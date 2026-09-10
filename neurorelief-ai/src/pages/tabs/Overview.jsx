import Spinner from '../../components/Spinner'
import { useState, useEffect } from 'react'
import { getOverviewData } from '../../services/api'

export default function Overview({ onTabChange }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [waterCount, setWaterCount] = useState(() => {
    const saved = localStorage.getItem('neurorelief_water_' + new Date().toISOString().split('T')[0])
    return saved ? parseInt(saved) : 0
  })
  const [meditationDone, setMeditationDone] = useState(() => {
    return localStorage.getItem('neurorelief_meditation_' + new Date().toISOString().split('T')[0]) === 'true'
  })

  const waterGoal = 8

  useEffect(() => {
    getOverviewData('usr').then(setData).finally(() => setLoading(false))
  }, [])

  function addWater() {
    if (waterCount < waterGoal) {
      const newCount = waterCount + 1
      setWaterCount(newCount)
      localStorage.setItem('neurorelief_water_' + new Date().toISOString().split('T')[0], newCount)
    }
  }

  function removeWater() {
    if (waterCount > 0) {
      const newCount = waterCount - 1
      setWaterCount(newCount)
      localStorage.setItem('neurorelief_water_' + new Date().toISOString().split('T')[0], newCount)
    }
  }

  function toggleMeditation() {
    const newVal = !meditationDone
    setMeditationDone(newVal)
    localStorage.setItem('neurorelief_meditation_' + new Date().toISOString().split('T')[0], newVal)
  }

  if (loading) return <Spinner text="Loading dashboard..." />
  if (!data) return <p className="text-center text-gray-400 py-8">Failed to load</p>

  const statCards = [
    { label: 'Cycles Tracked', value: data.stats.cyclesTracked, sub: 'Total logged', emoji: '📊', bg: 'bg-pink-50' },
    { label: 'Mood Check-ins', value: data.stats.moodCheckins, sub: data.stats.moodCheckins > 0 ? 'Great progress!' : 'Start tracking', emoji: '😊', bg: 'bg-orange-50' },
    { label: 'Health Score', value: data.stats.healthScore + '%', sub: data.stats.healthScore >= 80 ? 'Excellent' : 'Keep going', emoji: '📈', bg: 'bg-green-50' },
    { label: 'Goals Met', value: data.stats.goalsMet, sub: 'On track!', emoji: '🎯', bg: 'bg-purple-50' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map(card => (
          <div key={card.label} className={`glass-card ${card.bg} p-5 text-center`}>
            <div className="text-3xl mb-2">{card.emoji}</div>
            <p className="text-sm font-medium text-gray-600">{card.label}</p>
            <p className="text-3xl font-bold text-brand-800 mt-1">{card.value}</p>
            <p className="text-xs text-brand-600 mt-1">{card.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Today's Focus — interactive hydration + meditation */}
        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-2xl">💧</span>
            <div>
              <h3 className="font-bold text-gray-900">Today's Focus</h3>
              <p className="text-sm text-brand-600">Stay hydrated and mindful</p>
            </div>
          </div>

          {/* Hydration tracker */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-brand-400" />
                <p className="text-sm font-semibold text-gray-800">Hydration</p>
              </div>
              <p className="text-xs text-gray-500">{waterCount} of {waterGoal} glasses</p>
            </div>
            {/* Progress bar */}
            <div className="w-full h-2 bg-gray-200 rounded-full mb-2">
              <div className="h-2 bg-blue-400 rounded-full transition-all" style={{ width: `${(waterCount / waterGoal) * 100}%` }} />
            </div>
            {/* Glass icons */}
            <div className="flex gap-1 mb-2">
              {Array.from({ length: waterGoal }).map((_, i) => (
                <div key={i} className={`w-6 h-8 rounded-b-lg border-2 ${i < waterCount ? 'bg-blue-300 border-blue-400' : 'bg-gray-100 border-gray-200'} transition-colors`} />
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={addWater} disabled={waterCount >= waterGoal}
                className="flex-1 py-1.5 bg-blue-100 text-blue-700 text-xs rounded-lg font-medium hover:bg-blue-200 disabled:opacity-40">
                + Add Glass
              </button>
              <button onClick={removeWater} disabled={waterCount <= 0}
                className="flex-1 py-1.5 bg-gray-100 text-gray-600 text-xs rounded-lg font-medium hover:bg-gray-200 disabled:opacity-40">
                - Remove
              </button>
            </div>
            {waterCount >= waterGoal && <p className="text-xs text-green-600 font-medium mt-1 text-center">Goal reached! 🎉</p>}
          </div>

          {/* Meditation tracker */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${meditationDone ? 'bg-green-400' : 'bg-brand-400'}`} />
              <div>
                <p className="text-sm font-semibold text-gray-800">Mindfulness</p>
                <p className="text-xs text-gray-500">{meditationDone ? '5 min meditation done ✓' : 'Not done yet'}</p>
              </div>
            </div>
            <button onClick={toggleMeditation}
              className={`px-3 py-1 text-xs rounded-full font-medium transition ${meditationDone ? 'bg-green-100 text-green-700' : 'bg-brand-100 text-brand-700 hover:bg-brand-200'}`}>
              {meditationDone ? 'Done ✓' : 'Mark Done'}
            </button>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-2xl">🚀</span>
            <div>
              <h3 className="font-bold text-gray-900">Quick Actions</h3>
              <p className="text-sm text-brand-600">Access all your wellness tools</p>
            </div>
          </div>
          <button onClick={() => onTabChange && onTabChange('cycle')} className="w-full mb-3 py-3 px-4 bg-pink-100 rounded-xl text-left hover:bg-pink-200 transition">
            <span className="text-sm font-semibold text-gray-800">📅 Log Cycle Data</span>
            <p className="text-xs text-gray-500">Track your menstrual health</p>
          </button>
          <button onClick={() => onTabChange && onTabChange('mood')} className="w-full mb-3 py-3 px-4 bg-purple-100 rounded-xl text-left hover:bg-purple-200 transition">
            <span className="text-sm font-semibold text-gray-800">😊 Check Mood</span>
            <p className="text-xs text-gray-500">Daily wellness check-in</p>
          </button>
          <button onClick={() => onTabChange && onTabChange('symptom')} className="w-full py-3 px-4 bg-blue-100 rounded-xl text-left hover:bg-blue-200 transition">
            <span className="text-sm font-semibold text-gray-800">🤖 AI Symptom Check</span>
            <p className="text-xs text-gray-500">Get pain prediction</p>
          </button>
        </div>

        {/* Health Tips */}
        <div className="glass-card p-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-2xl">💡</span>
            <div>
              <h3 className="font-bold text-gray-900">Health Tips</h3>
              <p className="text-sm text-brand-600">Personalized wellness insights</p>
            </div>
          </div>
          {data.healthTips.map(tip => (
            <div key={tip.title} className="mb-3 p-3 rounded-xl bg-green-50">
              <p className="text-sm font-semibold text-gray-800">{tip.title}</p>
              <p className="text-xs text-gray-500">{tip.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-card p-5">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">📋</span>
          <div>
            <h3 className="font-bold text-gray-900">Your Wellness Journey</h3>
            <p className="text-sm text-brand-600">Track your progress over time</p>
          </div>
        </div>
        {data.wellnessJourney.map((item, i) => (
          <div key={i} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${item.color === 'pink' ? 'bg-pink-100' : item.color === 'purple' ? 'bg-purple-100' : 'bg-blue-100'}`} />
              <div>
                <p className="text-sm font-semibold text-gray-800">{item.title}</p>
                <p className="text-xs text-gray-500">{item.detail}</p>
              </div>
            </div>
            <span className="text-sm text-brand-600 font-medium">{item.time}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
