/**
 * API Service Layer — Connected to real backend
 * Base URL: http://localhost:8000/api
 * Future: change to your deployed backend URL
 */

// VITE_API_URL lets a test build point at another backend; unset = the usual local backend
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

import { getSessionToken } from './session'

// The token of the account THIS tab is signed in as (see services/session.js)
const getToken = getSessionToken

function headers(withAuth = true) {
  const h = { 'Content-Type': 'application/json' }
  if (withAuth) {
    const token = getToken()
    if (token) h['Authorization'] = `Bearer ${token}`
  }
  return h
}

// Parses a JSON response and throws on an HTTP error, so an error body (401, 500, ...) is never shown as real data.
// The error carries .status and the server's message when it sent one.
async function okJson(res) {
  let data = null
  try { data = await res.json() } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

// ─── Auth ────────────────────────────────────────────
export async function loginUser(email, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: headers(false),
    body: JSON.stringify({ email, password })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Login failed')
  return data
}

export async function registerUser(email, password) {
  const res = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: headers(false),
    body: JSON.stringify({ email, password })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Registration failed')
  return data
}

// The signed-in account with its profile: { name, email, role, profile: { age, height, weight, bmi }, completion }
export async function getMe() {
  return okJson(await fetch(`${BASE_URL}/auth/me`, { headers: headers() }))
}
// Saves any of { name, age, height, weight } on the account (BMI is computed by the server). Throws with .status.
export async function updateMyProfile(fields) {
  const res = await fetch(`${BASE_URL}/auth/me`, { method: 'PATCH', headers: headers(), body: JSON.stringify(fields) })
  return okJson(res)
}
export const updateMyName = name => updateMyProfile({ name })

// ─── Doctor application (public) and admin review ────
// Errors carry .status, plus .field / .code from the server so the form can point at the right input.
async function jsonRequest(method, path, body, withAuth = true) {
  let res
  try {
    res = await fetch(`${BASE_URL}${path}`, { method, headers: headers(withAuth), body: body ? JSON.stringify(body) : undefined })
  } catch {
    const err = new Error('Could not reach the server. Please check your connection and try again.'); err.code = 'network'; throw err
  }
  let data = null
  try { data = await res.json() } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`)
    err.status = res.status; err.code = data?.code || null; err.field = data?.field || null
    throw err
  }
  return data
}
export const applyAsDoctor = body => jsonRequest('POST', '/auth/doctor-apply', body, false)
export const getMyDoctorApplication = () => jsonRequest('GET', '/auth/doctor-application')
export const getDoctorApplications = (status = 'pending') => jsonRequest('GET', `/admin/doctor-applications?status=${encodeURIComponent(status)}`)
export const approveDoctorApplication = userId => jsonRequest('POST', `/admin/doctor-applications/${userId}/approve`)
export const rejectDoctorApplication = (userId, reason) => jsonRequest('POST', `/admin/doctor-applications/${userId}/reject`, { reason })
export const getAuditLog = (limit = 100) => jsonRequest('GET', `/admin/audit?limit=${limit}`)

// ─── Cycle Data ──────────────────────────────────────
export async function getCycleData(userId) {
  const res = await fetch(`${BASE_URL}/cycles`, { headers: headers() })
  const data = await okJson(res)

  if (data.currentData) {
    return {
      currentPhase: data.currentData.currentPhase,
      dayOfCycle: data.currentData.dayOfCycle,
      nextPeriod: data.currentData.nextPeriod,
      periodLate: !!data.currentData.periodLate,
      daysLate: data.currentData.daysLate || 0,
      // ISO dates; null while the period is late (no window can be estimated)
      fertileWindow: data.currentData.fertileWindow || null,
      lastCycle: {
        startDate: data.currentData.lastCycle?.start_date || '-',
        cycleLength: data.currentData.lastCycle?.cycle_length || 28,
        flow: data.currentData.lastCycle?.flow || 'Medium',
        mood: data.currentData.lastCycle?.mood || '-'
      },
      cycles: data.cycles || [],
      insights: getInsightsForPhase(data.currentData.currentPhase)
    }
  }

  // No cycles yet
  return {
    currentPhase: 'Unknown',
    nextPeriod: '-',
    fertileWindow: { start: '-', end: '-' },
    lastCycle: null,
    cycles: [],
    insights: {
      phase: 'unknown',
      description: 'Add your first cycle to get personalized insights.',
      recommendations: ['Start tracking your cycle', 'Log your symptoms daily', 'Record your mood and energy']
    }
  }
}

function getInsightsForPhase(phase) {
  const insights = {
    'Menstrual': { phase: 'menstrual', description: "You're in your menstrual phase. Focus on rest, gentle movement, and iron-rich foods.", recommendations: ['Rest and gentle stretching', 'Eat iron-rich foods', 'Stay hydrated', 'Use heat therapy for cramps'] },
    'Follicular': { phase: 'follicular', description: "You're in the follicular phase. Energy is rising — great time for new projects and higher-intensity workouts.", recommendations: ['Increase magnesium-rich foods', 'Try higher-intensity workouts', 'Start new projects or goals'] },
    'Ovulatory': { phase: 'ovulatory', description: "You're in the ovulatory phase. Energy and confidence are at their peak.", recommendations: ['Take on challenging workouts', 'Schedule important meetings', 'Eat anti-inflammatory foods'] },
    'Luteal': { phase: 'luteal', description: "You're in the luteal phase. This is a good time for self-care and preparing for your next period.", recommendations: ['Increase magnesium-rich foods', 'Practice gentle yoga', 'Maintain regular sleep schedule'] },
  }
  return insights[phase] || insights['Follicular']
}

export async function addCycle(userId, cycleData) {
  const res = await fetch(`${BASE_URL}/cycles`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      start_date: cycleData.startDate,
      end_date: cycleData.endDate || null,
      cycle_length: cycleData.cycleLength || 28,
      flow: cycleData.flow || 'Medium',
      mood: cycleData.mood || null
    })
  })
  return res.json()
}

// ─── Mood & Wellness ─────────────────────────────────
export async function getMoodData(userId) {
  const res = await fetch(`${BASE_URL}/mood`, { headers: headers() })
  const data = await okJson(res)

  const todayEntry = data.todayEntry
  return {
    today: todayEntry ? {
      mood: todayEntry.mood || 'Good',
      emoji: getMoodEmoji(todayEntry.mood),
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      energy: todayEntry.energy || 5,
      stress: todayEntry.stress || 5,
      sleep: todayEntry.sleep_quality || 7,
      note: todayEntry.note || '',
      affirmation: getRandomAffirmation()
    } : {
      mood: 'Good',
      emoji: '😊',
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      energy: 7, stress: 3, sleep: 8,
      note: 'No mood logged yet today',
      affirmation: getRandomAffirmation()
    },
    patterns: data.patterns || { trend: 'Start tracking to see patterns', tips: ['Log your mood daily'] },
    history: data.records || [],
    // --- fields used by the prediction path (not for display) ---
    todayLogged: !!data.todayLogged,
    recent: data.recent || { daysLogged: 0, avgEnergy: null, avgStress: null, avgSleep: null },
    totalRecords: data.totalRecords || 0
  }
}

function getMoodEmoji(mood) {
  const map = { 'Good': '😊', 'Okay': '😐', 'Sad': '😢', 'Angry': '😡', 'Tired': '😴', 'Sick': '🤒' }
  return map[mood] || '😊'
}

function getRandomAffirmation() {
  const affirmations = [
    'You are capable of amazing things. Trust yourself and keep going.',
    'Every day is a new opportunity to grow and shine.',
    'Your strength is greater than any struggle.',
    'Be gentle with yourself. You are doing your best.',
    'You deserve to feel happy and at peace.',
  ]
  return affirmations[Math.floor(Math.random() * affirmations.length)]
}

export async function saveMoodEntry(userId, entry) {
  const res = await fetch(`${BASE_URL}/mood`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      mood: entry.mood,
      energy: entry.energy,
      stress: entry.stress,
      sleep_quality: entry.sleep,
      // The form has no sleep-hours input: 'sleep' is the 1-10 quality score, so it must not be stored as hours
      sleep_hours: null,
      note: entry.note
    })
  })
  return res.json()
}

// ─── Wellness Overview ───────────────────────────────
export async function getOverviewData(userId) {
  // Fetch real data from multiple endpoints
  let cycleCount = 0, moodCount = 0
  try {
    const cycleRes = await fetch(`${BASE_URL}/cycles`, { headers: headers() })
    const cycleData = await cycleRes.json()
    cycleCount = cycleData.cycles?.length || 0
  } catch {}
  try {
    const moodRes = await fetch(`${BASE_URL}/mood`, { headers: headers() })
    const moodData = await moodRes.json()
    moodCount = moodData.records?.length || 0
  } catch {}

  return {
    stats: {
      cyclesTracked: cycleCount,
      moodCheckins: moodCount,
      healthScore: Math.min(100, 60 + cycleCount * 3 + moodCount * 2),
      goalsMet: `${Math.min(10, Math.floor(cycleCount + moodCount / 3))}/10`
    },
    todaysFocus: {
      title: "Today's Focus",
      subtitle: 'Stay hydrated and mindful',
      items: [
        { label: 'Hydration', detail: '6 of 8 glasses completed' },
        { label: 'Mindfulness', detail: '5 min meditation done' }
      ]
    },
    healthTips: [
      { title: 'Nutrition', detail: 'Iron-rich foods boost energy' },
      { title: 'Movement', detail: '30 mins gentle exercise' },
      { title: 'Sleep', detail: '7-9 hours for optimal health' }
    ],
    wellnessJourney: [
      { title: 'Cycle logged', detail: `${cycleCount} cycles tracked`, time: 'Recent', color: 'pink' },
      { title: 'Mood check-in', detail: `${moodCount} check-ins`, time: 'Recent', color: 'purple' },
      { title: 'AI symptom analysis', detail: 'Use the advisor for insights', time: '', color: 'blue' }
    ]
  }
}

// ─── Doctors ─────────────────────────────────────────
export async function getDoctors() {
  const res = await fetch(`${BASE_URL}/doctors`)
  return okJson(res)
}

// ─── Articles / Learn ────────────────────────────────
export async function getArticles() {
  return [
    { id: 1, title: 'Understanding Your Menstrual Cycle', description: 'Learn about the four phases of your menstrual cycle and how they affect your body and mood.', category: 'menstrual health', readTime: 5, level: 'beginner' },
    { id: 2, title: 'Nutrition for Hormonal Balance', description: 'Discover foods that support hormonal health and help alleviate common menstrual symptoms.', category: 'nutrition', readTime: 7, level: 'intermediate' },
    { id: 3, title: 'Managing PMS Naturally', description: 'Natural remedies and lifestyle changes to help manage premenstrual syndrome symptoms.', category: 'mental health', readTime: 6, level: 'beginner' },
    { id: 4, title: 'Exercise Through Your Cycle', description: "Learn how to adapt your exercise routine to work with your body's natural rhythm.", category: 'fitness', readTime: 5, level: 'intermediate' },
    { id: 5, title: 'Understanding PCOS', description: 'Comprehensive guide to Polycystic Ovary Syndrome symptoms, diagnosis, and management.', category: 'menstrual health', readTime: 8, level: 'advanced' },
    { id: 6, title: 'Sleep and Your Cycle', description: 'How your menstrual cycle affects sleep patterns and tips for better rest.', category: 'mental health', readTime: 5, level: 'beginner' },
    { id: 7, title: 'TENS Therapy for Menstrual Pain', description: 'How Transcutaneous Electrical Nerve Stimulation works to relieve period cramps without medication.', category: 'menstrual health', readTime: 6, level: 'intermediate' },
    { id: 8, title: 'Heat Therapy and Dysmenorrhea', description: 'The science behind why heat pads work for period pain and optimal temperature ranges for relief.', category: 'menstrual health', readTime: 5, level: 'beginner' },
    { id: 9, title: 'Anti-Inflammatory Diet Guide', description: 'Foods that reduce inflammation and ease menstrual pain — omega-3s, turmeric, leafy greens, and more.', category: 'nutrition', readTime: 8, level: 'intermediate' },
    { id: 10, title: 'Iron Deficiency and Periods', description: 'Why menstruation increases iron loss, symptoms of deficiency, and how to maintain healthy iron levels.', category: 'nutrition', readTime: 6, level: 'beginner' },
    { id: 11, title: 'Yoga Poses for Cramp Relief', description: '10 gentle yoga poses specifically designed to ease menstrual cramps and lower back pain.', category: 'fitness', readTime: 7, level: 'beginner' },
    { id: 12, title: 'Strength Training and Hormones', description: 'How resistance training affects estrogen, progesterone, and testosterone throughout your cycle.', category: 'fitness', readTime: 8, level: 'advanced' },
    { id: 13, title: 'Anxiety and Your Cycle', description: 'Why anxiety peaks during the luteal phase and evidence-based techniques to manage it.', category: 'mental health', readTime: 7, level: 'intermediate' },
    { id: 14, title: 'Endometriosis Explained', description: 'Understanding endometriosis: symptoms, diagnosis methods, treatment options, and living with the condition.', category: 'menstrual health', readTime: 10, level: 'advanced' },
    { id: 15, title: 'Contraception and Cycle Changes', description: 'How different birth control methods affect your menstrual cycle, mood, and overall health.', category: 'sexual health', readTime: 8, level: 'intermediate' },
    { id: 16, title: 'Reproductive Health Basics', description: 'Essential knowledge about reproductive anatomy, fertility windows, and maintaining reproductive wellness.', category: 'sexual health', readTime: 7, level: 'beginner' },
    { id: 17, title: 'Gut Health and Hormones', description: 'The gut-hormone connection: how your microbiome affects estrogen metabolism and menstrual health.', category: 'nutrition', readTime: 9, level: 'advanced' },
    { id: 18, title: 'Meditation for Pain Management', description: 'Mindfulness-based techniques that reduce pain perception and improve emotional resilience during periods.', category: 'mental health', readTime: 6, level: 'beginner' },
  ]
}

// ─── Scan / Assessment ───────────────────────────────
export async function submitScan(scanData) {
  const res = await fetch(`${BASE_URL}/scans`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      life_stage: scanData.lifeStage,
      body_areas: scanData.bodyAreas,
      severity: scanData.severity,
      symptom_description: scanData.symptomDescription,
      medications: scanData.medications,
      notes: scanData.notes
    })
  })
  const data = await okJson(res)
  return {
    scan_id: data.scan_id,
    timestamp: new Date().toISOString(),
    ...scanData,
    aiSummary: data.ai_summary
  }
}

export async function getPastScans(userId) {
  const res = await fetch(`${BASE_URL}/scans`, { headers: headers() })
  return okJson(res)
}

// ─── Doctor workflow (appointment requests) ──────────
// Identity and role always come from the server-verified token, never from these arguments.
async function doctorRequest(method, path, body) {
  let res
  try {
    res = await fetch(`${BASE_URL}/doctors${path}`, {
      method, headers: headers(), body: body ? JSON.stringify(body) : undefined
    })
  } catch {
    throw new Error('Could not reach the server. Please check your connection and try again.')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
  return data
}

export const getDoctorProfile = () => doctorRequest('GET', '/me')
export const getDoctorRequests = () => doctorRequest('GET', '/requests')
export const updateRequestStatus = (id, status) => doctorRequest('PATCH', `/requests/${id}`, { status })
export const markRequestSeen = id => doctorRequest('POST', `/requests/${id}/seen`)
export const markAllRequestsSeen = () => doctorRequest('POST', '/requests/seen')
export const getMyBookings = () => doctorRequest('GET', '/bookings')
export const requestAppointment = body => doctorRequest('POST', '/book', body)
export const cancelBooking = id => doctorRequest('POST', `/bookings/${id}/cancel`)

// ─── Therapy plan and safety limits (heat limits are hard caps; TENS is a recommendation) ───
export const getTherapyLimits = () => jsonRequest('GET', '/therapy-plan')
export const getDeviceLimits = () => jsonRequest('GET', '/therapy-plan/device-limits')
export const getDoctorTherapyPlan = patientId => jsonRequest('GET', `/therapy-plan/doctor/${patientId}`)
export const createTherapyPlan = (patientId, body) => jsonRequest('POST', `/therapy-plan/doctor/${patientId}`, body)
export const revokeTherapyPlan = patientId => jsonRequest('POST', `/therapy-plan/doctor/${patientId}/revoke`)

// ─── Relief Journal (patient's own; medicine by name and time only, no dose) ───
export const getJournal = () => jsonRequest('GET', '/journal')
export const addJournalEntry = body => jsonRequest('POST', '/journal', body)
export const setJournalPainAfter = (id, painAfter) => jsonRequest('PATCH', `/journal/${id}`, { painAfter })
export const deleteJournalEntry = id => jsonRequest('DELETE', `/journal/${id}`)

// ─── 7-day pain estimate (AI model, built on the server; nothing saved) ───
export async function getPainForecast() {
  return okJson(await fetch(`${BASE_URL}/predict/forecast`, { headers: headers() }))
}

// ─── Prediction history (for the Overview "Latest Pain Prediction") ───
export async function getPredictionHistory() {
  const res = await fetch(`${BASE_URL}/predict/history`, { headers: headers() })
  const data = await okJson(res)
  return Array.isArray(data) ? data : []
}

// ─── Report Audit (patient side; every rule is enforced by the backend) ───
// Errors carry .status (HTTP) and .code (the backend's machine code, e.g. 'NO_DATA'); a network failure has code 'network'.
async function reportRequest(method, path, body) {
  let res
  try {
    res = await fetch(`${BASE_URL}/reports${path}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined })
  } catch {
    const err = new Error('network'); err.code = 'network'; throw err
  }
  let data = null
  try { data = await res.json() } catch { /* non-JSON body (e.g. a server without these routes) */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`)
    err.status = res.status; err.code = data?.code || null
    throw err
  }
  return data
}
export const getReportFeatureStatus = () => reportRequest('GET', '/status')
export const previewReport = body => reportRequest('POST', '/preview', body)
export const saveReport = body => reportRequest('POST', '/', body)
export const getMyReports = () => reportRequest('GET', '/')
export const getMyReport = id => reportRequest('GET', `/${id}`)
export const getReportShare = id => reportRequest('GET', `/shares/${id}`)
export const getReportActivity = id => reportRequest('GET', `/${id}/activity`)
// Sharing (the backend re-checks ownership, the confirmed appointment and the consent version on every call)
export const getReportConsent = () => reportRequest('GET', '/consent')
export const getEligibleDoctors = () => reportRequest('GET', '/eligible-doctors')
export const shareReport = (reportId, body) => reportRequest('POST', `/${reportId}/shares`, body)
export const revokeReportShare = shareId => reportRequest('POST', `/shares/${shareId}/revoke`)
// Uploaded PDF reports: the browser sends the file as base64 JSON; the backend re-validates everything (type, size, content).
export const uploadReportPdf = body => reportRequest('POST', '/uploads', body)
async function reportBlob(path) {
  let res
  try { res = await fetch(`${BASE_URL}/reports${path}`, { headers: headers() }) } catch { const err = new Error('network'); err.code = 'network'; throw err }
  if (!res.ok) {
    let data = null
    try { data = await res.json() } catch { /* not JSON */ }
    const err = new Error(data?.error || `Request failed (${res.status})`)
    err.status = res.status; err.code = data?.code || null
    throw err
  }
  return res.blob()
}
// The PDF is fetched with the Authorization header (never a token in a URL) and handled as a blob.
export const getMyReportFile = id => reportBlob(`/${id}/file`)
export const getDoctorReportFile = shareId => reportBlob(`/inbox/${shareId}/file`)
// Doctor side (the backend only answers for shares addressed to the signed-in doctor, with a confirmed appointment)
export const getDoctorReportSummary = () => reportRequest('GET', '/inbox/summary')
export const getDoctorReportInbox = () => reportRequest('GET', '/inbox')
export const getDoctorReportShare = shareId => reportRequest('GET', `/inbox/${shareId}`)
export const setDoctorReportStatus = (shareId, body) => reportRequest('POST', `/inbox/${shareId}/status`, body)
export const addDoctorReportNote = (shareId, note) => reportRequest('POST', `/inbox/${shareId}/notes`, { note })

// ─── Reports (old stubs, unused) ─────────────────────
export async function getReports(userId) { return [] }
export async function uploadReport(userId, file) {
  return { report_id: 'rpt_' + Date.now(), fileName: file.name }
}

// ─── Voice / chat assistant (backend proxies Gemini; the key never reaches the browser) ───
async function assistantRequest(method, path, body) {
  let res
  try {
    res = await fetch(`${BASE_URL}/assistant${path}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined })
  } catch {
    const err = new Error('network'); err.code = 'network'; throw err
  }
  let data = null
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const err = new Error('assistant_error')
    err.code = res.status === 401 || res.status === 403 ? 'session' : (data && data.error) || 'generic'
    throw err
  }
  return data
}
export const getAssistantStatus = () => assistantRequest('GET', '/status')
export const sendAssistantMessage = (message, history, lang) => assistantRequest('POST', '/chat', { message, history, lang })

