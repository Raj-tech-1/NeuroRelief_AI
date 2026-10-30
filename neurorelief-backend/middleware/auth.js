import jwt from 'jsonwebtoken'
import { get } from '../db/database.js'

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Add it to neurorelief-backend/.env before starting the server.')
}

export function generateToken(userId, role = 'user') {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '7d' })
}

// Builds the authentication middleware for a given secret and user lookup. The application uses the instance below;
// tests build one over a scratch database. Behaviour is identical either way.
export function createAuthenticator({ secret, getUser }) {
  return function authenticate(req, res, next) {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1] // "Bearer TOKEN"

    if (!token) {
      return res.status(401).json({ error: 'Access denied. No token provided.' })
    }

    let decoded
    try {
      decoded = jwt.verify(token, secret, { algorithms: ['HS256'] })
    } catch (err) {
      return res.status(403).json({ error: 'Invalid or expired token.' })
    }

    const user = getUser(decoded.userId)
    if (!user) {
      return res.status(403).json({ error: 'Invalid or expired token.' })
    }

    req.userId = user.user_id
    req.userRole = user.role
    next()
  }
}

// Verifies the token, then loads the CURRENT role from the database.
// The role claim inside the token is never trusted for authorization.
export const authenticateToken = createAuthenticator({
  secret: JWT_SECRET,
  getUser: userId => get('SELECT user_id, role FROM users WHERE user_id = ?', [userId]),
})

// Use after authenticateToken: router.get('/x', authenticateToken, requireRole('admin'), handler)
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return res.status(403).json({ error: 'You do not have permission to access this resource.' })
    }
    next()
  }
}
