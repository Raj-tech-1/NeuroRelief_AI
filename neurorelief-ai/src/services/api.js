/**
 * API Service Layer — Connected to real backend
 * Base URL: http://localhost:8000/api
 * Future: change to your deployed backend URL
 */

const BASE_URL = 'http://localhost:8000/api'

function getToken() {
  const user = localStorage.getItem('neurorelief_user')
  if (!user) return null
  try { return JSON.parse(user).token } catch { return null }
}

function headers(withAuth = true) {
  const h = { 'Content-Type': 'application/json' }
  if (withAuth) {
    const token = getToken()
    if (token) h['Authorization'] = `Bearer ${token}`
  }
  return h
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

// ─── Cycle Data ──────────────────────────────────────
export async function getCycleData(userId) {
  const res = await fetch(`${BASE_URL}/cycles`, { headers: headers() })
  const data = await res.json()

  if (data.currentData) {
    return {
      currentPhase: data.currentData.currentPhase,
      dayOfCycle: data.currentData.dayOfCycle,
      nextPeriod: data.currentData.nextPeriod,
      fertileWindow: data.currentData.fertileWindow,
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
  const data = await res.json()

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
      sleep_hours: entry.sleep,
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
  return res.json()
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
  const data = await res.json()
  return {
    scan_id: data.scan_id,
    timestamp: new Date().toISOString(),
    ...scanData,
    aiSummary: data.ai_summary
  }
}

export async function getPastScans(userId) {
  const res = await fetch(`${BASE_URL}/scans`, { headers: headers() })
  return res.json()
}

// ─── Reports ─────────────────────────────────────────
export async function getReports(userId) { return [] }
export async function uploadReport(userId, file) {
  return { report_id: 'rpt_' + Date.now(), fileName: file.name }
}
