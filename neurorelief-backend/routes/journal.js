import { Router, json } from 'express'
import { requireRole } from '../middleware/auth.js'
import { createRateLimiter } from '../middleware/rateLimit.js'
import * as svc from '../lib/journalService.js'

// /api/journal — the patient's own Relief Journal (patients only). See lib/journalService.js.
export function createJournalRouter({ authenticate, ctx }) {
  const router = Router()
  const writes = createRateLimiter({ windowMs: 10 * 60_000, max: 120 })
  router.use(authenticate)            // only reads headers: no body is parsed for an anonymous request
  router.use(json({ limit: '16kb' }))
  router.use(requireRole('user'))

  const ID_RE = /^[1-9]\d*$/
  const handle = (status, fn) => (req, res) => {
    try {
      res.set('Cache-Control', 'no-store')
      res.status(status).json(fn(req))
    } catch (err) {
      if (err instanceof svc.JournalError) return res.status(err.status).json({ error: err.message, code: err.code })
      console.error('Journal route failed:', err?.name || 'Error')   // never log content
      res.status(500).json({ error: 'The request could not be completed.', code: 'SERVER_ERROR' })
    }
  }
  const id = req => { if (!ID_RE.test(req.params.id)) throw new svc.JournalError(404, 'NOT_FOUND', 'Entry not found.'); return Number(req.params.id) }

  router.get('/', handle(200, req => svc.listJournal(ctx, req.userId)))
  router.post('/', writes, handle(201, req => svc.addEntry(ctx, req.userId, req.body)))
  router.patch('/:id', writes, handle(200, req => svc.setPainAfter(ctx, req.userId, id(req), req.body?.painAfter)))
  router.delete('/:id', writes, handle(200, req => svc.deleteEntry(ctx, req.userId, id(req))))
  return router
}
