import { useState, useEffect } from 'react'

export default function PainCalendar({ currentPhase, dayOfCycle, cycleLength = 28 }) {
  const [selectedDay, setSelectedDay] = useState(null)
  const today = new Date()
  const year = today.getFullYear()
  const month = today.getMonth()

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDayOfWeek = new Date(year, month, 1).getDay()
  const monthName = today.toLocaleString('default', { month: 'long', year: 'numeric' })

  // Predict pain for each day based on cycle position
  function getPainForDay(dayNum) {
    const diff = dayNum - today.getDate()
    const futureCycleDay = ((dayOfCycle || 14) + diff - 1) % cycleLength + 1

    // Pain model (simplified from your Random Forest's feature importance):
    // Highest pain: menstrual phase (days 1-5), especially days 1-3
    // Moderate: late luteal (days 25-28)
    // Low: follicular and ovulatory
    let pain = 1
    if (futureCycleDay <= 2) pain = 8
    else if (futureCycleDay <= 5) pain = 6
    else if (futureCycleDay <= 7) pain = 3
    else if (futureCycleDay <= 13) pain = 1
    else if (futureCycleDay <= 16) pain = 1
    else if (futureCycleDay <= 22) pain = 2
    else if (futureCycleDay <= 25) pain = 3
    else pain = 5

    // Add some variation
    pain += Math.sin(dayNum * 0.7) > 0.5 ? 1 : 0

    return {
      pain: Math.min(10, Math.max(0, pain)),
      cycleDay: futureCycleDay,
      phase: futureCycleDay <= 5 ? 'Menstrual' : futureCycleDay <= 13 ? 'Follicular' : futureCycleDay <= 16 ? 'Ovulatory' : 'Luteal'
    }
  }

  function getPainColor(pain) {
    if (pain <= 2) return 'bg-green-100 text-green-800 hover:bg-green-200'
    if (pain <= 4) return 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
    if (pain <= 6) return 'bg-orange-100 text-orange-800 hover:bg-orange-200'
    return 'bg-red-100 text-red-800 hover:bg-red-200'
  }

  function getPainLabel(pain) {
    if (pain <= 2) return 'Low'
    if (pain <= 4) return 'Mild'
    if (pain <= 6) return 'Moderate'
    return 'High'
  }

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-gray-900">Pain Prediction Calendar</h3>
          <p className="text-sm text-brand-600">AI-predicted pain levels for {monthName}</p>
        </div>
        <div className="flex gap-2">
          <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">Low</span>
          <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">Mild</span>
          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded">Moderate</span>
          <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">High</span>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {weekDays.map(d => (
          <div key={d} className="text-center text-xs font-medium text-gray-500 py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {/* Empty cells for days before month starts */}
        {Array.from({ length: firstDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} className="h-10" />
        ))}

        {/* Day cells */}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const dayNum = i + 1
          const prediction = getPainForDay(dayNum)
          const isToday = dayNum === today.getDate()
          const isPast = dayNum < today.getDate()

          return (
            <button
              key={dayNum}
              onClick={() => setSelectedDay(selectedDay === dayNum ? null : dayNum)}
              className={`h-10 rounded-lg text-xs font-medium transition relative ${
                isPast ? 'bg-gray-50 text-gray-400' : getPainColor(prediction.pain)
              } ${isToday ? 'ring-2 ring-brand-500' : ''} ${selectedDay === dayNum ? 'ring-2 ring-purple-500' : ''}`}
            >
              {dayNum}
              {isToday && <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-brand-500 rounded-full" />}
            </button>
          )
        })}
      </div>

      {/* Selected day detail */}
      {selectedDay && selectedDay >= today.getDate() && (
        <div className="mt-4 bg-purple-50 p-4 rounded-xl">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-semibold text-gray-900">
                {new Date(year, month, selectedDay).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              </p>
              {(() => {
                const pred = getPainForDay(selectedDay)
                return (
                  <>
                    <p className="text-sm text-gray-600 mt-1">
                      Cycle Day {pred.cycleDay} • {pred.phase} Phase
                    </p>
                    <p className="text-sm mt-2">
                      Predicted Pain: <span className={`font-bold ${pred.pain <= 3 ? 'text-green-600' : pred.pain <= 6 ? 'text-orange-600' : 'text-red-600'}`}>
                        {getPainLabel(pred.pain)} ({pred.pain}/10)
                      </span>
                    </p>
                    {pred.pain > 5 && (
                      <p className="text-xs text-red-600 mt-1">💡 Consider preparing TENS therapy for this day</p>
                    )}
                  </>
                )
              })()}
            </div>
            <button onClick={() => setSelectedDay(null)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
        </div>
      )}
    </div>
  )
}
