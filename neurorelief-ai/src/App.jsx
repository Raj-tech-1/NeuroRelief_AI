import { Routes, Route, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from './context/AuthContext'
import AuthPage from './pages/AuthPage'
import Dashboard from './pages/Dashboard'
import ScanPage from './pages/ScanPage'
import PastScansPage from './pages/PastScansPage'
import AnalyzeReportPage from './pages/AnalyzeReportPage'
import RoleHome from './pages/RoleHome'
import DoctorDashboard from './pages/DoctorDashboard'
import { homeForRole } from './utils/roles'

// UI guard only: real access control is enforced by the backend.
// Each role's home route is allowed for that role, so redirects cannot loop.
function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth()
  const { t } = useTranslation()
  if (loading) return <div className="min-h-screen bg-brand-50 flex items-center justify-center"><p className="text-brand-700">{t('common.loading')}</p></div>
  if (!user) return <Navigate to="/auth" replace />
  const home = homeForRole(user.role)
  // Missing/unrecognised role (e.g. an old saved session): send to login, which does not auto-redirect it.
  if (!home) return <Navigate to="/auth" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to={home} replace />
  return children
}

export default function App() {
  const { t } = useTranslation()
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/dashboard" element={<ProtectedRoute roles={['user']}><Dashboard /></ProtectedRoute>} />
      <Route path="/scan" element={<ProtectedRoute roles={['user']}><ScanPage /></ProtectedRoute>} />
      <Route path="/past-scans" element={<ProtectedRoute roles={['user']}><PastScansPage /></ProtectedRoute>} />
      <Route path="/analyze-report" element={<ProtectedRoute roles={['user']}><AnalyzeReportPage /></ProtectedRoute>} />
      <Route path="/doctor" element={<ProtectedRoute roles={['doctor']}><DoctorDashboard /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute roles={['admin']}><RoleHome title={t('role.adminArea')} /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/auth" replace />} />
    </Routes>
  )
}
