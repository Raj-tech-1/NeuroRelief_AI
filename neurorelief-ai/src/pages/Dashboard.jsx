import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import Navbar from '../components/Navbar'
import TabBar from '../components/TabBar'
import Overview from './tabs/Overview'
import CycleTracking from './tabs/CycleTracking'
import MoodWellness from './tabs/MoodWellness'
import AISymptomAdvisor from './tabs/AISymptomAdvisor'
import DoctorConnect from './tabs/DoctorConnect'
import DevicePanel from './tabs/DevicePanel'
import Learn from './tabs/Learn'
import ProfilePage from './ProfilePage'

const tabComponents = {
  overview: Overview,
  cycle: CycleTracking,
  mood: MoodWellness,
  symptom: AISymptomAdvisor,
  doctor: DoctorConnect,
  device: DevicePanel,
  learn: Learn,
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('overview')
  const [showProfile, setShowProfile] = useState(false)
  const { user } = useAuth()
  const ActiveComponent = tabComponents[activeTab]

  return (
    <div className="min-h-screen bg-brand-50">
      <Navbar />
      <div className="max-w-[1300px] mx-auto px-4 md:px-6 py-4">
        {/* Welcome header */}
        <div className="glass-card gradient-header p-6 mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-brand-900">Welcome to NeuroRelief AI</h1>
            <p className="text-brand-700 mt-1 text-sm md:text-base">Your AI-Powered Women's Health Companion</p>
          </div>
          <button onClick={() => setShowProfile(!showProfile)}
            className="w-12 h-12 rounded-xl bg-brand-500 text-white flex items-center justify-center text-lg font-bold hover:bg-brand-600 transition">
            {user?.name?.charAt(0)?.toUpperCase() || 'A'}
          </button>
        </div>

        {/* Profile panel */}
        {showProfile && (
          <div className="mb-4">
            <ProfilePage onClose={() => setShowProfile(false)} />
          </div>
        )}

        {/* Tab navigation */}
        <div className="glass-card mb-4 overflow-x-auto">
          <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
        </div>

        {/* Tab content */}
        <ActiveComponent onTabChange={setActiveTab} />
      </div>
    </div>
  )
}
