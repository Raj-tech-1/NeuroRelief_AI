import { createContext, useContext, useState, useEffect } from 'react'
import { loginUser, registerUser } from '../services/api'
import { readSession, writeSession, clearSession, onSessionLogout } from '../services/session'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // This tab's session (each tab keeps the account it signed in with; see services/session.js)
    setUser(readSession())
    setLoading(false)
    // Another tab logged this account out: sign this tab out too
    return onSessionLogout(() => setUser(null))
  }, [])

  // expectedRole (optional): used by the Doctor Portal. A valid account with a different role is
  // refused BEFORE any session is stored. This is a UX check only; the backend enforces roles.
  async function login(email, password, expectedRole, opts) {
    const userData = await loginUser(email, password)
    if (expectedRole && userData.role !== expectedRole) {
      throw new Error('This account is not a doctor account. Please use the patient sign in.')
    }
    setUser(userData)
    writeSession(userData, opts)
    return userData
  }

  async function register(email, password, opts) {
    const userData = await registerUser(email, password)
    setUser(userData)
    writeSession(userData, opts)
    return userData
  }

  function logout() {
    clearSession()
    setUser(null)
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
