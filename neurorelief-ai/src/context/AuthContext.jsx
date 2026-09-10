import { createContext, useContext, useState, useEffect } from 'react'
import { loginUser, registerUser } from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check for existing session
    const saved = localStorage.getItem('neurorelief_user')
    if (saved) {
      try { setUser(JSON.parse(saved)) } catch { localStorage.removeItem('neurorelief_user') }
    }
    setLoading(false)
  }, [])

  async function login(email, password) {
    const userData = await loginUser(email, password)
    setUser(userData)
    localStorage.setItem('neurorelief_user', JSON.stringify(userData))
    return userData
  }

  async function register(email, password) {
    const userData = await registerUser(email, password)
    setUser(userData)
    localStorage.setItem('neurorelief_user', JSON.stringify(userData))
    return userData
  }

  function logout() {
    setUser(null)
    localStorage.removeItem('neurorelief_user')
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
