// Tiny in-memory fixed-window rate limiter (per user id when authenticated, else per IP). Resets on restart.
export function createRateLimiter({ windowMs, max, now = Date.now }) {
  const hits = new Map()
  return function rateLimit(req, res, next) {
    const key = req.userId ? `u:${req.userId}` : `ip:${req.ip}`
    const t = now()
    let h = hits.get(key)
    if (!h || t - h.start >= windowMs) { h = { start: t, n: 0 }; hits.set(key, h) }
    h.n += 1
    if (hits.size > 5000) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k)
    if (h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.start + windowMs - t) / 1000)))
      return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.', code: 'RATE_LIMITED' })
    }
    next()
  }
}
