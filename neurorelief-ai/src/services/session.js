// Signed-in session storage.
//
// Each browser TAB keeps its own session (sessionStorage), so a tab always sends the token of the account it shows.
// localStorage only remembers the most recent sign-in, used to start new tabs signed in. (Previously every tab read
// the token from shared localStorage: signing in as a doctor in one tab made an already-open patient tab send the
// doctor's token, and the server correctly answered 403.)
//
// Logging out signs that account out in every open tab (a broadcast through localStorage).
const KEY = 'neurorelief_user'
const LOGOUT_KEY = 'neurorelief_logout'

const parse = raw => { try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : null } catch { return null } }
const ss = {
  get: () => { try { return sessionStorage.getItem(KEY) } catch { return null } },
  set: v => { try { sessionStorage.setItem(KEY, v); return true } catch { return false } },
  del: () => { try { sessionStorage.removeItem(KEY) } catch { /* unavailable */ } },
}
const ls = {
  get: k => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* unavailable */ } },
  del: k => { try { localStorage.removeItem(k) } catch { /* unavailable */ } },
}

/** This tab's session. A new tab adopts the most recent sign-in once, then keeps it. */
export function readSession() {
  const mine = ss.get()
  if (mine) return parse(mine)
  const latest = ls.get(KEY)
  if (!latest) return null
  // Pin it to this tab; if sessionStorage is unavailable, fall back to the shared copy (old behaviour)
  ss.set(latest)
  return parse(latest)
}

export function getSessionToken() {
  return readSession()?.token ?? null
}

/**
 * remember = true (default): new tabs on this device also start signed in to this account.
 * remember = false: only this tab is signed in; it ends when the tab is closed.
 */
export function writeSession(user, { remember = true } = {}) {
  const raw = JSON.stringify(user)
  if (!ss.set(raw) && !remember) return   // no per-tab storage available: nothing safe to keep
  if (remember) ls.set(KEY, raw)
  else {
    // Do not leave an older remembered sign-in of this same account behind for new tabs
    const shared = parse(ls.get(KEY))
    if (shared && shared.user_id === user.user_id) ls.del(KEY)
  }
}

/** Changes fields of this tab's session (e.g. the display name); the shared copy only if it is the same account. */
export function patchSession(fields) {
  const cur = readSession()
  if (!cur) return null
  const next = { ...cur, ...fields }
  ss.set(JSON.stringify(next))
  const shared = parse(ls.get(KEY))
  if (shared && shared.user_id === cur.user_id) ls.set(KEY, JSON.stringify({ ...shared, ...fields }))
  return next
}

/** Signs this tab out and tells every other tab signed in to the same account to sign out too. */
export function clearSession() {
  const cur = readSession()
  ss.del()
  const shared = parse(ls.get(KEY))
  if (!cur || (shared && shared.user_id === cur.user_id)) ls.del(KEY)
  if (cur?.user_id != null) ls.set(LOGOUT_KEY, JSON.stringify({ userId: cur.user_id, at: Date.now() }))
}

/** Calls onSignedOut() when another tab logs out the account this tab is using. Returns an unsubscribe function. */
export function onSessionLogout(onSignedOut) {
  const handler = e => {
    if (e.key !== LOGOUT_KEY || !e.newValue) return
    const msg = parse(e.newValue)
    const cur = readSession()
    if (cur && msg && msg.userId === cur.user_id) { ss.del(); onSignedOut() }
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
