import Spinner from '../../components/Spinner'
import { useState, useEffect } from 'react'
import { getMoodData, saveMoodEntry } from '../../services/api'
import { LineChart, BarChart } from '../../components/SimpleChart'
import { downloadCSV } from '../../components/ExportCSV'

const moodOptions = [
  { emoji: '😊', label: 'Good' },
  { emoji: '😐', label: 'Okay' },
  { emoji: '😢', label: 'Sad' },
  { emoji: '😡', label: 'Angry' },
  { emoji: '😴', label: 'Tired' },
  { emoji: '🤒', label: 'Sick' },
]

const moodEmojiMap = { 'Good': '😊', 'Okay': '😐', 'Sad': '😢', 'Angry': '😡', 'Tired': '😴', 'Sick': '🤒' }

export default function MoodWellness() {
  const [showUpdate, setShowUpdate] = useState(false)
  const [selectedMood, setSelectedMood] = useState(null)
  const [energy, setEnergy] = useState(7)
  const [stress, setStress] = useState(3)
  const [sleep, setSleep] = useState(8)
  const [note, setNote] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [loading, setLoading] = useState(true)

  const [display, setDisplay] = useState(null)
  const [patterns, setPatterns] = useState({ trend: '', tips: [] })
  const [history, setHistory] = useState([])

  async function fetchData() {
    try {
      const data = await getMoodData('usr')
      setDisplay(data.today)
      setPatterns(data.patterns)
      setHistory(data.history || [])
    } catch (err) {
      console.error('Failed to fetch mood data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  async function handleSaveMood() {
    if (!selectedMood) { setSaveMsg('Please select a mood'); return }
    await saveMoodEntry('usr', { mood: selectedMood, energy, stress, sleep, note })
    setSaveMsg('Mood saved!')
    // Refresh from backend
    await fetchData()
    setTimeout(() => {
      setSaveMsg('')
      setShowUpdate(false)
      setSelectedMood(null)
      setNote('')
    }, 1000)
  }

  if (loading) return <Spinner text="Loading mood data..." />

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Left: Daily Mood */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">Daily Mood Check-in</h3>
          <button
            onClick={() => { setShowUpdate(!showUpdate); setSaveMsg('') }}
            className="px-4 py-1.5 border border-brand-300 text-brand-600 text-sm rounded-lg hover:bg-brand-50"
          >
            {showUpdate ? 'Cancel' : 'Update Mood'}
          </button>
        </div>

        {showUpdate ? (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">How are you feeling?</p>
              <div className="flex gap-2 flex-wrap">
                {moodOptions.map(m => (
                  <button
                    key={m.label}
                    onClick={() => setSelectedMood(m.label)}
                    className={`flex items-center gap-1 px-3 py-2 rounded-full text-sm border transition ${
                      selectedMood === m.label ? 'border-brand-500 bg-brand-50 font-medium' : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <span>{m.emoji}</span> {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm text-gray-600">Energy: {energy}/10</label>
              <input type="range" min="1" max="10" value={energy} onChange={e => setEnergy(Number(e.target.value))} className="w-full" />
            </div>
            <div>
              <label className="text-sm text-gray-600">Stress: {stress}/10</label>
              <input type="range" min="1" max="10" value={stress} onChange={e => setStress(Number(e.target.value))} className="w-full" />
            </div>
            <div>
              <label className="text-sm text-gray-600">Sleep quality: {sleep}/10</label>
              <input type="range" min="1" max="10" value={sleep} onChange={e => setSleep(Number(e.target.value))} className="w-full" />
            </div>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Any notes about your day?" className="w-full border rounded-lg p-3 text-sm" rows={2} />
            {saveMsg && <p className={`text-sm font-medium ${saveMsg.includes('saved') ? 'text-green-600' : 'text-red-500'}`}>{saveMsg}</p>}
            <button onClick={handleSaveMood} className="w-full py-2 bg-brand-500 text-white rounded-lg font-medium hover:bg-brand-600">Save Mood</button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{display?.emoji || '😊'}</span>
                <div>
                  <p className="font-semibold">{display?.mood || 'No data yet'}</p>
                  <p className="text-xs text-gray-500">{display?.date}</p>
                </div>
              </div>
              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">Today</span>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-green-50 p-3 rounded-xl text-center">
                <p className="text-xs text-green-600 font-medium">Energy</p>
                <p className="text-lg font-bold">{display?.energy || '-'}/10</p>
              </div>
              <div className="bg-red-50 p-3 rounded-xl text-center">
                <p className="text-xs text-red-600 font-medium">Stress</p>
                <p className="text-lg font-bold">{display?.stress || '-'}/10</p>
              </div>
              <div className="bg-blue-50 p-3 rounded-xl text-center">
                <p className="text-xs text-blue-600 font-medium">Sleep</p>
                <p className="text-lg font-bold">{display?.sleep || '-'}/10</p>
              </div>
            </div>

            {display?.note && <p className="text-sm text-gray-600 mb-3 bg-gray-50 p-3 rounded-xl">{display.note}</p>}

            <div className="bg-yellow-50 p-3 rounded-xl">
              <p className="text-sm font-semibold text-gray-800">Daily Affirmation</p>
              <p className="text-sm text-purple-600 italic">"{display?.affirmation || 'You are doing great!'}"</p>
            </div>

            {/* Mood history from database */}
            {history.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-brand-600">Recent Check-ins</p>
                  <button onClick={() => downloadCSV(history, 'mood_history.csv')}
                    className="text-xs text-brand-600 hover:text-brand-800 underline">Export CSV</button>
                </div>
                {history.slice(0, 5).map((entry, i) => (
                  <div key={i} className="flex items-center justify-between mb-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span>{moodEmojiMap[entry.mood] || '😊'}</span>
                      <span className="font-medium">{entry.mood}</span>
                      <span className="text-gray-400">•</span>
                      <span className="text-gray-500">E:{entry.energy} S:{entry.stress}</span>
                    </div>
                    <span className="text-xs text-gray-400">{entry.date}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Right: Mood Patterns */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Mood Patterns</h3>

        {/* Charts from history data */}
        {history.length >= 2 && (
          <div className="mb-4">
            <LineChart
              data={history.slice(0, 7).reverse().map(h => h.energy || 5)}
              labels={history.slice(0, 7).reverse().map(h => h.date?.split('-').slice(1).join('/'))}
              title="Energy Level (Last 7 entries)"
              color="#059669"
              height={160}
            />
          </div>
        )}
        {history.length >= 2 && (
          <div className="mb-4">
            <LineChart
              data={history.slice(0, 7).reverse().map(h => h.stress || 5)}
              labels={history.slice(0, 7).reverse().map(h => h.date?.split('-').slice(1).join('/'))}
              title="Stress Level (Last 7 entries)"
              color="#DC2626"
              height={160}
            />
          </div>
        )}

        <div className="bg-green-50 p-4 rounded-xl mb-4">
          <p className="font-semibold text-gray-900 mb-1">This Week's Trend</p>
          <p className="text-sm text-gray-600">{patterns.trend}</p>
        </div>
        <div className="bg-green-50 p-4 rounded-xl">
          <p className="font-semibold text-gray-900 mb-2">Wellness Tips</p>
          {patterns.tips.map((tip, i) => (
            <p key={i} className="text-sm text-gray-600 mb-1">• {tip}</p>
          ))}
        </div>
      </div>
    </div>
  )
}