// ─── Care sync (/api/care): appointments, notes, messages, record consent, symptoms, therapy sessions ───
// Every rule (who may see what) is enforced by the backend. Errors carry .status and .code like reportRequest.
async function careRequest(method, path, body) {
  let res
  try {
    res = await fetch(`${BASE_URL}/care${path}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined })
  } catch {
    const err = new Error('Could not reach the server. Please check your connection and try again.'); err.code = 'network'; throw err
  }
  let data = null
  try { data = await res.json() } catch { /* non-JSON body */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`)
    err.status = res.status; err.code = data?.code || null
    throw err
  }
  return data
}
export const getCareStatus = () => careRequest('GET', '/status')
export const getCareActivity = since => careRequest('GET', `/activity${since ? `?since=${encodeURIComponent(since)}` : ''}`)
export const getConversations = () => careRequest('GET', '/conversations')
export const getCareAppointment = id => careRequest('GET', `/appointments/${id}`)
export const getMessages = id => careRequest('GET', `/appointments/${id}/messages`)
export const sendMessage = (id, text) => careRequest('POST', `/appointments/${id}/messages`, { text })
// patient
export const rescheduleAppointment = (id, body) => careRequest('POST', `/appointments/${id}/reschedule`, body)
export const respondToProposal = (id, accept, version) => careRequest('POST', `/appointments/${id}/proposal`, { accept, version })
export const getPatientNotes = id => careRequest('GET', `/appointments/${id}/notes`)
export const getMyFollowUps = () => careRequest('GET', '/follow-ups')
export const getRecordConsent = () => careRequest('GET', '/consent')
export const getMyGrants = () => careRequest('GET', '/grants')
export const createGrant = body => careRequest('POST', '/grants', body)
export const revokeGrant = id => careRequest('POST', `/grants/${id}/revoke`)
export const getMySymptoms = () => careRequest('GET', '/symptoms')
export const addSymptom = body => careRequest('POST', '/symptoms', body)
export const getTherapySessions = () => careRequest('GET', '/therapy-sessions')
export const saveTherapySession = body => careRequest('POST', '/therapy-sessions', body)
// doctor
export const getDoctorDashboard = () => careRequest('GET', '/doctor/dashboard')
export const proposeTime = (id, body) => careRequest('POST', `/doctor/appointments/${id}/propose`, body)
export const completeAppointment = (id, version) => careRequest('POST', `/doctor/appointments/${id}/complete`, { version })
export const doctorCancelAppointment = (id, version) => careRequest('POST', `/doctor/appointments/${id}/cancel`, { version })
export const addConsultationNote = (id, body) => careRequest('POST', `/doctor/appointments/${id}/notes`, body)
export const getDoctorNotes = (query = {}) => careRequest('GET', `/doctor/notes${Object.keys(query).length ? '?' + new URLSearchParams(query) : ''}`)
export const updateNote = (id, body) => careRequest('PATCH', `/doctor/notes/${id}`, body)
export const getDoctorFollowUps = () => careRequest('GET', '/doctor/follow-ups')
export const getDoctorPatients = () => careRequest('GET', '/doctor/patients')
export const getPatientTimeline = patientId => careRequest('GET', `/doctor/patients/${patientId}/timeline`)
export const getPatientRecords = (patientId, category) => careRequest('GET', `/doctor/patients/${patientId}/records?category=${encodeURIComponent(category)}`)
