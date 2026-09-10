import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import AuthPage from './pages/AuthPage'
import Dashboard from './pages/Dashboard'
import ScanPage from './pages/ScanPage'
import PastScansPage from './pages/PastScansPage'
import AnalyzeReportPage from './pages/AnalyzeReportPage'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen bg-brand-50 flex items-center justify-center"><p className="text-brand-700">Loading...</p></div>
  if (!user) return <Navigate to="/auth" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/scan" element={<ProtectedRoute><ScanPage /></ProtectedRoute>} />
      <Route path="/past-scans" element={<ProtectedRoute><PastScansPage /></ProtectedRoute>} />
      <Route path="/analyze-report" element={<ProtectedRoute><AnalyzeReportPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/auth" replace />} />
    </Routes>
  )
}
