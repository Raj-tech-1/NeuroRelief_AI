import { COMPONENT_BY_ID, DISCLAIMER, SYSTEMS } from './specs'

// Line icons used only by the Device 3D Explorer
const PATHS = {
  cube: <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
  layers: <path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5" />,
  play: <path d="M7 4.5v15l12-7.5L7 4.5z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  rotate: <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" />,
  zoomIn: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5M11 8v6M8 11h6" /></>,
  zoomOut: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5M8 11h6" /></>,
  home: <path d="M3 11l9-8 9 8M5 10v10h14V10" />,
  reset: <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" />,
  prev: <path d="M6 5v14M19 5l-9 7 9 7V5z" />,
  next: <path d="M18 5v14M5 5l9 7-9 7V5z" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  camera: <><path d="M3 8h4l2-3h6l2 3h4v11H3z" /><circle cx="12" cy="13" r="3.5" /></>,
  tag: <><path d="M3 12V4h8l10 10-8 8L3 12z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  focus: <><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /><circle cx="12" cy="12" r="2.5" /></>,
}

export function XIcon({ name, size = 20, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}

export function DisclaimerCard() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-brand-100 bg-white/90 px-4 py-3 shadow-sm">
      <span className="shrink-0 w-8 h-8 rounded-full bg-brand-500 text-white flex items-center justify-center">
        <XIcon name="info" size={18} />
      </span>
      <div className="text-[13px] leading-snug">
        <p className="font-semibold text-gray-900">This is an educational visualisation of our prototype.</p>
        <p className="text-gray-600">The heating system and the commercial TENS unit are separate devices and are not electrically connected. {DISCLAIMER}</p>
      </div>
    </div>
  )
}

export function ViewToolbar({ onRotate, rotating, onZoomIn, onZoomOut, onReset, extra }) {
  const btn = 'flex flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-[10px] font-medium text-gray-700 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300'
  return (
    <div className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-0.5 rounded-2xl bg-white/90 backdrop-blur border border-brand-100 shadow-md p-1">
      <button className={`${btn} ${rotating ? 'bg-brand-100 text-brand-800' : ''}`} onClick={onRotate} aria-pressed={rotating} title="Auto-rotate">
        <XIcon name="rotate" /> <span className="hidden sm:block">Rotate</span>
      </button>
      <button className={btn} onClick={onZoomIn} title="Zoom in"><XIcon name="zoomIn" /> <span className="hidden sm:block">Zoom In</span></button>
      <button className={btn} onClick={onZoomOut} title="Zoom out"><XIcon name="zoomOut" /> <span className="hidden sm:block">Zoom Out</span></button>
      <button className={btn} onClick={onReset} title="Reset view"><XIcon name="home" /> <span className="hidden sm:block">Reset</span></button>
      {extra}
    </div>
  )
}

export function SystemBadge({ group }) {
  const tens = group === 'tens'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tens ? 'bg-blue-50 text-blue-700' : 'bg-brand-50 text-brand-700'}`}>
      {SYSTEMS[group].short}
    </span>
  )
}

export function DetailsPanel({ id, onFocus, onClose, compact = false, note }) {
  const c = COMPONENT_BY_ID[id]
  if (!c) {
    return (
      <div className="rounded-2xl border border-dashed border-brand-200 bg-white/70 p-5 text-sm text-gray-500">
        Select a component in the 3D view or the list to see its details.
      </div>
    )
  }
  return (
    <div className="rounded-2xl border border-brand-100 bg-white shadow-sm p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <SystemBadge group={c.group} />
          <h3 className="mt-2 text-lg font-bold text-brand-900 leading-tight">{c.name}</h3>
          <p className="text-sm font-medium text-brand-600">{c.dims}</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-brand-50" aria-label="Close details">
            <XIcon name="close" size={18} />
          </button>
        )}
      </div>
      <p className="mt-3 text-sm text-gray-700 leading-relaxed">{c.purpose}</p>
      {!compact && (
        <dl className="mt-3 divide-y divide-brand-50 rounded-xl bg-brand-50/50 px-3">
          {c.specs.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 py-2 text-[13px]">
              <dt className="text-gray-500">{k}</dt>
              <dd className="font-medium text-gray-900 text-right">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {note && <p className="mt-3 text-xs text-gray-500">{note}</p>}
      {onFocus && (
        <button onClick={onFocus} className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-brand-200 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50">
          <XIcon name="focus" size={16} /> Focus in 3D
        </button>
      )}
    </div>
  )
}

export function FlowLegend() {
  return (
    <div className="hidden md:block absolute right-3 top-3 z-10 rounded-2xl bg-white/85 backdrop-blur border border-brand-100 shadow-sm px-3 py-2.5 text-[11px] text-gray-700 space-y-1.5">
      <p className="flex items-center gap-2"><span className="w-7 h-1 rounded-full bg-[#ff3d55]" /> Heating power flow (5 V)</p>
      <p className="flex items-center gap-2"><span className="w-7 h-1 rounded-full bg-[#3f7bff]" /> TENS pulses (separate device)</p>
      <p className="flex items-center gap-2"><span className="w-7 h-0 border-t-2 border-dashed border-[#8f6bff]" /> Temperature data (sensor)</p>
      <p className="flex items-center gap-2"><span className="w-7 h-1 rounded-full bg-[#ff9a4d]" /> Warmth (illustrative)</p>
    </div>
  )
}

// Soft lavender backdrop used behind every 3D canvas
export const VIEWPORT_BG = 'bg-[radial-gradient(ellipse_at_top,_#ffffff_0%,_#f6eefb_45%,_#ecdff6_100%)]'
