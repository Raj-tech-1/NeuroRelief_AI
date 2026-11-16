import { Router, json } from 'express'
import { requireRole } from '../middleware/auth.js'
import { createRateLimiter } from '../middleware/rateLimit.js'
import { encrypt, decrypt } from '../lib/reportCrypto.js'
import { activePlan, effectiveLimits, validatePlan, blePayload, PlanError, SYSTEM_LIMITS, DEFAULT_PLAN, TENS_GUIDANCE } from '../lib/therapyLimits.js'

// /api/therapy-plan
//   patient: GET /            current limits (doctor's plan or the standard plan)
//            GET /device-limits  the same limits as the BLE payload for the ESP32 (hex)
//   doctor:  GET  /doctor/:patientId          active plan + history (only with a confirmed appointment)
//            POST /doctor/:patientId          new plan (supersedes the active one)
//            POST /doctor/:patientId/revoke   back to the standard plan
// A doctor's optional note is encrypted (Report Audit key). Every change is written to audit_log.
export function createTherapyPlanRouter({ authenticate, ctx }) {
  const router = Router()
  const writes = createRateLimiter({ windowMs: 10 * 60_000, max: 60 })
  router.use(authenticate)
  router.use(json({ limit: '8kb' }))
  const ID_RE = /^[1-9]\d*$/
  const aad = (planId, patientId) => Buffer.from(`nr-plan|v1|plan:${planId}|patient:${patientId}`, 'utf8')
  const key = () => { try { return ctx.key() } catch { return null } }

  const handle = fn => (req, res) => {
    try {
      res.set('Cache-Control', 'no-store')
      const out = fn(req)
      res.status(out?.__status || 200).json(out?.__status ? out.body : out)
    } catch (err) {
      if (err instanceof PlanError) return res.status(err.status).json({ error: err.message, code: err.code, field: err.field })
      console.error('Therapy plan route failed:', err?.name || 'Error')
      res.status(500).json({ error: 'The request could not be completed.', code: 'SERVER_ERROR' })
    }
  }

  function noteOf(row) {
    if (!row?.ciphertext) return null
    const k = key()
    if (!k || k.keyId !== row.key_id) return null
    try { return decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, { key: k.key, aad: aad(row.plan_id, row.patient_id) }).toString('utf8') }
    catch { return null }
  }
  const planView = row => row && ({
    planId: row.plan_id, doctorName: row.doctor_name ?? null, status: row.status,
    heatMinC: row.heat_min_c, heatMaxC: row.heat_max_c, heatMaxMinutes: row.heat_max_minutes,
    tensFreqMin: row.tens_freq_min, tensFreqMax: row.tens_freq_max, sessionsPerDay: row.sessions_per_day,
    validUntil: row.valid_until, createdAt: row.created_at, endedAt: row.ended_at, note: noteOf(row),
  })
  const meta = { absolute: { heatMaxC: SYSTEM_LIMITS.heatAbsMaxC, heatMinC: SYSTEM_LIMITS.heatAbsMinC, heatMaxMinutes: SYSTEM_LIMITS.heatMaxMinutes, tensFreqMin: SYSTEM_LIMITS.tensFreqMin, tensFreqMax: SYSTEM_LIMITS.tensFreqMax, sessionsPerDayMax: SYSTEM_LIMITS.sessionsPerDayMax, planMaxDays: SYSTEM_LIMITS.planMaxDays }, standardPlan: DEFAULT_PLAN, tensGuidance: TENS_GUIDANCE }

  // ---------------- patient ----------------
  router.get('/', requireRole('user'), handle(req => {
    const limits = effectiveLimits(ctx.db, req.userId, ctx.now())
    const plan = activePlan(ctx.db, req.userId, ctx.now())
    return { limits, plan: planView(plan), ...meta }
  }))
  router.get('/device-limits', requireRole('user'), handle(req => {
    const limits = effectiveLimits(ctx.db, req.userId, ctx.now())
    return { limits, payloadHex: blePayload(limits).toString('hex'), format: 'nr-limits-v1' }
  }))

  // ---------------- doctor ----------------
  const doctor = requireRole('doctor')
  // The doctor's most recent confirmed (accepted/completed) appointment with this patient, or 403
  function relationship(req) {
    if (!ID_RE.test(req.params.patientId)) throw new PlanError(404, 'NOT_FOUND', 'Patient not found.')
    const patientId = Number(req.params.patientId)
    const a = ctx.db.get(
      "SELECT appointment_id FROM appointments WHERE doctor_user_id = ? AND patient_id = ? AND status IN ('accepted','completed') ORDER BY requested_date DESC, appointment_id DESC LIMIT 1",
      [req.userId, patientId])
    if (!a) throw new PlanError(403, 'NOT_ELIGIBLE', 'You can only set a therapy plan for a patient with a confirmed appointment with you.')
    return { patientId, appointmentId: a.appointment_id }
  }
  const audit = (tx, action, req, patientId, detail = null) =>
    tx.run('INSERT INTO audit_log (action, actor_user_id, actor_role, target_type, target_id, detail_code) VALUES (?, ?, ?, ?, ?, ?)', [action, req.userId, req.userRole, 'user', patientId, detail])

  router.get('/doctor/:patientId', doctor, handle(req => {
    const { patientId } = relationship(req)
    const history = ctx.db.all(
      `SELECT p.*, d.display_name AS doctor_name FROM therapy_plans p LEFT JOIN doctor_profiles d ON d.user_id = p.doctor_user_id
       WHERE p.patient_id = ? ORDER BY p.plan_id DESC LIMIT 20`, [patientId])
    return { limits: effectiveLimits(ctx.db, patientId, ctx.now()), plan: planView(activePlan(ctx.db, patientId, ctx.now())), history: history.map(planView), ...meta }
  }))

  router.post('/doctor/:patientId', doctor, writes, handle(req => {
    const { patientId, appointmentId } = relationship(req)
    const v = validatePlan(req.body)
    const note = typeof req.body?.note === 'string' ? req.body.note.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 500) : ''
    const k = note ? key() : null
    if (note && !k) throw new PlanError(503, 'ENCRYPTION_UNAVAILABLE', 'Notes cannot be saved right now. Save the plan without a note, or try again later.')
    const now = ctx.now()
    const validUntil = new Date(now.getTime() + v.validDays * 86400000).toISOString()
    const planId = ctx.db.transaction(tx => {
      tx.run("UPDATE therapy_plans SET status = 'superseded', ended_at = CURRENT_TIMESTAMP WHERE patient_id = ? AND status = 'active'", [patientId])
      // The id is needed before the insert to bind the encrypted note to it (values are immutable after insert)
      const id = Number(tx.get("SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'therapy_plans'), 0) + 1 AS n").n)
      const env = note ? encrypt(note, { key: k.key, aad: aad(id, patientId) }) : null
      tx.run(
        `INSERT INTO therapy_plans (plan_id, patient_id, doctor_user_id, appointment_id, heat_min_c, heat_max_c, heat_max_minutes, tens_freq_min, tens_freq_max,
                                    sessions_per_day, valid_until, ciphertext, iv, auth_tag, key_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, patientId, req.userId, appointmentId, v.heatMinC, v.heatMaxC, v.heatMaxMinutes, v.tensFreqMin, v.tensFreqMax, v.sessionsPerDay, validUntil,
          env?.ciphertext ?? null, env?.iv ?? null, env?.authTag ?? null, env ? k.keyId : null])
      audit(tx, 'therapy_plan.created', req, patientId)
      return id
    })
    const row = ctx.db.get('SELECT p.*, d.display_name AS doctor_name FROM therapy_plans p LEFT JOIN doctor_profiles d ON d.user_id = p.doctor_user_id WHERE p.plan_id = ?', [planId])
    return { __status: 201, body: { plan: planView(row), limits: effectiveLimits(ctx.db, patientId, ctx.now()) } }
  }))

  router.post('/doctor/:patientId/revoke', doctor, writes, handle(req => {
    const { patientId } = relationship(req)
    const active = activePlan(ctx.db, patientId, ctx.now())
    if (!active) throw new PlanError(409, 'NO_ACTIVE_PLAN', 'There is no active plan to end.')
    ctx.db.transaction(tx => {
      tx.run("UPDATE therapy_plans SET status = 'revoked', ended_at = CURRENT_TIMESTAMP WHERE plan_id = ? AND status = 'active'", [active.plan_id])
      audit(tx, 'therapy_plan.revoked', req, patientId)
    })
    return { revoked: active.plan_id, limits: effectiveLimits(ctx.db, patientId, ctx.now()) }
  }))

  return router
}
