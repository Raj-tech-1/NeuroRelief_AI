// Writes one row to the append-only audit_log table (db/database.js). Codes only: never emails, passwords,
// names or health content. An audit failure is logged but never breaks the request that triggered it.
import { run } from '../db/database.js'

export function audit({ action, outcome = 'ok', actorId = null, actorRole = null, targetType = null, targetId = null, detail = null }, runFn = run) {
  try {
    runFn(
      'INSERT INTO audit_log (action, outcome, actor_user_id, actor_role, target_type, target_id, detail_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [action, outcome, actorId, actorRole, targetType, targetId, detail]
    )
  } catch (err) {
    console.error('Audit log write failed:', err?.name || 'Error')
  }
}
