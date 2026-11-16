import { Router } from 'express'
import { all, get, transaction } from '../db/database.js'
import { authenticateToken, requireRole } from '../middleware/auth.js'

// Admin-only: review doctor applications and read the audit log. Admin accounts are created only with
// scripts/seed-user.js (SEED_ROLE=admin); there is no way to become an admin through the API.
const router = Router()
router.use(authenticateToken)
router.use(requireRole('admin'))
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next() })

const ID_RE = /^[1-9]\d*$/
const STATUSES = ['pending', 'approved', 'rejected']
export const REJECT_REASONS = ['licence_unverifiable', 'details_incomplete', 'duplicate_application', 'not_eligible', 'other']

const toApplication = r => ({
  userId: r.user_id, doctorId: r.doctor_id, name: r.display_name, email: r.email, specialty: r.specialty,
  days: (r.days || '').split(',').filter(Boolean), licenceNumber: r.licence_number, licenceAuthority: r.licence_authority,
  status: r.verification_status, appliedAt: r.applied_at, reviewedAt: r.reviewed_at, reason: r.review_reason,
  demo: r.is_demo === 1,
})

// GET /api/admin/doctor-applications?status=pending|approved|rejected  (default: pending)
router.get('/doctor-applications', (req, res) => {
  const status = req.query.status ?? 'pending'
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status filter.' })
  const rows = all(
    `SELECT p.*, u.email FROM doctor_profiles p JOIN users u ON u.user_id = p.user_id
     WHERE p.verification_status = ? ORDER BY COALESCE(p.applied_at, p.created_at) DESC`, [status])
  res.json({ applications: rows.map(toApplication), rejectReasons: REJECT_REASONS })
})

// Approve or reject a PENDING application. Approval turns the account into a doctor (role 'doctor'),
// which makes the profile bookable. Everything happens in one transaction together with its audit entry.
function review(req, res, decision) {
  if (!ID_RE.test(req.params.userId)) return res.status(404).json({ error: 'Application not found.' })
  const userId = Number(req.params.userId)
  const reason = decision === 'rejected' ? req.body?.reason : null
  if (decision === 'rejected' && !REJECT_REASONS.includes(reason)) {
    return res.status(400).json({ error: 'Choose a rejection reason.', code: 'REASON_REQUIRED' })
  }
  const app = get(
    `SELECT p.doctor_id, p.verification_status, u.role FROM doctor_profiles p JOIN users u ON u.user_id = p.user_id WHERE p.user_id = ?`, [userId])
  if (!app) return res.status(404).json({ error: 'Application not found.' })
  if (app.verification_status !== 'pending' || app.role !== 'doctor_applicant') {
    return res.status(409).json({ error: `This application is already ${app.verification_status}.`, code: 'NOT_PENDING' })
  }
  transaction(tx => {
    tx.run(
      "UPDATE doctor_profiles SET verification_status = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?, review_reason = ? WHERE user_id = ? AND verification_status = 'pending'",
      [decision, req.userId, reason, userId])
    if (decision === 'approved') tx.run("UPDATE users SET role = 'doctor' WHERE user_id = ? AND role = 'doctor_applicant'", [userId])
    tx.run('INSERT INTO audit_log (action, actor_user_id, actor_role, target_type, target_id, detail_code) VALUES (?, ?, ?, ?, ?, ?)',
      [decision === 'approved' ? 'doctor.approved' : 'doctor.rejected', req.userId, req.userRole, 'user', userId, reason])
  })
  res.json({ userId, status: decision, reason })
}
router.post('/doctor-applications/:userId/approve', (req, res) => review(req, res, 'approved'))
router.post('/doctor-applications/:userId/reject', (req, res) => review(req, res, 'rejected'))

// GET /api/admin/audit?limit=100  — newest first; codes only
router.get('/audit', (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100))
  res.json(all('SELECT log_id, action, outcome, actor_user_id, actor_role, target_type, target_id, detail_code, created_at FROM audit_log ORDER BY log_id DESC LIMIT ?', [limit]))
})

export default router
