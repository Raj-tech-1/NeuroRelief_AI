import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import LanguageSelector from '../components/LanguageSelector'
import { useAuth } from '../context/AuthContext'

// Temporary landing page for roles whose dashboards are not built yet.
export default function RoleHome({ title }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()

  function handleLogout() {
    logout()
    navigate('/auth')
  }

  return (
    <div className="min-h-screen bg-brand-50 flex items-center justify-center p-6 relative">
      <div className="absolute top-4 right-4"><LanguageSelector /></div>
      <div className="glass-card p-10 text-center max-w-md w-full">
        <h1 className="text-2xl font-bold text-brand-800 mb-2">{t('role.comingSoon', { title })}</h1>
        <p className="text-sm text-gray-500 mb-6">{t('role.signedIn', { email: user?.email })}</p>
        <button onClick={handleLogout}
          className="px-6 py-2.5 bg-brand-500 text-white rounded-lg font-medium hover:bg-brand-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300">
          {t('nav.logout')}
        </button>
      </div>
    </div>
  )
}
