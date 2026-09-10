const tabs = [
  { id: 'overview', label: 'Overview', emoji: '🏠', gradient: 'tab-overview' },
  { id: 'cycle', label: 'Cycle Tracking', emoji: '📅', gradient: 'tab-cycle' },
  { id: 'mood', label: 'Mood & Wellness', emoji: '😊', gradient: 'tab-mood' },
  { id: 'symptom', label: 'AI Symptom Advisor', emoji: '🤖', gradient: 'tab-symptom' },
  { id: 'doctor', label: 'Doctor Connect', emoji: '👩‍⚕️', gradient: 'tab-doctor' },
  { id: 'device', label: 'Device Control', emoji: '⌚', gradient: 'tab-overview' },
  { id: 'learn', label: 'Learn', emoji: '📚', gradient: 'tab-learn' },
]

export default function TabBar({ activeTab, onTabChange }) {
  return (
    <div className="flex flex-wrap gap-2 p-4">
      {tabs.map(tab => {
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all ${
              isActive
                ? `${tab.gradient} text-white shadow-md`
                : 'bg-white border border-gray-200 text-brand-700 hover:bg-brand-50'
            }`}
          >
            <span>{tab.emoji}</span>
            <span>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
