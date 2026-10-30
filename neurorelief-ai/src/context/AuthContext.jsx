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

  // expectedRole (optional): used by the Doctor Portal. A valid account with a different role is
  // refused BEFORE any session is stored. This is a UX check only; the backend enforces roles.
  async function login(email, password, expectedRole) {
    const userData = await loginUser(email, password)
    if (expectedRole && userData.role !== expectedRole) {
      throw new Error('This account is not a doctor account. Please use the patient sign in.')
    }
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
