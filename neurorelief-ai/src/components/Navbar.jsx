import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const navItems = [
  { label: 'Wellness', path: '/dashboard' },
  { label: 'Analyze Report', path: '/analyze-report' },
  { label: 'New Scan', path: '/scan' },
  { label: 'View Past Scans', path: '/past-scans' },
]

export default function Navbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuth()

  function handleLogout() {
    logout()
    navigate('/auth')
  }

  return (
    <nav className="flex items-center justify-between px-6 py-3 bg-white/70 backdrop-blur-sm sticky top-0 z-50">
      <div className="flex items-center gap-4">
        {/* Logo */}
        <div className="w-10 h-10 rounded-full bg-green-900 flex items-center justify-center">
          <span className="text-white text-xs font-bold">NR</span>
        </div>
        {/* Nav items */}
        {navItems.map(item => {
          const isActive = location.pathname === item.path
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                isActive
                  ? 'bg-brand-600 text-white'
                  : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {item.label}
            </button>
          )
        })}
      </div>
      <button
        onClick={handleLogout}
        className="text-brand-600 font-medium text-sm hover:text-brand-800 flex items-center gap-1"
      >
        Logout
      </button>
    </nav>
  )
}
