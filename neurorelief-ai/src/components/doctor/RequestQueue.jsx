import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../../i18n/format'
import { Icon } from '../icons'
import RequestRow, { TABLE_COLS } from './RequestRow'
import { SORTS } from './helpers'

const FILTERS = ['all', 'pending', 'accepted', 'declined', 'cancelled']
const PAGE_SIZE = 10

function Empty({ title, hint, action }) {
  return (
    <div className="text-center py-10 px-4">
      <span className="mx-auto mb-3 w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center"><Icon name="list" size={22} /></span>
      <p className="font-semibold text-slate-800">{title}</p>
      <p className="text-sm text-slate-500 mt-1">{hint}</p>
      {action}
    </div>
  )
}

// Search, status filter, sort and pagination over the doctor's own requests. All filtering is
// client-side on data already returned by GET /doctors/requests; Accept/Decline use the existing PATCH.
export default function RequestQueue({ list, filter, setFilter, busyId, onDecide, focusId }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('soonest')
  const [page, setPage] = useState(0)
  const handledFocus = useRef(null)

  const counts = useMemo(() => {
    const c = { all: list.length }
    for (const f of FILTERS.slice(1)) c[f] = list.filter(r => r.status === f).length
    return c
  }, [list])

  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase()
    const out = list.filter(r => (filter === 'all' || r.status === filter) && (!q || String(r.patient_name).toLocaleLowerCase().includes(q)))
    const cmp = sort === 'name' ? (a, b) => String(a.patient_name).localeCompare(String(b.patient_name), fmt.locale) || SORTS.soonest(a, b) : SORTS[sort]
    return out.sort(cmp)
  }, [list, filter, search, sort, fmt.locale])

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, pages - 1)
  const visible = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  // Opening a request from the bell: clear the search/sort and jump to the page that holds it
  useEffect(() => {
    if (focusId == null) { handledFocus.current = null; return }
    if (handledFocus.current === focusId) return
    handledFocus.current = focusId
    setSearch(''); setSort('soonest')
    const ordered = list.filter(r => filter === 'all' || r.status === filter).sort(SORTS.soonest)
    const idx = ordered.findIndex(r => r.appointment_id === focusId)
    setPage(idx >= 0 ? Math.floor(idx / PAGE_SIZE) : 0)
  }, [focusId, list, filter])

  useEffect(() => {
    if (focusId == null) return
    document.getElementById(`req-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusId, safePage, visible.length])

  const filtersActive = search.trim() !== '' || filter !== 'all'
  const clear = () => { setSearch(''); setFilter('all'); setPage(0) }
  const from = rows.length ? safePage * PAGE_SIZE + 1 : 0
  const to = Math.min(rows.length, (safePage + 1) * PAGE_SIZE)

  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5" aria-labelledby="queue-h">
      <h2 id="queue-h" className="font-bold text-slate-900 mb-3">{t('dd.reqTitle')}</h2>

      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div className="relative flex-1 basis-56 min-w-0">
          <label htmlFor="queue-search" className="sr-only">{t('dd.searchLabel')}</label>
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"><Icon name="search" size={16} /></span>
          <input id="queue-search" type="search" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} placeholder={t('dd.searchPh')} autoComplete="off"
            className="w-full pl-9 pr-9 py-2 text-sm rounded-xl border border-slate-200 bg-white focus:outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-100" />
          {search && (
            <button onClick={() => { setSearch(''); setPage(0) }} aria-label={t('dd.searchClear')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="queue-sort" className="text-xs font-semibold text-slate-600">{t('dd.sortLabel')}</label>
          <select id="queue-sort" value={sort} onChange={e => { setSort(e.target.value); setPage(0) }}
            className="text-sm rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-8 focus:outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-100 max-w-[14rem]">
            <option value="soonest">{t('dd.sortSoonest')}</option>
            <option value="latest">{t('dd.sortLatest')}</option>
            <option value="newest">{t('dd.sortNewest')}</option>
            <option value="name">{t('dd.sortName')}</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label={t('dd.filterAria')}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => { setFilter(f); setPage(0) }} aria-pressed={filter === f}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-100 ${
              filter === f ? 'bg-teal-600 text-white border-teal-600' : 'border-slate-200 text-slate-700 bg-white hover:bg-slate-50'}`}>
            {t(`dd.filter${f[0].toUpperCase() + f.slice(1)}`)}
            <span className={`px-1.5 rounded-full text-[11px] ${filter === f ? 'bg-white/25' : 'bg-slate-100 text-slate-600'}`}>{fmt.number(counts[f])}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        list.length === 0
          ? <Empty title={t('dd.none')} hint={t('dd.noneHint')} />
          : <Empty title={t('dd.noMatch')} hint={t('dd.noMatchHint')}
              action={filtersActive && <button onClick={clear} className="mt-3 px-4 py-1.5 rounded-lg border border-teal-300 text-teal-700 text-sm font-semibold hover:bg-teal-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-100">{t('dd.clearFilters')}</button>} />
      ) : (
        <>
          <div className={`hidden md:grid ${TABLE_COLS} gap-4 px-3.5 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500`} aria-hidden="true">
            <span>{t('dd.colPatient')}</span><span>{t('dd.colWhen')}</span><span>{t('dd.colStatus')}</span><span className="text-right">{t('dd.colActions')}</span>
          </div>
          <ul className="space-y-2">
            {visible.map(r => <RequestRow key={r.appointment_id} r={r} variant="table" highlighted={focusId === r.appointment_id} busyId={busyId} onDecide={onDecide} />)}
          </ul>
          <nav className="flex flex-wrap items-center justify-between gap-3 mt-4 text-sm text-slate-600" aria-label={t('dd.pagerLabel')}>
            <p>{t('dd.showing', { from: fmt.number(from), to: fmt.number(to), total: fmt.number(rows.length) })}</p>
            {pages > 1 && (
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(safePage - 1)} disabled={safePage === 0} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-medium hover:bg-slate-50 disabled:opacity-40 focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-100">{t('dd.prev')}</button>
                <span aria-live="polite">{t('dd.pageOf', { page: fmt.number(safePage + 1), pages: fmt.number(pages) })}</span>
                <button onClick={() => setPage(safePage + 1)} disabled={safePage >= pages - 1} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-medium hover:bg-slate-50 disabled:opacity-40 focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-100">{t('dd.next')}</button>
              </div>
            )}
          </nav>
        </>
      )}
    </section>
  )
}
