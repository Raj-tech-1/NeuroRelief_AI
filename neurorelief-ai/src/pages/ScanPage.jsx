import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { submitScan } from '../services/api'

const bodyAreas = ['Head', 'Thyroid', 'Chest', 'Breast', 'Abdomen', 'Pelvic', 'Back', 'Arms & Legs']
const lifeStages = [
  { id: 'Menstruating', title: 'Menstruating', desc: 'Regular menstrual cycles' },
  { id: 'Pregnant', title: 'Pregnant', desc: 'Currently expecting' },
  { id: 'Postpartum', title: 'Postpartum', desc: '0-12 months after birth' },
  { id: 'Perimenopause', title: 'Perimenopause', desc: 'Transitional phase (40-55)' },
  { id: 'Menopause', title: 'Menopause', desc: 'No period for 12+ months' },
  { id: 'Postmenopause', title: 'Postmenopause', desc: 'After menopause' },
]

export default function ScanPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [selectedAreas, setSelectedAreas] = useState([])
  const [selectedStage, setSelectedStage] = useState(null)
  const [symptomDesc, setSymptomDesc] = useState('')
  const [severity, setSeverity] = useState(5)
  const [medications, setMedications] = useState('')
  const [medList, setMedList] = useState([])
  const [additionalNotes, setAdditionalNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  function toggleArea(area) {
    setSelectedAreas(prev => prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area])
  }

  function addMedication() {
    if (medications.trim()) {
      setMedList(prev => [...prev, medications.trim()])
      setMedications('')
    }
  }

  function removeMedication(index) {
    setMedList(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit() {
    if (!selectedStage) { setError('Please select a life stage'); return }
    if (selectedAreas.length === 0) { setError('Please select at least one body area'); return }
    setError('')
    setSubmitting(true)
    try {
      const res = await submitScan({
        bodyAreas: selectedAreas,
        lifeStage: selectedStage,
        symptomDescription: symptomDesc,
        severity,
        medications: medList,
        notes: additionalNotes
      })
      setResult(res)
      setStep(2)
    } catch (err) {
      setError('Failed to submit scan. Make sure the backend is running.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-brand-50">
      <Navbar />
      <div className="max-w-[1300px] mx-auto px-6 py-6">
        {/* Progress */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white ${step >= 1 ? 'bg-brand-500' : 'bg-gray-300'}`}>1</div>
            <span className={`text-sm font-medium ${step >= 1 ? 'text-brand-600' : 'text-gray-400'}`}>Assessment</span>
          </div>
          <div className={`flex-1 h-1 mx-4 rounded ${step >= 2 ? 'bg-brand-500' : 'bg-gray-200'}`} />
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white ${step >= 2 ? 'bg-brand-500' : 'bg-gray-300'}`}>2</div>
            <span className={`text-sm font-medium ${step >= 2 ? 'text-brand-600' : 'text-gray-400'}`}>AI Biometric Scan</span>
          </div>
        </div>

        {step === 1 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="glass-card p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-brand-100 rounded-xl flex items-center justify-center"><span className="text-lg">📋</span></div>
                <div>
                  <h3 className="font-bold text-gray-900">Select Affected Areas</h3>
                  <p className="text-sm text-brand-600">Click on body regions where you're experiencing symptoms</p>
                </div>
              </div>
              <div className="flex justify-center my-6">
                <svg viewBox="0 0 200 400" className="w-48 h-80">
                  <circle cx="100" cy="40" r="28" fill={selectedAreas.includes('Head') ? '#F9A8D4' : '#FCE4EC'} stroke="#F48FB1" strokeWidth="1.5" className="cursor-pointer" onClick={() => toggleArea('Head')} />
                  <rect x="92" y="68" width="16" height="20" fill="#FCE4EC" stroke="#F48FB1" strokeWidth="1" />
                  <rect x="55" y="88" width="90" height="120" rx="10" fill={selectedAreas.includes('Chest') || selectedAreas.includes('Abdomen') ? '#F9A8D4' : '#FCE4EC'} stroke="#F48FB1" strokeWidth="1.5" className="cursor-pointer" onClick={() => toggleArea('Abdomen')} />
                  <rect x="20" y="95" width="30" height="100" rx="10" fill={selectedAreas.includes('Arms & Legs') ? '#F9A8D4' : '#FCE4EC'} stroke="#F48FB1" strokeWidth="1" className="cursor-pointer" onClick={() => toggleArea('Arms & Legs')} />
                  <rect x="150" y="95" width="30" height="100" rx="10" fill={selectedAreas.includes('Arms & Legs') ? '#F9A8D4' : '#FCE4EC'} stroke="#F48FB1" strokeWidth="1" className="cursor-pointer" onClick={() => toggleArea('Arms & Legs')} />
                  <rect x="60" y="208" width="80" height="40" rx="8" fill={selectedAreas.includes('Pelvic') ? '#F9A8D4' : '#FCE4EC'} stroke="#F48FB1" strokeWidth="1.5" className="cursor-pointer" onClick={() => toggleArea('Pelvic')} />
                  <rect x="60" y="250" width="32" height="120" rx="10" fill={selectedAreas.includes('Arms & Legs') ? '#F9A8D4' : '#FCE4EC'} stroke="#F48FB1" strokeWidth="1" className="cursor-pointer" onClick={() => toggleArea('Arms & Legs')} />
                  <rect x="108" y="250" width="32" height="120" rx="10" fill={selectedAreas.includes('Arms & Legs') ? '#F9A8D4' : '#FCE4EC'} stroke="#F48FB1" strokeWidth="1" className="cursor-pointer" onClick={() => toggleArea('Arms & Legs')} />
                </svg>
              </div>
              <div className="flex flex-wrap gap-2 justify-center">
                {bodyAreas.map(area => (
                  <button key={area} onClick={() => toggleArea(area)}
                    className={`px-4 py-2 rounded-full text-sm border transition ${selectedAreas.includes(area) ? 'bg-brand-500 text-white border-brand-500' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                    {area}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="glass-card p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center"><span className="text-lg">👤</span></div>
                  <div>
                    <h3 className="font-bold text-gray-900">Life Stage</h3>
                    <p className="text-sm text-brand-600">Select your current life stage for accurate assessment</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {lifeStages.map(stage => (
                    <button key={stage.id} onClick={() => setSelectedStage(stage.id)}
                      className={`p-3 rounded-xl text-left border transition ${selectedStage === stage.id ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <p className="text-sm font-semibold text-gray-900">{stage.title}</p>
                      <p className="text-xs text-gray-500">{stage.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="glass-card p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-brand-100 rounded-xl flex items-center justify-center"><span className="text-lg">📝</span></div>
                  <div>
                    <h3 className="font-bold text-gray-900">Symptom Details</h3>
                    <p className="text-sm text-brand-600">Describe your symptoms in detail</p>
                  </div>
                </div>

                <label className="block text-sm font-medium text-gray-700 mb-1">Describe your symptom</label>
                <textarea value={symptomDesc} onChange={e => setSymptomDesc(e.target.value)}
                  placeholder="e.g., Sharp pain when breathing, dull ache..."
                  className="w-full border rounded-lg p-3 text-sm mb-3" rows={3} />

                <label className="block text-sm font-medium text-gray-700 mb-1">Severity (1-10): {severity}</label>
                <input type="range" min="1" max="10" value={severity} onChange={e => setSeverity(Number(e.target.value))}
                  className="w-full mb-1" style={{ accentColor: '#DB2777' }} />
                <div className="flex justify-between text-xs text-gray-400 mb-3"><span>Mild</span><span>Severe</span></div>

                <label className="block text-sm font-medium text-gray-700 mb-1">Current Medications</label>
                <div className="flex gap-2 mb-2">
                  <input value={medications} onChange={e => setMedications(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addMedication())}
                    placeholder="e.g., Ibuprofen, Birth control..."
                    className="flex-1 px-3 py-2 border rounded-lg text-sm" />
                  <button onClick={addMedication} className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm">Add</button>
                </div>
                {medList.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {medList.map((m, i) => (
                      <span key={i} onClick={() => removeMedication(i)} className="text-xs bg-pink-50 text-brand-600 px-2 py-1 rounded-full cursor-pointer hover:bg-pink-100">{m} ✕</span>
                    ))}
                  </div>
                )}

                <label className="block text-sm font-medium text-gray-700 mb-1">Additional Notes (optional)</label>
                <textarea value={additionalNotes} onChange={e => setAdditionalNotes(e.target.value)}
                  placeholder="Any additional information..." className="w-full border rounded-lg p-3 text-sm" rows={2} />

                {error && <p className="text-sm text-red-500 mt-2">{error}</p>}

                <button onClick={handleSubmit} disabled={submitting}
                  className="w-full mt-4 py-3 bg-brand-500 text-white rounded-lg font-medium hover:bg-brand-600 disabled:opacity-60">
                  {submitting ? 'Submitting...' : 'Submit Assessment'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="glass-card p-8 max-w-2xl mx-auto text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4"><span className="text-3xl">✅</span></div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Scan Complete</h3>
            <p className="text-gray-500 mb-6">{result?.aiSummary}</p>
            <div className="bg-purple-50 p-4 rounded-xl text-left mb-4">
              <p className="text-sm"><span className="font-medium">Areas:</span> {result?.bodyAreas?.join(', ')}</p>
              <p className="text-sm"><span className="font-medium">Life Stage:</span> {result?.lifeStage}</p>
              <p className="text-sm"><span className="font-medium">Severity:</span> {result?.severity}/10</p>
              {result?.symptomDescription && <p className="text-sm"><span className="font-medium">Description:</span> {result.symptomDescription}</p>}
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={() => navigate('/past-scans')} className="px-6 py-2 bg-brand-500 text-white rounded-lg font-medium">View Past Scans</button>
              <button onClick={() => navigate('/dashboard')} className="px-6 py-2 border border-gray-300 rounded-lg font-medium">Back to Dashboard</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
