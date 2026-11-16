import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import { getMe, updateMyProfile } from '../services/api'

const LEGACY_KEY = 'neurorelief_profile'   // older versions kept age/height/weight only in this browser

export default function ProfilePage({ onClose, onSaved }) {
  const { user, updateUser } = useAuth()
  const [saveError, setSaveError] = useState('')   // translation key
  const { t } = useTranslation()
  const [name, setName] = useState(user?.name || '')
  const [age, setAge] = useState('')
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [bmi, setBmi] = useState(null)
  const [loading, setLoading] = useState(true)
  const [fromBrowser, setFromBrowser] = useState(false)   // values pre-filled from the old browser-only profile
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(false)   // true while the 'saved' confirmation is showing (text is translated at render)

  useEffect(() => {
    let alive = true
    // The profile lives on the account (server). If it is still empty, offer the old browser-only values once.
    getMe().then(me => {
      if (!alive) return
      const p = me.profile || {}
      setName(me.name || '')
      setAge(p.age ?? ''); setHeight(p.height ?? ''); setWeight(p.weight ?? ''); setBmi(p.bmi ?? null)
      if (p.age == null && p.height == null && p.weight == null) {
        let old = null
        try { old = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null') } catch { /* corrupt: ignore */ }
        if (old && old.owner_id === user?.user_id && (old.age || old.height || old.weight)) {
          setAge(old.age || ''); setHeight(old.height || ''); setWeight(old.weight || '')
          setFromBrowser(true)
        }
      }
    }).catch(() => { if (alive) setSaveError('profile.loadFailed') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [user?.user_id])

  useEffect(() => {
    // Live preview only; the saved BMI is computed by the server
    const h = parseFloat(height) / 100 // cm to m
    const w = parseFloat(weight)
    setBmi(h > 0 && w > 0 ? Math.round((w / (h * h)) * 10) / 10 : null)
  }, [height, weight])

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setSaveError('')
    try {
      // Everything is saved on the account: the name is shown to doctors; age and BMI feed the pain model.
      // An empty measurement field clears it (null).
      const blank = v => (v === '' || v == null ? null : Number(v))
      const saved = await updateMyProfile({ name, age: blank(age), height: blank(height), weight: blank(weight) })
      updateUser({ name: saved.name })
      setName(saved.name)
      setBmi(saved.profile?.bmi ?? null)
      setFromBrowser(false)
      try { localStorage.removeItem(LEGACY_KEY) } catch { /* storage unavailable */ }

      setSaveMsg(true)
      setTimeout(() => setSaveMsg(false), 2000)
      onSaved?.(saved)
    } catch (err) {
      setSaveError(err.status === 400 ? (err.message?.startsWith('Name') || err.message?.startsWith('Please enter') ? 'profile.nameInvalid' : 'profile.rangeInvalid') : 'profile.saveFailed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="glass-card p-6 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-brand-800">{t('profile.title')}</h3>
        {onClose && (
          <button onClick={onClose} aria-label={t('profile.close')} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
        )}
      </div>

      <div className="flex items-center gap-4 mb-6">
        <div className="w-16 h-16 rounded-full bg-brand-500 text-white flex items-center justify-center text-2xl font-bold">
          {name?.charAt(0)?.toUpperCase() || 'U'}
        </div>
        <div>
          <p className="font-semibold text-gray-900">{name || t('profile.user')}</p>
          <p className="text-sm text-gray-500">{user?.email}</p>
        </div>
      </div>

      <div className="space-y-4">
        {loading && <p role="status" className="text-sm text-brand-700">{t('common.loading')}</p>}
        {fromBrowser && <p role="status" className="text-xs text-brand-800 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">{t('profile.fromBrowser')}</p>}
        <p className="text-xs text-gray-500">{t('profile.privacy')}</p>
        <div>
          <label htmlFor="pf-name" className="block text-sm font-medium text-gray-700 mb-1">{t('profile.name')}</label>
          <input id="pf-name" value={name} onChange={e => setName(e.target.value)} maxLength={60} autoComplete="name"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
        </div>

        <div>
          <label htmlFor="pf-age" className="block text-sm font-medium text-gray-700 mb-1">{t('profile.age')}</label>
          <input id="pf-age" type="number" value={age} onChange={e => setAge(e.target.value)} min="10" max="80" placeholder={t('profile.agePh')}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          <p className="text-xs text-gray-400 mt-1">{t('profile.ageHint')}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="pf-height" className="block text-sm font-medium text-gray-700 mb-1">{t('profile.height')}</label>
            <input id="pf-height" type="number" value={height} onChange={e => setHeight(e.target.value)} min="100" max="220" placeholder={t('profile.heightPh')}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          </div>
          <div>
            <label htmlFor="pf-weight" className="block text-sm font-medium text-gray-700 mb-1">{t('profile.weight')}</label>
            <input id="pf-weight" type="number" value={weight} onChange={e => setWeight(e.target.value)} min="30" max="200" placeholder={t('profile.weightPh')}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-400" />
          </div>
        </div>

        {bmi && (
          <div className={`p-3 rounded-xl text-center ${bmi < 18.5 ? 'bg-yellow-50' : bmi < 25 ? 'bg-green-50' : bmi < 30 ? 'bg-orange-50' : 'bg-red-50'}`}>
            <p className="text-xs text-gray-500">{t('profile.bmi')}</p>
            <p className="text-2xl font-bold text-gray-900">{bmi}</p>
            <p className="text-xs text-gray-500">
              {bmi < 18.5 ? t('profile.underweight') : bmi < 25 ? t('profile.normal') : bmi < 30 ? t('profile.overweight') : t('profile.obese')}
            </p>
          </div>
        )}

        {saveMsg && <p role="status" className="text-sm text-green-600 font-medium text-center">{t('profile.saved')}</p>}
        {saveError && <p role="alert" className="text-sm text-red-600 font-medium text-center">{t(saveError)}</p>}

        <button onClick={handleSave} disabled={saving || loading}
          className="w-full py-2.5 bg-brand-500 text-white rounded-lg font-medium hover:bg-brand-600 disabled:opacity-60">
          {saving ? t('common.saving') : t('profile.save')}
        </button>
      </div>
    </div>
  )
}
