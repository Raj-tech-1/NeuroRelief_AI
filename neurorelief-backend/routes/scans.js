import { Router } from 'express'
import { all, run } from '../db/database.js'
import { authenticateToken } from '../middleware/auth.js'

const router = Router()
router.use(authenticateToken)

router.get('/', (req, res) => {
  const scans = all('SELECT * FROM scans WHERE user_id = ? ORDER BY created_at DESC', [req.userId])
  res.json(scans)
})

router.post('/', (req, res) => {
  const { life_stage, body_areas, severity, symptom_description, medications, notes } = req.body
  const areas = Array.isArray(body_areas) ? body_areas.join(', ') : body_areas
  const meds = Array.isArray(medications) ? medications.join(', ') : medications || null
  const ai_summary = `Based on your symptoms (severity ${severity}/10) in the ${life_stage} stage, affecting ${areas}. We recommend consulting with a healthcare provider for further evaluation.`

  const result = run(
    'INSERT INTO scans (user_id, life_stage, body_areas, severity, symptom_description, medications, notes, ai_summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [req.userId, life_stage, areas, severity, symptom_description || null, meds, notes || null, ai_summary]
  )

  res.status(201).json({ scan_id: result.lastInsertRowid, ai_summary, message: 'Scan saved' })
})

export default router
