import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function AuthPage() {
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const { login, register, user } = useAuth()
  const navigate = useNavigate()

  // Redirect if already logged in
  if (user) { navigate('/dashboard', { replace: true }); return null }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!email || !password) { setError('Please fill all fields'); return }
    if (isSignUp && password !== confirmPassword) { setError('Passwords do not match'); return }

    setLoading(true)
    try {
      if (isSignUp) { await register(email, password) }
      else { await login(email, password) }
      navigate('/dashboard')
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const features = [
    { tag: 'AI PREDICTION', title: 'Pain severity forecast' },
    { tag: 'SMART THERAPY', title: 'TENS & heat control' },
    { tag: 'CYCLE TRACKING', title: 'Track your health' },
    { tag: 'ML POWERED', title: '87.8% accuracy model' },
  ]

  return (
    <div className="min-h-screen bg-brand-50 flex items-center justify-center p-6">
      <div className="flex flex-col md:flex-row w-full max-w-[900px] gap-8">
        {/* Left - Hero */}
        <div className="flex-1 gradient-header rounded-2xl p-8 flex flex-col justify-center">
          <span className="inline-block bg-white/40 text-brand-800 text-xs font-semibold tracking-widest uppercase px-4 py-1.5 rounded-full mb-6 w-fit">
            NeuroRelief AI Companion
          </span>
          <h1 className="text-4xl font-extrabold text-gray-900 leading-tight mb-4">
            Smart pain relief for women, powered by AI.
          </h1>
          <p className="text-gray-600 mb-8 leading-relaxed">
            NeuroRelief AI uses machine learning to predict menstrual pain severity and recommends personalized TENS and heat therapy — all from your cycle, sleep, and wellness data.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {features.map(f => (
              <div key={f.tag} className="bg-white/50 rounded-xl p-4">
                <p className="text-xs font-semibold tracking-widest uppercase text-brand-600 mb-1">{f.tag}</p>
                <p className="text-gray-900 font-semibold">{f.title}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Right - Auth Form */}
        <div className="w-full md:w-[380px] bg-white rounded-2xl p-8 flex flex-col">
          <p className="text-xs text-brand-600 font-semibold tracking-widest uppercase text-center mb-2">
            AI-POWERED WOMEN'S WELLNESS COMPANION
          </p>
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-1">
            Sign in or create your NeuroRelief AI account
          </h2>
          <p className="text-sm text-gray-500 text-center mb-6">
            Secure access to your wellness dashboard, AI pain predictions, and health reports.
          </p>

          {/* Sign In / Sign Up toggle */}
          <div className="flex bg-gray-100 rounded-full p-1 mb-6">
            <button
              onClick={() => { setIsSignUp(false); setError('') }}
              className={`flex-1 py-2 rounded-full text-sm font-medium transition-all ${!isSignUp ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setIsSignUp(true); setError('') }}
              className={`flex-1 py-2 rounded-full text-sm font-medium transition-all ${isSignUp ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
            >
              Sign Up
            </button>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@yourmail.com"
                className="w-full px-4 py-2.5 rounded-lg bg-blue-50/50 border border-gray-200 focus:outline-none focus:border-brand-400 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:border-brand-400 text-sm pr-10"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm">
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>
            {isSignUp && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:border-brand-400 text-sm pr-10"
                  />
                  <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm">
                    {showConfirmPassword ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">
                {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full py-3 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-lg transition-colors disabled:opacity-60"
            >
              {loading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
            </button>
          </div>

          <p className="text-xs text-gray-400 text-center mt-4">
            By continuing you agree to NeuroRelief AI's Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  )
}
