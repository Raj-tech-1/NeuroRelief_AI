import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Spinner from '../components/Spinner'
import { getPastScans } from '../services/api'

export default function PastScansPage() {
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

  return (
    <div className="min-h-screen bg-brand-50">
      <Navbar />
      <div className="max-w-[1300px] mx-auto px-6 py-6">
        <div className="glass-card p-6">
          <div className="text-center mb-4">
            <button className="px-6 py-2 border border-brand-300 text-brand-600 rounded-full text-sm font-medium">
              AI Summary
            </button>
          </div>

          {loading ? (
            <Spinner text="Loading scans..." />
          ) : scans.length === 0 ? (
            <>
              <div className="bg-white border border-gray-100 rounded-xl p-4 mb-8">
                <p className="text-sm text-gray-500">No scan history yet. Complete your first scan to see AI-powered insights about your health patterns.</p>
              </div>
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-pink-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">📋</span>
                </div>
                <p className="text-gray-400 mb-4">No scans yet</p>
                <button onClick={() => navigate('/scan')} className="px-8 py-3 bg-brand-500 text-white rounded-lg font-medium hover:bg-brand-600">
                  Start Your First Scan
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Selected scan detail */}
              {selectedScan && (
                <div className="bg-purple-50 p-5 rounded-xl mb-6">
                  <div className="flex justify-between items-start mb-3">
                    <h4 className="font-bold text-gray-900">Scan Details</h4>
                    <button onClick={() => setSelectedScan(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <p className="text-gray-500">Date:</p>
                    <p className="font-medium">{new Date(selectedScan.created_at).toLocaleString()}</p>
                    <p className="text-gray-500">Life Stage:</p>
                    <p className="font-medium">{selectedScan.life_stage}</p>
                    <p className="text-gray-500">Body Areas:</p>
                    <p className="font-medium">{selectedScan.body_areas}</p>
                    <p className="text-gray-500">Severity:</p>
                    <p className="font-medium">{selectedScan.severity}/10</p>
                    {selectedScan.symptom_description && <>
                      <p className="text-gray-500">Description:</p>
                      <p className="font-medium">{selectedScan.symptom_description}</p>
                    </>}
                    {selectedScan.medications && <>
                      <p className="text-gray-500">Medications:</p>
                      <p className="font-medium">{selectedScan.medications}</p>
                    </>}
                  </div>
                  {selectedScan.ai_summary && (
                    <div className="mt-3 p-3 bg-white rounded-lg">
                      <p className="text-xs text-brand-600 font-semibold">AI Summary</p>
                      <p className="text-sm text-gray-600">{selectedScan.ai_summary}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {scans.map(scan => (
                  <div key={scan.scan_id} className="border border-gray-100 rounded-xl p-4 text-center hover:bg-gray-50 transition">
                    <p className="text-xs text-gray-400 mb-2">{new Date(scan.created_at).toLocaleString()}</p>
                    <p className="text-xs text-brand-600 font-semibold">LIFE STAGE</p>
                    <p className="text-sm mb-2">{scan.life_stage}</p>
                    <p className="text-xs text-brand-600 font-semibold">AREA OF CONCERN</p>
                    <p className="text-sm mb-2">{scan.body_areas}</p>
                    <p className="text-xs text-brand-600 font-semibold">SEVERITY</p>
                    <p className="text-sm mb-3">{scan.severity}/10</p>
                    <button
                      onClick={() => setSelectedScan(scan)}
                      className="w-full py-2 bg-brand-500 text-white text-sm rounded-lg hover:bg-brand-600"
                    >
                      Click to see full report
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
