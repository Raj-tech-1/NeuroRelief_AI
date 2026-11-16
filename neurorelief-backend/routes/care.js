// /api/care — patient <-> doctor synchronisation: appointment lifecycle, consultation notes, follow-ups, messages,
// health-record consent, symptoms, therapy sessions, activity feed and the doctor dashboard.
// All rules live in lib/clinicalService.js; this file only does authentication, role gating, rate limiting and error mapping.
// Built from injected dependencies (createCareRouter) so tests can mount it on a scratch database.
// Until the clinical schema exists every route except /status answers a generic 503 and nothing is read or written.
import { Router, json } from 'express'
import { requireRole } from '../middleware/auth.js'
import { createRateLimiter } from '../middleware/rateLimit.js'
import * as svc from '../lib/clinicalService.js'

const ID_RE = /^[1-9]\d*$/

export function createCareRouter({ authenticate, ctx, reportSummary = null, limits = {} }) {
  const router = Router()
  const general = createRateLimiter({ windowMs: 60_000, max: limits.generalPerMinute ?? 240 })
  const writes = createRateLimiter({ windowMs: 10 * 60_000, max: limits.writesPer10Min ?? 120 })

  router.use(authenticate)   // only reads headers: no body is parsed for an anonymous request
  router.use(json({ limit: '32kb' }))
  router.use(general)

  const patient = requireRole('user')
  const doctor = requireRole('doctor')
  const party = requireRole('user', 'doctor')
  const actor = req => ({ id: req.userId, role: req.userRole })
  const wrap = status => fn => (req, res) => {
    try {
      res.set('Cache-Control', 'no-store')
      res.status(status).json(fn(req))
    } catch (err) {
      if (err instanceof svc.CareError) return res.status(err.status).json({ error: err.message, code: err.code })
      console.error('Care route failed:', err?.name || 'Error')   // never log the message: it could contain record content
      res.status(500).json({ error: 'The request could not be completed.', code: 'SERVER_ERROR' })
    }
  }
  const handle = wrap(200)
  const created = wrap(201)
  const id = (req, name) => ID_RE.test(req.params[name]) ? Number(req.params[name]) : (() => { throw new svc.CareError(404, 'NOT_FOUND', 'Not found.') })()

  router.get('/status', handle(() => svc.featureStatus(ctx)))
  router.use((req, res, next) => {
    if (!svc.featureStatus(ctx).enabled) return res.status(503).json({ error: 'This feature is not available yet.', code: 'NOT_CONFIGURED' })
    next()
  })

  // ---- Both parties ----
  router.get('/activity', party, handle(req => svc.activity(ctx, actor(req), req.query.since)))
  router.get('/conversations', party, handle(req => svc.conversations(ctx, actor(req))))
  router.get('/appointments/:id', party, handle(req => svc.getAppointment(ctx, actor(req), id(req, 'id'))))
  router.get('/appointments/:id/messages', party, handle(req => svc.listMessages(ctx, actor(req), id(req, 'id'))))
  router.post('/appointments/:id/messages', party, writes, created(req => svc.sendMessage(ctx, actor(req), id(req, 'id'), req.body)))

  // ---- Patient ----
  router.post('/appointments/:id/reschedule', patient, writes, handle(req => svc.patientReschedule(ctx, req.userId, id(req, 'id'), req.body)))
  router.post('/appointments/:id/proposal', patient, writes, handle(req => svc.patientRespondProposal(ctx, req.userId, id(req, 'id'), req.body)))
  router.get('/appointments/:id/notes', patient, handle(req => svc.patientNotes(ctx, req.userId, id(req, 'id'))))
  router.get('/follow-ups', patient, handle(req => svc.patientFollowUps(ctx, req.userId)))
  router.get('/consent', patient, handle(() => svc.getConsent()))
  router.get('/grants', patient, handle(req => svc.patientGrants(ctx, req.userId)))
  router.post('/grants', patient, writes, created(req => svc.createGrant(ctx, req.userId, req.body)))
  router.post('/grants/:id/revoke', patient, writes, handle(req => svc.revokeGrant(ctx, req.userId, id(req, 'id'))))
  router.get('/symptoms', patient, handle(req => svc.listSymptoms(ctx, req.userId)))
  router.post('/symptoms', patient, writes, created(req => svc.addSymptom(ctx, req.userId, req.body)))
  router.get('/therapy-sessions', patient, handle(req => svc.listTherapySessions(ctx, req.userId)))
  router.post('/therapy-sessions', patient, writes, created(req => svc.addTherapySession(ctx, req.userId, req.body)))

  // ---- Doctor ----
  router.get('/doctor/dashboard', doctor, handle(req => {
    let summary = null
    try { summary = reportSummary ? reportSummary(req.userId) : null } catch { summary = null }
    return svc.doctorDashboard(ctx, req.userId, summary)
  }))
  router.post('/doctor/appointments/:id/propose', doctor, writes, handle(req => svc.doctorPropose(ctx, req.userId, id(req, 'id'), req.body)))
  router.post('/doctor/appointments/:id/complete', doctor, writes, handle(req => svc.doctorComplete(ctx, req.userId, id(req, 'id'), req.body)))
  router.post('/doctor/appointments/:id/cancel', doctor, writes, handle(req => svc.doctorCancel(ctx, req.userId, id(req, 'id'), req.body)))
  router.post('/doctor/appointments/:id/notes', doctor, writes, created(req => svc.doctorAddNote(ctx, req.userId, id(req, 'id'), req.body)))
  router.get('/doctor/notes', doctor, handle(req => svc.doctorNotes(ctx, req.userId, req.query)))
  router.patch('/doctor/notes/:id', doctor, writes, handle(req => svc.doctorUpdateNote(ctx, req.userId, id(req, 'id'), req.body)))
  router.get('/doctor/follow-ups', doctor, handle(req => svc.doctorFollowUps(ctx, req.userId)))
  router.get('/doctor/patients', doctor, handle(req => svc.doctorPatients(ctx, req.userId)))
  router.get('/doctor/patients/:id/timeline', doctor, handle(req => svc.doctorPatientTimeline(ctx, req.userId, id(req, 'id'))))
  router.get('/doctor/patients/:id/records', doctor, handle(req => svc.doctorPatientRecords(ctx, req.userId, id(req, 'id'), req.query.category)))

  return router
}
