import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Spinner from '../components/Spinner'
import { getPastScans } from '../services/api'

export default function AnalyzeReportPage() {
  const navigate = useNavigate()
  const [scans, setScans] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedScan, setSelectedScan] = useState(null)

  useEffect(() => {
    getPastScans('usr')
      .then(data => setScans(Array.isArray(data) ? data : []))
      .catch(() => setScans([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="min-h-screen bg-brand-50">
      <Navbar />
      <Spinner text="Loading reports..." />
    </div>
  )

  // If user has scans, show the latest as a report
  if (selectedScan) {
    return (
      <div className="min-h-screen bg-brand-50">
        <Navbar />
        <div className="max-w-[800px] mx-auto px-6 py-8">
          <button onClick={() => setSelectedScan(null)} className="text-brand-600 text-sm font-medium mb-4 hover:text-brand-800">← Back to reports</button>
          <div className="glass-card p-8">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-brand-100 rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-2xl">📄</span></div>
              <h2 className="text-xl font-bold text-gray-900">Health Assessment Report</h2>
              <p className="text-sm text-gray-500">{new Date(selectedScan.created_at).toLocaleString()}</p>
            </div>

            <div className="space-y-4">
              <div className="bg-pink-50 p-4 rounded-xl">
                <h4 className="font-semibold text-brand-800 mb-2">Patient Information</h4>
                <div className="grid grid-cols-2 gap-y-2 text-sm">
                  <p className="text-gray-500">Life Stage:</p>
                  <p className="font-medium">{selectedScan.life_stage}</p>
                  <p className="text-gray-500">Assessment Date:</p>
                  <p className="font-medium">{new Date(selectedScan.created_at).toLocaleDateString()}</p>
                </div>
              </div>

              <div className="bg-purple-50 p-4 rounded-xl">
                <h4 className="font-semibold text-purple-800 mb-2">Symptom Assessment</h4>
                <div className="grid grid-cols-2 gap-y-2 text-sm">
                  <p className="text-gray-500">Affected Areas:</p>
                  <p className="font-medium">{selectedScan.body_areas}</p>
                  <p className="text-gray-500">Pain Severity:</p>
                  <p className="font-medium">{selectedScan.severity}/10 — {selectedScan.severity <= 3 ? 'Mild' : selectedScan.severity <= 6 ? 'Moderate' : 'Severe'}</p>
                  {selectedScan.symptom_description && <>
                    <p className="text-gray-500">Description:</p>
                    <p className="font-medium">{selectedScan.symptom_description}</p>
                  </>}
                </div>
              </div>

              {selectedScan.medications && (
                <div className="bg-orange-50 p-4 rounded-xl">
                  <h4 className="font-semibold text-orange-800 mb-2">Current Medications</h4>
                  <p className="text-sm">{selectedScan.medications}</p>
                </div>
              )}

              <div className="bg-green-50 p-4 rounded-xl">
                <h4 className="font-semibold text-green-800 mb-2">AI Analysis & Recommendations</h4>
                <p className="text-sm text-gray-600">{selectedScan.ai_summary}</p>
                <div className="mt-3 pt-3 border-t border-green-200">
                  <p className="text-sm font-medium text-green-800 mb-1">General Recommendations:</p>
                  <p className="text-sm text-gray-600">• Monitor symptoms and track any changes daily</p>
                  <p className="text-sm text-gray-600">• Maintain adequate hydration (8 glasses/day)</p>
                  <p className="text-sm text-gray-600">• Practice stress-reduction techniques</p>
                  {selectedScan.severity > 5 && (
                    <p className="text-sm text-gray-600">• Consider consulting with a healthcare provider for persistent symptoms</p>
                  )}
                  {selectedScan.severity > 7 && (
                    <p className="text-sm text-red-600 font-medium">• High severity detected — seek professional medical advice soon</p>
                  )}
                </div>
              </div>

              {selectedScan.notes && (
                <div className="bg-gray-50 p-4 rounded-xl">
                  <h4 className="font-semibold text-gray-800 mb-2">Additional Notes</h4>
                  <p className="text-sm text-gray-600">{selectedScan.notes}</p>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => window.print()} className="flex-1 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium">Print Report</button>
              <button onClick={() => setSelectedScan(null)} className="flex-1 py-2 border border-gray-300 rounded-lg text-sm font-medium">Back</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-brand-50">
      <Navbar />
      <div className="max-w-[800px] mx-auto px-6 py-8">
        {scans.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <div className="w-16 h-16 bg-pink-100 rounded-full flex items-center justify-center mx-auto mb-4"><span className="text-2xl">📄</span></div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">No Report Available</h3>
            <p className="text-gray-500 mb-6">Complete an assessment to view your health report.</p>
            <button onClick={() => navigate('/scan')} className="px-8 py-3 bg-brand-500 text-white rounded-lg font-medium hover:bg-brand-600">Start Assessment</button>
          </div>
        ) : (
          <div className="glass-card p-6">
            <h3 className="text-lg font-bold text-brand-800 mb-1">Your Health Reports</h3>
            <p className="text-sm text-gray-500 mb-4">View detailed analysis from your assessments</p>
            <div className="space-y-3">
              {scans.map(scan => (
                <div key={scan.scan_id} className="border border-gray-100 rounded-xl p-4 hover:bg-gray-50 transition cursor-pointer" onClick={() => setSelectedScan(scan)}>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold text-gray-900">Assessment Report</p>
                      <p className="text-sm text-gray-500">{scan.life_stage} • {scan.body_areas} • Severity: {scan.severity}/10</p>
                    </div>
                    <p className="text-xs text-gray-400">{new Date(scan.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => navigate('/scan')} className="w-full mt-4 py-2 border border-brand-300 text-brand-600 rounded-lg text-sm font-medium hover:bg-brand-50">+ New Assessment</button>
          </div>
        )}
      </div>
    </div>
  )
}
