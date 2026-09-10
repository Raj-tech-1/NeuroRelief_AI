import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'

export default function ProfilePage({ onClose }) {
  const { user } = useAuth()
  const [name, setName] = useState(user?.name || '')
  const [age, setAge] = useState('')
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [bmi, setBmi] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  useEffect(() => {
    // Load saved profile from localStorage
    const saved = localStorage.getItem('neurorelief_profile')
    if (saved) {
      const p = JSON.parse(saved)
      setAge(p.age || '')
      setHeight(p.height || '')
      setWeight(p.weight || '')
      setBmi(p.bmi || null)
    }
  }, [])

  useEffect(() => {
    if (height && weight) {
      const h = parseFloat(height) / 100 // cm to m
      const w = parseFloat(weight)
      if (h > 0 && w > 0) {
        setBmi(Math.round((w / (h * h)) * 10) / 10)
      }
    }
  }, [height, weight])

  function handleSave() {
    setSaving(true)
    const profile = { name, age, height, weight, bmi }
    localStorage.setItem('neurorelief_profile', JSON.stringify(profile))

    // Update user in localStorage too
    const savedUser = JSON.parse(localStorage.getItem('neurorelief_user') || '{}')
    savedUser.name = name
    localStorage.setItem('neurorelief_user', JSON.stringify(savedUser))

    setSaveMsg('Profile saved!')
    setSaving(false)
    setTimeout(() => setSaveMsg(''), 2000)
  }

  return (
    <div className="glass-card p-6 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-brand-800">Profile Settings</h3>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
        )}
      </div>

      <div className="flex items-center gap-4 mb-6">
        <div className="w-16 h-16 rounded-full bg-brand-500 text-white flex items-center justify-center text-2xl font-bold">
          {name?.charAt(0)?.toUpperCase() || 'U'}
        </div>
        <div>
          <p className="font-semibold text-gray-900">{name || 'User'}</p>
          <p className="text-sm text-gray-500">{user?.email}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input value={name} onChange={e => setName(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Age</label>
          <input type="number" value={age} onChange={e => setAge(e.target.value)} min="10" max="80" placeholder="e.g., 25"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          <p className="text-xs text-gray-400 mt-1">Used for personalized AI predictions</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Height (cm)</label>
            <input type="number" value={height} onChange={e => setHeight(e.target.value)} min="100" max="220" placeholder="e.g., 165"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Weight (kg)</label>
            <input type="number" value={weight} onChange={e => setWeight(e.target.value)} min="30" max="200" placeholder="e.g., 60"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          </div>
        </div>

        {bmi && (
          <div className={`p-3 rounded-xl text-center ${bmi < 18.5 ? 'bg-yellow-50' : bmi < 25 ? 'bg-green-50' : bmi < 30 ? 'bg-orange-50' : 'bg-red-50'}`}>
            <p className="text-xs text-gray-500">Your BMI</p>
            <p className="text-2xl font-bold text-gray-900">{bmi}</p>
            <p className="text-xs text-gray-500">
              {bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese'}
            </p>
          </div>
        )}

        {saveMsg && <p className="text-sm text-green-600 font-medium text-center">{saveMsg}</p>}

        <button onClick={handleSave} disabled={saving}
          className="w-full py-2.5 bg-brand-500 text-white rounded-lg font-medium hover:bg-brand-600 disabled:opacity-60">
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
      </div>
    </div>
  )
}
