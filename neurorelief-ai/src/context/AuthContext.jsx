import { createContext, useContext, useState, useEffect } from 'react'
import { loginUser, registerUser, applyAsDoctor } from '../services/api'
import { readSession, writeSession, clearSession, onSessionLogout, patchSession } from '../services/session'

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
  // expectedRole may be one role or a list (the Doctor Portal accepts doctors and doctor applicants)
  async function login(email, password, expectedRole, opts) {
    const userData = await loginUser(email, password)
    const allowed = expectedRole == null ? null : [].concat(expectedRole)
    if (allowed && !allowed.includes(userData.role)) {
      throw new Error('This account is not a doctor account. Please use the patient sign in.')
    }
    setUser(userData)
    writeSession(userData, opts)
    return userData
  }

  // Public doctor application: the new account (role 'doctor_applicant') is signed in to see its status
  async function applyDoctor(fields, opts) {
    const userData = await applyAsDoctor(fields)
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

  // Updates fields of the signed-in user (e.g. the display name) in this tab's session AND in the UI right away
  function updateUser(fields) {
    const next = patchSession(fields)
    if (next) setUser(next)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, applyDoctor, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
