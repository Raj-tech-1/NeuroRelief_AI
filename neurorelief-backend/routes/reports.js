// /api/reports — Report Audit: patients generate a report from their own records and share it with a doctor they have a
// confirmed appointment with; that doctor reviews it. All rules live in lib/reportService.js; this file only does
// authentication, role gating, id parsing, rate limiting and error mapping.
//
// The router is built from injected dependencies (createReportsRouter) so tests can mount it on a scratch database.
// If the feature is not configured (no key, or the report tables are missing) every route except /status answers a
// generic 503 and nothing is read or written.
import { Router, json } from 'express'
import { requireRole } from '../middleware/auth.js'
import { createRateLimiter } from '../middleware/rateLimit.js'
import * as svc from '../lib/reportService.js'

const ID_RE = /^[1-9]\d*$/

export function createReportsRouter({ authenticate, ctx, limits = {} }) {
  const router = Router()
  const general = createRateLimiter({ windowMs: 60_000, max: limits.generalPerMinute ?? 120 })
  const heavy = createRateLimiter({ windowMs: 10 * 60_000, max: limits.heavyPer10Min ?? 40 })

  // Only the upload route takes a large body (a 5 MB PDF is ~6.7 MB as base64); this parser must run first so the small default is skipped.
  router.use('/uploads', json({ limit: '8mb' }))
  router.use(json({ limit: '64kb' }))
  router.use(authenticate)
  router.use(general)

  const patient = requireRole('user')
  const doctor = requireRole('doctor')
  const handle = fn => (req, res) => {
    try {
      res.set('Cache-Control', 'no-store')
      res.json(fn(req))
    } catch (err) {
      if (err instanceof svc.ServiceError) return res.status(err.status).json({ error: err.message, code: err.code })
      console.error('Report route failed:', err?.name || 'Error')   // never log the message: it could contain record content
      res.status(500).json({ error: 'The request could not be completed.', code: 'SERVER_ERROR' })
    }
  }
  const created = fn => (req, res) => {
    try {
      res.set('Cache-Control', 'no-store')
      res.status(201).json(fn(req))
    } catch (err) {
      if (err instanceof svc.ServiceError) return res.status(err.status).json({ error: err.message, code: err.code })
      console.error('Report route failed:', err?.name || 'Error')
      res.status(500).json({ error: 'The request could not be completed.', code: 'SERVER_ERROR' })
    }
  }
  // A decrypted PDF: always a download, never rendered by the server, never cached, never sniffed.
  const file = (fn, label) => (req, res) => {
    try {
      const { bytes } = fn(req)
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${label(req)}.pdf"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Length': String(bytes.length) })
      res.send(bytes)
    } catch (err) {
      if (err instanceof svc.ServiceError) return res.status(err.status).json({ error: err.message, code: err.code })
      console.error('Report route failed:', err?.name || 'Error')
      res.status(500).json({ error: 'The request could not be completed.', code: 'SERVER_ERROR' })
    }
  }
  const id = (req, name) => ID_RE.test(req.params[name]) ? Number(req.params[name]) : (() => { throw new svc.ServiceError(404, 'NOT_FOUND', 'Not found.') })()

  // Status is available to any signed-in user so the UI can show the honest "not configured" state.
  router.get('/status', handle(() => svc.featureStatus(ctx)))
  // Everything else needs the feature to be fully configured.
  router.use((req, res, next) => {
    if (!svc.featureStatus(ctx).enabled) return res.status(503).json({ error: 'Report Audit is not available right now.', code: 'NOT_CONFIGURED' })
    next()
  })

  // ---- Patient ----
  router.get('/consent', patient, handle(() => svc.getConsent()))
  router.get('/eligible-doctors', patient, handle(req => svc.eligibleDoctors(ctx, req.userId)))
  router.post('/preview', patient, heavy, handle(req => svc.previewReport(ctx, req.userId, req.body)))
  router.post('/', patient, heavy, created(req => svc.createReport(ctx, req.userId, req.body)))
  router.post('/uploads', patient, heavy, created(req => svc.createUploadedReport(ctx, req.userId, req.body)))
  router.get('/', patient, handle(req => svc.listReports(ctx, req.userId)))
  router.get('/shares/:shareId', patient, handle(req => svc.getPatientShare(ctx, req.userId, id(req, 'shareId'))))
  router.post('/shares/:shareId/revoke', patient, heavy, handle(req => svc.revokeShare(ctx, req.userId, id(req, 'shareId'))))
  // ---- Doctor (registered before the "/:id" patient routes so "inbox" is never read as an id) ----
  router.get('/inbox/summary', doctor, handle(req => svc.doctorInboxSummary(ctx, req.userId)))
  router.get('/inbox', doctor, handle(req => svc.doctorInbox(ctx, req.userId, { status: req.query.status, q: req.query.q })))
  router.get('/inbox/:shareId/file', doctor, file(req => svc.doctorShareFile(ctx, req.userId, id(req, 'shareId')), req => `shared-report-${id(req, 'shareId')}`))
  router.get('/inbox/:shareId', doctor, handle(req => svc.doctorOpenShare(ctx, req.userId, id(req, 'shareId'))))
  router.post('/inbox/:shareId/status', doctor, heavy, handle(req => svc.doctorSetStatus(ctx, req.userId, id(req, 'shareId'), req.body)))
  router.post('/inbox/:shareId/notes', doctor, heavy, created(req => svc.doctorAddNote(ctx, req.userId, id(req, 'shareId'), req.body)))

  router.get('/:id/file', patient, file(req => svc.patientReportFile(ctx, req.userId, id(req, 'id')), req => `report-${id(req, 'id')}`))
  router.get('/:id/activity', patient, handle(req => svc.reportActivity(ctx, req.userId, id(req, 'id'))))
  router.post('/:id/shares', patient, heavy, created(req => svc.createShare(ctx, req.userId, id(req, 'id'), req.body)))
  router.get('/:id', patient, handle(req => svc.getReport(ctx, req.userId, id(req, 'id'))))

  return router
}
