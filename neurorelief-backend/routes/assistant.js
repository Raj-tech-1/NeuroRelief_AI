import { Router } from 'express'
import { authenticateToken } from '../middleware/auth.js'

// Voice/chat wellness assistant. Stateless: nothing is written to the database and
// the conversation is held only by the client. The Gemini key stays in this process.
const router = Router()
router.use(authenticateToken)

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`
const TIMEOUT_MS = 20000
const MAX_MESSAGE = 1000
const MAX_HISTORY_TURNS = 10
const MAX_HISTORY_TEXT = 2000
const RATE_LIMIT = 12          // requests per user per minute
const LANGUAGES = { en: 'English', hi: 'Hindi', kn: 'Kannada', ta: 'Tamil', te: 'Telugu' }

const hits = new Map()
function rateLimited(userId) {
  const now = Date.now()
  const recent = (hits.get(userId) || []).filter(t => now - t < 60000)
  if (recent.length >= RATE_LIMIT) { hits.set(userId, recent); return true }
  recent.push(now)
  hits.set(userId, recent)
  return false
}

const systemPrompt = language => `You are the NeuroRelief AI wellness assistant for people who experience menstrual pain.
Reply ONLY in ${language}, in plain conversational text with no markdown, bullet symbols, asterisks or emojis, because the reply may be read aloud. Keep it short: at most about 5 sentences.
Rules:
- You give general wellness information only. You are not a doctor and you never diagnose, prescribe medicine or doses, or say what condition someone has.
- If the person describes urgent signs, tell them clearly and first to seek urgent medical care or contact their local emergency number. Urgent signs include: very heavy bleeding (for example soaking through a pad or tampon every hour for several hours), fainting or near-fainting, sudden or severe pain, pain or bleeding when pregnant or possibly pregnant, fever with pelvic pain, chest pain, or difficulty breathing.
- For ordinary period pain you may mention commonly recommended self-care such as rest, warmth, gentle movement, hydration and talking to a doctor if pain is severe, new, getting worse or interfering with daily life.
- You cannot see this person's health records, pain predictions or device data, and you must not claim to. Never give instructions to set or change TENS or heat device settings; for the device, tell them to use the Device Control page and its safety limits, or ask a clinician.
- If you are unsure or the question is outside menstrual health and wellness, say so briefly and suggest speaking to a healthcare professional.
- Do not invent statistics, studies or medical facts.`

function fail(res, status, code) {
  return res.status(status).json({ error: code })
}

router.get('/status', (req, res) => {
  res.json({ configured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) })
})

router.post('/chat', async (req, res) => {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim()
  if (!apiKey) return fail(res, 503, 'not_configured')

  const { message, history, lang } = req.body || {}
  if (typeof message !== 'string' || !message.trim()) return fail(res, 400, 'empty_message')
  if (message.length > MAX_MESSAGE) return fail(res, 400, 'message_too_long')
  const language = LANGUAGES[lang] || LANGUAGES.en

  const turns = Array.isArray(history) ? history.slice(-MAX_HISTORY_TURNS) : []
  const contents = []
  for (const turn of turns) {
    if (!turn || typeof turn.text !== 'string' || !turn.text.trim()) continue
    if (turn.role !== 'user' && turn.role !== 'assistant') continue
    contents.push({ role: turn.role === 'user' ? 'user' : 'model', parts: [{ text: turn.text.slice(0, MAX_HISTORY_TEXT) }] })
  }
  contents.push({ role: 'user', parts: [{ text: message.trim() }] })

  if (rateLimited(req.userId)) return fail(res, 429, 'rate_limited')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const upstream = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt(language) }] },
        contents,
        generationConfig: { temperature: 0.4, maxOutputTokens: 1024 }
      }),
      signal: controller.signal
    })
    if (!upstream.ok) {
      console.error(`Assistant: Gemini responded with HTTP ${upstream.status}`)
      return fail(res, 502, upstream.status === 429 ? 'upstream_busy' : 'upstream_error')
    }
    const data = await upstream.json()
    if (data.promptFeedback?.blockReason) return fail(res, 422, 'blocked')
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim()
    if (!text) return fail(res, 502, 'empty_reply')
    res.json({ reply: text })
  } catch (err) {
    if (err.name === 'AbortError') return fail(res, 504, 'timeout')
    console.error('Assistant: request to Gemini failed')
    return fail(res, 502, 'upstream_error')
  } finally {
    clearTimeout(timer)
  }
})

export default router
